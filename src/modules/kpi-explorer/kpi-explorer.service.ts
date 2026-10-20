import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service";
import { paginate } from "@/modules/administration/overview/overview.mappers";
import { toKebabCase } from "@/common/utils/enum-casing";
import type { KpiExplorerQueryDto } from "@/modules/kpi-explorer/dto/kpi-explorer-query.dto";
import type { UpdateKpiMetadataDto } from "@/modules/kpi-explorer/dto/update-kpi-metadata.dto";
import type { CreateKpiDto } from "@/modules/kpi-explorer/dto/create-kpi.dto";
import type { SetKpiActiveDto } from "@/modules/kpi-explorer/dto/set-kpi-active.dto";
import type { SetKpiCurrentValueDto } from "@/modules/kpi-explorer/dto/set-kpi-current-value.dto";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { formatPeriodLabel, toCatalogueRow, toKpiProfile } from "@/modules/kpi-explorer/kpi-explorer.mappers";
import { ADMIN_OVERRIDE_SOURCE_REFERENCE } from "@/modules/kpi-explorer/admin-override.constant";
import { compareReportingValues } from "@/common/utils/reporting-period";
import { statusValueError } from "@/common/kpi/status-values";
import {
  CANONICAL_INSTITUTIONS,
  resolveInstitutionSources,
} from "@/common/institutions/institution-alias";

const DEFAULT_PAGE_SIZE = 20;

const VALUE_INCLUDE = { sourceSubmissionItem: { include: { submission: true } } } as const;
const SOURCE_INSTITUTION_INCLUDE = { include: { institution: true } } as const;
const KPI_INCLUDE = { pillar: true, sourceInstitutions: SOURCE_INSTITUTION_INCLUDE } as const;
const LINKED_KPI_SELECT = { select: { code: true, name: true } } as const;
const KPI_PROFILE_INCLUDE = {
  pillar: true,
  targetPoints: true,
  sourceInstitutions: SOURCE_INSTITUTION_INCLUDE,
  canonicalKpi: LINKED_KPI_SELECT,
  aliases: LINKED_KPI_SELECT,
} as const;

const READINESS_TIERS = ["CORE", "SUPPORTING", "FUTURE"] as const;
const VALIDATION_STATUSES = [
  "confirmed",
  "public-source",
  "requires-validation",
  "provisional",
  "future",
] as const;

@Injectable()
export class KpiExplorerService {
  constructor(private readonly prisma: PrismaService) {}

