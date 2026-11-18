import { describeSchedule, nextRunAfter, type ScheduleTiming } from "./report-schedule";

const weekly = (dayOfWeek: number, hourLagos: number): ScheduleTiming => ({ cadence: "WEEKLY", dayOfWeek, dayOfMonth: null, hourLagos });
const monthly = (dayOfMonth: number, hourLagos: number): ScheduleTiming => ({ cadence: "MONTHLY", dayOfWeek: null, dayOfMonth, hourLagos });

describe("nextRunAfter", () => {
  it("runs a weekly schedule on the coming day at the Lagos hour, which is one hour behind in UTC", () => {
    const next = nextRunAfter(weekly(1, 8), new Date("2026-11-19T10:00:00Z"));
    expect(next.toISOString()).toBe("2026-11-23T07:00:00.000Z");
  });

  it("runs later the same day when the time has not passed yet", () => {
    const next = nextRunAfter(weekly(4, 16), new Date("2026-11-19T10:00:00Z"));
    expect(next.toISOString()).toBe("2026-11-19T15:00:00.000Z");
  });

  it("moves a week on once the time has passed", () => {
    const next = nextRunAfter(weekly(4, 8), new Date("2026-11-19T10:00:00Z"));
    expect(next.toISOString()).toBe("2026-11-26T07:00:00.000Z");
  });

  it("never returns the instant it was asked from", () => {
    const next = nextRunAfter(weekly(4, 8), new Date("2026-11-19T07:00:00Z"));
    expect(next.toISOString()).toBe("2026-11-26T07:00:00.000Z");
  });

  it("handles midnight Lagos time, which is the previous day in UTC", () => {
    const next = nextRunAfter(weekly(1, 0), new Date("2026-11-19T10:00:00Z"));
    expect(next.toISOString()).toBe("2026-11-22T23:00:00.000Z");
  });

  it("runs a monthly schedule this month if the day is still ahead", () => {
    const next = nextRunAfter(monthly(25, 9), new Date("2026-11-19T10:00:00Z"));
    expect(next.toISOString()).toBe("2026-11-25T08:00:00.000Z");
  });

  it("rolls a monthly schedule into the next month and across a year end", () => {
    expect(nextRunAfter(monthly(1, 8), new Date("2026-11-19T10:00:00Z")).toISOString()).toBe("2026-12-01T07:00:00.000Z");
    expect(nextRunAfter(monthly(1, 8), new Date("2026-12-19T10:00:00Z")).toISOString()).toBe("2027-01-01T07:00:00.000Z");
  });
});

describe("describeSchedule", () => {
  it("describes weekly and monthly schedules in plain words", () => {
    expect(describeSchedule(weekly(1, 8))).toBe("Every Monday at 08:00 (Lagos time)");
    expect(describeSchedule(weekly(7, 17))).toBe("Every Sunday at 17:00 (Lagos time)");
    expect(describeSchedule(monthly(1, 8))).toBe("On the 1st of every month at 08:00 (Lagos time)");
    expect(describeSchedule(monthly(22, 8))).toBe("On the 22nd of every month at 08:00 (Lagos time)");
    expect(describeSchedule(monthly(11, 8))).toBe("On the 11th of every month at 08:00 (Lagos time)");
  });
});
