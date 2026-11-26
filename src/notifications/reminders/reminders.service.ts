import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service";
import { EmailService } from "@/notifications/email/email.service";
import { NotificationsFeedService } from "@/notifications/feed/notifications-feed.service";
import { BrandingService } from "@/modules/administration/branding/branding.service";
import { reminderDigestEmail } from "@/notifications/email/templates/reminder-digest";
import { administratorWhere, providerWhere, reviewerWhere } from "@/notifications/recipients";
import {
  DEADLINE_EARLY_DAYS,
  DEFAULT_OVERDUE_LIMIT_DAYS,
  RETURNED_ESCALATION_DAYS,
  RETURNED_REMINDER_DAYS,
  REVIEW_ESCALATION_DAYS,
  REVIEW_REMINDER_DAYS,
  dayNumber,
  daysSince,
  deadlineStage,
  deadlineText,
  plural,
  type ReminderSection,
} from "@/notifications/reminders/reminder-rules";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_TITLE = "Data reporting reminder";

const SECTIONS: Record<ReminderSection, { title: string; path: string }> = {
  "review-escalation": { title: "Escalation: submissions still waiting for review", path: "/data-submissions/validation" },
  "review-waiting": { title: "Submissions waiting for your review", path: "/data-submissions/validation" },
  overdue: { title: "Overdue data", path: "/data-submissions/overdue" },
  deadline: { title: "Data due soon", path: "/data-submissions/obligations" },
  "returned-escalation": { title: "Escalation: returned data not resubmitted", path: "/data-submissions/submissions" },
  returned: { title: "Returned to you for correction", path: "/data-submissions/submissions" },
};

interface Recipient {
  id: string;
  email: string;
  fullName: string;
}

export interface ReminderEntry {
  key: string;
  section: ReminderSection;
  text: string;
}

export interface ReminderDigest {
  user: Recipient;
  entries: ReminderEntry[];
}