  async getFilters() {
    const [pillars, categories, sourceInstitutions, periods] = await Promise.all([
      this.prisma.pillar.findMany({ orderBy: { name: "asc" } }),
      this.prisma.kpiDefinition.findMany({
        where: { category: { not: "" } },
        select: { category: true },
        distinct: ["category"],
      }),
      this.prisma.kpiDefinition.findMany({
        where: { sourceInstitution: { not: "" } },
        select: { sourceInstitution: true },
        distinct: ["sourceInstitution"],
      }),
      this.prisma.kpiValue.findMany({ select: { period: true }, distinct: ["period"] }),
    ]);

    const withAll = (label: string, options: { value: string; label: string }[]) => [
      { value: "all", label: `All ${label}` },
      ...options,
    ];

    return {
      pillars: withAll(
        "pillars",
        pillars.map((p) => ({ value: p.slug, label: p.name })),
      ),
      categories: withAll(
        "categories",
        categories
          .map((c) => ({ value: c.category, label: c.category }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      ),
      readinessTiers: withAll(
        "readiness tiers",
        READINESS_TIERS.map((tier) => ({ value: toKebabCase(tier), label: titleCase(toKebabCase(tier)) })),
      ),
      validationStatuses: withAll(
        "validation statuses",
        VALIDATION_STATUSES.map((status) => ({ value: status, label: titleCase(status) })),
      ),
      sourceInstitutions: withAll(
        "institutions",
        sourceInstitutions.map((s) => ({ value: s.sourceInstitution, label: s.sourceInstitution })),
      ),
      reportingPeriods: withAll(
        "periods",
        [...new Set(periods.map((p) => p.period))]
          .sort()
          .map((p) => ({ value: p, label: formatPeriodLabel(p) })),
      ),
      geographies: [{ value: "national", label: "National" }],
    };
  }

  async getOverview(query: KpiExplorerQueryDto) {
    const pageSize = Math.min(200, query.pageSize ?? DEFAULT_PAGE_SIZE);
    const search = query.search?.trim().toLowerCase() ?? "";

    const [allKpis, allValues] = await Promise.all([
      this.prisma.kpiDefinition.findMany({ where: { isActive: true }, include: KPI_INCLUDE }),
      this.prisma.kpiValue.findMany({
        where: query.reportingPeriod && query.reportingPeriod !== "all"
          ? { period: query.reportingPeriod }
          : undefined,
        include: VALUE_INCLUDE,
      }),
    ]);

    const latestByKpi = new Map<string, (typeof allValues)[number]>();
    for (const value of allValues) {
      const previous = latestByKpi.get(value.kpiDefinitionId);
      if (!previous || compareReportingValues(value, previous) > 0) latestByKpi.set(value.kpiDefinitionId, value);
    }

    const allRows = allKpis
      .filter((kpi) => !query.reportingPeriod || query.reportingPeriod === "all" || latestByKpi.has(kpi.id))
      .map((kpi) => ({
      kpi,
      row: toCatalogueRow(kpi, latestByKpi.get(kpi.id) ?? null),
    }));

    const filteredRows = allRows.filter(({ row }) => {
      if (query.pillar && query.pillar !== "all" && row.pillar !== query.pillar) return false;
      if (query.category && query.category !== "all" && row.category !== query.category) return false;
      if (query.readiness && query.readiness !== "all" && row.readiness !== query.readiness) return false;
      if (
        query.validationStatus &&
        query.validationStatus !== "all" &&
        row.validationStatus !== query.validationStatus
      ) {
        return false;
      }
      if (
        query.sourceInstitution &&
        query.sourceInstitution !== "all" &&
        row.sourceInstitution !== query.sourceInstitution
      ) {
        return false;
      }
      if (search && ![row.id, row.name, row.sourceInstitution].join(" ").toLowerCase().includes(search)) {
        return false;
      }
      return true;
    });

    return {
      lastUpdated: new Date().toISOString(),
      summary: buildSummaryCards(filteredRows.map((r) => r.row)),
      catalogue: paginate(
        filteredRows.map((r) => r.row),
        query.page ?? 1,
        pageSize,
      ),
      pillarDistribution: buildPillarDistribution(allRows.map((r) => r.row)),
      readinessDistribution: buildReadinessDistribution(allRows.map((r) => r.row)),
    };
  }

  async getProfile(code: string) {
    const kpi = await this.prisma.kpiDefinition.findUnique({ where: { code }, include: KPI_PROFILE_INCLUDE });
    if (!kpi) throw new NotFoundException("KPI not found.");

    const values = await this.prisma.kpiValue.findMany({
      where: { kpiDefinitionId: kpi.id },
      include: VALUE_INCLUDE,
    });

    return toKpiProfile(kpi, values);
  }

  /**
   * Deliberately excludes category/readiness/name (not part of
   * updateKpiMetadataRequestSchema - those are effectively permanent once
   * an indicator is registered) and never touches current/history/
   * validationStatus/confidence - those only ever change via an approved
   * data submission (see toKpiProfile()'s own comment). Pillar reassignment
   * IS part of this endpoint - see the DTO's own comment.
   */
  async updateMetadata(code: string, dto: UpdateKpiMetadataDto) {
    const kpi = await this.prisma.kpiDefinition.findUnique({ where: { code } });
    if (!kpi) throw new NotFoundException("KPI not found.");

    const pillar = await this.prisma.pillar.findUnique({ where: { slug: dto.pillar } });
    if (!pillar) throw new BadRequestException("Unknown pillar.");

    if (dto.sourceInstitution.trim() !== kpi.sourceInstitution) {
      await this.assertRegisteredInstitution(dto.sourceInstitution);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.kpiDefinition.update({
        where: { id: kpi.id },
        data: {
          pillarId: pillar.id,
          definition: dto.definition,
          formula: dto.formula,
          unit: dto.unit,
          aggregation: dto.aggregation,
          frequency: dto.frequency,
          disaggregation: dto.disaggregation,
          limitations: dto.limitations,
          baseline: dto.baseline,
          baselineLabel: dto.baselineLabel,
          target: dto.target,
          targetLabel: dto.targetLabel,
          targetDate: dto.targetDate,
          sourceInstitution: dto.sourceInstitution,
          sourceDataset: dto.sourceDataset,
          sourceReference: dto.sourceReference,
          // Only touched when the field is actually present in the
          // request - omitting it must leave the existing alignment (or
          // lack of one) untouched, matching the schema's own comment.
          // Prisma needs the Prisma.JsonNull sentinel to write a real SQL
          // NULL into a Json column - a plain `null` is only valid for
          // "don't touch this field", the opposite of what's meant here.
          ...(dto.externalStandardAlignment !== undefined
            ? {
                externalStandardAlignment:
                  dto.externalStandardAlignment === null
                    ? Prisma.JsonNull
                    : (dto.externalStandardAlignment as unknown as Prisma.InputJsonValue),
              }
            : {}),
        },
      });

      // Replace-all semantics (updateKpiMetadataRequestSchema's own
      // comment): omitting `targets` leaves existing periodic checkpoints
      // untouched; sending an array (including []) replaces the full list.
      if (dto.targets !== undefined) {
        await tx.kpiTargetPoint.deleteMany({ where: { kpiDefinitionId: kpi.id } });
        if (dto.targets.length > 0) {
          await tx.kpiTargetPoint.createMany({
            data: dto.targets.map((point) => ({
              kpiDefinitionId: kpi.id,
              period: point.period,
              value: point.value,
              label: point.label,
            })),
          });
        }
      }

      await syncKpiSourceInstitutions(tx, kpi.id, dto.sourceInstitution);
    });

    return this.getProfile(code);
  }

  /**
   * A new indicator starts with no baseline/target/current value at all -
   * those arrive later through PATCH .../kpis/:id (baseline/target) or a
   * data submission (current), never typed in here. isActive defaults to
   * true; validationStatus/confidence resolve to "future"/"future-gap"
   * automatically (no KpiValue exists yet) via the same derivation every
   * other KPI uses.
   */
  async create(dto: CreateKpiDto) {
    const existing = await this.prisma.kpiDefinition.findUnique({ where: { code: dto.id } });
    if (existing) throw new ConflictException("A KPI with this identifier already exists.");

    const pillar = await this.prisma.pillar.findUnique({ where: { slug: dto.pillar } });
    if (!pillar) throw new BadRequestException("Unknown pillar.");

    await this.assertRegisteredInstitution(dto.sourceInstitution);

    const kpi = await this.prisma.kpiDefinition.create({
      data: {
        code: dto.id,
        name: dto.name,
        pillarId: pillar.id,
        category: dto.category,
        unit: dto.unit,
        definition: dto.definition,
        formula: dto.formula,
        frequency: dto.frequency,
        sourceInstitution: dto.sourceInstitution,
        sourceDataset: dto.sourceDataset,
        readiness: dto.readiness,
      },
      include: { pillar: true },
    });

    await syncKpiSourceInstitutions(this.prisma, kpi.id, dto.sourceInstitution);

    const withSources = await this.prisma.kpiDefinition.findUniqueOrThrow({
      where: { id: kpi.id },
      include: KPI_INCLUDE,
    });

    return {
      row: toCatalogueRow(withSources, null),
      message: `${dto.name} was added to the catalogue.`,
    };
  }

  /**
   * Reversible, never deletes - a retired indicator that already
   * published values must stay traceable (setKpiActiveRequestSchema's own
   * comment), so this only flips isActive and hides it from the default
   * catalogue (getOverview()'s `where: { isActive: true }`).
   */
  async setActive(code: string, dto: SetKpiActiveDto) {
    const kpi = await this.prisma.kpiDefinition.findUnique({ where: { code } });
    if (!kpi) throw new NotFoundException("KPI not found.");

    const updated = await this.prisma.kpiDefinition.update({
      where: { id: kpi.id },
      data: { isActive: dto.active },
      include: { pillar: true },
    });

    const latestValue = await this.prisma.kpiValue.findFirst({
      where: { kpiDefinitionId: kpi.id },
      include: VALUE_INCLUDE,
      orderBy: { approvedAt: "desc" },
    });

    return {
      row: toCatalogueRow(updated, latestValue),
      message: dto.active
        ? `${updated.name} was restored to the catalogue.`
        : `${updated.name} was retired from the catalogue.`,
    };
  }

  /**
   * Explicit admin override of the usual rule that current/history only
   * ever change via an approved data submission (recordDecision() in
   * data-submissions.service.ts). KpiValue.sourceSubmissionItemId is a
   * required, unique FK - there is no schema path to a value that isn't
   * linked to a real SubmissionItem - so this synthesizes a minimal,
   * already-decided submission chain (Submission + one SubmissionItem +
   * ReviewDecision, status set straight to APPROVED/PROVISIONALLY_APPROVED)
   * rather than a bare KpiValue insert. That keeps every existing reader
   * (toCatalogueRow/toKpiProfile, both of which derive current/
   * validationStatus from the submission behind the KpiValue) working
   * unchanged, and keeps the override itself traceable in the submissions
   * table rather than being invisible. `note`, if given, is recorded as the
   * ReviewDecision's comment so the override reason survives in the audit
   * trail; there's nowhere on KpiValue itself to keep free text.
   */
  async setCurrentValue(code: string, dto: SetKpiCurrentValueDto, user: AuthenticatedUser) {
    const kpi = await this.prisma.kpiDefinition.findUnique({ where: { code } });
    if (!kpi) throw new NotFoundException("KPI not found.");

    const statusError = statusValueError(kpi.unit, dto.value);
    if (statusError) throw new BadRequestException(statusError);

    const institutionId = await this.resolveInstitutionId(kpi.sourceInstitution, user.institutionId);
    const targetStatus = dto.resultingStatus === "confirmed" ? "APPROVED" : "PROVISIONALLY_APPROVED";
    const reviewType = dto.resultingStatus === "confirmed" ? "APPROVE" : "PROVISIONALLY_APPROVE";
    const approvedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      const submission = await tx.submission.create({
        data: {
          institutionId,
          submittedById: user.id,
          method: "MANUAL_ENTRY",
          status: targetStatus,
          sourceReference: ADMIN_OVERRIDE_SOURCE_REFERENCE,
          notes: dto.note ?? "",
          reviewerId: user.id,
          items: {
            create: [{ kpiDefinitionId: kpi.id, period: dto.reportingPeriod, value: dto.value }],
          },
        },
        include: { items: true },
      });

      await tx.reviewDecision.create({
        data: { submissionId: submission.id, reviewedById: user.id, decision: reviewType, comment: dto.note ?? "" },
      });

      await tx.kpiValue.create({
        data: {
          kpiDefinitionId: kpi.id,
          institutionId,
          period: dto.reportingPeriod,
          value: dto.value,
          sourceSubmissionItemId: submission.items[0]!.id,
          approvedAt,
        },
      });
    });

