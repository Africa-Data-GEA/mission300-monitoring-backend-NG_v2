import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma, ReportSchedule } from "@prisma/client";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { toKebabCase } from "@/common/utils/enum-casing";
import { EmailService } from "@/notifications/email/email.service";
import { executiveBriefEmail, type EmailBrand } from "@/notifications/email/templates";
import { BrandingService } from "@/modules/administration/branding/branding.service";
import { PrismaService } from "@/prisma/prisma.service";
import type { ReportConfigDto } from "@/modules/reports/dto/report-config.dto";
import type { ReportScheduleDto } from "@/modules/reports/dto/report-schedule.dto";
import { describeSchedule, nextRunAfter, type ScheduleTiming } from "@/modules/reports/report-schedule";
import { ReportsService } from "@/modules/reports/reports.service";

const MAX_DUE_PER_TICK = 20;

const SCHEDULE_INCLUDE = {
  createdBy: { select: { fullName: true } },
  deliveries: { orderBy: { sentAt: "desc" }, take: 1 },
} as const;

type ScheduleWithOwner = Prisma.ReportScheduleGetPayload<{ include: typeof SCHEDULE_INCLUDE }>;

function timingOf(schedule: Pick<ReportSchedule, "cadence" | "dayOfWeek" | "dayOfMonth" | "hourLagos">): ScheduleTiming {
  return {
    cadence: schedule.cadence,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    hourLagos: schedule.hourLagos,
  };
}

interface Audience {
  institutionId?: string;
  institutionName?: string;
}

function audienceOf(schedule: Pick<ReportSchedule, "config">): Audience {
  const config = (schedule.config ?? {}) as Audience;
  return config.institutionId ? { institutionId: config.institutionId, institutionName: config.institutionName } : {};
}

function configFor(pillars: string[] | undefined, audience: Audience = {}): ReportConfigDto & Audience {
  return {
    ...(audience.institutionId ? { institutionId: audience.institutionId, institutionName: audience.institutionName } : {}),
    reportType: "EXECUTIVE_BRIEF",
    periods: ["all"],
    pillars: pillars?.length ? pillars : ["all"],
    kpiCategory: "all",
    state: "all",
    distributionCompany: "all",
    programmeOrAgency: "all",
    validationStatus: "all",
    readinessTier: "all",
    format: "PDF",
    orientation: "portrait",
  };
}

function pillarsOf(schedule: Pick<ReportSchedule, "config">): string[] {
  const config = schedule.config as { pillars?: string[] } | null;
  return config?.pillars?.length ? config.pillars : ["all"];
}

export function toScheduleResponse(schedule: ScheduleWithOwner) {
  const last = schedule.deliveries[0] ?? null;
  return {
    id: schedule.id,
    name: schedule.name,
    cadence: toKebabCase(schedule.cadence),
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    hourLagos: schedule.hourLagos,
    description: describeSchedule(timingOf(schedule)),
    recipients: schedule.recipients,
    pillars: pillarsOf(schedule),
    institutionId: audienceOf(schedule).institutionId ?? null,
    institutionName: audienceOf(schedule).institutionName ?? null,
    isActive: schedule.isActive,
    nextRunAt: schedule.nextRunAt.toISOString(),
    lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
    createdBy: schedule.createdBy.fullName,
    lastDelivery: last
      ? {
          status: toKebabCase(last.status),
          sentAt: last.sentAt.toISOString(),
          recipientCount: last.recipients.length,
          failedCount: last.failedCount,
          error: last.error,
        }
      : null,
  };
}

@Injectable()
export class ReportSchedulesService {
  private readonly logger = new Logger(ReportSchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly email: EmailService,
    private readonly branding: BrandingService,
    private readonly config: ConfigService,
  ) {}

  async list() {
    const schedules = await this.prisma.reportSchedule.findMany({
      orderBy: { createdAt: "desc" },
      include: SCHEDULE_INCLUDE,
    });
    return { items: schedules.map(toScheduleResponse) };
  }

  async audiences() {
    return this.prisma.institution.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  }

  private async audienceFor(institutionId: string | undefined): Promise<Audience> {
    if (!institutionId) return {};
    const institution = await this.prisma.institution.findUnique({ where: { id: institutionId } });
    if (!institution) throw new BadRequestException("Choose an agency that exists.");
    return { institutionId: institution.id, institutionName: institution.name };
  }

  async create(user: AuthenticatedUser, dto: ReportScheduleDto) {
    const audience = await this.audienceFor(dto.institutionId);
    const timing = this.timingFrom(dto);
    const schedule = await this.prisma.reportSchedule.create({
      data: {
        name: dto.name.trim(),
        config: configFor(dto.pillars, audience) as unknown as Prisma.InputJsonValue,
        cadence: timing.cadence,
        dayOfWeek: timing.dayOfWeek,
        dayOfMonth: timing.dayOfMonth,
        hourLagos: timing.hourLagos,
        recipients: [...new Set(dto.recipients)],
        isActive: dto.isActive ?? true,
        nextRunAt: nextRunAfter(timing, new Date()),
        createdById: user.id,
      },
      include: SCHEDULE_INCLUDE,
    });
    return toScheduleResponse(schedule);
  }

