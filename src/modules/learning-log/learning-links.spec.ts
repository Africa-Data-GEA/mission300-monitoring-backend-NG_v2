import { BadRequestException } from "@nestjs/common";
import { LearningLogService } from "@/modules/learning-log/learning-log.service";
import { loadRelatedLinks, loadRelatedOptions } from "@/modules/learning-log/learning-log-links";

jest.setTimeout(30000);

function build(existing: object | null = null) {
  const prisma = {
    kpiDefinition: {
      findMany: jest.fn(async ({ where }: { where: { code?: { in: string[] }; isActive?: boolean } }) =>
        where.code ? where.code.in.filter((code) => code === "M300-P2-025").map((code) => ({ code, name: "Clean Cooking Access" })) : [{ code: "M300-P1-001", name: "Installed Capacity" }],
      ),
    },
    programme: {
      findMany: jest.fn(async ({ where }: { where?: { id?: { in: string[] } } }) =>
        where?.id ? where.id.in.filter((id) => id === "prog-1").map((id) => ({ id, name: "EEP Phase III" })) : [{ id: "prog-1", name: "EEP Phase III" }],
      ),
    },
    project: {
      findMany: jest.fn(async ({ where }: { where?: { id?: { in: string[] } } }) =>
        where?.id ? where.id.in.filter((id) => id === "proj-1").map((id) => ({ id, name: "Solar Hybrid Project" })) : [{ id: "proj-1", name: "Solar Hybrid Project" }],
      ),
    },
    learningLogEntry: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "e1",
        decidedAt: new Date("2026-10-20T00:00:00Z"),
        decidedBy: { fullName: "Admin" },
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "e1",
        decidedAt: new Date("2026-10-20T00:00:00Z"),
        decidedBy: { fullName: "Admin" },
        entryType: "DECISION",
        title: "t",
        area: "OTHER",
        status: "PROPOSED",
        reviewCycle: "Q4",
        ...existing,
        ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
      })),
      findUnique: jest.fn().mockResolvedValue(existing),
    },
  };
  return { service: new LearningLogService(prisma as never), prisma };
}

const dto = (over: object = {}) => ({
  title: "A useful title",
  area: "OTHER",
  status: "PROPOSED",
  decision: "d".repeat(12),
  rationale: "r".repeat(12),
  reviewCycle: "Q4",
  ...over,
});
const user = { id: "u1" } as never;

describe("what an entry can be related to", () => {
  it("accepts a KPI, a programme or a project that exists, and returns its name", async () => {
    const { service } = build();
    expect((await service.create(user, dto({ relatedRecord: "M300-P2-025" }) as never)).entry.related).toEqual({ type: "kpi", id: "M300-P2-025", name: "Clean Cooking Access" });
    expect((await service.create(user, dto({ relatedRecord: "prog-1" }) as never)).entry.related).toMatchObject({ type: "programme", name: "EEP Phase III" });
    expect((await service.create(user, dto({ relatedRecord: "proj-1" }) as never)).entry.related).toMatchObject({ type: "project", name: "Solar Hybrid Project" });
  });

  it("refuses free text that is not a real record, and saves nothing", async () => {
    const { service, prisma } = build();
    await expect(service.create(user, dto({ relatedRecord: "the big KPI thing" }) as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.learningLogEntry.create).not.toHaveBeenCalled();
  });

  it("is fine with no related record", async () => {
    const { service } = build();
    expect((await service.create(user, dto() as never)).entry.related).toBeNull();
  });

  it("refuses changing an entry to a made-up reference", async () => {
    const { service, prisma } = build({ id: "e1", entryType: "DECISION", relatedRecord: null });
    await expect(service.update("e1", { relatedRecord: "made up" } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.learningLogEntry.update).not.toHaveBeenCalled();
  });

  it("leaves an older free-text reference alone when it is not being changed", async () => {
    const { service } = build({ id: "e1", entryType: "DECISION", relatedRecord: "old free text" });
    await expect(service.update("e1", { relatedRecord: "old free text", title: "New title here" } as never)).resolves.toBeDefined();
  });
});

describe("the choices offered", () => {
  it("lists KPIs with their code, and programmes and projects by name", async () => {
    const { prisma } = build();
    expect(await loadRelatedOptions(prisma as never)).toEqual({
      kpis: [{ value: "M300-P1-001", label: "M300-P1-001 — Installed Capacity" }],
      programmes: [{ value: "prog-1", label: "EEP Phase III" }],
      projects: [{ value: "proj-1", label: "Solar Hybrid Project" }],
    });
  });

  it("does not query when nothing is referenced", async () => {
    const { prisma } = build();
    expect((await loadRelatedLinks(prisma as never, [null, ""])).size).toBe(0);
    expect(prisma.kpiDefinition.findMany).not.toHaveBeenCalled();
  });
});
