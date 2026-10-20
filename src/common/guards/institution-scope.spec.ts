import { isUnscopedRole, scopeInstitutionFilter } from "@/common/guards/institution-scope.guard";

const user = (role: string, institutionId: string | null, extra: object = {}) =>
  ({ id: "u", role, roles: [], institutionId, ...extra }) as never;

describe("which institutions a user can see (REV-001)", () => {
  it("lets a reviewer review every institution only when explicitly set to", () => {
    expect(isUnscopedRole(user("DATA_REVIEWER", null, { reviewsAllInstitutions: true }))).toBe(true);
    expect(scopeInstitutionFilter(user("VALIDATOR", null, { reviewsAllInstitutions: true }))).toEqual({});
  });

  it("gives a reviewer with no institution and no setting nothing", () => {
    expect(isUnscopedRole(user("DATA_REVIEWER", null))).toBe(false);
    expect(scopeInstitutionFilter(user("DATA_REVIEWER", null))).toEqual({ institutionId: "__none__" });
  });

  it("keeps a reviewer who belongs to an institution scoped to it", () => {
    expect(scopeInstitutionFilter(user("DATA_REVIEWER", "inst-rea"))).toEqual({ institutionId: "inst-rea" });
    expect(isUnscopedRole(user("DATA_REVIEWER", "inst-rea", { reviewsAllInstitutions: true }))).toBe(false);
  });

  it("never widens a data provider, whatever the setting", () => {
    expect(isUnscopedRole(user("INSTITUTIONAL_DATA_PROVIDER", null, { reviewsAllInstitutions: true }))).toBe(false);
  });

  it("does not widen someone who is both provider and reviewer", () => {
    const both = user("DATA_REVIEWER", null, { roles: ["DATA_REVIEWER", "INSTITUTIONAL_DATA_PROVIDER"], reviewsAllInstitutions: true });
    expect(isUnscopedRole(both)).toBe(false);
  });

  it("keeps the administrative roles unscoped", () => {
    expect(isUnscopedRole(user("SYSTEM_ADMINISTRATOR", null))).toBe(true);
  });
});
