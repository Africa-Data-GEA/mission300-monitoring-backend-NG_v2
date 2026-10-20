import { anyName, resolvePillarInstitutionFilter } from "@/modules/pillar-dashboard/pillar-institution-filter";

jest.setTimeout(30000);

function db(institutions: { id: string; name: string }[]) {
  return {
    institution: {
      findFirst: jest.fn(async ({ where }: { where: { OR: { id?: string; name?: { equals: string } }[] } }) =>
        institutions.find((entry) => where.OR.some((clause) => clause.id === entry.id || clause.name?.equals.toLowerCase() === entry.name.toLowerCase())) ?? null,
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => institutions.find((entry) => entry.id === where.id) ?? null),
    },
    project: { findMany: jest.fn().mockResolvedValue([{ owner: "REA" }, { owner: "NERC" }]) },
    programme: { findMany: jest.fn().mockResolvedValue([{ leadInstitution: "Rural Electrification Agency (REA)" }]) },
    bottleneck: { findMany: jest.fn().mockResolvedValue([{ institution: "Rural Electrification Agency" }]) },
  };
}

const REA = { id: "seed-institution-rea", name: "Rural Electrification Agency (REA)" };
const NISO = { id: "seed-institution-niso-tcn", name: "NISO / TCN" };

describe("the institution filter on a pillar page", () => {
  it("is off for nothing or 'all'", async () => {
    expect(await resolvePillarInstitutionFilter(db([REA]) as never, undefined)).toBeNull();
    expect(await resolvePillarInstitutionFilter(db([REA]) as never, "all")).toBeNull();
  });

  it("finds an institution by id and gathers the spellings recorded for it", async () => {
    const filter = await resolvePillarInstitutionFilter(db([REA, NISO]) as never, REA.id);
    expect(filter?.institutionId).toBe(REA.id);
    expect(filter?.names).toEqual(expect.arrayContaining([REA.name, "REA", "Rural Electrification Agency"]));
    expect(filter?.names).not.toContain("NERC");
  });

  it("resolves a differently worded name to the registered institution", async () => {
    const filter = await resolvePillarInstitutionFilter(db([REA, NISO]) as never, "Nigerian Independent System Operator (NISO)");
    expect(filter?.institutionId).toBe(NISO.id);
  });

  it("matches nothing for an institution that does not exist, rather than everything", async () => {
    const filter = await resolvePillarInstitutionFilter(db([REA]) as never, "Nowhere Ltd");
    expect(filter).toEqual({ institutionId: null, names: ["Nowhere Ltd"] });
  });

  it("builds case-insensitive name matches", () => {
    expect(anyName([" REA "])).toEqual([{ equals: "REA", mode: "insensitive" }]);
  });
});
