import type {
  DiscoDeliveryMilestone,
  DiscoPerformanceRecord,
  DiscoServiceBand,
  Institution,
  State,
} from "@prisma/client";
import { toKebabCase } from "@/common/utils/enum-casing";
import { formatPeriodLabel } from "@/modules/kpi-explorer/kpi-explorer.mappers";

/**
 * State/DisCo is NOT a read-composition layer like Executive Overview or
 * Pillar Dashboards - DisCo financial/operational performance is real data
 * that comes from external NERC regulatory records nothing else in this
 * schema tracks, admin-entered for now (see DiscoPerformanceRecord's own
 * schema comment). A "DisCo" is an existing Institution row (type
 * "Disco"), not a separate entity.
 */

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

/**
 * Chronological sort key for a "q{1-4}-{year}" period string (e.g.
 * "q3-2025") - plain alphabetical sort groups by quarter number first and
 * year second ("q2-2020" sorts after "q1-2021", which is backwards), so
 * anywhere periods need ordering by actual time (latest-per-DisCo,
 * previous-period trends) must sort by this instead. Unparseable periods
 * sort first (oldest), never crash a comparator.
 */
export function periodSortKey(period: string): number {
  const match = /^q([1-4])-(\d{4})$/.exec(period);
  if (!match) return -Infinity;
  const quarter = Number(match[1]);
  const year = Number(match[2]);
  return year * 4 + quarter;
}

/** The quarter immediately before `period` (e.g. "q1-2026" -> "q4-2025").
 * Null for an unparseable period - there is nothing to look up in that
 * case, not a real "no prior period" answer. */
export function previousPeriodOf(period: string): string | null {
  const match = /^q([1-4])-(\d{4})$/.exec(period);
  if (!match) return null;
  const quarter = Number(match[1]);
  const year = Number(match[2]);
  return quarter === 1 ? `q4-${year - 1}` : `q${quarter - 1}-${year}`;
}

const numberFormatter = new Intl.NumberFormat("en-US");
const decimalFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function formatInt(value: number): string {
  return numberFormatter.format(Math.round(value));
}

export function formatMwh(value: number): string {
  return `${numberFormatter.format(Math.round(value))} MWh`;
}

export function formatNgnBillions(value: number): string {
  return `NGN ${decimalFormatter.format(value / 1_000_000_000)}bn`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function titleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function toValidationLabel(status: string): string {
  return titleCase(status.toLowerCase().replace(/_/g, "-"));
}

export function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : (numerator / denominator) * 100;
}

type RecordWithInstitution = DiscoPerformanceRecord & { institution: Institution };

/**
 * Matches discoComparisonRowSchema exactly, minus the two bar-percent pairs
 * (energyReceivedBarPercent/energyBilledBarPercent and
 * revenueBilledBarPercent/revenueCollectedBarPercent) and `rankLabel` -
 * both need every row in the comparison to compute a relative scale/rank,
 * so the service adds those after mapping the whole batch.
 */
type RemittanceSource = Pick<DiscoPerformanceRecord, "period" | "remittanceObligationNgn" | "remittanceActualNgn">;

export function toDiscoComparisonRowBase(record: RecordWithInstitution, remittanceSource: RemittanceSource = record) {
  const meteringRate = ratio(record.meteredCustomers, record.activeCustomers);
  const billingEfficiency = ratio(toNumber(record.energyBilledMwh), toNumber(record.energyReceivedMwh));
  const collectionEfficiency = ratio(toNumber(record.revenueCollectedNgn), toNumber(record.revenueBilledNgn));
  const remittanceObligationNgn = toNumber(remittanceSource.remittanceObligationNgn);
  const remittancePerformance = ratio(toNumber(remittanceSource.remittanceActualNgn), remittanceObligationNgn);
  const remittancePeriodSuffix =
    remittanceSource.period === record.period ? "" : ` (${formatPeriodLabel(remittanceSource.period)})`;
  // Same "no obligation reported" case the market-remittance headline card
  // already distinguishes from a real 0% (state-disco.service.ts) - without
  // this, a DisCo with no remittance data loaded read as "we checked and
  // it's zero" instead of "we don't have this figure yet".
  const remittancePerformanceLabel =
    remittanceObligationNgn > 0 ? `${formatPercent(remittancePerformance)}${remittancePeriodSuffix}` : "Not reported";

  return {
    id: record.institutionId,
    name: record.institution.name,
    activeCustomers: formatInt(record.activeCustomers),
    meteredCustomers: formatInt(record.meteredCustomers),
    unmeteredCustomers: formatInt(record.activeCustomers - record.meteredCustomers),
    meteringRate: formatPercent(meteringRate),
    meteringRateValue: meteringRate,
    energyReceived: formatMwh(toNumber(record.energyReceivedMwh)),
    energyReceivedValue: toNumber(record.energyReceivedMwh),
    energyBilled: formatMwh(toNumber(record.energyBilledMwh)),
    energyBilledValue: toNumber(record.energyBilledMwh),
    billingEfficiency: formatPercent(billingEfficiency),
    revenueBilled: formatNgnBillions(toNumber(record.revenueBilledNgn)),
    revenueBilledValue: toNumber(record.revenueBilledNgn),
    revenueCollected: formatNgnBillions(toNumber(record.revenueCollectedNgn)),
    revenueCollectedValue: toNumber(record.revenueCollectedNgn),
    collectionEfficiency: formatPercent(collectionEfficiency),
    remittancePerformance: remittancePerformanceLabel,
    validationLabel: toValidationLabel(record.validationStatus),
  };
}

