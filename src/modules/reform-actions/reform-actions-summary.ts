import { toKebabCase } from "@/common/utils/enum-casing";

export const REFORM_ACTION_STATUSES = [
  "NOT_YET_DUE",
  "IN_PROGRESS_ON_TRACK",
  "IN_PROGRESS_MINOR_DELAYS",
  "IN_PROGRESS_AT_RISK",
  "DELAYED",
  "COMPLETED",
] as const;

export type ReformStatus = (typeof REFORM_ACTION_STATUSES)[number];

export interface SummaryInput {
  pillarSlug: string;
  isPriority: boolean;
  status: ReformStatus;
}

export type StatusCounts = Record<string, number>;

function emptyCounts(): StatusCounts {
  return Object.fromEntries(REFORM_ACTION_STATUSES.map((status) => [toKebabCase(status), 0]));
}

export function summariseReformActions(items: readonly SummaryInput[]) {
  const byStatus = { priority: emptyCounts(), other: emptyCounts() };
  const pillars = new Map<string, { pillar: string; priority: number; other: number }>();

  for (const item of items) {
    const group = item.isPriority ? "priority" : "other";
    byStatus[group][toKebabCase(item.status)] += 1;
    const row = pillars.get(item.pillarSlug) ?? { pillar: item.pillarSlug, priority: 0, other: 0 };
    row[group] += 1;
    pillars.set(item.pillarSlug, row);
  }

  return {
    total: items.length,
    priorityTotal: items.filter((item) => item.isPriority).length,
    byPillar: [...pillars.values()],
    byStatus,
  };
}
