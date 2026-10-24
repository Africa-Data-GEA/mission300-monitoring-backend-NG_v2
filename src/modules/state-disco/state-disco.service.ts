import { Injectable, NotFoundException } from "@nestjs/common";
import { ValidationStatus } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service";
import { toKebabCase } from "@/common/utils/enum-casing";
import { formatPeriodLabel } from "@/modules/kpi-explorer/kpi-explorer.mappers";
import {
  formatInt,
  formatNgnBillions,
  formatPercent,
  periodSortKey,
  previousPeriodOf,
  ratio,
  toDeliveryRow,
  toDiscoComparisonRowBase,
  toStateCoverageRow,
  toStateRecord,
  toUtilityOperationsRow,
  toValidationLabel,
} from "@/modules/state-disco/state-disco.mappers";
import type { StateDiscoQueryDto } from "@/modules/state-disco/dto/state-disco-query.dto";
import type { UpsertDiscoPerformanceDto } from "@/modules/state-disco/dto/upsert-disco-performance.dto";
import type { UpsertDiscoServiceBandDto } from "@/modules/state-disco/dto/upsert-disco-service-band.dto";
import type { CreateDiscoDeliveryMilestoneDto } from "@/modules/state-disco/dto/create-disco-delivery-milestone.dto";
import type { UpdateDiscoDeliveryMilestoneDto } from "@/modules/state-disco/dto/update-disco-delivery-milestone.dto";

const PROVENANCE_NOW = () => new Date().toISOString();

@Injectable()
export class StateDiscoService {
  constructor(private readonly prisma: PrismaService) {}

  async getFilters() {
    const [discos, states, periodRows] = await Promise.all([
      this.prisma.institution.findMany({ where: { type: "Disco" }, orderBy: { name: "asc" } }),
      this.prisma.state.findMany({ orderBy: { name: "asc" } }),
      this.prisma.discoPerformanceRecord.findMany({ select: { period: true }, distinct: ["period"] }),
    ]);

    const withAll = (label: string, options: { value: string; label: string }[]) => [
      { value: "all", label: `All ${label}` },
      ...options,
    ];

    return {
      reportingPeriods: withAll(
        "periods",
        [...new Map(periodRows.map((p) => [formatPeriodLabel(p.period), p.period])).values()]
          .sort((a, b) => periodSortKey(b) - periodSortKey(a))
          .map((p) => ({ value: p, label: formatPeriodLabel(p) })),
      ),
      // Not measured data - the page's own View toggle between the DisCo-
      // led default and the State view (docs/specs/state-disco-
      // performance.md Section A/D).
      views: [
        { value: "disco", label: "Distribution Company" },
        { value: "state", label: "State" },
      ],
      // "national" is this one endpoint's own all-DisCos sentinel - NOT
      // "all", confirmed directly against stateDiscoQuerySchema and the
      // real mock handler's filterUtility().
      distributionCompanies: [
        { value: "national", label: "National (all DisCos)" },
        ...discos.map((d) => ({ value: d.id, label: d.name })),
      ],
      states: withAll(
        "states",
        states.map((s) => ({ value: s.id, label: s.name })),
      ),
      utilityMetrics: withAll("utility metrics", [
        { value: "metering-rate", label: "Metering rate" },
        { value: "atcc-losses", label: "ATC&C loss rate" },
        { value: "collection-efficiency", label: "Collection efficiency" },
        { value: "market-remittance", label: "Market-remittance performance" },
      ]),
      serviceBands: withAll(
        "bands",
        (["A", "B", "C", "D", "E"] as const).map((b) => ({ value: b, label: `Band ${b}` })),
      ),
      validationStatuses: withAll(
        "validation statuses",
        Object.values(ValidationStatus).map((s) => ({ value: toKebabCase(s), label: toValidationLabel(s) })),
      ),
      // Not measured data - a fixed, small set of the regulatory sources
      // this module's own spec names (docs/specs/state-disco-
      // performance.md's "Data source" column throughout).
      sources: withAll("sources", [
        { value: "nerc", label: "Nigerian Electricity Regulatory Commission" },
        { value: "rea", label: "Rural Electrification Agency" },
      ]),
    };
  }

  private buildMeta(
    title: string,
    description: string,
    sourceLabel = "Nigerian Electricity Regulatory Commission",
  ) {
    return {
      title,
      description,
      lastUpdatedLabel: "Just now",
      sourceLabel,
    };
  }

  private async getLatestRecordPerDisco(period?: string) {
    const records = await this.prisma.discoPerformanceRecord.findMany({
      where: period && period !== "all" ? { period } : undefined,
      include: { institution: true },
    });
    // "Latest" means chronologically latest period, not most recently
    // written row - a bulk historical backfill can insert an old quarter
    // after a newer one, so createdAt order doesn't track period order.
    records.sort((a, b) => periodSortKey(b.period) - periodSortKey(a.period));
    const latest = new Map<string, (typeof records)[number]>();
    for (const record of records) {
      if (!latest.has(record.institutionId)) latest.set(record.institutionId, record);
    }
    return [...latest.values()];
  }

