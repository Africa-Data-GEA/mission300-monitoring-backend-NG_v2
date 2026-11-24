export const HEADLINE_KPI_CODES = [
  "M300-PX-001",
  "M300-P1-003",
  "M300-P1-005",
  "M300-P3-004",
  "M300-P3-006",
  "M300-P3-008",
  "M300-P3-012",
  "M300-P2-002",
  "M300-P2-006",
] as const;

export const BRIEF_BOTTLENECK_LIMIT = 5;
export const BRIEF_ACTION_LIMIT = 5;
export const BRIEF_COMPLETED_ACTION_SLOTS = 2;

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const ACTION_STATUS_ORDER = [
  "DELAYED",
  "IN_PROGRESS_AT_RISK",
  "IN_PROGRESS_MINOR_DELAYS",
  "IN_PROGRESS_ON_TRACK",
  "NOT_YET_DUE",
];

const UNITLESS = new Set(["", "number", "count"]);

function isPercent(unit: string): boolean {
  return unit.trim() === "%";
}

function formatNumber(value: number): string {
  const magnitude = Math.abs(value);
  const digits = magnitude >= 1000 ? 0 : magnitude >= 100 ? 1 : 2;
  const text = value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
  return text === "-0" ? "0" : text;
}

export function formatBriefValue(value: number, unit: string): string {
  if (isPercent(unit)) return `${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
  const text = formatNumber(value);
  return UNITLESS.has(unit.trim().toLowerCase()) ? text : `${text} ${unit.trim()}`;
}

export function formatBriefChange(latest: number, previous: number, unit: string): string {
  const delta = latest - previous;
  if (Math.abs(delta) < 1e-9) return "No change";
  const sign = delta > 0 ? "+" : "−";
  const magnitude = Math.abs(delta);
  if (isPercent(unit)) {
    return `${sign}${magnitude.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} pts`;
  }
  const text = formatNumber(magnitude);
  return UNITLESS.has(unit.trim().toLowerCase()) ? `${sign}${text}` : `${sign}${text} ${unit.trim()}`;
}

function rank(order: readonly string[], value: string): number {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

export function rankBottlenecks<T extends { severity: string; dateRaised: Date }>(records: readonly T[]): T[] {
  return [...records].sort(
    (a, b) =>
      rank(SEVERITY_ORDER, a.severity) - rank(SEVERITY_ORDER, b.severity) ||
      a.dateRaised.getTime() - b.dateRaised.getTime(),
  );
}

export function rankActions<T extends { isPriority: boolean; status: string; dueDate: Date | null }>(records: readonly T[]): T[] {
  const due = (record: T) => record.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  return [...records].sort(
    (a, b) =>
      Number(b.isPriority) - Number(a.isPriority) ||
      rank(ACTION_STATUS_ORDER, a.status) - rank(ACTION_STATUS_ORDER, b.status) ||
      due(a) - due(b),
  );
}

export type BriefTone = "good" | "bad" | "neutral";

export interface BriefIndicator {
  name: string;
  value: string | null;
  period: string | null;
  change: string | null;
  tone: BriefTone;
  target: string | null;
}

export interface BriefPillar {
  name: string;
  projects: number;
  onTrack: number;
  atRisk: number;
  bottlenecks: number;
}

export interface BriefBottleneck {
  issue: string;
  severity: string;
  pillar: string;
  ageDays: number;
  status: string;
}

export interface BriefAction {
  action: string;
  lead: string;
  due: string | null;
  status: string;
}

export interface BriefData {
  glance: {
    indicatorsReported: number;
    indicatorsTotal: number;
    projectsAtRisk: number;
    criticalBottlenecks: number;
    delayedActions: number;
    completedActions: number;
    totalActions: number;
    improvingIndicators: number;
  };
  indicators: BriefIndicator[];
  pillars: BriefPillar[];
  bottlenecks: BriefBottleneck[];
  actions: BriefAction[];
}

export function changeTone(delta: number, direction: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER"): BriefTone {
  if (Math.abs(delta) < 1e-9) return "neutral";
  const improving = direction === "HIGHER_IS_BETTER" ? delta > 0 : delta < 0;
  return improving ? "good" : "bad";
}