const RECIPIENT_FIELDS = { id: true, email: true, fullName: true } satisfies Prisma.UserSelect;

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly feed: NotificationsFeedService,
    private readonly branding: BrandingService,
    private readonly config: ConfigService,
  ) {}

  async plan(now: Date): Promise<ReminderDigest[]> {
    const digests = new Map<string, ReminderDigest>();
    const cache = new Map<string, Promise<Recipient[]>>();
    const recipients = (cacheKey: string, where: Prisma.UserWhereInput) => {
      const found = cache.get(cacheKey) ?? this.prisma.user.findMany({ where, select: RECIPIENT_FIELDS });
      cache.set(cacheKey, found);
      return found;
    };
    const add = (users: Recipient[], entry: ReminderEntry) => {
      for (const user of users) {
        const digest = digests.get(user.id) ?? { user, entries: [] };
        if (!digest.entries.some((existing) => existing.key === entry.key)) digest.entries.push(entry);
        digests.set(user.id, digest);
      }
    };

    await this.collectWaitingReviews(now, recipients, add);
    await this.collectDeadlines(now, recipients, add);
    await this.collectReturned(now, recipients, add);

    return this.withoutAlreadySent([...digests.values()], now);
  }

  async run(now: Date): Promise<{ sent: number; failed: number }> {
    const digests = await this.plan(now);
    if (digests.length === 0) return { sent: 0, failed: 0 };

    const settings = await this.branding.get();
    const brand = {
      primaryColor: settings.primaryColor,
      secondaryColor: settings.secondaryColor,
      logoUrl: settings.logoUrl,
      countryName: settings.countryName,
      officialName: settings.officialName,
    };
    const frontendUrl = this.config.get<string>("FRONTEND_URL", "http://localhost:5173");

    let sent = 0;
    let failed = 0;
    for (const { user, entries } of digests) {
      try {
        const sections = (Object.keys(SECTIONS) as ReminderSection[])
          .map((section) => ({
            section,
            title: SECTIONS[section].title,
            lines: entries.filter((entry) => entry.section === section).map((entry) => entry.text),
          }))
          .filter((section) => section.lines.length > 0);
        const path = SECTIONS[sections[0].section].path;
        const { subject, html } = reminderDigestEmail(
          { name: user.fullName, total: entries.length, sections, url: `${frontendUrl}${path}` },
          brand,
        );
        const result = await this.email.send({ to: user.email, subject, html });
        if (!result.sent && !result.skipped) {
          failed += 1;
          continue;
        }
        await this.feed.create(
          user.id,
          REMINDER_TITLE,
          sections.map((section) => `${section.title}: ${section.lines.length}`).join(". "),
          path,
        );
        await this.prisma.reminderLog.createMany({
          data: entries.map((entry) => ({ userId: user.id, key: entry.key, sentAt: now })),
          skipDuplicates: true,
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`Reminder digest failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
    return { sent, failed };
  }

  private async collectWaitingReviews(
    now: Date,
    recipients: (key: string, where: Prisma.UserWhereInput) => Promise<Recipient[]>,
    add: (users: Recipient[], entry: ReminderEntry) => void,
  ) {
    const waiting = await this.prisma.submission.findMany({
      where: {
        status: { in: ["PENDING", "UNDER_REVIEW"] },
        nextVersion: null,
        createdAt: { lt: new Date(now.getTime() - (REVIEW_REMINDER_DAYS - 1) * DAY_MS) },
      },
      include: { institution: true, obligation: { include: { dataset: true } } },
      orderBy: { createdAt: "asc" },
    });

    const uploads = new Map<string, typeof waiting>();
    for (const submission of waiting) {
      const key = `${submission.batchId ?? submission.id}:${submission.institutionId}`;
      uploads.set(key, [...(uploads.get(key) ?? []), submission]);
    }

    for (const [uploadKey, submissions] of uploads) {
      const first = submissions[0];
      const age = daysSince(first.createdAt, now);
      if (age < REVIEW_REMINDER_DAYS) continue;
      const names = [...new Set(submissions.map((item) => item.obligation?.dataset.name).filter(Boolean))];
      const subject = names.length === 1 ? names[0] : plural(submissions.length, "submission");
      const text = `${first.institution.name}: ${subject}, waiting ${plural(age, "day")}`;
      add(await recipients(`reviewers:${first.institutionId}`, reviewerWhere(first.institutionId)), {
        key: `review:${uploadKey}`,
        section: "review-waiting",
        text,
      });
      if (age >= REVIEW_ESCALATION_DAYS) {
        add(await recipients("administrators", administratorWhere()), {
          key: `review-escalation:${uploadKey}`,
          section: "review-escalation",
          text,
        });
      }
    }
  }

  private async collectDeadlines(
    now: Date,
    recipients: (key: string, where: Prisma.UserWhereInput) => Promise<Recipient[]>,
    add: (users: Recipient[], entry: ReminderEntry) => void,
  ) {
    const limit = Number(this.config.get("REMINDERS_OVERDUE_LIMIT_DAYS", DEFAULT_OVERDUE_LIMIT_DAYS));
    const today = dayNumber(now) * DAY_MS;
    const obligations = await this.prisma.obligation.findMany({
      where: {
        acceptedSubmissionId: null,
        dueDate: { gte: new Date(today - limit * DAY_MS), lt: new Date(today + (DEADLINE_EARLY_DAYS + 1) * DAY_MS) },
        dataset: { isActive: true },
        submissions: { none: { status: { in: ["PENDING", "UNDER_REVIEW", "APPROVED", "PROVISIONALLY_APPROVED"] } } },
      },
      include: { institution: true, dataset: true, focalPerson: true },
      orderBy: { dueDate: "asc" },
    });

    for (const obligation of obligations) {
      const { dataset } = obligation;
      if (dataset.submissionMode === "NERC_CONSOLIDATED" && obligation.institutionId !== dataset.ownerInstitutionId) continue;
      const stage = deadlineStage(obligation.dueDate, now, limit);
      if (!stage) continue;

      const providers = [
        ...(await recipients(`providers:${obligation.institutionId}`, providerWhere(obligation.institutionId))),
        ...(obligation.focalPerson?.status === "ACTIVE" ? [obligation.focalPerson] : []),
      ];
      const entry: ReminderEntry = {
        key: `${stage.section}:${obligation.id}:${stage.stage}`,
        section: stage.section,
        text: `${obligation.institution.name}: ${dataset.name} (${obligation.reportingPeriod}), ${deadlineText(stage)}`,
      };
      add(providers, entry);
      if (stage.section === "overdue") add(await recipients("administrators", administratorWhere()), entry);
    }
  }

  private async collectReturned(
    now: Date,
    recipients: (key: string, where: Prisma.UserWhereInput) => Promise<Recipient[]>,
    add: (users: Recipient[], entry: ReminderEntry) => void,
  ) {
    const returned = await this.prisma.submission.findMany({
      where: { status: "RETURNED", nextVersion: null },
      include: {
        institution: true,
        submittedBy: true,
        items: { select: { period: true } },
        reviewDecisions: { where: { decision: "RETURN_FOR_CORRECTION" }, orderBy: { createdAt: "desc" }, take: 1 },
        obligation: {
          include: {
            dataset: true,
            submissions: { select: { createdAt: true, status: true, items: { select: { period: true } } } },
          },
        },
      },
    });

    for (const submission of returned) {
      const decision = submission.reviewDecisions[0];
      if (!decision) continue;
      const age = daysSince(decision.createdAt, now);
      if (age < RETURNED_REMINDER_DAYS) continue;

      const periods = new Set(submission.items.map((item) => item.period));
      const replaced = submission.obligation?.submissions.some(
        (other) =>
          other.status !== "DRAFT" &&
          other.createdAt > submission.createdAt &&
          other.items.some((item) => periods.has(item.period)),
      );
      if (replaced) continue;

      const dataset = submission.obligation?.dataset.name ?? "Submission";
      const period = submission.obligation?.reportingPeriod;
      const text = `${submission.institution.name}: ${dataset}${period ? ` (${period})` : ""}, returned ${plural(age, "day")} ago`;
      if (submission.submittedBy.status === "ACTIVE") {
        add([submission.submittedBy], { key: `returned:${decision.id}`, section: "returned", text });
      }
      if (age >= RETURNED_ESCALATION_DAYS) {
        add(await recipients("administrators", administratorWhere()), {
          key: `returned-escalation:${decision.id}`,
          section: "returned-escalation",
          text,
        });
      }
    }
  }

  private async withoutAlreadySent(digests: ReminderDigest[], now: Date): Promise<ReminderDigest[]> {
    if (digests.length === 0) return [];
    const userIds = digests.map((digest) => digest.user.id);
    const logs = await this.prisma.reminderLog.findMany({
      where: { userId: { in: userIds }, key: { in: digests.flatMap((digest) => digest.entries.map((entry) => entry.key)) } },
      select: { userId: true, key: true },
    });
    const sentToday = await this.prisma.reminderLog.findMany({
      where: { userId: { in: userIds }, sentAt: { gte: new Date(dayNumber(now) * DAY_MS) } },
      select: { userId: true },
      distinct: ["userId"],
    });
    const done = new Set(logs.map((log) => `${log.userId}|${log.key}`));
    const today = new Set(sentToday.map((log) => log.userId));

    return digests
      .filter((digest) => !today.has(digest.user.id))
      .map((digest) => ({
        user: digest.user,
        entries: digest.entries.filter((entry) => !done.has(`${digest.user.id}|${entry.key}`)),
      }))
      .filter((digest) => digest.entries.length > 0);
  }
}
