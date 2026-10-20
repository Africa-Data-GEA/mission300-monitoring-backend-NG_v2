import type { PrismaService } from "@/prisma/prisma.service";
import type { StorageService } from "@/storage/storage.service";
import type { RabbitmqService } from "@/events/rabbitmq.service";
import type { SecuritySettingsService } from "@/modules/administration/security/security-settings.service";
import { DataSubmissionsService } from "./data-submissions.service";

describe("Submission decision institution scope", () => {
  const user = { id: "reviewer", role: "VALIDATOR", institutionId: "inst-a" };
  function fixture(institutionId: string) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      submission: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: "submission",
            institutionId,
            submittedById: "submitter",
            submittedBy: { institution: { type: "NERC" } },
            status: "PENDING",
            items: [],
            obligationId: null,
          }),
      },
      $transaction: jest.fn(async (work) => work({ submission: { updateMany }, reviewDecision: { create } })),
    };
    const service = new DataSubmissionsService(
      prisma as unknown as PrismaService,
      {} as StorageService,
      { publish: jest.fn() } as unknown as RabbitmqService,
      {} as SecuritySettingsService,
    );
    return { service, prisma, updateMany, create };
  }
  it("permits an in-scope decision and checks scope again in the transaction", async () => {
    const { service, updateMany, create } = fixture("inst-a");
    await service.recordDecision(user, "submission", { decision: "rejected", comments: "Correction needed" });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "submission",
        status: "PENDING",
        OR: [{ institutionId: "inst-a" }, { submittedBy: { institutionId: "inst-a" } }],
      },
      data: { status: "REJECTED" },
    });
    expect(create).toHaveBeenCalled();
  });
  it("blocks a foreign decision and bulk decision without writing", async () => {
    const { service, prisma, create } = fixture("inst-b");
    await expect(
      service.recordDecision(user, "foreign", { decision: "approved", comments: "Not authorized" }),
    ).rejects.toMatchObject({ status: 403 });
    await service.bulkRecordDecision(user, ["foreign"], { decision: "approved", comments: "Not authorized" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