  private async getRecordsForDisco(institutionId: string, period?: string) {
    const records = await this.prisma.discoPerformanceRecord.findMany({
      where: { institutionId, ...(period && period !== "all" ? { period } : {}) },
      include: { institution: true },
    });
    records.sort((a, b) => periodSortKey(b.period) - periodSortKey(a.period));
    return records;
  }

  /** One row per institution for an exact period - unlike
   * getLatestRecordPerDisco, this never falls back to an earlier period, so
   * an empty result honestly means "no DisCo reported this period" rather
   * than silently substituting whatever's latest. */
  private async getRecordsForExactPeriod(period: string) {
    const records = await this.prisma.discoPerformanceRecord.findMany({
      where: { period },
      include: { institution: true },
    });
    const byInstitution = new Map<string, (typeof records)[number]>();
    for (const record of records) {
      if (!byInstitution.has(record.institutionId)) byInstitution.set(record.institutionId, record);
    }
    return [...byInstitution.values()];
  }

  /** Sums a set of per-DisCo performance records into the same national-
   * aggregate shape getOverview's "current" uses, so the prior-period
   * comparison is computed identically to the current period rather than
   * by a second, easily-diverging copy of this logic. */
  private aggregateNational(records: { activeCustomers: number; meteredCustomers: number; energyReceivedMwh: unknown; energyBilledMwh: unknown; revenueBilledNgn: unknown; revenueCollectedNgn: unknown; remittanceObligationNgn: unknown; remittanceActualNgn: unknown; allowedLossRatePercent: unknown }[]) {
    const totals = records.reduce(
      (acc, r) => ({
        activeCustomers: acc.activeCustomers + r.activeCustomers,
        meteredCustomers: acc.meteredCustomers + r.meteredCustomers,
        energyReceivedMwh: acc.energyReceivedMwh + Number(r.energyReceivedMwh),
        energyBilledMwh: acc.energyBilledMwh + Number(r.energyBilledMwh),
        revenueBilledNgn: acc.revenueBilledNgn + Number(r.revenueBilledNgn),
        revenueCollectedNgn: acc.revenueCollectedNgn + Number(r.revenueCollectedNgn),
        remittanceObligationNgn: acc.remittanceObligationNgn + Number(r.remittanceObligationNgn),
        remittanceActualNgn: acc.remittanceActualNgn + Number(r.remittanceActualNgn),
        allowedLossRateSum:
          acc.allowedLossRateSum + (r.allowedLossRatePercent === null ? 0 : Number(r.allowedLossRatePercent)),
        allowedLossRateCount: acc.allowedLossRateCount + (r.allowedLossRatePercent === null ? 0 : 1),
      }),
      {
        activeCustomers: 0,
        meteredCustomers: 0,
        energyReceivedMwh: 0,
        energyBilledMwh: 0,
        revenueBilledNgn: 0,
        revenueCollectedNgn: 0,
        remittanceObligationNgn: 0,
        remittanceActualNgn: 0,
        allowedLossRateSum: 0,
        allowedLossRateCount: 0,
      },
    );
    const { allowedLossRateSum, allowedLossRateCount, ...rest } = totals;
    const result = {
      ...rest,
      allowedLossRatePercent: allowedLossRateCount > 0 ? allowedLossRateSum / allowedLossRateCount : null,
      atccLossRatePercent: 0,
    };
    const billingEfficiency = result.energyReceivedMwh > 0 ? result.energyBilledMwh / result.energyReceivedMwh : 0;
    const collectionEfficiency = result.revenueBilledNgn > 0 ? result.revenueCollectedNgn / result.revenueBilledNgn : 0;
    result.atccLossRatePercent =
      result.energyReceivedMwh > 0 && result.revenueBilledNgn > 0
        ? (1 - billingEfficiency * collectionEfficiency) * 100
        : 0;
    return result;
  }

  private async getRemittancePosition(selection: string, periodFilter: string) {
    const periods = periodFilter === "all" ? null : [periodFilter, previousPeriodOf(periodFilter)].filter((p): p is string => p !== null);
    const records = await this.prisma.discoPerformanceRecord.findMany({
      where: {
        remittanceObligationNgn: { gt: 0 },
        ...(selection === "national" ? {} : { institutionId: selection }),
        ...(periods ? { period: { in: periods } } : {}),
      },
      select: { period: true, remittanceObligationNgn: true, remittanceActualNgn: true },
    });

    const byPeriod = new Map<string, { obligation: number; actual: number }>();
    for (const record of records) {
      const entry = byPeriod.get(record.period) ?? { obligation: 0, actual: 0 };
      entry.obligation += Number(record.remittanceObligationNgn);
      entry.actual += Number(record.remittanceActualNgn);
      byPeriod.set(record.period, entry);
    }

    const latestPeriod =
      periodFilter === "all"
        ? [...byPeriod.keys()].sort((a, b) => periodSortKey(b) - periodSortKey(a))[0]
        : byPeriod.has(periodFilter)
          ? periodFilter
          : undefined;
    if (!latestPeriod) return null;

    const priorPeriod = previousPeriodOf(latestPeriod);
    return {
      period: latestPeriod,
      current: byPeriod.get(latestPeriod)!,
      previous: priorPeriod ? (byPeriod.get(priorPeriod) ?? null) : null,
    };
  }

