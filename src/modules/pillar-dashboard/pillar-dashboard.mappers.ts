import type { toKpiProfile } from "@/modules/kpi-explorer/kpi-explorer.mappers";

/**
 * A pillar dashboard has no entities of its own (docs/database-structure.md
 * in the real frontend repo) - it's a filtered view over data that already
 * exists: headline cards are real KPI Explorer profiles selected for this
 * pillar, and the delivery/bottleneck panel is Programme/Project/Bottleneck
 * rows filtered by the same `pillar` field they already carry. See
 * pillar-dashboard.service.ts, which reuses kpi-explorer.mappers.ts's
 * toKpiProfile/toCatalogueRow, programs.mappers.ts's
 * toProgrammeRecord/toProjectRecord, and bottlenecks.mappers.ts's
 * toBottleneckRecord directly rather than re-implementing any of them.
 */

export const PILLAR_LABELS: Record<string, string> = {
  "generation-network": "Generation & Network",
  "last-mile-access": "Last-Mile Access",
  "financially-viable-utilities": "Financially Viable Utilities",
  "private-sector-participation": "Private-Sector Participation",
  "regional-integration": "Regional Integration",
  "clean-cooking": "Clean Cooking",
};

/**
 * The four real KPI Matrix indicators used as each pillar's headline cards -
 * matches the real frontend mock's own PILLAR_KPI_IDS constant exactly
 * (mocks/data/pillar-dashboard.ts), using the real Nigeria M300-Pxx-xxx ids
 * now that the real KPI directory (prisma/data/kpi-directory.json) is
 * ingested - this used to point at invented placeholder codes from before
 * that directory existed.
 */
export const PILLAR_HEADLINE_KPI_CODES: Record<string, readonly [string, string, string, string]> = {
  // M300-P1-003 ("Available (Dispatched) Generation Capacity") swapped out
  // for M300-P1-016 ("Available Generation Capacity") per the real mock's
  // own comment - M300-P1-003 stays in the catalogue as a supporting
  // indicator, not deleted.
  "generation-network": ["M300-P1-016", "M300-P1-005", "M300-P1-004", "M300-P1-012"],
  "last-mile-access": ["M300-PX-001", "M300-P2-001", "M300-P2-003", "M300-P2-006"],
  "financially-viable-utilities": ["M300-P3-004", "M300-P3-006", "M300-P3-009", "M300-P3-010"],
  "private-sector-participation": ["M300-P4-002", "M300-P4-003", "M300-P4-001", "M300-P4-006"],
  "regional-integration": ["M300-P5-001", "M300-P5-002", "M300-P5-003", "M300-P5-004"],
  "clean-cooking": ["M300-P2-008", "M300-P2-012", "M300-P2-010", "M300-P2-011"],
};

export const PILLAR_SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

type KpiProfile = ReturnType<typeof toKpiProfile>;

/** Matches pillarHeadlineCardSchema exactly. */
export function toPillarHeadlineCard(profile: KpiProfile) {
  return {
    kpiId: profile.id,
    title: profile.name,
    value: profile.currentLabel,
    rawValue: profile.current,
    unit: profile.unit,
    period: profile.reportingPeriod || null,
    baseline: profile.baseline,
    baselineLabel: profile.baselineLabel,
    targetLabel: profile.targetLabel,
    target: profile.target,
    targetBasis: profile.targetBasis,
    targetBasisLabel: profile.targetBasisLabel,
    direction: profile.direction,
    validationStatus: profile.validationStatus,
    provenance: profile.provenance,
    trend: profile.trend,
    sparkline: profile.history.map((point) => ({ period: point.period, value: point.value })),
  };
}

/** Matches pillarCoreIndicatorSchema exactly - `group` is the KPI's own sourceDataset, not a curated label. */
export function toPillarCoreIndicator(profile: KpiProfile, group: string) {
  return {
    kpiId: profile.id,
    name: profile.name,
    group,
    unit: profile.unit,
    current: profile.current,
    target: profile.target,
    baseline: profile.baseline,
    baselineLabel: profile.baselineLabel,
    currentLabel: profile.currentLabel,
    targetLabel: profile.targetLabel,
    period: profile.reportingPeriod || null,
    direction: profile.direction,
    history: profile.history.map((point) => point.value),
    sparkline: profile.history.map((point) => ({ period: point.period, value: point.value })),
    validationStatus: profile.validationStatus,
    provenance: profile.provenance,
  };
}
