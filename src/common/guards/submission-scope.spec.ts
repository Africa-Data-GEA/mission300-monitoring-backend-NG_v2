import { assertSubmissionAccess, scopeSubmissionFilter } from "@/common/guards/institution-scope.guard";

const user = (role: string, institutionId: string | null, extra: object = {}) =>
  ({ id: "u", role, roles: [], institutionId, ...extra }) as never;

describe("which submissions an institution's people can see", () => {
  it("covers submissions about the institution and ones its own people uploaded", () => {
    expect(scopeSubmissionFilter(user("DATA_REVIEWER", "inst-nerc"))).toEqual({
      OR: [{ institutionId: "inst-nerc" }, { submittedBy: { institutionId: "inst-nerc" } }],
    });
  });

  it("shows nothing to someone with no institution", () => {
    expect(scopeSubmissionFilter(user("DATA_REVIEWER", null)).OR).toEqual([
      { institutionId: "__none__" },
      { submittedBy: { institutionId: "__none__" } },
    ]);
  });

  it("is unrestricted for a platform-wide reviewer", () => {
    expect(scopeSubmissionFilter(user("DATA_REVIEWER", null, { reviewsAllInstitutions: true }))).toEqual({});
  });
});

describe("NERC reviews the DisCo rows NERC uploaded", () => {
  const disco = { institutionId: "inst-eko", submittedBy: { institutionId: "inst-nerc" } };

  it("lets a NERC reviewer act on a DisCo submission uploaded by NERC", () => {
    expect(() => assertSubmissionAccess(user("DATA_REVIEWER", "inst-nerc"), disco)).not.toThrow();
  });

  it("lets the DisCo's own institution act on its submission", () => {
    expect(() => assertSubmissionAccess(user("DATA_REVIEWER", "inst-eko"), disco)).not.toThrow();
  });

  it("still refuses an unrelated institution", () => {
    expect(() => assertSubmissionAccess(user("DATA_REVIEWER", "inst-rea"), disco)).toThrow(/another institution/);
  });

  it("refuses someone with no institution", () => {
    expect(() => assertSubmissionAccess(user("DATA_REVIEWER", null), disco)).toThrow();
  });
});