const BAND_ORDER = ["A", "B", "C", "D", "E"] as const;

export function formatSupplyHours(hoursPerDay: number): string {
  return `${decimalFormatter.format(hoursPerDay)} hrs/day`;
}

export function formatTariff(ngnPerKwh: number): string {
  return `NGN ${ngnPerKwh.toFixed(2)}/kWh`;
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

type ServiceBandWithInstitution = DiscoServiceBand & { institution: Institution };

/**
 * Matches utilityOperationsRowSchema exactly - one row per DisCo, its 5
 * service bands ordered A-E. Only ever built from a set of exactly 5 real
 * DiscoServiceBand rows for the same institution (see the service, which
 * skips a DisCo entirely from this endpoint's response rather than
 * padding/inventing a missing band to satisfy the schema's `.length(5)`).
 */
export function toUtilityOperationsRow(institutionId: string, bands: ServiceBandWithInstitution[]) {
  const sorted = [...bands].sort((a, b) => BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band));
  return {
    id: institutionId,
    utility: sorted[0].institution.name,
    effectiveOrder: sorted[0].effectiveOrder,
    bands: sorted.map((b) => ({
      band: b.band,
      supplyHours: formatSupplyHours(toNumber(b.supplyHoursPerDay)),
      tariff: formatTariff(toNumber(b.tariffNgnPerKwh)),
      intensityPercent: toNumber(b.intensityPercent),
    })),
  };
}

type MilestoneWithInstitution = DiscoDeliveryMilestone & { institution: Institution };

/** Matches deliveryRowSchema exactly. */
export function toDeliveryRow(m: MilestoneWithInstitution) {
  return {
    id: m.id,
    utility: m.institution.name,
    milestone: m.milestone,
    serviceBand: m.serviceBand,
    validationLabel: toValidationLabel(m.validationStatus),
    dueDate: m.dueDate.toISOString(),
    dueDateLabel: formatDateLabel(m.dueDate),
    executionStatus: toKebabCase(m.executionStatus),
    achievedLabel: m.achievedDate ? formatDateLabel(m.achievedDate) : "Not yet achieved",
    evidenceLabel: m.evidenceUrl ? "Evidence attached" : "No evidence yet",
    reportingCompliance: m.reportingCompliance || "Not yet assessed",
    bottleneck: m.bottleneck,
  };
}

export interface StateCoverageAggregates {
  activeProgrammes: number;
  activeProjects: number;
  openBottlenecks: number;
  /// No real per-state breakdown of the national mini-grid/solar-home-
  /// system KPI figures exists yet - the spec is explicit that this must
  /// never be inferred or fabricated, so these stay 0 until a project-
  /// level delivered-units field exists to sum honestly.
  miniGridConnections: number;
  solarHomeSystems: number;
  /// Share of this state's tagged projects that are complete - a real,
  /// derived "how much delivery is done" figure, not a fabricated one.
  coverageBarPercent: number;
}

/** Matches stateCoverageRowSchema exactly. */
export function toStateCoverageRow(state: State, aggregates: StateCoverageAggregates) {
  return {
    id: state.id,
    state: state.name,
    zone: state.zone,
    miniGridConnections: formatInt(aggregates.miniGridConnections),
    solarHomeSystems: formatInt(aggregates.solarHomeSystems),
    activeProgrammes: formatInt(aggregates.activeProgrammes),
    activeProjects: formatInt(aggregates.activeProjects),
    openBottlenecks: formatInt(aggregates.openBottlenecks),
    validationLabel: state.validatedAt ? "Confirmed" : "Provisional",
    coverageBarPercent: aggregates.coverageBarPercent,
    validatedBy: state.validatedByName,
    validatedAt: state.validatedAt ? state.validatedAt.toISOString() : null,
  };
}

/** Matches stateRecordSchema exactly. */
export function toStateRecord(row: {
  id: string;
  type: "programme" | "project" | "bottleneck";
  name: string;
  owner: string;
  status: string;
  sourceLabel: string;
}) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    owner: row.owner,
    status: toKebabCase(row.status),
    deliveryLabel: toValidationLabel(toKebabCase(row.status)),
    sourceLabel: row.sourceLabel,
  };
}
