import { permittedDecisionsFor } from "@/modules/data-submissions/data-submissions.mappers";
import { DataSubmissionsService } from "@/modules/data-submissions/data-submissions.service";

jest.setTimeout(60000);

const reviewer = { id: "reviewer", role: "VALIDATOR", roles: [], institutionId: "inst-a" } as never;

function build(status: string) {
  const submission = {
    id: "sub-1",
    institutionId: "inst-a",
    submittedById: "submitter",
    status,
    obligationId: "obl-1",
    items: [{ id: "item-1", kpiDefinitionId: "k1", period: "Q3 2026", value: 10, kpiDefinition: { name: "KPI", aggregation: "Sum" } }],
    submittedBy: { institution: { type: "Federal Agency" } },
    obligation: { dataset: { submissionMode: "PER_INSTITUTION" } },
  };
  const tx = {
    submission: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    reviewDecision: { create: jest.fn() },
    kpiValue: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    kpiDefinition: { findMany: jest.fn().mockResolvedValue([]) },
    obligation: { update: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = {
    submission: { findUnique: jest.fn().mockResolvedValue(submission) },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new DataSubmissionsService(
    prisma as never,
    {} as never,
    { publish: jest.fn() } as never,
    { get: jest.fn().mockResolvedValue({ allowSelfReview: false }) } as never,
  );
  return { service, tx };
}

describe("what a reviewer may do with a submission", () => {
  it("offers all four decisions while pending", () => {
    expect(permittedDecisionsFor("PENDING", true)).toEqual(["approved", "provisional", "returned", "rejected"]);
  });

  it("offers confirm or withdraw on a provisional approval, not provisional again", () => {
    expect(permittedDecisionsFor("PROVISIONALLY_APPROVED", true)).toEqual(["approved", "returned", "rejected"]);
  });

  it.each(["APPROVED", "REJECTED", "RETURNED"])("offers nothing once %s", (status) => {
    expect(permittedDecisionsFor(status, true)).toEqual([]);
  });

  it("offers nothing to someone who may not decide", () => {
    expect(permittedDecisionsFor("PROVISIONALLY_APPROVED", false)).toEqual([]);
  });
});

describe("a provisional approval is an open state", () => {
  it("can be confirmed as approved, keeping the live value", async () => {
    const { service, tx } = build("PROVISIONALLY_APPROVED");
    await service.recordDecision(reviewer, "sub-1", { decision: "approved", comments: "Confirmed with source" });
    expect(tx.submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "PROVISIONALLY_APPROVED" }), data: { status: "APPROVED" } }),
    );
    expect(tx.kpiValue.create).toHaveBeenCalled();
    expect(tx.kpiValue.deleteMany).not.toHaveBeenCalled();
  });

  it.each(["returned", "rejected"] as const)("is withdrawn when %s: the live value is removed and the obligation reopens", async (decision) => {
    const { service, tx } = build("PROVISIONALLY_APPROVED");
    await service.recordDecision(reviewer, "sub-1", { decision, comments: "Source not confirmed" });
    expect(tx.kpiValue.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ sourceSubmissionItemId: { in: ["item-1"] } }, { sourceSubmissionItemId: { startsWith: "live-linked-item-item-1-" } }] },
    });
    expect(tx.obligation.updateMany).toHaveBeenCalledWith({
      where: { id: "obl-1", acceptedSubmissionId: "sub-1" },
      data: { acceptedSubmissionId: null },
    });
    expect(tx.kpiValue.create).not.toHaveBeenCalled();
  });

  it("cannot be provisionally approved a second time", async () => {
    const { service, tx } = build("PROVISIONALLY_APPROVED");
    await expect(
      service.recordDecision(reviewer, "sub-1", { decision: "provisional", comments: "Again" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.submission.updateMany).not.toHaveBeenCalled();
  });

  it("does not withdraw anything when a pending submission is rejected", async () => {
    const { service, tx } = build("PENDING");
    await service.recordDecision(reviewer, "sub-1", { decision: "rejected", comments: "Wrong figures" });
    expect(tx.kpiValue.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses a decision on an already final submission", async () => {
    const { service } = build("APPROVED");
    await expect(
      service.recordDecision(reviewer, "sub-1", { decision: "returned", comments: "Too late" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
