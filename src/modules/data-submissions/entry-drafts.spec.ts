import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { EntryDraftsService, hasDraftContent } from "@/modules/data-submissions/entry-drafts.service";

const provider = (institutionId: string) =>
  ({ id: "u1", role: "INSTITUTIONAL_DATA_PROVIDER", roles: [], institutionId }) as unknown as AuthenticatedUser;

function build(stored: { payload: unknown; updatedAt: Date; savedBy: { fullName: string } } | null = null) {
  const prisma = {
    obligation: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "obl-1" ? { institutionId: "inst-a" } : null,
      ),
    },
    entryDraft: {
      findUnique: jest.fn().mockResolvedValue(stored),
      upsert: jest.fn(async () => ({ updatedAt: new Date("2026-10-23T10:00:00Z") })),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { prisma, service: new EntryDraftsService(prisma as never) };
}

describe("hasDraftContent", () => {
  it("is false for an untouched form", () => {
    expect(hasDraftContent({ values: { f1: "", f2: "  " }, sourceReference: "", notes: "" })).toBe(false);
    expect(hasDraftContent({ rows: [{ period: "Q3 2026", values: {} }] })).toBe(false);
  });

  it("is true once any value, institution, reference or note is entered", () => {
    expect(hasDraftContent({ values: { f1: "12" } })).toBe(true);
    expect(hasDraftContent({ rows: [{ period: "Q3 2026", institution: "Ikeja Electric", values: {} }] })).toBe(true);
    expect(hasDraftContent({ sourceReference: "Q3 return" })).toBe(true);
    expect(hasDraftContent({ notes: "to finish" })).toBe(true);
  });
});

describe("EntryDraftsService", () => {
  it("saves one draft per obligation without creating a submission", async () => {
    const { prisma, service } = build();
    const result = await service.save(provider("inst-a"), "obl-1", { values: { f1: "61.7" } });
    expect(prisma.entryDraft.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { obligationId: "obl-1" } }),
    );
    expect(result.message).toMatch(/not been sent for review/i);
  });

  it("refuses to save an empty draft", async () => {
    const { prisma, service } = build();
    await expect(service.save(provider("inst-a"), "obl-1", { values: { f1: "" } })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.entryDraft.upsert).not.toHaveBeenCalled();
  });

  it("refuses a draft over the row limit", async () => {
    const { service } = build();
    const rows = Array.from({ length: 501 }, () => ({ period: "Q3 2026", values: { f1: "1" } }));
    await expect(service.save(provider("inst-a"), "obl-1", { rows })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns the saved draft with who saved it", async () => {
    const { service } = build({
      payload: { values: { f1: "61.7" }, rows: null, sourceReference: "ref", notes: "n" },
      updatedAt: new Date("2026-10-23T10:00:00Z"),
      savedBy: { fullName: "Seed Data Provider" },
    });
    const { draft } = await service.get(provider("inst-a"), "obl-1");
    expect(draft).toMatchObject({ values: { f1: "61.7" }, sourceReference: "ref", savedBy: "Seed Data Provider" });
  });

  it("returns no draft when none was saved", async () => {
    const { service } = build();
    expect(await service.get(provider("inst-a"), "obl-1")).toEqual({ draft: null });
  });

  it("keeps another institution out of the draft", async () => {
    const { prisma, service } = build();
    await expect(service.get(provider("inst-b"), "obl-1")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.save(provider("inst-b"), "obl-1", { values: { f1: "1" } })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.discard(provider("inst-b"), "obl-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.entryDraft.upsert).not.toHaveBeenCalled();
    expect(prisma.entryDraft.deleteMany).not.toHaveBeenCalled();
  });

  it("reports an unknown obligation", async () => {
    const { service } = build();
    await expect(service.get(provider("inst-a"), "nope")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("discards the draft", async () => {
    const { prisma, service } = build();
    await service.discard(provider("inst-a"), "obl-1");
    expect(prisma.entryDraft.deleteMany).toHaveBeenCalledWith({ where: { obligationId: "obl-1" } });
  });
});
