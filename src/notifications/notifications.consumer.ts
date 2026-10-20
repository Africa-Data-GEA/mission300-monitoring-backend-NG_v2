import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { RabbitmqService } from "@/events/rabbitmq.service";
import { PrismaService } from "@/prisma/prisma.service";
import { EmailService } from "@/notifications/email/email.service";
import { WebhooksService } from "@/notifications/webhooks/webhooks.service";
import { AuthService } from "@/modules/auth/auth.service";
import {
  submissionDecisionEmail,
  submissionReceivedEmail,
  submissionAwaitingReviewEmail,
  reportReadyEmail,
  type EmailBrand,
} from "@/notifications/email/templates";
import { BrandingService } from "@/modules/administration/branding/branding.service";
import { REPORT_TYPE_LABELS } from "@/modules/reports/reports.mappers";
import { NotificationsFeedService } from "@/notifications/feed/notifications-feed.service";

/**
 * Single subscriber for every notification-worthy domain event, fanning
 * each one out to both channels (email + webhook). Adding a new
 * notification later means one more `case`, not new plumbing - both
 * channels already run off this one RabbitMQ subscription.
 */
@Injectable()
export class NotificationsConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitmqService,
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly webhooks: WebhooksService,
    private readonly auth: AuthService,
    private readonly branding: BrandingService,
    private readonly feed: NotificationsFeedService,
  ) {}

  /** Whatever an admin has currently saved in Administration > Customization. */
  private async getEmailBrand(): Promise<EmailBrand> {
    const settings = await this.branding.get();
    return {
      primaryColor: settings.primaryColor,
      secondaryColor: settings.secondaryColor,
      logoUrl: settings.logoUrl,
      countryName: settings.countryName,
      officialName: settings.officialName,
    };
  }

  async onModuleInit() {
    await this.rabbitmq.subscribe(
      "notifications.dispatch",
      ["submission.decision_recorded", "submission.uploaded", "user.invited", "report.ready"],
      (payload, event) => this.handle(event, payload),
    );
  }

  private async handle(event: string, payload: unknown): Promise<void> {
    // Webhooks always fire, regardless of whether we also have an email
    // recipient for this particular event - the two channels are independent.
    await this.webhooks.dispatch(event, payload);

    switch (event) {
      case "submission.decision_recorded":
        return this.notifySubmissionDecision(payload as { submissionId: string });
      case "submission.uploaded":
        return this.notifySubmissionUploaded(payload as { submissionId: string });
      case "user.invited":
        return this.notifyUserInvited(payload as { userId: string; email: string });
      case "report.ready":
        return this.notifyReportReady(payload as { reportId: string });
    }
  }

  private async notifySubmissionDecision({ submissionId }: { submissionId: string }) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        institution: true,
        submittedBy: true,
        reviewDecisions: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    const latestDecision = submission?.reviewDecisions[0];
    if (!submission || !latestDecision) return;

    const { subject, html } = submissionDecisionEmail(
      {
        institutionName: submission.institution.name,
        decision: latestDecision.decision,
        comment: latestDecision.comment,
      },
      await this.getEmailBrand(),
    );
    await this.email.send({ to: submission.submittedBy.email, subject, html });
    await this.feed.create(
      submission.submittedBy.id,
      `Submission ${latestDecision.decision.toLowerCase()}`,
      `Your ${submission.institution.name} submission was ${latestDecision.decision.toLowerCase()}.`,
      "/data-submissions/submissions",
    );
  }

  /**
   * Two audiences, both from one event: a confirmation to whoever
   * submitted, and a heads-up to every DATA_REVIEWER/VALIDATOR - there's
   * no per-submission reviewer assignment yet (that's Phase 3 of the Data
   * Submissions rebuild), so the whole reviewer pool hears about it
   * rather than nobody at all.
   */
  private async notifySubmissionUploaded({ submissionId }: { submissionId: string }) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        institution: true,
        submittedBy: true,
        obligation: { include: { dataset: true } },
      },
    });
    if (!submission || !submission.obligation) return;

    const brand = await this.getEmailBrand();
    const frontendUrl = process.env.FRONTEND_URL;

    const received = submissionReceivedEmail(
      {
        institutionName: submission.institution.name,
        datasetName: submission.obligation.dataset.name,
        reportingPeriod: submission.obligation.reportingPeriod,
        submissionsUrl: `${frontendUrl}/data-submissions/submissions`,
      },
      brand,
    );
    await this.email.send({
      to: submission.submittedBy.email,
      subject: received.subject,
      html: received.html,
    });
    await this.feed.create(
      submission.submittedBy.id,
      "Submission received",
      `${submission.obligation.dataset.name} (${submission.obligation.reportingPeriod}) was submitted for review.`,
      "/data-submissions/submissions",
    );

    const reviewers = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { role: { in: ["DATA_REVIEWER", "VALIDATOR"] } },
          { roles: { hasSome: ["DATA_REVIEWER", "VALIDATOR"] } },
        ],
        AND: [{
          OR: [
            { institutionId: submission.institutionId },
            { role: { in: ["SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER", "OVERSIGHT_USER", "READ_ONLY_USER"] } },
            { roles: { hasSome: ["SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER", "OVERSIGHT_USER", "READ_ONLY_USER"] } },
          ],
        }],
      },
    });
    const awaitingReview = submissionAwaitingReviewEmail(
      {
        institutionName: submission.institution.name,
        datasetName: submission.obligation.dataset.name,
        reportingPeriod: submission.obligation.reportingPeriod,
        submittedByName: submission.submittedBy.fullName,
        validationUrl: `${frontendUrl}/data-submissions/validation/${submission.id}`,
      },
      brand,
    );
    await Promise.all(
      reviewers.map((reviewer) =>
        this.email.send({ to: reviewer.email, subject: awaitingReview.subject, html: awaitingReview.html }),
      ),
    );
    await this.feed.createMany(
      reviewers.map((reviewer) => reviewer.id),
      "Submission awaiting review",
      `${submission.institution.name} submitted ${submission.obligation.dataset.name} (${submission.obligation.reportingPeriod}).`,
      `/data-submissions/validation/${submission.id}`,
    );
  }

  private async notifyUserInvited({ userId }: { userId: string; email: string }) {
    // Token generation happens HERE, not in the "user.invited" event
    // payload above (which webhook subscribers also receive verbatim) -
    // a raw set-password token must never travel through a channel meant
    // for third-party fan-out. See AuthService.sendAccountInvitedEmail().
    await this.auth.sendAccountInvitedEmail(userId);
  }

  private async notifyReportReady({ reportId }: { reportId: string }) {
    const report = await this.prisma.savedReport.findUnique({
      where: { id: reportId },
      include: { requestedBy: true },
    });
    if (!report) return;

    const { subject, html } = reportReadyEmail(
      { reportType: REPORT_TYPE_LABELS[report.reportType] },
      await this.getEmailBrand(),
    );
    await this.email.send({ to: report.requestedBy.email, subject, html });
    await this.feed.create(
      report.requestedBy.id,
      "Report ready",
      `${REPORT_TYPE_LABELS[report.reportType]} is ready to download.`,
      "/reports",
    );
  }
}
