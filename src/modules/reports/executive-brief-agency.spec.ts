import type { PrismaService } from "@/prisma/prisma.service";
import { ExecutiveBriefService } from "./executive-brief.service";

const pillar = { slug: "last-mile-access", name: "Last-mile access" };
const action = (id: string, leadInstitution: string) => ({
  id,
  action: id,
  leadInstitution,
  isPriority: false,
  status: "IN_PROGRESS_ON_TRACK",
  dueDate: null,
  pillar,
});
const bottleneck = (issue: string, institution: string) => ({
  issue,
  institution,
  severity: "HIGH",
  status: "OPEN",
  dateRaised: new Date("2026-11-01T00:00:00Z"),
  pillar,
});
const project = (owner: string, leadInstitutionId: string | null) => ({
  currentStatus: "ON_TRACK",
  owner,
  programme: { leadInstitutionId },
  pillar,
});

function build() {
  const prisma = {
    institution: { findUnique: jest.fn().mockResolvedValue({ id: "rea", name: "Rural Electrification Agency (REA)" }) },
    kpiDefinition: { findMany: jest.fn().mockResolvedValue([]) },
    kpiValue: { findMany: jest.fn().mockResolvedValue([]) },
    pillar: { findMany: jest.fn().mockResolvedValue([pillar, { slug: "clean-cooking", name: "Clean cooking" }]) },
    project: { findMany: jest.fn().mockResolvedValue([project("REA", null), project("TCN", "rea"), project("TCN", "tcn")]) },
    bottleneck: { findMany: jest.fn().mockResolvedValue([bottleneck("Ours", "REA"), bottleneck("Theirs", "TCN")]) },
    reformAction: { findMany: jest.fn().mockResolvedValue([action("ours", "REA"), action("theirs", "NERC"), action("nobody", "")]) },
  };
  return { prisma, service: new ExecutiveBriefService(prisma as unknown as PrismaService) };
}

const config = {
  periods: ["all"],
  pillars: ["all"],
  kpiCategory: "all",
  state: "all",
  distributionCompany: "all",
  programmeOrAgency: "all",
  validationStatus: "all",
  readinessTier: "all",
};

describe("executive brief for one agency", () => {
  it("keeps only that agency's actions, projects and bottlenecks", async () => {
    const { service } = build();
    const { brief } = await service.build({ ...config, institutionId: "rea" });

    expect(brief.preparedFor).toBe("Rural Electrification Agency (REA)");
    expect(brief.actions.map((item) => item.action)).toEqual(["ours"]);
    expect(brief.bottlenecks.map((item) => item.issue)).toEqual(["Ours"]);
    expect(brief.pillars).toEqual([expect.objectContaining({ name: "Last-mile access", projects: 2 })]);
  });

  it("leaves the national brief unfiltered", async () => {
    const { service, prisma } = build();
    const { brief } = await service.build(config);

    expect(brief.preparedFor).toBeUndefined();
    expect(brief.actions).toHaveLength(3);
    expect(brief.pillars).toHaveLength(2);
    expect(prisma.institution.findUnique).not.toHaveBeenCalled();
  });
});
