import { Injectable, NotFoundException } from "@nestjs/common";
import { latestDate } from "@/common/utils/latest-date";
import { PrismaService } from "@/prisma/prisma.service";
import { NO_KPI_VALUE_LABEL, toKpiProfile } from "@/modules/kpi-explorer/kpi-explorer.mappers";
import { toKebabCase } from "@/common/utils/enum-casing";
import {
  mapBottleneckExceptionSeverity,
  SEVERITY_RANK,
  toConfidence,
  toSourceTag,
  withTargetDate,
} from "@/modules/executive-overview/executive-overview.mappers";
import type { ExecutiveOverviewQueryDto } from "@/modules/executive-overview/dto/executive-overview-query.dto";

const KPI_PROFILE_INCLUDE = { pillar: true, targetPoints: true } as const;
const VALUE_INCLUDE = { sourceSubmissionItem: { include: { submission: true } } } as const;

// GenCo-declared installed nameplate capacity - not yet its own tracked KPI
// Explorer indicator (only available/dispatched capacity is), so kept as a
// documented constant rather than inventing a bespoke KPI for it. Same
// reasoning the frontend mock gives for its own hardcoded INSTALLED_MW.
const INSTALLED_CAPACITY_MW = 13_600;

// The one label for "this KPI has no reportingPeriod yet" (an empty
// profile.reportingPeriod, i.e. no approved value to date it from) - every
// card below imports this rather than inventing its own wording (this file
// previously had both "Not yet reported" and "Not yet published" for the
// identical condition). Distinct from NO_KPI_VALUE_LABEL: this describes a
// missing *period*, not a missing *value*.
const NO_REPORTING_PERIOD_LABEL = "Not yet reported";

const numberFormatter = new Intl.NumberFormat("en-US");

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return numberFormatter.format(value);
}

/** Same (year, quarter) ordering as FiltersService's sortPeriodsDescending -
 * a plain year sorts after that year's own quarters (Q5), so an annual
 * figure reads as the most recent thing known about that year. An
 * unparseable period (e.g. the frontend's "custom" sentinel, which never
 * carries real from/to dates today - see GlobalFilterBar's own comment)
 * returns null, not [0, 0], so it can be told apart from a genuinely early
 * period rather than silently filtering every KPI value out. */
function periodSortKey(period: string): [number, number] | null {
  const quarter = /^q([1-4])-(\d{4})$/i.exec(period.trim());
  if (quarter) return [Number(quarter[2]), Number(quarter[1])];
  const year = /^(\d{4})$/.exec(period.trim());
  if (year) return [Number(year[1]), 5];
  return null;
}

/** True when `candidate` is the same period as, or earlier than, `cutoff` -
 * "as of" semantics, not an exact match, since KPIs report at different
 * granularities (annual vs quarterly) and a point-in-time filter should
 * still show the latest known value as of that point, not require an exact
 * period match that may not exist for every KPI. */
function isAtOrBeforePeriod(candidate: string, cutoff: [number, number]): boolean {
  const candidateKey = periodSortKey(candidate);
  if (!candidateKey) return false;
  const [candidateYear, candidateQuarter] = candidateKey;
  const [cutoffYear, cutoffQuarter] = cutoff;
  if (candidateYear !== cutoffYear) return candidateYear < cutoffYear;
  return candidateQuarter <= cutoffQuarter;
}

type KpiProfile = ReturnType<typeof toKpiProfile>;

@Injectable()
export class ExecutiveOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadProfiles(codes: readonly string[], asOfPeriod?: [number, number]): Promise<KpiProfile[]> {
    const definitions = await this.prisma.kpiDefinition.findMany({
      where: { code: { in: [...codes] } },
      include: KPI_PROFILE_INCLUDE,
    });
    const definitionsByCode = new Map(definitions.map((definition) => [definition.code, definition]));
    for (const code of codes) {
      if (!definitionsByCode.has(code)) {
        throw new NotFoundException(
          `Executive Overview KPI "${code}" is not configured - seed or create it via KPI Explorer first.`,
        );
      }
    }

