export const REVIEW_REMINDER_DAYS = 3;
export const REVIEW_ESCALATION_DAYS = 7;
export const DEADLINE_EARLY_DAYS = 7;
export const DEADLINE_LAST_DAYS = 1;
export const OVERDUE_REPEAT_DAYS = 7;
export const RETURNED_REMINDER_DAYS = 5;
export const RETURNED_ESCALATION_DAYS = 10;
export const DEFAULT_OVERDUE_LIMIT_DAYS = 90;
export const SEND_FROM_UTC_HOUR = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReminderSection =
  | "review-escalation"
  | "review-waiting"
  | "overdue"
  | "deadline"
  | "returned-escalation"
  | "returned";

export function dayNumber(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

export function daysSince(date: Date, now: Date): number {
  return dayNumber(now) - dayNumber(date);
}

export interface DeadlineStage {
  section: "deadline" | "overdue";
  stage: string;
  days: number;
}

export function deadlineStage(dueDate: Date, now: Date, overdueLimitDays = DEFAULT_OVERDUE_LIMIT_DAYS): DeadlineStage | null {
  const remaining = dayNumber(dueDate) - dayNumber(now);
  if (remaining > DEADLINE_EARLY_DAYS) return null;
  if (remaining > DEADLINE_LAST_DAYS) return { section: "deadline", stage: "early", days: remaining };
  if (remaining >= 0) return { section: "deadline", stage: "last", days: remaining };
  const overdue = -remaining;
  if (overdue > overdueLimitDays) return null;
  return { section: "overdue", stage: `week-${Math.floor((overdue - 1) / OVERDUE_REPEAT_DAYS) + 1}`, days: overdue };
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function deadlineText(stage: DeadlineStage): string {
  if (stage.section === "overdue") return `${plural(stage.days, "day")} overdue`;
  if (stage.days === 0) return "due today";
  return `due in ${plural(stage.days, "day")}`;
}
