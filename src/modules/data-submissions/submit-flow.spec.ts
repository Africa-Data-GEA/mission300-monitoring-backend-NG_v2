import { ConflictException } from "@nestjs/common";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { DataSubmissionsService } from "@/modules/data-submissions/data-submissions.service";
import {
  alreadyWaitingMessage,
  canOpenValidationPages,
  nextUrlAfterSubmit,
} from "@/modules/data-submissions/submit-flow";

const user = (role: string, institutionId: string | null = "inst-niso") =>
  ({ id: "u1", role, roles: [], institutionId }) as unknown as AuthenticatedUser;

describe("where a submitter lands afterwards", () => {
  it("sends an institutional data provider to their submission history, not a reviewer page", () => {
    const provider = user("INSTITUTIONAL_DATA_PROVIDER");
    expect(canOpenValidationPages(provider)).toBe(false);
    expect(nextUrlAfterSubmit(provider, "sub-1")).toBe("/data-submissions/submissions");
    expect(nextUrlAfterSubmit(provider, null)).toBe("/data-submissions/submissions");
  });

  it.each(["DATA_REVIEWER", "VALIDATOR", "SYSTEM_ADMINISTRATOR"])("keeps the validation page for %s", (role) => {
    expect(nextUrlAfterSubmit(user(role), "sub-1")).toBe("/data-submissions/validation/sub-1");
    expect(nextUrlAfterSubmit(user(role), null)).toBe("/data-submissions/validation");
  });

  it("treats a provider who also holds a reviewer role as a reviewer", () => {
    const both = { id: "u", role: "INSTITUTIONAL_DATA_PROVIDER", roles: ["INSTITUTIONAL_DATA_PROVIDER", "DATA_REVIEWER"] };
    expect(canOpenValidationPages(both as unknown as AuthenticatedUser)).toBe(true);
  });

  it("names the period in the message about a submission already waiting", () => {
    expect(alreadyWaitingMessage(["2025"])).toContain("for 2025");
    expect(alreadyWaitingMessage(["Q1 2026", "Q1 2026", "Q2 2026"])).toContain("Q1 2026, Q2 2026");
  });
});

describe("submitting twice for the same period", () => {
  const OBLIGATION = {
    id: "obl-1",
    institutionId: "inst-niso",
    reportingPeriod: "2025",
    dataset: {
      id: "niso-renewable-generation-mix",
      fields: [{ id: "f1", label: "Renewable Generation Share", type: "NUMBER", required: true, kpiDefinitionId: "k1" }],
    },
  };

  function build(waiting: boolean) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      submission: {
        findFirst: jest.fn().mockResolvedValue(waiting ? { id: "existing" } : null),
        create: jest.fn().mockResolvedValue({ id: "new-sub", version: 1 }),
      },
    };
    const prisma = {
      obligation: { findUnique: jest.fn().mockResolvedValue(OBLIGATION) },
      submission: { findMany: jest.fn().mockResolvedValue(waiting ? [{ obligationId: "obl-1" }] : []) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const rabbit = { publish: jest.fn() };
    const security = { get: jest.fn().mockResolvedValue({ allowSelfReview: true }) };
    const service = new DataSubmissionsService(prisma as never, {} as never, rabbit as never, security as never);
    return { service, prisma, tx, rabbit };
  }

  const entry = { values: { f1: "65.5" }, sourceReference: "ref" };

  it("accepts the first submission and sends the provider to their history", async () => {
    const { service, tx, rabbit } = build(false);
    const result = await service.saveManualEntry(user("INSTITUTIONAL_DATA_PROVIDER"), "obl-1", entry as never);
    expect(result.nextUrl).toBe("/data-submissions/submissions");
    expect(tx.submission.create).toHaveBeenCalledTimes(1);
    expect(rabbit.publish).toHaveBeenCalledTimes(1);
  });

  it("refuses a second submission while one is waiting, and creates nothing", async () => {
    const { service, tx, rabbit } = build(true);
    await expect(
      service.saveManualEntry(user("INSTITUTIONAL_DATA_PROVIDER"), "obl-1", entry as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.submission.create).not.toHaveBeenCalled();
    expect(rabbit.publish).not.toHaveBeenCalled();
  });

  it("still refuses when the first check passes but another click wins the race", async () => {
    const { service, prisma, tx } = build(true);
    prisma.submission.findMany.mockResolvedValue([]);
    await expect(
      service.saveManualEntry(user("INSTITUTIONAL_DATA_PROVIDER"), "obl-1", entry as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.submission.create).not.toHaveBeenCalled();
  });
});