  async getTrends(query: StateDiscoQueryDto) {
    const selection = query.distributionCompany ?? "national";

    let selectedLabel = "National (all DisCos)";
    if (selection !== "national") {
      const institution = await this.prisma.institution.findUnique({ where: { id: selection } });
      if (!institution) throw new NotFoundException("Unknown Distribution Company.");
      selectedLabel = institution.name;
    }

    const records = await this.prisma.discoPerformanceRecord.findMany({
      where: selection === "national" ? {} : { institutionId: selection },
    });

    const byPeriod = new Map<string, typeof records>();
    for (const record of records) {
      const list = byPeriod.get(record.period) ?? [];
      list.push(record);
      byPeriod.set(record.period, list);
    }

    const roundOne = (value: number) => Math.round(value * 10) / 10;
    const points = [...byPeriod.entries()]
      .filter(([period]) => periodSortKey(period) !== -Infinity)
      .sort(([a], [b]) => periodSortKey(a) - periodSortKey(b))
      .map(([period, list]) => {
        const totals = this.aggregateNational(list);
        return {
          period,
          label: formatPeriodLabel(period),
          meteringRate:
            totals.activeCustomers > 0 ? roundOne(ratio(totals.meteredCustomers, totals.activeCustomers)) : null,
          atccLossRate:
            totals.energyReceivedMwh > 0 && totals.revenueBilledNgn > 0 ? roundOne(totals.atccLossRatePercent) : null,
          collectionEfficiency:
            totals.revenueBilledNgn > 0 ? roundOne(ratio(totals.revenueCollectedNgn, totals.revenueBilledNgn)) : null,
          remittancePerformance:
            totals.remittanceObligationNgn > 0
              ? roundOne(ratio(totals.remittanceActualNgn, totals.remittanceObligationNgn))
              : null,
          reportingDiscos: list.length,
        };
      });

    return {
      meta: this.buildMeta(
        "Performance trends",
        "Quarter-by-quarter metering, loss, collection and remittance performance for the selected Distribution Company.",
      ),
      selectedUtility: selectedLabel,
      points,
    };
  }

