import { reviewScopeProblem } from "@/modules/administration/users/review-scope-rules";

describe("a reviewer's scope must be explicit", () => {
  it("accepts a reviewer with an institution", () => {
    expect(reviewScopeProblem(["DATA_REVIEWER"], "Rural Electrification Agency (REA)", false)).toBeNull();
  });

  it("accepts a reviewer or validator set to review all institutions", () => {
    expect(reviewScopeProblem(["DATA_REVIEWER"], null, true)).toBeNull();
    expect(reviewScopeProblem(["DATA_REVIEWER", "VALIDATOR"], "", true)).toBeNull();
  });

  it("refuses a reviewer with neither", () => {
    expect(reviewScopeProblem(["DATA_REVIEWER"], "", false)).toMatch(/needs an institution/);
    expect(reviewScopeProblem(["VALIDATOR"], undefined, false)).toMatch(/needs an institution/);
  });

  it("refuses both an institution and all institutions", () => {
    expect(reviewScopeProblem(["DATA_REVIEWER"], "REA", true)).toMatch(/not both/);
  });

  it("refuses all institutions for anyone who is not only a reviewer", () => {
    expect(reviewScopeProblem(["INSTITUTIONAL_DATA_PROVIDER"], null, true)).toMatch(/Only a Data Reviewer/);
    expect(reviewScopeProblem(["DATA_REVIEWER", "INSTITUTIONAL_DATA_PROVIDER"], null, true)).toMatch(/Only a Data Reviewer/);
  });

  it("does not require an institution of roles that are not reviewer-only", () => {
    expect(reviewScopeProblem(["SYSTEM_ADMINISTRATOR"], "", false)).toBeNull();
    expect(reviewScopeProblem(["DATA_REVIEWER", "SYSTEM_ADMINISTRATOR"], "", false)).toBeNull();
  });
});