  async update(id: string, dto: ReportScheduleDto) {
    await this.requireSchedule(id);
    const audience = await this.audienceFor(dto.institutionId);
    const timing = this.timingFrom(dto);
    const schedule = await this.prisma.reportSchedule.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        config: configFor(dto.pillars, audience) as unknown as Prisma.InputJsonValue,
        cadence: timing.cadence,
        dayOfWeek: timing.dayOfWeek,
        dayOfMonth: timing.dayOfMonth,
        hourLagos: timing.hourLagos,
        recipients: [...new Set(dto.recipients)],
        isActive: dto.isActive ?? true,
        nextRunAt: nextRunAfter(timing, new Date()),
      },
      include: SCHEDULE_INCLUDE,
    });
    return toScheduleResponse(schedule);
  }

  async remove(id: string) {
    await this.requireSchedule(id);
    await this.prisma.reportSchedule.delete({ where: { id } });
  }

  async deliveries(id: string) {
    await this.requireSchedule(id);
    const rows = await this.prisma.reportDelivery.findMany({
      where: { scheduleId: id },
      orderBy: { sentAt: "desc" },
      take: 20,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: toKebabCase(row.status),
        sentAt: row.sentAt.toISOString(),
        recipientCount: row.recipients.length,
        failedCount: row.failedCount,
        error: row.error,
        savedReportId: row.savedReportId,
      })),
    };
  }

  async sendNow(user: AuthenticatedUser, id: string, test: boolean) {
    const schedule = await this.requireSchedule(id);
    let recipients = schedule.recipients;
    if (test) {
      const requester = await this.prisma.user.findUnique({ where: { id: user.id }, select: { email: true } });
      if (!requester) throw new BadRequestException("Your account has no email address to send a test to.");
      recipients = [requester.email];
    }
    const delivery = await this.deliver(schedule, recipients);
    return {
      status: toKebabCase(delivery.status),
      recipientCount: delivery.recipients.length,
      failedCount: delivery.failedCount,
      error: delivery.error,
    };
  }

  async runDue(now: Date = new Date()) {
    const due = await this.prisma.reportSchedule.findMany({
      where: { isActive: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: "asc" },
      take: MAX_DUE_PER_TICK,
    });

    for (const schedule of due) {
      const claimed = await this.prisma.reportSchedule.updateMany({
        where: { id: schedule.id, nextRunAt: schedule.nextRunAt },
        data: { nextRunAt: nextRunAfter(timingOf(schedule), now) },
      });
      if (claimed.count !== 1) continue;
      try {
        await this.deliver(schedule, schedule.recipients);
      } catch (error) {
        this.logger.error(
          `Scheduled brief "${schedule.name}" failed: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }
    return due.length;
  }

  private async deliver(schedule: ReportSchedule, recipients: string[]) {
    const record = async (
      status: "SENT" | "PARTIAL" | "FAILED",
      failedCount: number,
      error: string | null,
      savedReportId?: string,
    ) => {
      await this.prisma.reportSchedule.update({ where: { id: schedule.id }, data: { lastRunAt: new Date() } });
      return this.prisma.reportDelivery.create({
        data: { scheduleId: schedule.id, savedReportId, status, recipients, failedCount, error },
      });
    };

    const creator = await this.prisma.user.findUnique({ where: { id: schedule.createdById } });
    if (!creator || creator.status !== "ACTIVE") {
      return record("FAILED", recipients.length, "The account that created this schedule is no longer active.");
    }

    let savedReportId: string | undefined;
    let pdf: { buffer: Buffer; fileName: string };
    let reportingPeriod: string;
    try {
      const actor: AuthenticatedUser = {
        id: creator.id,
        role: creator.role,
        roles: creator.roles,
        institutionId: creator.institutionId,
      };
      const generated = await this.reports.generate(actor, configFor(pillarsOf(schedule), audienceOf(schedule)), { notify: false });
      savedReportId = generated.savedReport.id;
      reportingPeriod = generated.preview.metadata.reportingPeriod;
      pdf = await this.reports.getSavedPdf(savedReportId);
    } catch (error) {
      return record(
        "FAILED",
        recipients.length,
        error instanceof Error ? error.message : "The brief could not be generated.",
        savedReportId,
      );
    }

    const brand = await this.emailBrand();
    const dashboardUrl = `${this.config.get<string>("FRONTEND_URL", "")}/reports`;
    const { subject, html } = executiveBriefEmail({ scheduleName: schedule.name, reportingPeriod, dashboardUrl }, brand);

    let failedCount = 0;
    let firstReason: string | null = null;
    for (const to of recipients) {
      const result = await this.email.send({
        to,
        subject,
        html,
        attachments: [{ filename: pdf.fileName, content: pdf.buffer }],
      });
      if (!result.sent) {
        failedCount += 1;
        firstReason ??= result.reason ?? "Delivery failed";
      }
    }

    const status = failedCount === 0 ? "SENT" : failedCount === recipients.length ? "FAILED" : "PARTIAL";
    return record(status, failedCount, firstReason, savedReportId);
  }

  private timingFrom(dto: ReportScheduleDto): ScheduleTiming {
    const cadence = dto.cadence === "weekly" ? "WEEKLY" : "MONTHLY";
    return {
      cadence,
      dayOfWeek: cadence === "WEEKLY" ? (dto.dayOfWeek ?? 1) : null,
      dayOfMonth: cadence === "MONTHLY" ? (dto.dayOfMonth ?? 1) : null,
      hourLagos: dto.hourLagos,
    };
  }

  private async requireSchedule(id: string) {
    const schedule = await this.prisma.reportSchedule.findUnique({ where: { id } });
    if (!schedule) throw new NotFoundException(`No report schedule found with id ${id}`);
    return schedule;
  }

  private async emailBrand(): Promise<EmailBrand> {
    const settings = await this.branding.get();
    return {
      primaryColor: settings.primaryColor,
      secondaryColor: settings.secondaryColor,
      logoUrl: settings.logoUrl,
      countryName: settings.countryName,
      officialName: settings.officialName,
    };
  }
}
