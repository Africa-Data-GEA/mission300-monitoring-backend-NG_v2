export function latestDate(dates: readonly (Date | string | null | undefined)[], fallback: Date = new Date()): Date {
  let latest: Date | null = null;
  for (const entry of dates) {
    if (!entry) continue;
    const date = entry instanceof Date ? entry : new Date(entry);
    if (Number.isNaN(date.getTime())) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest ?? fallback;
}