    return this.getProfile(code);
  }

  /**
   * Only a KpiValue that came from setCurrentValue()'s own admin-override
   * path may be corrected or removed here - identified by the exact
   * sourceReference it stamps, not merely by a null obligationId (the
   * historical bulk-import scripts also leave obligationId null on their
   * synthetic submissions; see ADMIN_OVERRIDE_SOURCE_REFERENCE's comment).
   * A value that arrived through an approved data submission, or through
   * bulk import, stays governed by its own workflow; this override tool
   * doesn't get to quietly rewrite or delete either.
   */
  private async findEditableHistoryPoint(code: string, valueId: string) {
    const kpi = await this.prisma.kpiDefinition.findUnique({ where: { code } });
    if (!kpi) throw new NotFoundException("KPI not found.");

    const value = await this.prisma.kpiValue.findUnique({ where: { id: valueId }, include: VALUE_INCLUDE });
    if (!value || value.kpiDefinitionId !== kpi.id) throw new NotFoundException("History point not found.");
    if (value.sourceSubmissionItem.submission.sourceReference !== ADMIN_OVERRIDE_SOURCE_REFERENCE) {
      throw new BadRequestException(
        "This value did not come from a direct admin override - correct it through Data Submissions review, not here.",
      );
    }
    return Object.assign(value, { kpiUnit: kpi.unit });
  }

  async editHistoryPoint(code: string, valueId: string, dto: SetKpiCurrentValueDto) {
    const value = await this.findEditableHistoryPoint(code, valueId);
    const statusError = statusValueError(value.kpiUnit, dto.value);
    if (statusError) throw new BadRequestException(statusError);
    const targetStatus = dto.resultingStatus === "confirmed" ? "APPROVED" : "PROVISIONALLY_APPROVED";
    const reviewType = dto.resultingStatus === "confirmed" ? "APPROVE" : "PROVISIONALLY_APPROVE";

    await this.prisma.$transaction([
      this.prisma.kpiValue.update({
        where: { id: valueId },
        data: { period: dto.reportingPeriod, value: dto.value, approvedAt: new Date() },
      }),
      this.prisma.submissionItem.update({
        where: { id: value.sourceSubmissionItemId },
        data: { period: dto.reportingPeriod, value: dto.value },
      }),
      this.prisma.submission.update({
        where: { id: value.sourceSubmissionItem.submissionId },
        data: { status: targetStatus, notes: dto.note ?? "" },
      }),
      this.prisma.reviewDecision.updateMany({
        where: { submissionId: value.sourceSubmissionItem.submissionId },
        data: { decision: reviewType, comment: dto.note ?? "" },
      }),
    ]);

    return this.getProfile(code);
  }

  async deleteHistoryPoint(code: string, valueId: string) {
    const value = await this.findEditableHistoryPoint(code, valueId);
    const submissionId = value.sourceSubmissionItem.submissionId;

    await this.prisma.$transaction([
      this.prisma.kpiValue.delete({ where: { id: valueId } }),
      this.prisma.reviewDecision.deleteMany({ where: { submissionId } }),
      this.prisma.submissionItem.deleteMany({ where: { submissionId } }),
      this.prisma.submission.delete({ where: { id: submissionId } }),
    ]);

    return this.getProfile(code);
  }

  private async assertRegisteredInstitution(sourceInstitution: string) {
    const name = sourceInstitution.trim();
    const registered = name
      ? await this.prisma.institution.findFirst({
          where: { name: { equals: name, mode: "insensitive" } },
          select: { id: true },
        })
      : null;
    if (!registered) {
      throw new BadRequestException(`"${name}" is not a registered institution. Select one from the institutions list.`);
    }
  }

  private async resolveInstitutionId(sourceInstitution: string, fallbackInstitutionId: string | null) {
    const name = sourceInstitution.trim();

    if (name) {
      const existing = await this.prisma.institution.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
      });
      if (existing) return existing.id;

      const [slug] = resolveInstitutionSources(name).slugs;
      if (slug) {
        const canonical = await this.prisma.institution.findUnique({
          where: { id: CANONICAL_INSTITUTIONS[slug].id },
        });
        if (canonical) return canonical.id;
      }
    }

    if (fallbackInstitutionId) return fallbackInstitutionId;

    throw new BadRequestException(
      name
        ? `Source institution "${name}" does not match a registered institution. Register it, or add an alias in institution-alias.ts, before overriding this value.`
        : "This indicator has no source institution recorded, and you are not attached to an institution. Set the indicator's source institution before overriding its value.",
    );
  }
}