  async getOverview(query: StateDiscoQueryDto) {
    const selection = query.distributionCompany ?? "national";
    const periodFilter = query.reportingPeriod ?? "all";
    const now = PROVENANCE_NOW();

    let selectedLabel: string;
    let current: {
      activeCustomers: number;
      meteredCustomers: number;
      energyReceivedMwh: number;
      energyBilledMwh: number;
      revenueBilledNgn: number;
      revenueCollectedNgn: number;
      remittanceObligationNgn: number;
      remittanceActualNgn: number;
      atccLossRatePercent: number;
      allowedLossRatePercent: number | null;
    };
    let previous: typeof current | null = null;

    if (selection === "national") {
      const latestPerDisco = await this.getLatestRecordPerDisco(periodFilter);
      selectedLabel = "National (all DisCos)";
      current = this.aggregateNational(latestPerDisco);

      // The market-wide "current period" to diff against: the filter's own
      // period when one is picked, otherwise the latest period actually
      // reported by any DisCo (periods can differ per DisCo under "all").
      // Only diffs against a period DisCos genuinely reported - an empty
      // result for that exact prior quarter leaves `previous` null rather
      // than inventing a comparison, same honesty as the single-DisCo path.
      const referencePeriod =
        periodFilter !== "all"
          ? periodFilter
          : latestPerDisco.reduce<string | null>(
              (latest, r) => (!latest || periodSortKey(r.period) > periodSortKey(latest) ? r.period : latest),
              null,
            );
      const priorPeriod = referencePeriod ? previousPeriodOf(referencePeriod) : null;
      if (priorPeriod) {
        const priorRecords = await this.getRecordsForExactPeriod(priorPeriod);
        if (priorRecords.length > 0) previous = this.aggregateNational(priorRecords);
      }
    } else {
      const institution = await this.prisma.institution.findUnique({ where: { id: selection } });
      if (!institution) throw new NotFoundException("Unknown Distribution Company.");
      selectedLabel = institution.name;

      const records = await this.getRecordsForDisco(selection, periodFilter);
      if (records.length === 0) {
        current = {
          activeCustomers: 0,
          meteredCustomers: 0,
          energyReceivedMwh: 0,
          energyBilledMwh: 0,
          revenueBilledNgn: 0,
          revenueCollectedNgn: 0,
          remittanceObligationNgn: 0,
          remittanceActualNgn: 0,
          atccLossRatePercent: 0,
          allowedLossRatePercent: null,
        };
      } else {
        const r = records[0];
        current = {
          activeCustomers: r.activeCustomers,
          meteredCustomers: r.meteredCustomers,
          energyReceivedMwh: Number(r.energyReceivedMwh),
          energyBilledMwh: Number(r.energyBilledMwh),
          revenueBilledNgn: Number(r.revenueBilledNgn),
          revenueCollectedNgn: Number(r.revenueCollectedNgn),
          remittanceObligationNgn: Number(r.remittanceObligationNgn),
          remittanceActualNgn: Number(r.remittanceActualNgn),
          atccLossRatePercent: Number(r.atccLossRatePercent),
          allowedLossRatePercent: r.allowedLossRatePercent === null ? null : Number(r.allowedLossRatePercent),
        };
        if (records.length > 1) {
          const p = records[1];
          previous = {
            activeCustomers: p.activeCustomers,
            meteredCustomers: p.meteredCustomers,
            energyReceivedMwh: Number(p.energyReceivedMwh),
            energyBilledMwh: Number(p.energyBilledMwh),
            revenueBilledNgn: Number(p.revenueBilledNgn),
            revenueCollectedNgn: Number(p.revenueCollectedNgn),
            remittanceObligationNgn: Number(p.remittanceObligationNgn),
            remittanceActualNgn: Number(p.remittanceActualNgn),
            atccLossRatePercent: Number(p.atccLossRatePercent),
            allowedLossRatePercent:
              p.allowedLossRatePercent === null ? null : Number(p.allowedLossRatePercent),
          };
        }
      }
    }

    const meteringRate = ratio(current.meteredCustomers, current.activeCustomers);
    const collectionEfficiency = ratio(current.revenueCollectedNgn, current.revenueBilledNgn);
    const remittance = await this.getRemittancePosition(selection, periodFilter);
    const remittancePerformance = remittance ? ratio(remittance.current.actual, remittance.current.obligation) : 0;

    const noPriorTrend = (direction: "higher-is-better" | "lower-is-better") => ({
      change: 0,
      label: "No prior period recorded yet",
      direction,
    });

    const trendFor = (
      currentValue: number,
      previousValue: number | undefined,
      direction: "higher-is-better" | "lower-is-better",
    ) => {
      if (previousValue === undefined) return noPriorTrend(direction);
      const change = Math.round((currentValue - previousValue) * 10) / 10;
      return { change, label: `${change >= 0 ? "+" : ""}${change} pts vs prior period`, direction };
    };

    const provenance = (definition: string, methodology: string, source: string) => ({
      definition,
      methodology,
      source,
      lastUpdated: now,
    });

    const metrics = [
      {
        id: "metering-rate",
        title: "Metering rate",
        value: formatPercent(meteringRate),
        supportingLabel: `${formatInt(current.meteredCustomers)} of ${formatInt(current.activeCustomers)} active customers metered`,
        benchmarkLabel: "100% by 2027",
        varianceLabel: `${(meteringRate - 100).toFixed(1)} pts vs 100% target`,
        progressPercent: Math.max(0, Math.min(100, Math.round(meteringRate))),
        trend: trendFor(
          meteringRate,
          previous ? ratio(previous.meteredCustomers, previous.activeCustomers) : undefined,
          "higher-is-better",
        ),
        provenance: provenance(
          "Metered active customers as a share of active registered customers.",
          "Metered customers divided by active customers for the same Distribution Company and period, multiplied by 100.",
          "Nigerian Electricity Regulatory Commission Monthly Metering Factsheet.",
        ),
      },
      {
        id: "atcc-losses",
        title: "Aggregate Technical, Commercial and Collection loss rate",
        value: formatPercent(current.atccLossRatePercent),
        supportingLabel:
          current.allowedLossRatePercent === null
            ? "Allowed benchmark not yet available"
            : `Allowed benchmark ${formatPercent(current.allowedLossRatePercent)}`,
        benchmarkLabel:
          current.allowedLossRatePercent === null
            ? "Allowed: not yet available"
            : `Allowed: ${formatPercent(current.allowedLossRatePercent)}`,
        varianceLabel:
          current.allowedLossRatePercent === null
            ? "No variance available - allowed loss rate not yet entered"
            : `${(current.atccLossRatePercent - current.allowedLossRatePercent).toFixed(1)} pts vs allowed loss`,
        progressPercent: Math.max(0, Math.min(100, Math.round(100 - current.atccLossRatePercent))),
        trend: trendFor(current.atccLossRatePercent, previous?.atccLossRatePercent, "lower-is-better"),
        provenance: provenance(
          "Official utility loss rate.",
          "Use the reported Distribution Company value; show variance from allowed loss in percentage points.",
          "Nigerian Electricity Regulatory Commission Quarterly Reports and tariff orders.",
        ),
      },
      {
        id: "collection-efficiency",
        title: "Collection efficiency",
        value: formatPercent(collectionEfficiency),
        supportingLabel: `${formatNgnBillions(current.revenueCollectedNgn)} of ${formatNgnBillions(current.revenueBilledNgn)} billed collected`,
        benchmarkLabel: "100%",
        varianceLabel: `${(collectionEfficiency - 100).toFixed(1)} pts vs 100% target`,
        progressPercent: Math.max(0, Math.min(100, Math.round(collectionEfficiency))),
        trend: trendFor(
          collectionEfficiency,
          previous ? ratio(previous.revenueCollectedNgn, previous.revenueBilledNgn) : undefined,
          "higher-is-better",
        ),
        provenance: provenance(
          "Share of billed customer revenue actually collected.",
          "Revenue collected divided by revenue billed, multiplied by 100.",
          "Nigerian Electricity Regulatory Commission Quarterly Reports.",
        ),
      },
      {
        id: "market-remittance",
        title: "Market-remittance performance",
        value: remittance ? formatPercent(remittancePerformance) : "Not reported",
        supportingLabel: remittance
          ? `${formatNgnBillions(remittance.current.actual)} of ${formatNgnBillions(remittance.current.obligation)} obligation remitted (${formatPeriodLabel(remittance.period)})`
          : "No remittance obligation reported for this period",
        benchmarkLabel: "100% of applicable obligation",
        varianceLabel: remittance
          ? `${(remittancePerformance - 100).toFixed(1)} pts vs 100% compliance`
          : "No variance available - no remittance obligation reported",
        progressPercent: Math.max(0, Math.min(100, Math.round(remittancePerformance))),
        trend: remittance
          ? trendFor(
              remittancePerformance,
              remittance.previous ? ratio(remittance.previous.actual, remittance.previous.obligation) : undefined,
              "higher-is-better",
            )
          : { change: 0, label: "No remittance data to compare", direction: "higher-is-better" as const },
        provenance: provenance(
          "Actual market remittance as a share of applicable obligation.",
          "Actual remittance divided by the applicable Nigerian Bulk Electricity Trading Plc or Market Operator obligation, multiplied by 100.",
          "Nigerian Electricity Regulatory Commission market-remittance tables.",
        ),
      },
    ];

    return {
      meta: this.buildMeta(
        "Distribution Company performance",
        "Metering, loss, collection and remittance performance for the selected Distribution Company.",
      ),
      selectedUtility: selectedLabel,
      metrics,
    };
  }

