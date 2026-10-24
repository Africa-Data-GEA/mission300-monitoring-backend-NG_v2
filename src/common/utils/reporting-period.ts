/** Compare reporting chronology, then approval chronology for revisions of the same period. */
export function reportingPeriodKey(period: string): number | null {
  const value = period.trim();
  const quarter = /^q([1-4])-(\d{4})$/i.exec(value);
  if (quarter) return Number(quarter[2]) * 12 + Number(quarter[1]) * 3;
  const yearQuarter = /^(\d{4})-q([1-4])$/i.exec(value);
  if (yearQuarter) return Number(yearQuarter[1]) * 12 + Number(yearQuarter[2]) * 3;
  const monthly = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (monthly) return Number(monthly[1]) * 12 + Number(monthly[2]);
  const year = /^(\d{4})$/.exec(value);
  if (year) return Number(year[1]) * 12 + 12;
  return null;
}

export function compareReportingValues(
  left: { period: string; approvedAt: Date },
  right: { period: string; approvedAt: Date },
): number {
  const leftKey = reportingPeriodKey(left.period);
  const rightKey = reportingPeriodKey(right.period);
  if (leftKey !== null && rightKey !== null && leftKey !== rightKey) return leftKey - rightKey;
  if (leftKey === null && rightKey !== null) return -1;
  if (leftKey !== null && rightKey === null) return 1;
  if (left.period !== right.period) return left.period.localeCompare(right.period);
  return left.approvedAt.getTime() - right.approvedAt.getTime();
}

export function periodStartKey(period: string): number | null {
  const value = period.trim();
  const quarter = /^q([1-4])-(\d{4})$/i.exec(value);
  if (quarter) return Number(quarter[2]) * 12 + (Number(quarter[1]) - 1) * 3 + 1;
  const yearQuarter = /^(\d{4})-q([1-4])$/i.exec(value);
  if (yearQuarter) return Number(yearQuarter[1]) * 12 + (Number(yearQuarter[2]) - 1) * 3 + 1;
  const monthly = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (monthly) return Number(monthly[1]) * 12 + Number(monthly[2]);
  const year = /^(\d{4})$/.exec(value);
  if (year) return Number(year[1]) * 12 + 1;
  return null;
}

export function isFuturePeriod(period: string, now: Date = new Date()): boolean {
  const start = periodStartKey(period);
  if (start === null) return false;
  return start > now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
}

export function withoutFuturePeriods<T extends { period: string }>(values: readonly T[], now: Date = new Date()): T[] {
  return values.filter((value) => !isFuturePeriod(value.period, now));
}

export function notInFuture(date: Date, now: Date = new Date()): Date {
  return date.getTime() > now.getTime() ? now : date;
}
