export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const SHORT = MONTHS.map((month) => month.slice(0, 3));

export function quarterOfMonth(monthName: string): number | null {
  const index = MONTHS.indexOf(monthName as (typeof MONTHS)[number]);
  return index === -1 ? null : Math.floor(index / 3) + 1;
}

export function addMonth(coverage: Map<string, Set<string>>, period: string, monthName: string) {
  const months = coverage.get(period) ?? new Set<string>();
  months.add(monthName);
  coverage.set(period, months);
}

export function commonMonths(sources: Map<string, Set<string>>[]): Map<string, Set<string>> {
  const [first, ...rest] = sources;
  const result = new Map<string, Set<string>>();
  if (!first) return result;
  for (const [period, months] of first) {
    const shared = [...months].filter((month) => rest.every((source) => source.get(period)?.has(month)));
    result.set(period, new Set(shared));
  }
  return result;
}

export function coverageNoteFor(period: string, months: Set<string> | undefined): string | null {
  const match = /^q([1-4])-\d{4}$/.exec(period);
  if (!match || !months) return null;

  const quarter = Number(match[1]);
  const first = (quarter - 1) * 3;
  const present = [0, 1, 2].filter((offset) => months.has(MONTHS[first + offset]));
  if (present.length === 3 || present.length === 0) return null;

  const names = present.map((offset) => SHORT[first + offset]);
  const contiguous = present.every((offset, index) => index === 0 || offset === present[index - 1] + 1);
  return contiguous && names.length > 1 ? `${names[0]}–${names[names.length - 1]}` : names.join(", ");
}
