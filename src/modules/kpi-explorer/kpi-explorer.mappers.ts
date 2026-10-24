import type {
  Institution,
  KpiDefinition,
  KpiSourceInstitution,
  KpiTargetPoint,
  KpiValue,
  Pillar,
  Submission,
  SubmissionItem,
} from "@prisma/client";
import { toKebabCase } from "@/common/utils/enum-casing";
import { ADMIN_OVERRIDE_SOURCE_REFERENCE } from "@/modules/kpi-explorer/admin-override.constant";
import { compareReportingValues, notInFuture, withoutFuturePeriods } from "@/common/utils/reporting-period";
import { isStatusUnit, statusLabel } from "@/common/kpi/status-values";

type ValueWithProvenance = KpiValue & { sourceSubmissionItem: SubmissionItem & { submission: Submission } };

// The one label for "no KpiValue has ever been approved for this KPI yet"
// (current === null) - every caller showing a KPI's current figure imports
// this rather than inventing its own wording, so the dashboard never shows
// two different strings (e.g. "No data yet" here, "Not yet reported"
// somewhere else) for the identical state. See executive-overview.service.ts's
// buildAccessChannel/buildCompactOutcomeCard for the other consumers.
export const NO_KPI_VALUE_LABEL = "No data yet";

/**
 * The real contract's 5-value validationStatus vocabulary is broader than
 * what this system can currently produce: only two decisions ever write a
 * KpiValue (APPROVE, PROVISIONALLY_APPROVE - see recordDecision() in
 * data-submissions.service.ts), so "public-source" and "requires-
 * validation" (which imply a value sourced some OTHER way, e.g. a public
 * report typed in directly) are never reachable yet. Honest 3-state
 * derivation rather than inventing a path to values this system can't
 * actually produce.
 */
function deriveValidationStatus(submissionStatus: string | null): string {
  if (!submissionStatus) return "future";
  if (submissionStatus === "APPROVED") return "confirmed";
  if (submissionStatus === "PROVISIONALLY_APPROVED") return "provisional";
  return "requires-validation";
}

