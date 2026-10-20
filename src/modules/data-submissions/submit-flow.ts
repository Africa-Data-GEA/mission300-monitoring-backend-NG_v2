import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";

const REVIEW_ROLES = ["DATA_REVIEWER", "VALIDATOR", "SYSTEM_ADMINISTRATOR"];

export const SUBMISSION_HISTORY_URL = "/data-submissions/submissions";
export const VALIDATION_QUEUE_URL = "/data-submissions/validation";

export function canOpenValidationPages(user: AuthenticatedUser): boolean {
  const roles = user.roles?.length ? user.roles : [user.role];
  return roles.some((role) => REVIEW_ROLES.includes(role));
}

export function nextUrlAfterSubmit(user: AuthenticatedUser, submissionId: string | null): string {
  if (!canOpenValidationPages(user)) return SUBMISSION_HISTORY_URL;
  return submissionId ? `${VALIDATION_QUEUE_URL}/${submissionId}` : VALIDATION_QUEUE_URL;
}

export function alreadyWaitingMessage(periods: string[], provisional = false): string {
  const unique = [...new Set(periods)];
  const which = unique.length === 1 ? `for ${unique[0]}` : `for ${unique.join(", ")}`;
  if (provisional) {
    return `A submission ${which} is provisionally approved. Confirm or withdraw it first before submitting again.`;
  }
  return `A submission ${which} is already awaiting review. Wait for the decision before submitting again.`;
}

const MAX_PROBLEMS_SHOWN = 20;

export function rowProblemsMessage(problems: string[], again = "upload it again"): string {
  const shown = problems.slice(0, MAX_PROBLEMS_SHOWN);
  const more = problems.length - shown.length;
  const count = `${problems.length} problem${problems.length === 1 ? "" : "s"}`;
  return [
    `The file was not accepted and nothing was submitted: ${count} found. Correct these rows and ${again}.`,
    ...shown,
    ...(more > 0 ? [`...and ${more} more.`] : []),
  ].join("\n");
}

export function isSingleDiscoValueForNationalKpi(submitterInstitutionType: string, kpiAggregation: string): boolean {
  return submitterInstitutionType.trim().toLowerCase() === "disco" && /national/i.test(kpiAggregation);
}

export function receivedMessage(rowCount: number, valueCount: number, submissionCount: number): string {
  const rows = `${rowCount} row${rowCount === 1 ? "" : "s"}`;
  const values = `${valueCount} value${valueCount === 1 ? "" : "s"}`;
  const created =
    submissionCount === 1 ? "1 submission was created" : `${submissionCount} submissions were created`;
  return (
    `Received: ${rows} read, ${values} checked for format and range, none rejected, ${created}. ` +
    "Nothing is published until a reviewer approves it."
  );
}

export function heldBackNote(kpiNames: string[]): string {
  const unique = [...new Set(kpiNames)];
  return (
    ` Not published as a national figure: ${unique.join(", ")}. ` +
    "A single distribution company's value cannot stand for the national figure, which needs inputs from every DisCo. " +
    "The value stays on this submission's record."
  );
}

export interface RowProblem {
  rowNumber: number;
  period: string;
  field: string | null;
  value: string | null;
  message: string;
  text: string;
}

export function toProblemDetails(problems: RowProblem[]) {
  return [...problems]
    .sort((a, b) => a.rowNumber - b.rowNumber)
    .map(({ rowNumber, period, field, value, message }) => ({ row: rowNumber, period, field, value, problem: message }));
}

export function rollupNote(published: string[], waiting: string[]): string {
  const names = (entries: string[]) => [...new Set(entries.map((entry) => entry.split(" ")[0]))].join(", ");
  const parts = [" The national figures are worked out from every approved DisCo row for the quarter, not from this one DisCo."];
  if (published.length) parts.push(` Updated now: ${names(published)}.`);
  if (waiting.length) parts.push(` Waiting for the remaining DisCo rows to be decided: ${names(waiting)}.`);
  return parts.join("");
}
