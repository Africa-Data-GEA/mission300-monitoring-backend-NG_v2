import type { ConfigService } from "@nestjs/config";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import type { EmailService } from "@/notifications/email/email.service";
import type { BrandingService } from "@/modules/administration/branding/branding.service";
import type { PrismaService } from "@/prisma/prisma.service";
import { ReportSchedulesService } from "./report-schedules.service";
import type { ReportsService } from "./reports.service";

const NOW = new Date("2026-11-19T10:00:00Z");

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    name: "Weekly minister brief",
    config: { pillars: ["all"] },
    cadence: "WEEKLY",
    dayOfWeek: 1,
    dayOfMonth: null,
    hourLagos: 8,
    recipients: ["minister@example.org", "adviser@example.org"],
    isActive: true,
    nextRunAt: new Date("2026-11-19T07:00:00Z"),
    lastRunAt: null,
    createdById: "u1",
    ...overrides,
  };
}

function build(options: { claimed?: number; creatorStatus?: string | null; sendResults?: boolean[]; generateError?: Error } = {}) {
  const prisma = {
    reportSchedule: {
      findMany: jest.fn().mockResolvedValue([schedule()]),
      findUnique: jest.fn().mockResolvedValue(schedule()),
      updateMany: jest.fn().mockResolvedValue({ count: options.claimed ?? 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    reportDelivery: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, recipients: data.recipients })),
    },
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        options.creatorStatus === null
          ? null
          : { id: where.id, role: "DASHBOARD_MANAGER", roles: [], institutionId: null, status: options.creatorStatus ?? "ACTIVE", email: "me@example.org" },
      ),
    },
  };
  const sendResults = [...(options.sendResults ?? [])];
  const email = {
    send: jest.fn(async () => ((sendResults.shift() ?? true) ? { sent: true } : { sent: false, reason: "The email provider rejected the message" })),
  };
  const reports = {
    generate: jest.fn(async () => {
      if (options.generateError) throw options.generateError;
      return { savedReport: { id: "r1" }, preview: { metadata: { reportingPeriod: "Latest available" } } };
    }),
    getSavedPdf: jest.fn().mockResolvedValue({ buffer: Buffer.from("%PDF-1.3"), fileName: "executive-brief_all_v1.pdf" }),
  };
  const branding = {
    get: jest.fn().mockResolvedValue({ primaryColor: "#005380", secondaryColor: "#FFB400", logoUrl: "", countryName: "Nigeria", officialName: "Nigeria" }),
  };
  const config = { get: jest.fn((_key: string, fallback?: string) => fallback ?? "") };
  const service = new ReportSchedulesService(
    prisma as unknown as PrismaService,
    reports as unknown as ReportsService,
    email as unknown as EmailService,
    branding as unknown as BrandingService,
    config as unknown as ConfigService,
  );
  return { prisma, email, reports, service };
}

describe("ReportSchedulesService.runDue", () => {
  it("sends the brief to every recipient with the PDF attached and records a SENT delivery", async () => {
    const { prisma, email, reports, service } = build();
    expect(await service.runDue(NOW)).toBe(1);
    expect(reports.generate).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), expect.objectContaining({ reportType: "EXECUTIVE_BRIEF" }), { notify: false });
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "minister@example.org", attachments: [expect.objectContaining({ filename: "executive-brief_all_v1.pdf" })] }),
    );
    expect(prisma.reportDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ scheduleId: "s1", status: "SENT", failedCount: 0, savedReportId: "r1" }),
    });
  });

  it("moves the next run forward before sending, so a second instance cannot send it again", async () => {
    const { prisma, service } = build();
    await service.runDue(NOW);
    expect(prisma.reportSchedule.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", nextRunAt: new Date("2026-11-19T07:00:00Z") },
      data: { nextRunAt: new Date("2026-11-23T07:00:00.000Z") },
    });
  });

  it("does nothing when another instance already claimed the schedule", async () => {
    const { email, reports, service } = build({ claimed: 0 });
    await service.runDue(NOW);
    expect(reports.generate).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it("records PARTIAL when only some recipients could be reached", async () => {
    const { prisma, service } = build({ sendResults: [true, false] });
    await service.runDue(NOW);
    expect(prisma.reportDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "PARTIAL", failedCount: 1, error: "The email provider rejected the message" }),
    });
  });

  it("records FAILED when nobody could be reached", async () => {
    const { prisma, service } = build({ sendResults: [false, false] });
    await service.runDue(NOW);
    expect(prisma.reportDelivery.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "FAILED", failedCount: 2 }) });
  });

  it("fails without generating anything when the creating account is no longer active", async () => {
    const { prisma, reports, email, service } = build({ creatorStatus: "SUSPENDED" });
    await service.runDue(NOW);
    expect(reports.generate).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
    expect(prisma.reportDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "FAILED", error: "The account that created this schedule is no longer active." }),
    });
  });

  it("records the reason when the brief cannot be generated", async () => {
    const { prisma, email, service } = build({ generateError: new Error("database unavailable") });
    await service.runDue(NOW);
    expect(email.send).not.toHaveBeenCalled();
    expect(prisma.reportDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "FAILED", error: "database unavailable" }),
    });
  });
});

describe("ReportSchedulesService.sendNow", () => {
  const user = { id: "u9", role: "DASHBOARD_MANAGER", roles: [], institutionId: null } as AuthenticatedUser;

  it("sends only to the requester when it is a test", async () => {
    const { email, service } = build();
    const result = await service.sendNow(user, "s1", true);
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: "me@example.org" }));
    expect(result).toMatchObject({ status: "sent", recipientCount: 1 });
  });

  it("sends to the whole list otherwise", async () => {
    const { email, service } = build();
    const result = await service.sendNow(user, "s1", false);
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "sent", recipientCount: 2 });
  });
});
