import { changeTone, formatBriefChange, formatBriefValue, rankActions, rankBottlenecks } from "./executive-brief";

describe("formatBriefValue", () => {
  it("shows percentages to one decimal with a % sign", () => {
    expect(formatBriefValue(34.48, "%")).toBe("34.5%");
    expect(formatBriefValue(60, "%")).toBe("60%");
  });

  it("groups large numbers without decimals and keeps the unit", () => {
    expect(formatBriefValue(8533.4, "GWh")).toBe("8,533 GWh");
    expect(formatBriefValue(1476608, "Number")).toBe("1,476,608");
  });

  it("keeps two decimals for small values and one for mid-sized ones", () => {
    expect(formatBriefValue(5.678, "MW")).toBe("5.68 MW");
    expect(formatBriefValue(124.33, "NGN/kWh")).toBe("124.3 NGN/kWh");
  });
});

describe("formatBriefChange", () => {
  it("reports percentage-point moves in points", () => {
    expect(formatBriefChange(34.5, 32.5, "%")).toBe("+2 pts");
    expect(formatBriefChange(32.5, 34.9, "%")).toBe("−2.4 pts");
  });

  it("signs absolute changes and keeps the unit", () => {
    expect(formatBriefChange(5400, 5300, "MW")).toBe("+100 MW");
    expect(formatBriefChange(5300, 5400, "MW")).toBe("−100 MW");
  });

  it("says when nothing moved", () => {
    expect(formatBriefChange(10, 10, "MW")).toBe("No change");
  });
});

describe("rankBottlenecks", () => {
  it("puts critical before high and older before newer within a severity", () => {
    const ranked = rankBottlenecks([
      { id: "low-old", severity: "LOW", dateRaised: new Date("2025-01-01") },
      { id: "high-new", severity: "HIGH", dateRaised: new Date("2026-05-01") },
      { id: "critical", severity: "CRITICAL", dateRaised: new Date("2026-06-01") },
      { id: "high-old", severity: "HIGH", dateRaised: new Date("2026-01-01") },
    ]);
    expect(ranked.map((record) => record.id)).toEqual(["critical", "high-old", "high-new", "low-old"]);
  });
});

describe("rankActions", () => {
  it("lists priority actions first, then the most behind, then the earliest due", () => {
    const ranked = rankActions([
      { id: "plain-delayed", isPriority: false, status: "DELAYED", dueDate: new Date("2026-01-01") },
      { id: "priority-on-track", isPriority: true, status: "IN_PROGRESS_ON_TRACK", dueDate: new Date("2026-03-01") },
      { id: "priority-delayed-late", isPriority: true, status: "DELAYED", dueDate: new Date("2026-09-01") },
      { id: "priority-delayed-early", isPriority: true, status: "DELAYED", dueDate: new Date("2026-02-01") },
      { id: "priority-no-date", isPriority: true, status: "DELAYED", dueDate: null },
    ]);
    expect(ranked.map((record) => record.id)).toEqual([
      "priority-delayed-early",
      "priority-delayed-late",
      "priority-no-date",
      "priority-on-track",
      "plain-delayed",
    ]);
  });
});

describe("changeTone", () => {
  it("is good when a higher-is-better value rises and bad when it falls", () => {
    expect(changeTone(2, "HIGHER_IS_BETTER")).toBe("good");
    expect(changeTone(-2, "HIGHER_IS_BETTER")).toBe("bad");
  });

  it("is good when a lower-is-better value falls and bad when it rises", () => {
    expect(changeTone(-2, "LOWER_IS_BETTER")).toBe("good");
    expect(changeTone(2, "LOWER_IS_BETTER")).toBe("bad");
  });

  it("is neutral when nothing moved", () => {
    expect(changeTone(0, "HIGHER_IS_BETTER")).toBe("neutral");
  });
});
