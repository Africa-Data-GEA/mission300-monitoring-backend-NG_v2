import { Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/prisma/prisma.service";
import { anyName, resolvePillarInstitutionFilter } from "@/modules/pillar-dashboard/pillar-institution-filter";
import { toCatalogueRow, toKpiProfile } from "@/modules/kpi-explorer/kpi-explorer.mappers";
import { toMilestoneRecord, toProgrammeRecord, toProjectRecord } from "@/modules/programs/programs.mappers";
import {
  loadBottleneckIdsByLinkedRecord,
  toBottleneckRecord,
} from "@/modules/bottlenecks/bottlenecks.mappers";
import { toKebabCase } from "@/common/utils/enum-casing";
import { latestDate } from "@/common/utils/latest-date";
import { reportingPeriodKey, withoutFuturePeriods } from "@/common/utils/reporting-period";
import {
  PILLAR_HEADLINE_KPI_CODES,
  PILLAR_LABELS,
  PILLAR_SEVERITY_RANK,
  toPillarCoreIndicator,
  toPillarHeadlineCard,
} from "@/modules/pillar-dashboard/pillar-dashboard.mappers";

const KPI_PROFILE_INCLUDE = { pillar: true, targetPoints: true } as const;
const VALUE_INCLUDE = { sourceSubmissionItem: { include: { submission: true } } } as const;
const PROGRAMME_INCLUDE = { pillar: true } as const;
const PROJECT_INCLUDE = {
  pillar: true,
  programme: true,
  statusHistory: true,
  documents: true,
  updates: true,
} as const;
const BOTTLENECK_INCLUDE = { pillar: true, statusHistory: true } as const;
const MILESTONE_INCLUDE = { project: true } as const;

const EXECUTION_STATUSES = ["ON_TRACK", "AT_RISK", "DELAYED", "BLOCKED", "COMPLETED"] as const;

@Injectable()
export class PillarDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(pillarSlug: string, reportingPeriod?: string, institution?: string) {
    const pillar = await this.prisma.pillar.findUnique({ where: { slug: pillarSlug } });
    if (!pillar) throw new NotFoundException("Unknown Compact pillar.");

    const headlineCodes = PILLAR_HEADLINE_KPI_CODES[pillarSlug];
    if (!headlineCodes) {
      throw new InternalServerErrorException(
        `No headline-card KPI mapping configured for pillar "${pillarSlug}".`,
      );
    }

    const kpis = await this.prisma.kpiDefinition.findMany({
      where: { pillarId: pillar.id, isActive: true },
      include: KPI_PROFILE_INCLUDE,
    });
    const activeCodes = new Set(kpis.map((k) => k.code));
    const retiredHeadlineCodes = headlineCodes.filter((code) => !activeCodes.has(code));
    const retiredHeadline = retiredHeadlineCodes.length
      ? await this.prisma.kpiDefinition.findMany({
          where: { code: { in: retiredHeadlineCodes } },
          include: KPI_PROFILE_INCLUDE,
        })
      : [];
    const profileKpis = [...kpis, ...retiredHeadline];
    const kpiIds = profileKpis.map((k) => k.id);
    const filter = await resolvePillarInstitutionFilter(this.prisma, institution);
    const ownedKpiIds = filter
      ? new Set(
          filter.institutionId
            ? (
                await this.prisma.kpiSourceInstitution.findMany({
                  where: { institutionId: filter.institutionId, kpiDefinitionId: { in: kpiIds } },
                  select: { kpiDefinitionId: true },
                })
              ).map((link) => link.kpiDefinitionId)
            : [],
        )
      : null;
    const fetchedValues = kpiIds.length
      ? await this.prisma.kpiValue.findMany({
          where: { kpiDefinitionId: { in: kpiIds } },
          include: VALUE_INCLUDE,
        })
      : [];

    // "As of" semantics, not an exact string match on `period` - KPIs on the
    // same pillar report at different cadences (annual vs quarterly), so a
    // bare-year cutoff like "2026" must still surface a KPI's latest value
    // at "q2-2026", not silently drop it because the strings don't match
    // character-for-character. Exact matching here previously made a real,
    // approved, recent value read as "No data yet" on every pillar
    // dashboard whenever a KPI's cadence didn't happen to match the
    // requested period string - see ExecutiveOverviewService's own
    // isAtOrBeforePeriod, which never had this bug because it always
    // compared parsed period keys instead of raw strings.
    const cutoffKey =
      reportingPeriod && reportingPeriod !== "all" ? reportingPeriodKey(reportingPeriod) : null;
    const reportedValues = withoutFuturePeriods(fetchedValues);
    const allValues =
      cutoffKey === null
        ? reportedValues
        : reportedValues.filter((value) => {
            const key = reportingPeriodKey(value.period);
            return key !== null && key <= cutoffKey;
          });

    const valuesByKpi = new Map<string, typeof allValues>();
    for (const value of allValues) {
      const list = valuesByKpi.get(value.kpiDefinitionId) ?? [];
      list.push(value);
      valuesByKpi.set(value.kpiDefinitionId, list);
    }

    const profilesByCode = new Map<string, ReturnType<typeof toKpiProfile>>();
    for (const kpi of profileKpis) {
      profilesByCode.set(kpi.code, toKpiProfile(kpi, valuesByKpi.get(kpi.id) ?? []));
    }

    const missingHeadline = headlineCodes.filter((code) => !profilesByCode.has(code));
    if (missingHeadline.length > 0) {
      throw new InternalServerErrorException(
        `Pillar dashboard "${pillarSlug}" references unseeded KPI code(s): ${missingHeadline.join(", ")}.`,
      );
    }
    const kpiIdByCode = new Map(profileKpis.map((k) => [k.code, k.id]));
    const institutionLabel = filter?.names[0] ?? "this institution";
    const headlineCards = headlineCodes.map((code) => {
      const profile = profilesByCode.get(code)!;
      const owned = !ownedKpiIds || ownedKpiIds.has(kpiIdByCode.get(code) ?? "");
      return toPillarHeadlineCard(
        owned ? profile : { ...profile, current: null, currentLabel: `Not reported by ${institutionLabel}`, reportingPeriod: "" },
      );
    });

    const latestByKpi = new Map<string, (typeof allValues)[number]>();
    for (const value of [...allValues].sort((a, b) => b.approvedAt.getTime() - a.approvedAt.getTime())) {
      if (!latestByKpi.has(value.kpiDefinitionId)) latestByKpi.set(value.kpiDefinitionId, value);
    }
    const catalogueRows = kpis.map((kpi) => toCatalogueRow(kpi, latestByKpi.get(kpi.id) ?? null));

    const coreIndicators = kpis
      .filter((kpi) => {
        if (headlineCodes.includes(kpi.code)) return false;
        if (ownedKpiIds && !ownedKpiIds.has(kpi.id)) return false;
        // P4-001 is derived from the REA P4-009 snapshot. Keep the source KPI
        // in the catalogue, but don't repeat an identical current reading.
        if (pillarSlug === "private-sector-participation" && kpi.code === "M300-P4-009") {
          const headlineValue = profilesByCode.get("M300-P4-001")?.current;
          const sourceValue = profilesByCode.get("M300-P4-009")?.current;
          if (headlineValue !== null && headlineValue === sourceValue) return false;
        }
        return true;
      })
      .map((kpi) => toPillarCoreIndicator(profilesByCode.get(kpi.code)!, kpi.sourceDataset || "Other"));

    const names = filter?.names ?? null;
    const [programmes, projects, bottlenecksRaw, milestonesRaw] = await Promise.all([
      this.prisma.programme.findMany({
        where: {
          pillarId: pillar.id,
          ...(names
            ? {
                OR: [
                  ...anyName(names).map((match) => ({ leadInstitution: match })),
                  { supportingInstitutions: { hasSome: names } },
                ],
              }
            : {}),
        },
        include: PROGRAMME_INCLUDE,
      }),
      this.prisma.project.findMany({
        where: {
          pillarId: pillar.id,
          ...(names ? { OR: anyName(names).map((match) => ({ owner: match })) } : {}),
        },
        include: PROJECT_INCLUDE,
      }),
      this.prisma.bottleneck.findMany({
        where: {
          pillarId: pillar.id,
          ...(names ? { OR: anyName(names).map((match) => ({ institution: match })) } : {}),
        },
        include: BOTTLENECK_INCLUDE,
      }),
      // Real Milestone rows (the same model Programs' own project-detail
      // milestones tab reads) scoped to this pillar via their project's
      // pillarId - not the "any KPI whose unit is 'status'" stand-in the
      // frontend used to show under this same name. Honestly empty until
      // someone actually creates one for a project in this pillar.
      this.prisma.milestone.findMany({
        where: {
          project: {
            pillarId: pillar.id,
            ...(names ? { OR: anyName(names).map((match) => ({ owner: match })) } : {}),
          },
        },
        include: MILESTONE_INCLUDE,
        orderBy: { expectedDate: "asc" },
      }),
    ]);
    const milestoneRecords = milestonesRaw.map(toMilestoneRecord);

    const bottleneckIds = await loadBottleneckIdsByLinkedRecord(this.prisma, [
      ...programmes.map((p) => p.id),
      ...projects.map((p) => p.id),
    ]);
    const programmeRecords = programmes.map((p) => toProgrammeRecord(p, bottleneckIds.get(p.id) ?? []));
    const projectRecords = projects.map((p) => toProjectRecord(p, bottleneckIds.get(p.id) ?? []));

    const statuses = [...programmes.map((p) => p.status), ...projects.map((p) => p.currentStatus)];
    const counts = EXECUTION_STATUSES.map((status) => ({
      status: toKebabCase(status),
      count: statuses.filter((s) => s === status).length,
    }));

    const now = new Date();
    // Ranked top-5 for this pillar - no status filter beyond the pillar
    // match itself (matches the frontend mock's own buildPillarDashboard()
    // exactly: resolved bottlenecks are NOT excluded here, unlike
    // Executive Overview's exceptions[] or Bottlenecks' own "open" set).
    const bottlenecks = bottlenecksRaw
      .map((b) => ({
        ...b,
        ageDays: Math.floor((now.getTime() - b.dateRaised.getTime()) / (24 * 60 * 60 * 1000)),
      }))
      .sort((a, b) => {
        const delta = (PILLAR_SEVERITY_RANK[a.severity] ?? 0) - (PILLAR_SEVERITY_RANK[b.severity] ?? 0);
        return delta !== 0 ? delta : b.ageDays - a.ageDays;
      })
      .slice(0, 5)
      .map((b) => toBottleneckRecord(b, now));

    return {
      pillar: pillarSlug,
      label: PILLAR_LABELS[pillarSlug],
      lastUpdated: latestDate(
        [
          ...[...profilesByCode.values()].map((profile) => profile.provenance.lastUpdated),
          ...projects.map((p) => p.updatedAt),
        ],
        now,
      ).toISOString(),
      headlineCards,
      coreIndicators,
      deliveryStatus: { counts, total: statuses.length },
      bottlenecks,
      milestones: milestoneRecords,
      programmes: programmeRecords,
      projects: projectRecords,
      // State/DisCo is its own not-yet-built module (a separate entity
      // model entirely - DisCo-level metering/revenue comparison rows, not
      // KPI Explorer data) - honestly empty until then, same "close the
      // loop later" precedent as Programs Phase A's bottlenecks[] before
      // Phase B wired the real derivation.
      discoPerformance: [] as unknown[],
      kpis: catalogueRows,
    };
  }
}