function deriveConfidence(submissionStatus: string | null): string {
  if (!submissionStatus) return "future-gap";
  if (submissionStatus === "APPROVED") return "confirmed";
  return "requires-validation";
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

export function formatPeriodLabel(period: string): string {
  const quarter = /^q([1-4])-(\d{4})$/i.exec(period.trim());
  if (quarter) return `Q${quarter[1]} ${quarter[2]}`;
  return period;
}

const HISTORY_WINDOW = 4;

/** Formats a trend delta for display - compact (1.2M/45.3K) once the
 * magnitude is large (people counts, USD Million figures, etc.), plain
 * locale-formatted otherwise (percentage-point changes stay as e.g.
 * "0.83", never compacted). Carries its own sign via the value itself
 * (Math.abs never applied), so the caller's separate "+" prefix for a
 * positive change is the only other sign in the final label. */
function formatTrendMagnitude(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function buildTrend(
  currentValue: number,
  previousValue: number,
  previousPeriod: string,
  unit: string,
  direction: "higher-is-better" | "lower-is-better",
) {
  const change = Math.round((currentValue - previousValue) * 100) / 100;
  const sign = change > 0 ? "+" : "";
  const suffix = unit === "%" ? " pp" : unit ? ` ${unit}` : "";
  return {
    change,
    label: `${sign}${formatTrendMagnitude(change)}${suffix} vs ${formatPeriodLabel(previousPeriod)}`,
    direction,
  };
}

type ResolvedSourceInstitution = KpiSourceInstitution & { institution: Institution };

type KpiWithPillar = KpiDefinition & {
  pillar: Pillar;
  sourceInstitutions?: ResolvedSourceInstitution[];
};

function toResolvedSourceInstitutions(kpi: KpiWithPillar) {
  return (kpi.sourceInstitutions ?? []).map((link) => ({
    id: link.institution.id,
    name: link.institution.name,
    type: link.institution.type,
  }));
}

/** Matches kpiCatalogueRowSchema exactly (m300-frontend/src/api/schemas/kpi-explorer.ts). */
export function recordedAt(value: { approvedAt: Date; updatedAt?: Date } | null | undefined): Date | null {
  return value ? (value.updatedAt ?? value.approvedAt) : null;
}

export function toCatalogueRow(kpi: KpiWithPillar, latestValue: ValueWithProvenance | null) {
  const submissionStatus = latestValue?.sourceSubmissionItem.submission.status ?? null;
  return {
    id: kpi.code,
    name: kpi.name,
    pillar: kpi.pillar.slug,
    category: kpi.category || "Uncategorized",
    unit: kpi.unit,
    sourceInstitution: kpi.sourceInstitution || "Not supplied",
    sourceInstitutions: toResolvedSourceInstitutions(kpi),
    sourceDataset: kpi.sourceDataset || "Not supplied",
    frequency: kpi.frequency || "Not supplied",
    readiness: toKebabCase(kpi.readiness),
    validationStatus: deriveValidationStatus(submissionStatus),
    lastUpdated: notInFuture(recordedAt(latestValue) ?? kpi.updatedAt).toISOString(),
    active: kpi.isActive,
  };
}

function buildVarianceLabel(
  current: number | null,
  target: number | null,
  direction: string,
  unit: string,
): string {
  if (current === null || target === null) return "No variance available.";
  const diff = current - target;
  const onTrack = direction === "HIGHER_IS_BETTER" ? diff >= 0 : diff <= 0;
  const sign = diff > 0 ? "+" : "";
  const unitSuffix = unit ? ` ${unit}` : "";
  return `${sign}${diff.toFixed(2)}${unitSuffix} vs target (${onTrack ? "on track" : "behind target"})`;
}

const DECISION_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  PROVISIONALLY_APPROVED: "Provisionally approved",
};

type LinkedKpi = { code: string; name: string };

type KpiWithFullProfile = KpiWithPillar & {
  targetPoints: KpiTargetPoint[];
  canonicalKpi?: LinkedKpi | null;
  aliases?: LinkedKpi[];
};

function toRelatedIndicators(kpi: KpiWithFullProfile) {
  return [
    ...(kpi.canonicalKpi ? [{ id: kpi.canonicalKpi.code, name: kpi.canonicalKpi.name, relation: "canonical" as const }] : []),
    ...(kpi.aliases ?? []).map((alias) => ({ id: alias.code, name: alias.name, relation: "alias" as const })),
  ];
}

/**
 * Matches kpiProfileSchema exactly. `current`/`history`/`validationStatus`/
 * `confidence`/`reportingPeriod`/`validationDecision` are all derived from
 * `kpiValues` (ordered oldest to newest) here, never stored - the same
 * "only changes via an approved submission" rule the schema's own header
 * comment already states. `linkedRecords` is always [] for now - the
 * Implementation Register (Programs/Projects) hasn't been rebuilt to a
 * real contract yet, so there's nothing real to join against.
 */
export function toKpiProfile(kpi: KpiWithFullProfile, allKpiValues: ValueWithProvenance[]) {
  const kpiValues = withoutFuturePeriods(allKpiValues);
  const sorted = [...kpiValues].sort(compareReportingValues);
  const latestByPeriod = new Map<string, ValueWithProvenance>();
  for (const value of sorted) latestByPeriod.set(value.period.toLowerCase(), value);
  const chronological = [...latestByPeriod.values()].sort(compareReportingValues);
  const latest = sorted.at(-1) ?? null;
  const submissionStatus = latest?.sourceSubmissionItem.submission.status ?? null;
  const current = toNumber(latest?.value);
  const target = toNumber(kpi.target);
  const baseline = toNumber(kpi.baseline);

  const history = sorted.slice(-HISTORY_WINDOW).map((v) => ({
    id: v.id,
    period: formatPeriodLabel(v.period),
    value: toNumber(v.value) ?? 0,
    coverageNote: v.coverageNote ?? null,
    valueLabel: isStatusUnit(kpi.unit) ? statusLabel(toNumber(v.value)) : null,
    validationStatus: deriveValidationStatus(v.sourceSubmissionItem.submission.status),
    submissionId: v.sourceSubmissionItem.submissionId,
    // Only ever true for a value set via the setCurrentValue() admin
    // override - identified by its exact sourceReference stamp, not a null
    // obligationId, since the historical bulk-import scripts also leave
    // obligationId null on their own synthetic submissions (see
    // ADMIN_OVERRIDE_SOURCE_REFERENCE's comment in kpi-explorer.service.ts).
    editable: v.sourceSubmissionItem.submission.sourceReference === ADMIN_OVERRIDE_SOURCE_REFERENCE,
  }));

  const direction = toKebabCase(kpi.direction) as "higher-is-better" | "lower-is-better";
  const previous = chronological.length > 1 ? chronological.at(-2)! : null;
  const previousValue = previous ? toNumber(previous.value) : null;
  const trend =
    current !== null && previous !== null && previousValue !== null && !latest?.coverageNote && !isStatusUnit(kpi.unit)
      ? buildTrend(current, previousValue, previous.period, kpi.unit, direction)
      : undefined;

  const definitionText = kpi.definition || "Not yet documented.";
  const lastUpdated = notInFuture(recordedAt(latest) ?? kpi.updatedAt).toISOString();

  return {
    id: kpi.code,
    name: kpi.name,
    pillar: kpi.pillar.slug,

    definition: definitionText,
    formula: kpi.formula || "Not yet documented.",
    unit: kpi.unit,
    aggregation: kpi.aggregation,
    frequency: kpi.frequency,
    disaggregation: kpi.disaggregation,
    limitations: kpi.limitations,

    baseline,
    baselineLabel: kpi.baselineLabel,
    current,
    currentLabel:
      current === null
        ? NO_KPI_VALUE_LABEL
        : isStatusUnit(kpi.unit)
          ? (statusLabel(current) ?? NO_KPI_VALUE_LABEL)
          : `${current}${kpi.unit ? ` ${kpi.unit}` : ""}`,
    target,
    targetLabel: kpi.targetLabel,
    targetBasis: kpi.targetBasis
      ? (toKebabCase(kpi.targetBasis) as "level" | "growth-rate" | "none")
      : undefined,
    targetBasisLabel: kpi.targetBasisLabel ?? undefined,
    targetDate: kpi.targetDate,
    targets: kpi.targetPoints.map((p) => ({ period: p.period, value: Number(p.value), label: p.label })),
    externalStandardAlignment: (kpi.externalStandardAlignment as object | null) ?? null,
    varianceLabel: isStatusUnit(kpi.unit) ? "No variance available." : buildVarianceLabel(current, target, kpi.direction, kpi.unit),
    direction,
    trend,
    history,

    sourceInstitution: kpi.sourceInstitution || "Not supplied",
    sourceInstitutions: toResolvedSourceInstitutions(kpi),
    relatedIndicators: toRelatedIndicators(kpi),
    sourceDataset: kpi.sourceDataset || "Not supplied",
    sourceReference: kpi.sourceReference,
    reportingPeriod: latest ? formatPeriodLabel(latest.period) : "",
    reportingPeriodCoverage: latest?.coverageNote ?? null,
    validationStatus: deriveValidationStatus(submissionStatus),
    validationDecision: submissionStatus ? (DECISION_LABEL[submissionStatus] ?? "") : "",
    version: kpi.version,
    confidence: deriveConfidence(submissionStatus),
    provenance: {
      definition: definitionText,
      methodology: kpi.formula || "Not yet documented.",
      source: kpi.sourceInstitution || "Not supplied",
      lastUpdated,
    },

    linkedRecords: [] as unknown[],
  };
}