  async getComparison(query: StateDiscoQueryDto) {
    const selection = query.distributionCompany ?? "national";
    const latestPerDisco = await this.getLatestRecordPerDisco();
    const scoped =
      selection === "national" ? latestPerDisco : latestPerDisco.filter((r) => r.institutionId === selection);

    const validationFilter = query.validationStatus ?? "all";
    const filtered =
      validationFilter === "all"
        ? scoped
        : scoped.filter((r) => toKebabCase(r.validationStatus) === validationFilter);

    const remittanceRecords = await this.prisma.discoPerformanceRecord.findMany({
      where: {
        remittanceObligationNgn: { gt: 0 },
        institutionId: { in: filtered.map((r) => r.institutionId) },
      },
      select: { institutionId: true, period: true, remittanceObligationNgn: true, remittanceActualNgn: true },
    });
    const latestRemittance = new Map<string, (typeof remittanceRecords)[number]>();
    for (const record of remittanceRecords) {
      const existing = latestRemittance.get(record.institutionId);
      if (!existing || periodSortKey(record.period) > periodSortKey(existing.period)) {
        latestRemittance.set(record.institutionId, record);
      }
    }

    const baseRows = filtered.map((r) => toDiscoComparisonRowBase(r, latestRemittance.get(r.institutionId) ?? r));

    const maxEnergyReceived = Math.max(1, ...baseRows.map((r) => r.energyReceivedValue));
    const maxEnergyBilled = Math.max(1, ...baseRows.map((r) => r.energyBilledValue));
    const maxRevenueBilled = Math.max(1, ...baseRows.map((r) => r.revenueBilledValue));
    const maxRevenueCollected = Math.max(1, ...baseRows.map((r) => r.revenueCollectedValue));

    const ranked = [...baseRows].sort((a, b) => b.meteringRateValue - a.meteringRateValue);
    const rankById = new Map(ranked.map((r, index) => [r.id, index + 1]));

    const rows = baseRows.map((r) => ({
      id: r.id,
      name: r.name,
      rankLabel: `${rankById.get(r.id)} of ${baseRows.length}`,
      activeCustomers: r.activeCustomers,
      meteredCustomers: r.meteredCustomers,
      unmeteredCustomers: r.unmeteredCustomers,
      meteringRate: r.meteringRate,
      energyReceived: r.energyReceived,
      energyBilled: r.energyBilled,
      billingEfficiency: r.billingEfficiency,
      energyReceivedBarPercent: Math.round((r.energyReceivedValue / maxEnergyReceived) * 1000) / 10,
      energyBilledBarPercent: Math.round((r.energyBilledValue / maxEnergyBilled) * 1000) / 10,
      revenueBilled: r.revenueBilled,
      revenueCollected: r.revenueCollected,
      collectionEfficiency: r.collectionEfficiency,
      revenueBilledBarPercent: Math.round((r.revenueBilledValue / maxRevenueBilled) * 1000) / 10,
      revenueCollectedBarPercent: Math.round((r.revenueCollectedValue / maxRevenueCollected) * 1000) / 10,
      remittancePerformance: r.remittancePerformance,
      validationLabel: r.validationLabel,
    }));

    return {
      meta: this.buildMeta(
        "Distribution Company comparison",
        "Customer, energy, revenue and remittance position ranked across Distribution Companies.",
      ),
      rows,
    };
  }

