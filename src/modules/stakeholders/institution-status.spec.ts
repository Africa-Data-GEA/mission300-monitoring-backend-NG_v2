import { institutionStatus } from "@/modules/stakeholders/institution-status";

const base = { userStatuses: [], hasApprovedData: false, datasetOrObligationCount: 0 };

describe("an institution's onboarding status", () => {
  it("is active with an active user", () => {
    expect(institutionStatus({ ...base, userStatuses: ["PENDING", "ACTIVE"] })).toBe("active");
  });

  it("is active once data has been approved, even with no login", () => {
    expect(institutionStatus({ ...base, hasApprovedData: true })).toBe("active");
  });

  it("is in progress when a user is invited but not yet active", () => {
    expect(institutionStatus({ ...base, userStatuses: ["PENDING"] })).toBe("onboarding-in-progress");
  });

  it("is in progress when a dataset or obligation is assigned but nothing is approved", () => {
    expect(institutionStatus({ ...base, datasetOrObligationCount: 2 })).toBe("onboarding-in-progress");
  });

  it("is pending when nothing has happened yet", () => {
    expect(institutionStatus(base)).toBe("pending-onboarding");
  });

  it("is not active when its only users are suspended or inactive", () => {
    expect(institutionStatus({ ...base, userStatuses: ["SUSPENDED", "INACTIVE"] })).toBe("pending-onboarding");
  });
});