type KpiSourceInstitutionWriter = {
  institution: {
    findMany: (args: {
      where: { type?: string; id?: { in: string[] } };
      select: { id: true };
    }) => Promise<{ id: string }[]>;
  };
  kpiSourceInstitution: {
    deleteMany: (args: { where: { kpiDefinitionId: string } }) => Promise<unknown>;
    createMany: (args: {
      data: { kpiDefinitionId: string; institutionId: string }[];
      skipDuplicates: boolean;
    }) => Promise<unknown>;
  };
};

async function syncKpiSourceInstitutions(
  client: KpiSourceInstitutionWriter,
  kpiDefinitionId: string,
  sourceInstitution: string,
) {
  const resolution = resolveInstitutionSources(sourceInstitution ?? "");
  const institutionIds = resolution.slugs.map((slug) => CANONICAL_INSTITUTIONS[slug].id);

  if (resolution.allDiscos) {
    const discos = await client.institution.findMany({
      where: { type: "Disco" },
      select: { id: true },
    });
    institutionIds.push(...discos.map((disco) => disco.id));
  }

  await client.kpiSourceInstitution.deleteMany({ where: { kpiDefinitionId } });
  if (institutionIds.length === 0) return;

  const existing = await client.institution.findMany({
    where: { id: { in: [...new Set(institutionIds)] } },
    select: { id: true },
  });
  if (existing.length === 0) return;

  await client.kpiSourceInstitution.createMany({
    data: existing.map((institution) => ({ kpiDefinitionId, institutionId: institution.id })),
    skipDuplicates: true,
  });
}

function titleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const PROVENANCE_NOW = () => new Date().toISOString();

/**
 * Matches catalogueSummaryCardSchema, exactly the 4 cards from docs/specs/
 * kpi-explorer.md Section A - computed against filteredRows, so these
 * counts track the same pillar/category/readiness/validationStatus/
 * sourceInstitution/search narrowing as the catalogue table itself (only
 * pagination and reportingPeriod are applied on top, at the call site).
 */
function buildSummaryCards(rows: ReturnType<typeof toCatalogueRow>[]) {
  const now = PROVENANCE_NOW();
  const provenance = (definition: string, methodology: string, source: string) => ({
    definition,
    methodology,
    source,
    lastUpdated: now,
  });

  const coreCount = rows.filter((r) => r.readiness === "core").length;
  const supportingCount = rows.filter((r) => r.readiness === "supporting").length;
  const withValue = rows.filter((r) => r.validationStatus !== "future").length;
  const dataGap = rows.length - withValue;

  return [
    {
      id: "total-indicators",
      title: "Total indicators",
      count: rows.length,
      breakdown: [] as { label: string; count: number }[],
      provenance: provenance(
        "Count of active indicators in the approved catalogue.",
        "Count unique active Key Performance Indicator identifiers.",
        "Approved Mission 300 Key Performance Indicator Matrix",
      ),
    },
    {
      id: "core-indicators",
      title: "Core or Tier 1 indicators",
      count: coreCount,
      breakdown: [],
      provenance: provenance(
        "Indicators classified as immediate Minimum Viable Dataset priorities.",
        "Count catalogue records classified Core or Tier 1.",
        "Approved Key Performance Indicator Matrix",
      ),
    },
    {
      id: "supporting-indicators",
      title: "Supporting or Tier 2 indicators",
      count: supportingCount,
      breakdown: [],
      provenance: provenance(
        "Supporting indicators to be used where the source institution already maintains the data.",
        "Count catalogue records classified Supporting or Tier 2.",
        "Approved Key Performance Indicator Matrix",
      ),
    },
    {
      id: "data-availability",
      title: "Indicators with a current value or data gap",
      count: rows.length,
      breakdown: [
        { label: "With current value", count: withValue },
        { label: "Data gap", count: dataGap },
      ],
      provenance: provenance(
        "Catalogue coverage by current data availability.",
        "Count indicators with an approved current value separately from those marked as a data gap.",
        "Key Performance Indicator value repository and validation workflow",
      ),
    },
  ];
}

function buildPillarDistribution(rows: ReturnType<typeof toCatalogueRow>[]) {
  const byPillar = new Map<string, ReturnType<typeof toCatalogueRow>[]>();
  for (const row of rows) {
    if (!byPillar.has(row.pillar)) byPillar.set(row.pillar, []);
    byPillar.get(row.pillar)!.push(row);
  }
  return [...byPillar.entries()].map(([pillar, pillarRows]) => {
    const statusCounts = new Map<string, number>();
    for (const row of pillarRows) {
      statusCounts.set(row.validationStatus, (statusCounts.get(row.validationStatus) ?? 0) + 1);
    }
    return {
      pillar,
      label: titleCase(pillar),
      total: pillarRows.length,
      byStatus: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
    };
  });
}

function buildReadinessDistribution(rows: ReturnType<typeof toCatalogueRow>[]) {
  return READINESS_TIERS.map((tier) => {
    const code = toKebabCase(tier);
    return { tier: code, label: titleCase(code), count: rows.filter((r) => r.readiness === code).length };
  });
}