  async upsertPerformance(institutionId: string, dto: UpsertDiscoPerformanceDto) {
    const institution = await this.prisma.institution.findUnique({ where: { id: institutionId } });
    if (!institution) throw new NotFoundException("Institution not found.");
    if (institution.type !== "Disco") {
      throw new NotFoundException("This institution is not registered as a Distribution Company.");
    }

    const record = await this.prisma.discoPerformanceRecord.upsert({
      where: { institutionId_period: { institutionId, period: dto.period } },
      create: {
        institutionId,
        period: dto.period,
        activeCustomers: dto.activeCustomers,
        meteredCustomers: dto.meteredCustomers,
        energyReceivedMwh: dto.energyReceivedMwh,
        energyBilledMwh: dto.energyBilledMwh,
        revenueBilledNgn: dto.revenueBilledNgn,
        revenueCollectedNgn: dto.revenueCollectedNgn,
        remittanceObligationNgn: dto.remittanceObligationNgn,
        remittanceActualNgn: dto.remittanceActualNgn,
        allowedLossRatePercent: dto.allowedLossRatePercent,
        atccLossRatePercent: dto.atccLossRatePercent,
        validationStatus: dto.validationStatus ?? "PROVISIONAL",
      },
      update: {
        activeCustomers: dto.activeCustomers,
        meteredCustomers: dto.meteredCustomers,
        energyReceivedMwh: dto.energyReceivedMwh,
        energyBilledMwh: dto.energyBilledMwh,
        revenueBilledNgn: dto.revenueBilledNgn,
        revenueCollectedNgn: dto.revenueCollectedNgn,
        remittanceObligationNgn: dto.remittanceObligationNgn,
        remittanceActualNgn: dto.remittanceActualNgn,
        allowedLossRatePercent: dto.allowedLossRatePercent,
        atccLossRatePercent: dto.atccLossRatePercent,
        ...(dto.validationStatus ? { validationStatus: dto.validationStatus } : {}),
      },
      include: { institution: true },
    });

    return {
      record: toDiscoComparisonRowBase(record),
      message: `${record.institution.name}'s ${dto.period} performance record has been saved.`,
    };
  }

  async getSupplyTariff(query: StateDiscoQueryDto) {
    const selection = query.distributionCompany ?? "national";
    const bands = await this.prisma.discoServiceBand.findMany({
      where: selection === "national" ? {} : { institutionId: selection },
      include: { institution: true },
    });

    const byInstitution = new Map<string, typeof bands>();
    for (const band of bands) {
      const list = byInstitution.get(band.institutionId) ?? [];
      list.push(band);
      byInstitution.set(band.institutionId, list);
    }

    // A DisCo only appears here once all 5 bands are entered - the schema
    // requires exactly 5, and padding or inventing a missing band would
    // put a number on the page no one actually reported.
    const rows = [...byInstitution.entries()]
      .filter(([, list]) => list.length === 5)
      .map(([institutionId, list]) => toUtilityOperationsRow(institutionId, list));

    return {
      meta: {
        title: "Supply hours and approved tariffs",
        description: "Service bands remain separate; no unweighted tariff average is presented.",
        lastUpdatedLabel: "Just now",
        sourceLabel: "Nigerian Electricity Regulatory Commission tariff orders",
      },
      rows,
    };
  }

