import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "@/prisma/prisma.service";
import type { EmailService } from "@/notifications/email/email.service";
import type { NotificationsFeedService } from "@/notifications/feed/notifications-feed.service";
import type { BrandingService } from "@/modules/administration/branding/branding.service";
import { deadlineStage } from "./reminder-rules";
import { RemindersService } from "./reminders.service";

const now = new Date("2026-11-26T08:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

const reviewer = { id: "reviewer", email: "reviewer@example.org", fullName: "Reviewer" };
const admin = { id: "admin", email: "admin@example.org", fullName: "Admin" };
const provider = { id: "provider", email: "provider@example.org", fullName: "Provider", status: "ACTIVE" };

interface Setup {
  waiting?: unknown[];
  obligations?: unknown[];
  returned?: unknown[];
  logs?: { userId: string; key: string; sentAt: Date }[];
  email?: { sent: boolean; skipped?: boolean };
}

function build({ waiting = [], obligations = [], returned = [], logs = [], email = { sent: true } }: Setup) {
  const prisma = {
    submission: {
      findMany: jest.fn(({ where }) => Promise.resolve(where.status === "RETURNED" ? returned : waiting)),
    },
    obligation: { findMany: jest.fn().mockResolvedValue(obligations) },
    user: {
      findMany: jest.fn(({ where }) => {
        const text = JSON.stringify(where);
        if (text.includes("DATA_REVIEWER")) return Promise.resolve([reviewer]);
        if (text.includes("INSTITUTIONAL_DATA_PROVIDER")) return Promise.resolve([provider]);
        return Promise.resolve([admin]);
      }),
    },
    reminderLog: {
      findMany: jest.fn(({ where }) =>
        Promise.resolve(logs.filter((log) => (where.sentAt ? log.sentAt >= where.sentAt.gte : where.key.in.includes(log.key)))),
      ),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const send = jest.fn().mockResolvedValue(email);
  const create = jest.fn().mockResolvedValue(undefined);
  const service = new RemindersService(
    prisma as unknown as PrismaService,
    { send } as unknown as EmailService,
    { create } as unknown as NotificationsFeedService,
    { get: jest.fn().mockResolvedValue({ primaryColor: "#005380", secondaryColor: "#FFB400", logoUrl: "", countryName: "Nigeria", officialName: "Nigeria" }) } as unknown as BrandingService,
    { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService,
  );
  return { service, prisma, send, create };
}

const waitingFor = (days: number) => ({
  id: "s1",
  batchId: "b1",
  institutionId: "i1",
  createdAt: daysAgo(days),
  institution: { name: "NERC" },
  obligation: { dataset: { name: "DisCo Energy Billed" } },
});

const obligationDue = (days: number) => ({
  id: "o1",
  institutionId: "i1",
  institution: { name: "NERC" },
  dataset: { name: "Metering", submissionMode: "PER_INSTITUTION", ownerInstitutionId: null },
  reportingPeriod: "Q3 2026",
  dueDate: daysAgo(days),
  focalPerson: null,
});

const returnedFor = (days: number, laterPeriods: string[] = []) => ({
  id: "s2",
  createdAt: daysAgo(days + 1),
  institution: { name: "NERC" },
  submittedBy: provider,
  items: [{ period: "q3-2026" }],
  reviewDecisions: [{ id: "d1", createdAt: daysAgo(days) }],
  obligation: {
    reportingPeriod: "Q3 2026",
    dataset: { name: "Metering" },
    submissions: laterPeriods.map((period) => ({ status: "PENDING", createdAt: daysAgo(0), items: [{ period }] })),
  },
});

const summary = async (setup: Setup) =>
  (await build(setup).service.plan(now))
    .map((digest) => `${digest.user.id}:${digest.entries.map((entry) => entry.section).join(",")}`)
    .sort();

describe("deadlineStage", () => {
  const stage = (days: number) => deadlineStage(daysAgo(-days), now)?.stage ?? null;

  it("reminds a week before and a day before", () => {
    expect([stage(8), stage(7), stage(2), stage(1), stage(0)]).toEqual([null, "early", "early", "last", "last"]);
  });

  it("repeats weekly once overdue and stops after the limit", () => {
    expect([stage(-1), stage(-7), stage(-8), stage(-90), stage(-91)]).toEqual(["week-1", "week-1", "week-2", "week-13", null]);
  });
});

describe("RemindersService", () => {
  it("reminds reviewers after three days and escalates to administrators after seven", async () => {
    await expect(summary({ waiting: [waitingFor(2)] })).resolves.toEqual([]);
    await expect(summary({ waiting: [waitingFor(3)] })).resolves.toEqual(["reviewer:review-waiting"]);
    await expect(summary({ waiting: [waitingFor(7)] })).resolves.toEqual(["admin:review-escalation", "reviewer:review-waiting"]);
  });

  it("tells the provider before a deadline and the administrator too once it passes", async () => {
    await expect(summary({ obligations: [obligationDue(-5)] })).resolves.toEqual(["provider:deadline"]);
    await expect(summary({ obligations: [obligationDue(2)] })).resolves.toEqual(["admin:overdue", "provider:overdue"]);
  });

  it("chases returned data until it is resubmitted", async () => {
    await expect(summary({ returned: [returnedFor(4)] })).resolves.toEqual([]);
    await expect(summary({ returned: [returnedFor(10)] })).resolves.toEqual(["admin:returned-escalation", "provider:returned"]);
    await expect(summary({ returned: [returnedFor(10, ["q3-2026"])] })).resolves.toEqual([]);
  });

  it("does not repeat a reminder or send a second summary on the same day", async () => {
    const waiting = [waitingFor(4)];
    await expect(summary({ waiting, logs: [{ userId: "reviewer", key: "review:b1:i1", sentAt: daysAgo(1) }] })).resolves.toEqual([]);
    await expect(summary({ waiting, logs: [{ userId: "reviewer", key: "other", sentAt: now }] })).resolves.toEqual([]);
  });

  it("records a reminder only when it was delivered", async () => {
    const delivered = build({ waiting: [waitingFor(4)] });
    await expect(delivered.service.run(now)).resolves.toEqual({ sent: 1, failed: 0 });
    expect(delivered.create).toHaveBeenCalledTimes(1);
    expect(delivered.prisma.reminderLog.createMany).toHaveBeenCalledTimes(1);

    const refused = build({ waiting: [waitingFor(4)], email: { sent: false } });
    await expect(refused.service.run(now)).resolves.toEqual({ sent: 0, failed: 1 });
    expect(refused.create).not.toHaveBeenCalled();
    expect(refused.prisma.reminderLog.createMany).not.toHaveBeenCalled();
  });
});
