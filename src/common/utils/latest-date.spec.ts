import { latestDate } from "@/common/utils/latest-date";

describe("latestDate", () => {
  const fallback = new Date("2026-10-24T00:00:00Z");

  it("returns the most recent of the dates given", () => {
    expect(latestDate([new Date("2026-06-30T00:00:00Z"), "2026-09-25T00:00:00.000Z", null], fallback).toISOString()).toBe(
      "2026-09-25T00:00:00.000Z",
    );
  });

  it("ignores empty and invalid entries", () => {
    expect(latestDate([undefined, null, "not a date"], fallback)).toBe(fallback);
  });

  it("falls back when there are no dates", () => {
    expect(latestDate([], fallback)).toBe(fallback);
  });
});