  async getDelivery(query: StateDiscoQueryDto) {
    const selection = query.distributionCompany ?? "national";
    const serviceBandFilter = query.serviceBand ?? "all";
    const validationFilter = query.validationStatus ?? "all";

    const milestones = await this.prisma.discoDeliveryMilestone.findMany({
      where: {
        ...(selection === "national" ? {} : { institutionId: selection }),
        ...(serviceBandFilter === "all" ? {} : { serviceBand: serviceBandFilter as never }),
      },
      include: { institution: true },
      orderBy: { dueDate: "asc" },
    });

    const filtered =
      validationFilter === "all"
        ? milestones
        : milestones.filter((m) => toKebabCase(m.validationStatus) === validationFilter);

    return {
      meta: {
        title: "Utility delivery and reporting compliance",
        description: "Performance Improvement Plan milestones linked to evidence and open bottlenecks.",
        lastUpdatedLabel: "Just now",
        sourceLabel: "Nigerian Electricity Regulatory Commission Performance Improvement Plan monitoring",
      },
      rows: filtered.map(toDeliveryRow),
    };
  }

  async upsertServiceBand(institutionId: string, dto: UpsertDiscoServiceBandDto) {
    const institution = await this.prisma.institution.findUnique({ where: { id: institutionId } });
    if (!institution) throw new NotFoundException("Institution not found.");
    if (institution.type !== "Disco") {
      throw new NotFoundException("This institution is not registered as a Distribution Company.");
    }

    const band = await this.prisma.discoServiceBand.upsert({
      where: { institutionId_band: { institutionId, band: dto.band } },
      create: {
        institutionId,
        band: dto.band,
        effectiveOrder: dto.effectiveOrder,
        supplyHoursPerDay: dto.supplyHoursPerDay,
        tariffNgnPerKwh: dto.tariffNgnPerKwh,
        intensityPercent: dto.intensityPercent,
      },
      update: {
        effectiveOrder: dto.effectiveOrder,
        supplyHoursPerDay: dto.supplyHoursPerDay,
        tariffNgnPerKwh: dto.tariffNgnPerKwh,
        intensityPercent: dto.intensityPercent,
      },
      include: { institution: true },
    });

    return {
      message: `${band.institution.name}'s Band ${band.band} supply/tariff data has been saved.`,
    };
  }

  async createDeliveryMilestone(institutionId: string, dto: CreateDiscoDeliveryMilestoneDto) {
    const institution = await this.prisma.institution.findUnique({ where: { id: institutionId } });
    if (!institution) throw new NotFoundException("Institution not found.");
    if (institution.type !== "Disco") {
      throw new NotFoundException("This institution is not registered as a Distribution Company.");
    }

    const milestone = await this.prisma.discoDeliveryMilestone.create({
      data: {
        institutionId,
        milestone: dto.milestone,
        serviceBand: dto.serviceBand,
        dueDate: new Date(dto.dueDate),
        executionStatus: dto.executionStatus ?? "ON_TRACK",
        evidenceUrl: dto.evidenceUrl ?? null,
        reportingCompliance: dto.reportingCompliance ?? "",
        bottleneck: dto.bottleneck ?? "",
      },
      include: { institution: true },
    });

    return {
      record: toDeliveryRow(milestone),
      message: `${milestone.milestone} has been added to ${institution.name}'s delivery plan.`,
    };
  }

  async updateDeliveryMilestone(milestoneId: string, dto: UpdateDiscoDeliveryMilestoneDto) {
    const existing = await this.prisma.discoDeliveryMilestone.findUnique({ where: { id: milestoneId } });
    if (!existing) throw new NotFoundException("Delivery milestone not found.");

    const milestone = await this.prisma.discoDeliveryMilestone.update({
      where: { id: milestoneId },
      data: {
        executionStatus: dto.executionStatus ?? existing.executionStatus,
        achievedDate: dto.achievedDate !== undefined ? new Date(dto.achievedDate) : existing.achievedDate,
        evidenceUrl: dto.evidenceUrl !== undefined ? dto.evidenceUrl : existing.evidenceUrl,
        reportingCompliance: dto.reportingCompliance ?? existing.reportingCompliance,
        bottleneck: dto.bottleneck ?? existing.bottleneck,
      },
      include: { institution: true },
    });

    return {
      record: toDeliveryRow(milestone),
      message: `${milestone.milestone} has been updated.`,
    };
  }

