export type ScheduleCadence = "WEEKLY" | "MONTHLY";

export interface ScheduleTiming {
  cadence: ScheduleCadence;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hourLagos: number;
}

const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function isoWeekday(date: Date): number {
  return ((date.getUTCDay() + 6) % 7) + 1;
}

export function nextRunAfter(timing: ScheduleTiming, from: Date): Date {
  const local = new Date(from.getTime() + LAGOS_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();

  if (timing.cadence === "WEEKLY") {
    const weekday = timing.dayOfWeek ?? 1;
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(Date.UTC(year, month, day + offset, timing.hourLagos));
      if (isoWeekday(candidate) === weekday && candidate.getTime() > local.getTime()) {
        return new Date(candidate.getTime() - LAGOS_OFFSET_MS);
      }
    }
  }

  const dayOfMonth = timing.dayOfMonth ?? 1;
  for (let offset = 0; offset <= 2; offset++) {
    const candidate = new Date(Date.UTC(year, month + offset, dayOfMonth, timing.hourLagos));
    if (candidate.getTime() > local.getTime()) return new Date(candidate.getTime() - LAGOS_OFFSET_MS);
  }
  return new Date(Date.UTC(year, month + 3, dayOfMonth, timing.hourLagos) - LAGOS_OFFSET_MS);
}

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[value % 10] ?? "th";
  return `${value}${suffix}`;
}

export function describeSchedule(timing: ScheduleTiming): string {
  const time = `${String(timing.hourLagos).padStart(2, "0")}:00 (Lagos time)`;
  if (timing.cadence === "WEEKLY") return `Every ${DAY_NAMES[(timing.dayOfWeek ?? 1) - 1]} at ${time}`;
  return `On the ${ordinal(timing.dayOfMonth ?? 1)} of every month at ${time}`;
}
