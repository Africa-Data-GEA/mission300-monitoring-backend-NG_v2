import { ConflictException } from "@nestjs/common";
import { DataSubmissionsService } from "@/modules/data-submissions/data-submissions.service";

jest.setTimeout(60000);

type Existing = { id: string; version: number; status: string; nextVersion: null | object };

function build(existing: Existing[]) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    submission: {
      findFirst: jest.fn(async ({ where }: { where: { status?: { in: string[] }; nextVersion?: null } }) => {
        if (where.status) return existing.find((entry) => where.status!.in.includes(entry.status)) ?? null;
        const latest = existing.filter((entry) => entry.nextVersion === null).sort((a, b) => b.version - a.version)[0];
        return latest ? { id: latest.id, version: latest.version } : null;
      }),
      create: jest.fn(async ({ data }: { data: object }) => ({ id: "new", ...data })),
    },
  };
  const prisma = { $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };
  const service = new DataSubmissionsService(prisma as never, {} as never, {} as never, {} as never);
  const create = (data: object = { notes: "x" }) =>
    (service as unknown as { createIfNothingWaiting: (o: string, p: string, d: object) => Promise<Record<string, unknown>> }).createIfNothingWaiting(
      "obl-1",
      "Q3 2026",
      data,
    );
  return { tx, create };
}

describe("a resubmission is the next version of the rejected one", () => {
  it("starts at version 1 with no link when nothing came before", async () => {
    const { create } = build([]);
    const created = await create();
    expect(created.version).toBeUndefined();
    expect(created.previousVersionId).toBeUndefined();
  });

  it("becomes version 2 linked to the rejected submission", async () => {
    const { create } = build([{ id: "sub-1", version: 1, status: "REJECTED", nextVersion: null }]);
    const created = await create();
    expect(created.version).toBe(2);
    expect(created.previousVersionId).toBe("sub-1");
  });

  it("links to the newest version when there are several", async () => {
    const { create } = build([
      { id: "sub-1", version: 1, status: "REJECTED", nextVersion: {} },
      { id: "sub-2", version: 2, status: "RETURNED", nextVersion: null },
    ]);
    const created = await create();
    expect(created.version).toBe(3);
    expect(created.previousVersionId).toBe("sub-2");
  });

  it("keeps the original record untouched", async () => {
    const { tx, create } = build([{ id: "sub-1", version: 1, status: "REJECTED", nextVersion: null }]);
    await create();
    expect(tx.submission.create).toHaveBeenCalledTimes(1);
  });

  it("refuses while the earlier submission is provisionally approved, telling the provider to confirm or withdraw it", async () => {
    const { tx, create } = build([{ id: "sub-1", version: 1, status: "PROVISIONALLY_APPROVED", nextVersion: null }]);
    await expect(create()).rejects.toThrow(/provisionally approved.*Confirm or withdraw/);
    expect(tx.submission.create).not.toHaveBeenCalled();
  });

  it("still refuses while another submission is waiting for review", async () => {
    const { tx, create } = build([{ id: "sub-1", version: 1, status: "PENDING", nextVersion: null }]);
    await expect(create()).rejects.toBeInstanceOf(ConflictException);
    expect(tx.submission.create).not.toHaveBeenCalled();
  });
});