  async getStates(query: StateDiscoQueryDto) {
    const stateFilter = query.state ?? "all";
    const states =
      stateFilter === "all"
        ? await this.prisma.state.findMany({ orderBy: { name: "asc" } })
        : await this.prisma.state.findMany({ where: { id: stateFilter } });

    const stateIds = states.map((s) => s.id);
    const projects = stateIds.length
      ? await this.prisma.project.findMany({ where: { stateId: { in: stateIds } } })
      : [];
    const projectIds = projects.map((p) => p.id);
    const bottlenecks = projectIds.length
      ? await this.prisma.bottleneck.findMany({
          where: { linkedRecord: { in: projectIds }, status: { not: "RESOLVED" } },
        })
      : [];

    const openBottlenecksByProject = new Map<string, number>();
    for (const b of bottlenecks) {
      openBottlenecksByProject.set(b.linkedRecord, (openBottlenecksByProject.get(b.linkedRecord) ?? 0) + 1);
    }

    const rows = states.map((state) => {
      const stateProjects = projects.filter((p) => p.stateId === state.id);
      const activeProjects = stateProjects.filter((p) => p.currentStatus !== "COMPLETED").length;
      const completedProjects = stateProjects.filter((p) => p.currentStatus === "COMPLETED").length;
      const activeProgrammes = new Set(
        stateProjects.filter((p) => p.currentStatus !== "COMPLETED").map((p) => p.programmeId),
      ).size;
      const openBottlenecks = stateProjects.reduce(
        (sum, p) => sum + (openBottlenecksByProject.get(p.id) ?? 0),
        0,
      );
      const coverageBarPercent =
        stateProjects.length === 0 ? 0 : Math.round((completedProjects / stateProjects.length) * 100);

      return toStateCoverageRow(state, {
        activeProgrammes,
        activeProjects,
        openBottlenecks,
        miniGridConnections: 0,
        solarHomeSystems: 0,
        coverageBarPercent,
      });
    });

    return {
      meta: {
        title: "State delivery coverage",
        description: "Validated distributed-energy delivery records where approved state breakdowns exist.",
        lastUpdatedLabel: "Just now",
        sourceLabel: "Rural Electrification Agency and Implementation Register",
      },
      notice: "Connection counts are not converted into inferred state electricity-access rates.",
      rows,
    };
  }

  async getStateDetail(stateId: string) {
    const state = await this.prisma.state.findUnique({ where: { id: stateId } });
    if (!state) throw new NotFoundException("The state profile was not found.");

    const projects = await this.prisma.project.findMany({ where: { stateId }, include: { programme: true } });
    const projectIds = projects.map((p) => p.id);
    const bottlenecks = projectIds.length
      ? await this.prisma.bottleneck.findMany({ where: { linkedRecord: { in: projectIds } } })
      : [];

    const activeProjects = projects.filter((p) => p.currentStatus !== "COMPLETED").length;
    const completedProjects = projects.filter((p) => p.currentStatus === "COMPLETED").length;
    const programmesById = new Map(projects.map((p) => [p.programmeId, p.programme]));
    const activeProgrammes = new Set(
      projects.filter((p) => p.currentStatus !== "COMPLETED").map((p) => p.programmeId),
    ).size;
    const openBottlenecks = bottlenecks.filter((b) => b.status !== "RESOLVED").length;
    const coverageBarPercent =
      projects.length === 0 ? 0 : Math.round((completedProjects / projects.length) * 100);

    const records = [
      ...[...programmesById.values()].map((programme) =>
        toStateRecord({
          id: programme.id,
          type: "programme" as const,
          name: programme.name,
          owner: programme.leadInstitution,
          status: programme.status,
          sourceLabel: "Implementation Register",
        }),
      ),
      ...projects.map((p) =>
        toStateRecord({
          id: p.id,
          type: "project" as const,
          name: p.name,
          owner: p.owner,
          status: p.currentStatus,
          sourceLabel: "Implementation Register",
        }),
      ),
      ...bottlenecks.map((b) =>
        toStateRecord({
          id: b.id,
          type: "bottleneck" as const,
          name: b.issue,
          owner: b.institution,
          status: b.status,
          sourceLabel: "Bottleneck Register",
        }),
      ),
    ];

    return {
      meta: {
        title: `${state.name} delivery profile`,
        description: "Delivery records linked to this state's tagged programmes, projects and bottlenecks.",
        lastUpdatedLabel: "Just now",
        sourceLabel: "Implementation Register and Bottleneck Register",
      },
      state: toStateCoverageRow(state, {
        activeProgrammes,
        activeProjects,
        openBottlenecks,
        miniGridConnections: 0,
        solarHomeSystems: 0,
        coverageBarPercent,
      }),
      notice: "Connection counts are not converted into inferred state electricity-access rates.",
      records,
      // No real period-over-period state snapshot mechanism exists yet -
      // honestly empty, matching the schema's own comment ("Empty where no
      // prior period has been recorded").
      history: [] as unknown[],
    };
  }

  async validateState(stateId: string, userId: string) {
    const [state, user] = await Promise.all([
      this.prisma.state.findUnique({ where: { id: stateId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!state) throw new NotFoundException("The state profile was not found.");
    if (!user) throw new NotFoundException("User not found.");

    const updated = await this.prisma.state.update({
      where: { id: stateId },
      data: { validatedByName: user.fullName, validatedAt: new Date() },
    });

    return { message: `${updated.name}'s coverage has been marked as validated by ${user.fullName}.` };
  }
}
