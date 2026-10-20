import { NO_DATASET_STATE } from "@/modules/data-submissions/data-gap-state";
import { toDataGap } from "@/modules/data-submissions/data-submissions.mappers";
import { DataSubmissionsService } from "@/modules/data-submissions/data-submissions.service";

jest.setTimeout(60000);

const kpi = (overrides: object = {}) =>
  ({
    id: "k1",
    code: "M300-P3-015",
    name: "DARES Programme Milestones Achieved",
    frequency: "Quarterly",
    readiness: "CORE",
    pillar: { name: "Financially Viable Utilities" },
    sourceInstitutions: [{ institution: { name: "Rural Electrification Agency (REA)" } }],
    datasetFields: [],
    ...overrides,
  }) as never;

function build() {
  const findMany = jest.fn().mockResolvedValue([kpi()]);
  const service = new DataSubmissionsService(
    { kpiDefinition: { findMany } } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, findMany };
}

const provider = { id: "u1", role: "INSTITUTIONAL_DATA_PROVIDER", roles: [], institutionId: "inst-rea" } as never;
const admin = { id: "u2", role: "SYSTEM_ADMINISTRATOR", roles: [], institutionId: null } as never;

describe("what Data gaps shows", () => {
  it("limits an institution's user to the indicators that institution owns", async () => {
    const { service, findMany } = build();
    await service.getGaps(provider, {});
    expect(findMany.mock.calls[0][0].where.sourceInstitutions).toEqual({ some: { institutionId: "inst-rea" } });
  });

  it("does not let an institution's user widen the scope through the institution filter", async () => {
    const { service, findMany } = build();
    await service.getGaps(provider, { institution: "inst-niso" });
    expect(findMany.mock.calls[0][0].where.sourceInstitutions).toEqual({ some: { institutionId: "inst-rea" } });
  });

  it("shows an administrator everything unless they choose an institution", async () => {
    const { service, findMany } = build();
    await service.getGaps(admin, {});
    expect(findMany.mock.calls[0][0].where.sourceInstitutions).toBeUndefined();
    await service.getGaps(admin, { institution: "inst-niso" });
    expect(findMany.mock.calls[1][0].where.sourceInstitutions).toEqual({ some: { institutionId: "inst-niso" } });
  });

  it("applies the readiness filter and the search", async () => {
    const { service, findMany } = build();
    await service.getGaps(admin, { readinessTier: "core", search: "dares" });
    const where = findMany.mock.calls[0][0].where;
    expect(where.readiness).toBe("CORE");
    expect(where.OR).toHaveLength(3);
  });

  it("ignores a readiness value it does not know", async () => {
    const { service, findMany } = build();
    await service.getGaps(admin, { readinessTier: "all" });
    expect(findMany.mock.calls[0][0].where.readiness).toBeUndefined();
  });
});

describe("a data gap row", () => {
  it("names the owner, the readiness and the KPI code", () => {
    const gap = toDataGap(kpi(), NO_DATASET_STATE);
    expect(gap.kpiId).toBe("M300-P3-015");
    expect(gap.owner).toBe("Rural Electrification Agency (REA)");
    expect(gap.readinessTier).toBe("Core");
    expect(gap.availableActions).toEqual(["view"]);
  });

  it("says unassigned only when no owning institution is known", () => {
    expect(toDataGap(kpi({ sourceInstitutions: [] }), NO_DATASET_STATE).owner).toBe("Unassigned");
  });

  it("carries the category, next action and status from the gap state", () => {
    const gap = toDataGap(kpi(), { category: "Needs correction", nextAction: "Fix it.", statusCode: "rejected" });
    expect(gap.category).toBe("Needs correction");
    expect(gap.nextAction).toBe("Fix it.");
    expect(gap.status).toEqual({ code: "rejected", label: "Rejected", tone: "danger" });
  });

  it("has no status when there is no obligation", () => {
    expect(toDataGap(kpi(), NO_DATASET_STATE).status).toBeNull();
  });
});
