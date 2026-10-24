import { compareReportingValues, reportingPeriodKey } from "./reporting-period";

describe("reporting chronology", () => {
  it("keeps a late correction to an old period behind a newer observation", () => {
    const oldCorrection = { period: "2024-Q4", approvedAt: new Date("2026-09-01") };
    const current = { period: "2026-Q2", approvedAt: new Date("2026-07-01") };
    expect(compareReportingValues(oldCorrection, current)).toBeLessThan(0);
    expect([current, oldCorrection].sort(compareReportingValues).at(-1)).toBe(current);
  });

  it("uses the latest approval for revisions within one period", () => {
    const first = { period: "q2-2026", approvedAt: new Date("2026-07-01") };
    const revision = { period: "q2-2026", approvedAt: new Date("2026-08-01") };
    expect(compareReportingValues(first, revision)).toBeLessThan(0);
  });

  it("orders monthly, quarterly and annual periods", () => {
    expect(reportingPeriodKey("2026-02")).toBeLessThan(reportingPeriodKey("Q2-2026")!);
    expect(reportingPeriodKey("2026-Q2")).toBe(reportingPeriodKey("Q2-2026"));
    expect(reportingPeriodKey("Q2-2026")).toBeLessThan(reportingPeriodKey("2026")!);
  });
});

import { isFuturePeriod, notInFuture, withoutFuturePeriods } from "./reporting-period";

describe("future periods", () => {
  const now = new Date("2026-10-24T10:00:00Z");

  it("treats a period as future only once it has not yet started", () => {
    expect(isFuturePeriod("2026", now)).toBe(false);
    expect(isFuturePeriod("q4-2026", now)).toBe(false);
    expect(isFuturePeriod("q1-2027", now)).toBe(true);
    expect(isFuturePeriod("2027", now)).toBe(true);
    expect(isFuturePeriod("2045", now)).toBe(true);
    expect(isFuturePeriod("2026-11", now)).toBe(true);
    expect(isFuturePeriod("2026-10", now)).toBe(false);
  });

  it("does not treat an unrecognised period as future", () => {
    expect(isFuturePeriod("baseline", now)).toBe(false);
  });

  it("drops future periods and keeps the rest", () => {
    const values = [{ period: "2025" }, { period: "2026" }, { period: "2030" }];
    expect(withoutFuturePeriods(values, now).map((value) => value.period)).toEqual(["2025", "2026"]);
  });

  it("never reports a date later than now", () => {
    expect(notInFuture(new Date("2026-12-31T00:00:00Z"), now)).toBe(now);
    expect(notInFuture(new Date("2026-06-30T00:00:00Z"), now).toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });
});