    const values = await this.prisma.kpiValue.findMany({
      where: { kpiDefinitionId: { in: definitions.map((definition) => definition.id) } },
      include: VALUE_INCLUDE,
    });
    const valuesByDefinition = new Map<string, typeof values>();
    for (const value of values) {
      if (asOfPeriod && !isAtOrBeforePeriod(value.period, asOfPeriod)) continue;
      const group = valuesByDefinition.get(value.kpiDefinitionId) ?? [];
      group.push(value);
      valuesByDefinition.set(value.kpiDefinitionId, group);
    }
    return codes.map((code) => {
      const definition = definitionsByCode.get(code)!;
      return toKpiProfile(definition, valuesByDefinition.get(definition.id) ?? []);
    });
  }

  async getOverview(query: ExecutiveOverviewQueryDto) {
    const pillarFilter = query.pillar ?? "all";
    const institutionFilter = query.institution ?? "all";
    const priorityFilter = query.priority ?? "all";
    const distributionCompanyFilter = query.distributionCompany ?? "all";
    // "all" (no selection) and an unparseable value (e.g. the frontend's
    // "custom" sentinel, which never carries real from/to dates - see
    // GlobalFilterBar's own comment) both mean "no period filter", not
    // "filter to nothing".
    const periodFilter =
      query.period && query.period !== "all" ? periodSortKey(query.period) ?? undefined : undefined;

    const profilesPromise = this.loadProfiles([
      // "People Connected to Electricity (Canonical)" - currently a small
      // pilot ledger, not yet at national scale (see the real frontend
      // mock's own comment, mocks/data/executive-overview.ts) - this card
      // will honestly report "needs a positive target configured" until a
      // real target is set on this KPI via the normal KPI Explorer edit
      // screen, rather than fabricating the national composite figure the
      // mock hardcodes with no real backing data.
      "M300-P2-024",
      "M300-PX-001",
      "M300-P1-016",
      // "Clean Cooking - Verified Beneficiary Households (Canonical)" - same
      // pilot-ledger caveat as M300-P2-024 above.
      "M300-P2-025",
      "M300-P2-001",
      "M300-P2-003",
      "M300-P2-006",
      // Access-delivery channel row for clean cooking - "Improved Cookstoves
      // Distributed", distinct from the M300-P2-025 pilot-ledger headline
      // card above (matches ACCESS_CHANNEL_KPI_IDS in the real frontend
      // mock exactly - the two sections deliberately use different KPIs).
      "M300-P2-011",
      "M300-P1-004",
      "M300-P3-004",
      "M300-P3-006",
      "M300-P3-009",
      "M300-P3-010",
      "M300-P4-002",
    ], periodFilter);
    const deliveryStatusPromise = this.buildDeliveryStatus(
      pillarFilter,
      institutionFilter,
      priorityFilter,
      distributionCompanyFilter,
    );
    const [profiles, deliveryStatus] = await Promise.all([profilesPromise, deliveryStatusPromise]);
    const [
      peopleProfile,
      accessRateProfile,
      generationProfile,
      cleanCookingProfile,
      gridProfile,
      miniGridProfile,
      shsProfile,
      cleanCookingChannelProfile,
      renewableProfile,
      meteringProfile,
      atccProfile,
      remittanceProfile,
      shortfallProfile,
      capitalProfile,
    ] = profiles;

    const headlineCards = {
      peopleWithElectricityAccess: this.buildCompactOutcomeCard(
        peopleProfile,
        "People with electricity access",
        "access",
      ),
      accessRate: this.buildAccessRateCard(accessRateProfile),
      generationCapacity: this.buildGenerationCapacityCard(generationProfile),
      cleanCookingAccess: this.buildCompactOutcomeCard(
        cleanCookingProfile,
        "Clean cooking access",
        "cooking",
      ),
    };

    const accessDelivery = [
      this.buildAccessChannel("grid-connections", gridProfile),
      this.buildAccessChannel("mini-grid-connections", miniGridProfile),
      this.buildAccessChannel("solar-home-systems", shsProfile),
      this.buildAccessChannel("clean-cooking", cleanCookingChannelProfile),
    ];

    const nationalPerformanceAll = [
      this.buildBulletMetric(renewableProfile, {
        id: "renewable-share",
        caption: "Seasonal - retains the reporting period",
      }),
      this.buildBulletMetric(meteringProfile, { id: "metering-rate" }),
      this.buildBulletMetric(atccProfile, { id: "atcc-losses", caption: "Lower is better" }),
      this.buildBulletMetric(remittanceProfile, { id: "market-remittance" }),
      this.buildBulletMetric(shortfallProfile, {
        id: "tariff-shortfall",
        caption: "Outstanding = approved requirement minus funded",
      }),
      this.buildBulletMetric(capitalProfile, {
        id: "private-capital",
        caption: "Tracked from the January 2025 baseline",
      }),
    ];
    // Headline outcomes (Section A) and access delivery (Section B) stay
    // national regardless of the pillar filter - only Sections C and D
    // narrow (docs/API.md's own explicit instruction).
    const nationalPerformance =
      pillarFilter === "all"
        ? nationalPerformanceAll
        : nationalPerformanceAll.filter((m) => m.pillar === pillarFilter);

    return {
      lastUpdated: latestDate([
        ...profiles.map((profile) => profile.provenance.lastUpdated),
        deliveryStatus.provenance.lastUpdated,
      ]).toISOString(),
      appliedPillar: pillarFilter,
      headlineCards,
      cprTargets: this.buildCprTargets(headlineCards),
      accessDelivery,
      nationalPerformance,
      deliveryStatus,
    };
  }

  /** Matches compactOutcomeCardSchema - used for peopleWithElectricityAccess and cleanCookingAccess. */
  private buildCompactOutcomeCard(profile: KpiProfile, title: string, icon: string) {
    const baseline = profile.baseline ?? 0;
    const current = profile.current ?? 0;
    const target = profile.target !== null && profile.target > 0 ? profile.target : null;

    return {
      title,
      icon,
      value:
        profile.current === null
          ? profile.currentLabel
          : profile.unit === "%"
            ? `${current.toFixed(1)}%`
            : formatCompact(current),
      current,
      baseline,
      target,
      scaleMin: 0,
      scaleMax: Math.max(target ?? 0, current, baseline, 1),
      reportingPeriod: profile.reportingPeriod || NO_REPORTING_PERIOD_LABEL,
      baselineLabel: profile.baselineLabel,
      targetLabel: withTargetDate(profile.targetLabel, profile.targetDate),
      direction: profile.direction,
      source: toSourceTag(profile.validationStatus),
      confidence: toConfidence(profile.validationStatus),
      // Defaulted per executive-overview.ts's own BACKEND TOLERANCE section:
      // empty/null here is honest ("no interim checkpoints / no related KPI
      // defined"), not a gap this backend needs to fabricate.
      milestones: [] as { label: string; value: number }[],
      kpiId: profile.id,
      relatedKpiNote: null as { label: string; kpiId: string; value: string } | null,
      trend: profile.trend,
      provenance: profile.provenance,
    };
  }

  private buildAccessRateCard(profile: KpiProfile) {
    const history = profile.history;
    const previous = history.length > 1 ? history[history.length - 2] : null;
    const current = profile.current ?? 0;

    return {
      title: "Electricity access rate",
      icon: "access",
      kpiId: profile.id,
      value: profile.current === null ? profile.currentLabel : `${current.toFixed(1)}%`,
      rawValue: current,
      sourceYear: profile.reportingPeriod || NO_REPORTING_PERIOD_LABEL,
      previousPublication: previous
        ? `previous publication ${previous.value}% (${previous.period})`
        : "No previous publication on record",
      targetLabel: withTargetDate(profile.targetLabel, profile.targetDate),
      source: toSourceTag(profile.validationStatus),
      confidence: toConfidence(profile.validationStatus),
      trend: profile.trend,
      provenance: profile.provenance,
      sparkline: history.map((p) => ({ period: p.period, value: p.value })),
    };
  }

  private buildGenerationCapacityCard(profile: KpiProfile) {
    const availableMw = profile.current ?? 0;
    const installedMw = INSTALLED_CAPACITY_MW;

    return {
      title: "Available generation capacity",
      icon: "generation",
      kpiId: profile.id,
      availableMw,
      installedMw,
      value: profile.current === null ? profile.currentLabel : `${(availableMw / 1000).toFixed(1)} GW`,
      availabilityRatio: Math.max(0, Math.min(100, Math.round((availableMw / installedMw) * 1000) / 10)),
      sparkline: profile.history.map((p) => ({ period: p.period, value: p.value })),
      benchmarkLabel: `of ${(installedMw / 1000).toFixed(1)} GW installed`,
      reportingPeriod: profile.reportingPeriod || NO_REPORTING_PERIOD_LABEL,
      source: toSourceTag(profile.validationStatus),
      confidence: toConfidence(profile.validationStatus),
      trend: profile.trend,
      provenance: profile.provenance,
    };
  }

  private buildAccessChannel(id: string, profile: KpiProfile) {
    const current = profile.current ?? 0;
    const target = profile.target;
    const percentComplete = target !== null && target > 0 ? Math.round((current / target) * 1000) / 10 : null;

    return {
      id,
      title: profile.name,
      value: profile.current === null ? NO_KPI_VALUE_LABEL : numberFormatter.format(current),
      rawValue: current,
      target,
      targetLabel: withTargetDate(profile.targetLabel, profile.targetDate),
      percentComplete,
      source: toSourceTag(profile.validationStatus),
      confidence: toConfidence(profile.validationStatus),
      trend: profile.trend,
      provenance: profile.provenance,
    };
  }

  private buildBulletMetric(profile: KpiProfile, config: { id: string; caption?: string }) {
    const current = profile.current ?? 0;
    const baseline = profile.baseline ?? 0;
    const target = profile.target;

    return {
      id: config.id,
      title: profile.name,
      pillar: profile.pillar,
      scaleMin: 0,
      scaleMax: Math.max(target ?? 0, current, baseline, 1),
      baseline,
      current,
      // No real approved-trajectory data source exists yet to say what
      // value THIS period was expected to hit - null is honest here,
      // unlike the frontend mock, which hardcodes a plausible-looking
      // number with no real backing at all.
      expected: null as number | null,
      target,
      direction: profile.direction,
      value:
        profile.current === null
          ? profile.currentLabel
          : profile.unit === "%"
            ? `${current.toFixed(1)}%`
            : `${numberFormatter.format(current)} ${profile.unit}`,
      targetLabel: withTargetDate(profile.targetLabel, profile.targetDate),
      caption: config.caption,
      source: toSourceTag(profile.validationStatus),
      confidence: toConfidence(profile.validationStatus),
      trend: profile.trend,
      provenance: profile.provenance,
      history: profile.history.map((p) => ({ period: p.period, value: p.value })),
    };
  }

  private buildCprTargets(cards: {
    peopleWithElectricityAccess: ReturnType<ExecutiveOverviewService["buildCompactOutcomeCard"]>;
    accessRate: ReturnType<ExecutiveOverviewService["buildAccessRateCard"]>;
    generationCapacity: ReturnType<ExecutiveOverviewService["buildGenerationCapacityCard"]>;
    cleanCookingAccess: ReturnType<ExecutiveOverviewService["buildCompactOutcomeCard"]>;
  }) {
    return [
      {
        title: cards.peopleWithElectricityAccess.title,
        value: cards.peopleWithElectricityAccess.value,
        baselineLabel: cards.peopleWithElectricityAccess.baselineLabel,
        targetLabel: cards.peopleWithElectricityAccess.targetLabel,
        kpiId: cards.peopleWithElectricityAccess.kpiId,
      },
      {
        title: cards.accessRate.title,
        value: cards.accessRate.value,
        baselineLabel: `${cards.accessRate.sourceYear} publication`,
        targetLabel: cards.accessRate.targetLabel,
        kpiId: cards.accessRate.kpiId,
      },
      {
        title: cards.generationCapacity.title,
        value: cards.generationCapacity.value,
        // No formal Compact baseline or fixed 2030 target for this metric -
        // benchmarked against installed capacity and an approved plan
        // projection "when available" instead (per the real spec).
        baselineLabel: cards.generationCapacity.benchmarkLabel,
        targetLabel:
          "No fixed Compact target — tracked against an approved Integrated Resource Plan projection when available",
        kpiId: cards.generationCapacity.kpiId,
      },
      {
        title: cards.cleanCookingAccess.title,
        value: cards.cleanCookingAccess.value,
        baselineLabel: cards.cleanCookingAccess.baselineLabel,
        targetLabel: cards.cleanCookingAccess.targetLabel,
        kpiId: cards.cleanCookingAccess.kpiId,
      },
    ];
  }

  private async buildDeliveryStatus(
    pillarFilter: string,
    institutionFilter: string,
    priorityFilter: string,
    distributionCompanyFilter: string,
  ) {
    const now = new Date();
    const [projects, bottlenecks] = await Promise.all([
      this.prisma.project.findMany({
        where: {},
        include: { pillar: true, programme: true, statusHistory: true },
      }),
      this.prisma.bottleneck.findMany({
        where: { status: { not: "RESOLVED" } },
        include: { pillar: true },
      }),
    ]);

    const filteredProjects = projects.filter(
      (p) =>
        (pillarFilter === "all" || p.pillar.slug === pillarFilter) &&
        (institutionFilter === "all" || p.owner === institutionFilter) &&
        // "Priority actions" - the workbook's own register-priority concept,
        // held on the parent Programme (Project has no priority field of
        // its own). "Complete portfolio" (the "all" value) means no filter.
        (priorityFilter === "all" || p.programme.priority === "PRIORITY") &&
        // Same mechanism as institutionFilter above, on the same field
        // (Project.owner) - a second, independent param rather than
        // reusing institutionFilter, because the real contract exposes
        // them as two separate controls (see GlobalFilterBar).
        (distributionCompanyFilter === "all" || p.owner === distributionCompanyFilter),
    );
    const filteredBottlenecks = bottlenecks.filter(
      (b) =>
        (pillarFilter === "all" || b.pillar.slug === pillarFilter) &&
        (institutionFilter === "all" || b.institution === institutionFilter) &&
        // Bottlenecks have no parent Programme/priority concept of their
        // own - priorityFilter narrows the project list only.
        (distributionCompanyFilter === "all" || b.institution === distributionCompanyFilter),
    );

    const ongoingProjects = filteredProjects.map((p) => ({
      id: p.id,
      name: p.name,
      programmeId: p.programmeId,
      programmeName: p.programme.name,
      pillar: p.pillar.slug,
      pillarLabel: p.pillar.name,
      owner: p.owner,
      leadName: p.leadName,
      location: p.location,
      latitude: p.latitude,
      longitude: p.longitude,
      currentStatus: toKebabCase(p.currentStatus),
      pipelineReadiness: p.pipelineReadiness ? toKebabCase(p.pipelineReadiness) : null,
      startDate: p.startDate.toISOString(),
      endDate: p.endDate ? p.endDate.toISOString() : null,
      comment: p.comment,
      statusHistory: p.statusHistory.map((h) => ({ period: h.period, status: toKebabCase(h.status) })),
    }));

    const statusSummary = (["on-track", "at-risk", "delayed", "blocked", "completed"] as const).map((status) => ({
      status,
      count: ongoingProjects.filter((p) => p.currentStatus === status).length,
    }));

    const exceptions = filteredBottlenecks
      .map((b) => ({
        ...b,
        ageDays: Math.floor((now.getTime() - b.dateRaised.getTime()) / (24 * 60 * 60 * 1000)),
      }))
      .sort((a, b) => {
        const severityDelta = (SEVERITY_RANK[a.severity] ?? 0) - (SEVERITY_RANK[b.severity] ?? 0);
        return severityDelta !== 0 ? severityDelta : b.ageDays - a.ageDays;
      })
      .map((b) => ({
        id: b.id,
        title: b.issue,
        category: toKebabCase(b.category),
        institution: b.institution,
        reference: b.linkedRecord,
        severity: mapBottleneckExceptionSeverity(b),
        daysUnresolved: b.ageDays,
        followUp: b.followUp,
        provenance: {
          definition: b.followUp || "No follow-up recorded yet.",
          methodology: `Tracked as a ${toKebabCase(b.status)} ${toKebabCase(b.category)} bottleneck.`,
          source: "Bottleneck Register.",
          lastUpdated: b.dateRaised.toISOString(),
        },
      }));

    return {
      ongoingProjects,
      statusSummary,
      exceptions,
      provenance: {
        definition:
          "Ongoing project delivery status by pillar, linked to unresolved bottlenecks and overdue decisions.",
        methodology:
          "Exclude completed projects, then count ongoing projects by On Track, At Risk, Delayed and Blocked status. Rank exceptions by severity, delivery impact and days unresolved. Unrelated performance percentages are never averaged.",
        source: "Compact Progress Report, Implementation Register and Bottleneck Register.",
        lastUpdated: latestDate([...projects.map((p) => p.updatedAt), ...bottlenecks.map((b) => b.dateRaised)], now).toISOString(),
      },
    };
  }
}
