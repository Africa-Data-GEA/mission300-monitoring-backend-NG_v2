import { recordedAt } from "@/modules/kpi-explorer/kpi-explorer.mappers";

describe("recordedAt", () => {
  it("uses the time the value was loaded or changed", () => {
    const value = { approvedAt: new Date("2026-12-31T00:00:00Z"), updatedAt: new Date("2026-10-24T09:00:00Z") };
    expect(recordedAt(value)?.toISOString()).toBe("2026-10-24T09:00:00.000Z");
  });

  it("falls back to the approval date when no load time is held", () => {
    expect(recordedAt({ approvedAt: new Date("2026-06-30T00:00:00Z") })?.toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });

  it("has no date when there is no value", () => {
    expect(recordedAt(null)).toBeNull();
  });
});
