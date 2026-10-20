import { BadRequestException } from "@nestjs/common";
import { BottlenecksService } from "@/modules/bottlenecks/bottlenecks.service";
import { loadBottleneckLinks, toBottleneckRecord } from "@/modules/bottlenecks/bottlenecks.mappers";

jest.setTimeout(60000);

const admin = { id: "u1", role: "SYSTEM_ADMINISTRATOR", roles: [], institutionId: null } as never;

const dto = (linkedRecord?: string) =>
  ({
    issue: "Grid connection delayed",
    category: "COORDINATION",
    severity: "MEDIUM",
    pillar: "generation-network",
    linkedRecord,
    institution: "Rural Electrification Agency (REA)",
    lifecycleStage: "IDENTIFICATION",
  }) as never;

function build(options: { projects?: string[]; programmes?: string[] } = {}) {
  const projects = options.projects ?? [];
  const programmes = options.programmes ?? [];
  const create = jest.fn(async ({ data }: { data: { linkedRecord: string } }) => ({
    id: "b1",
    issue: "x",
    category: "COORDINATION",
    severity: "MEDIUM",
    pillar: { slug: "generation-network" },
    linkedRecord: data.linkedRecord,
    institution: "REA",
    dateRaised: new Date("2026-10-01T00:00:00.000Z"),
    followUp: "",
    escalationStatus: "NOT_ESCALATED",
    status: "OPEN",
    lifecycleStage: "IDENTIFICATION",
    statusHistory: [],
  }));
  const prisma = {
    project: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        projects.includes(where.id) ? { owner: "REA" } : null,
      ),
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => projects.includes(id)).map((id) => ({ id, name: `Project ${id}` })),
      ),
    },
    programme: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
        programmes.includes(where.id) ? { id: where.id } : null,
      ),
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => programmes.includes(id)).map((id) => ({ id, name: `Programme ${id}` })),
      ),
    },
    institution: { findUnique: jest.fn() },
    pillar: { findUnique: jest.fn().mockResolvedValue({ id: "p1" }) },
    bottleneck: { create },
  };
  return { service: new BottlenecksService(prisma as never), create };
}

describe("a bottleneck's link to a project, programme or pillar (REQ-001)", () => {
  it("links to an existing project and returns its name", async () => {
    const { service, create } = build({ projects: ["proj-1"] });
    const result = await service.create(admin, dto("proj-1"));
    expect(create.mock.calls[0][0].data.linkedRecord).toBe("proj-1");
    expect(result.record.link).toEqual({ type: "project", id: "proj-1", name: "Project proj-1" });
  });

  it("links to an existing programme and returns its name", async () => {
    const { service } = build({ programmes: ["prog-1"] });
    const result = await service.create(admin, dto("prog-1"));
    expect(result.record.link).toEqual({ type: "programme", id: "prog-1", name: "Programme prog-1" });
  });

  it("is linked to the pillar only when no project or programme is chosen", async () => {
    const { service } = build();
    const result = await service.create(admin, dto(undefined));
    expect(result.record.link).toBeNull();
    expect(result.record.pillar).toBe("generation-network");
  });

  it("refuses free text that is not a project or programme, and creates nothing", async () => {
    const { service, create } = build({ projects: ["proj-1"] });
    await expect(service.create(admin, dto("IMP-2025-0142"))).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("resolving links for display", () => {
  it("names each project and programme once", async () => {
    const { service } = build({ projects: ["a"], programmes: ["b"] });
    void service;
    const prisma = {
      project: { findMany: jest.fn().mockResolvedValue([{ id: "a", name: "Alpha" }]) },
      programme: { findMany: jest.fn().mockResolvedValue([{ id: "b", name: "Beta" }]) },
    };
    const links = await loadBottleneckLinks(prisma as never, ["a", "b", "a", ""]);
    expect([...links.values()]).toEqual([
      { type: "programme", id: "b", name: "Beta" },
      { type: "project", id: "a", name: "Alpha" },
    ]);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["a", "b"] } } }),
    );
  });

  it("does not query when nothing is linked", async () => {
    const prisma = { project: { findMany: jest.fn() }, programme: { findMany: jest.fn() } };
    expect((await loadBottleneckLinks(prisma as never, ["", ""])).size).toBe(0);
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it("leaves a legacy free-text record without a link", () => {
    const record = toBottleneckRecord(
      {
        id: "b2",
        issue: "x",
        category: "COORDINATION",
        severity: "LOW",
        pillar: { slug: "generation-network" },
        linkedRecord: "IMP-OLD",
        institution: "REA",
        dateRaised: new Date("2026-10-01T00:00:00.000Z"),
        followUp: "",
        escalationStatus: "NOT_ESCALATED",
        status: "OPEN",
        lifecycleStage: "IDENTIFICATION",
        statusHistory: [],
      } as never,
      new Date("2026-10-10T00:00:00.000Z"),
    );
    expect(record.linkedRecord).toBe("IMP-OLD");
    expect(record.link).toBeNull();
  });
});
