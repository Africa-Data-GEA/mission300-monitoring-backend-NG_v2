import { PLATFORM_NAME } from "@/common/platform-name";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ReportType, ValidationStatus, KpiReadinessTier, type Prisma } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service";
import { RabbitmqService } from "@/events/rabbitmq.service";
import { toKebabCase } from "@/common/utils/enum-casing";
import { formatPeriodLabel, toCatalogueRow, toKpiProfile } from "@/modules/kpi-explorer/kpi-explorer.mappers";
import { toObligationView, toValidationQueueItem } from "@/modules/data-submissions/data-submissions.mappers";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import {
  appliedFiltersFor,
  buildCompactExportCards,
  buildReportCatalogue,
  configSignature,
  matchesPillars,
  periodsLabel,
  validationStatusLabelFor,
  type ReportConfigLike,
  type ReportFilterOptions,
} from "@/modules/reports/reports.mappers";
import type { ReportConfigDto } from "@/modules/reports/dto/report-config.dto";
import type { ReportsQueryDto } from "@/modules/reports/dto/reports-query.dto";
import { compareReportingValues } from "@/common/utils/reporting-period";

const DEFAULT_PAGE_SIZE = 10;

const KPI_PROFILE_INCLUDE = { pillar: true, targetPoints: true } as const;
const VALUE_INCLUDE = { sourceSubmissionItem: { include: { submission: true } } } as const;
const OBLIGATION_INCLUDE = {
  institution: true,
  dataset: { include: { pillar: true, ownerInstitution: true } },
  focalPerson: true,
} as const;
const SUBMISSION_QUEUE_INCLUDE = {
  institution: true,
  submittedBy: true,
  obligation: { include: { dataset: true } },
  reviewer: true,
} as const;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmq: RabbitmqService,
  ) {}

  private async loadFilterOptions(): Promise<ReportFilterOptions> {
    const [periods, pillars, categories, states, discos, programmes] = await Promise.all([
      this.prisma.kpiValue.findMany({ select: { period: true }, distinct: ["period"] }),
      this.prisma.pillar.findMany({ orderBy: { name: "asc" } }),
      this.prisma.kpiDefinition.findMany({
        where: { category: { not: "" } },
        select: { category: true },
        distinct: ["category"],
      }),
      this.prisma.state.findMany({ orderBy: { name: "asc" } }),
      this.prisma.institution.findMany({ where: { type: "Disco" }, orderBy: { name: "asc" } }),
      this.prisma.programme.findMany({ orderBy: { name: "asc" } }),
    ]);

    const withAll = (label: string, options: { value: string; label: string }[]) => [
      { value: "all", label: `All ${label}` },
      ...options,
    ];

    return {
      reportingPeriods: withAll(
        "periods",
        [...new Set(periods.map((p) => p.period))]
          .sort()
          .map((p) => ({ value: p, label: formatPeriodLabel(p) })),
      ),
      pillars: withAll(
        "pillars",
        pillars.map((p) => ({ value: p.slug, label: p.name })),
      ),
      kpiCategories: withAll(
        "categories",
        categories
          .map((c) => ({ value: c.category, label: c.category }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      ),
      states: withAll(
        "states",
        states.map((s) => ({ value: s.id, label: s.name })),
      ),
      distributionCompanies: withAll(
        "Distribution Companies",
        discos.map((d) => ({ value: d.id, label: d.name })),
      ),
      programmesOrAgencies: withAll(
        "programmes",
        programmes.map((p) => ({ value: p.id, label: p.name })),
      ),
      validationStatuses: withAll(
        "validation statuses",
        Object.values(ValidationStatus).map((s) => ({
          value: toKebabCase(s),
          label: titleCase(toKebabCase(s)),
        })),
      ),
      readinessTiers: withAll(
        "readiness tiers",
        Object.values(KpiReadinessTier).map((t) => ({
          value: toKebabCase(t),
          label: titleCase(toKebabCase(t)),
        })),
      ),
    };
  }

  async getFilters() {
    const options = await this.loadFilterOptions();
    const catalogue = buildReportCatalogue();
    return {
      reportTypes: [
        { value: "all", label: "All report types" },
        ...catalogue.map((c) => ({ value: c.reportType, label: c.title })),
      ],
      reportingPeriods: options.reportingPeriods,
      pillars: options.pillars,
      kpiCategories: options.kpiCategories,
      states: options.states,
      distributionCompanies: options.distributionCompanies,
      programmesOrAgencies: options.programmesOrAgencies,
      validationStatuses: options.validationStatuses,
      readinessTiers: options.readinessTiers,
      exportFormats: [
        { value: "pdf", label: "PDF" },
        { value: "xlsx", label: "Excel (.xlsx)" },
      ],
    };
  }

  async getOverview(query: ReportsQueryDto) {
    const search = query.search?.trim() ?? "";
    const category = query.category ?? "all";
    const pageSize = Math.min(50, query.pageSize ?? DEFAULT_PAGE_SIZE);
    const reportTypes = Object.values(ReportType).filter((type) => REPORT_TYPE_CATEGORY_OF(type) === category);
    const where: Prisma.SavedReportWhereInput = {
      ...(category === "all" ? {} : { reportType: { in: reportTypes } }),
      ...(search ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { fileReference: { contains: search, mode: "insensitive" } },
          { requestedBy: { fullName: { contains: search, mode: "insensitive" } } },
        ],
      } : {}),
    };
    const total = await this.prisma.savedReport.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(query.page ?? 1, pageCount);
    const saved = await this.prisma.savedReport.findMany({
      where,
      include: { requestedBy: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      lastUpdated: new Date().toISOString(),
      catalogue: buildReportCatalogue(),
      compactExports: buildCompactExportCards(),
      savedReports: { items: saved.map(toSavedReportResponse), page, pageSize, total },
    };
  }

  async preview(dto: ReportConfigDto) {
    assertSupportedFilters(dto);
    const options = await this.loadFilterOptions();
    return this.buildPreview(dto, options);
  }

  async generate(user: AuthenticatedUser, dto: ReportConfigDto) {
    assertSupportedFilters(dto);
    const options = await this.loadFilterOptions();
    const fullPreview = await this.buildPreview(dto, options);
    const preview = {
      ...fullPreview,
      sections: fullPreview.sections.filter((section) => !dto.excludedSections?.includes(section.title)),
    };

    const catalogueEntry = buildReportCatalogue().find((c) => c.reportType === toKebabCase(dto.reportType))!;
    const signature = configSignature({ ...dto, reportType: dto.reportType });
    const filtersSummary = reportAppliedFilters(dto, options)
      .map((f) => f.value)
      .join(" · ") || "Current snapshot";
    // The stored/returned config must match reportConfigSchema's own wire
    // format (kebab-case) exactly, not this backend's internal Prisma enum
    // representation (SCREAMING_SNAKE_CASE) - a caller regenerating from a
    // saved report's own `config` would otherwise round-trip a value the
    // real schema rejects.
    const { orientation, excludedSections, ...reportConfig } = dto;
    const wireConfig = { ...reportConfig, reportType: toKebabCase(dto.reportType), format: toKebabCase(dto.format) };

    const existing = await this.prisma.savedReport.findFirst({
      where: { configSignature: signature },
      orderBy: { lastGeneratedAt: "desc" },
      select: { version: true },
    });
    const version = (existing?.version ?? 0) + 1;
    const fileReference = `${toKebabCase(dto.reportType)}_${dto.periods.join("-")}_v${version}.${toKebabCase(dto.format)}`;

    const saved = await this.prisma.savedReport.create({
      data: {
        requestedById: user.id,
        reportType: dto.reportType,
        title: `${catalogueEntry.title} — ${reportingLabel(dto, options)}`,
        filtersSummary,
        validationStatusLabel: reportValidationLabel(dto, options),
        version,
        format: dto.format,
        fileReference,
        configSignature: signature,
        config: wireConfig as unknown as Prisma.InputJsonValue,
        previewSnapshot: preview as unknown as Prisma.InputJsonValue,
        orientation: orientation ?? "portrait",
      },
      include: { requestedBy: true },
    });

    // The snapshot is ready synchronously; the client renders its PDF/XLSX
    // from these saved rows and metadata.
    await this.rabbitmq.publish("report.ready", { reportId: saved.id });

    return { preview, savedReport: toSavedReportResponse(saved) };
  }

  async getSavedPreview(id: string) {
    const saved = await this.prisma.savedReport.findUnique({ where: { id } });
    if (!saved) throw new NotFoundException(`No saved report found with id ${id}`);
    if (!saved.previewSnapshot) {
      throw new ConflictException("This report predates saved snapshots. Generate it again to create a reproducible version.");
    }
    return { preview: saved.previewSnapshot, orientation: saved.orientation };
  }

  async deleteSaved(id: string) {
    const existing = await this.prisma.savedReport.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`No saved report found with id ${id}`);
    await this.prisma.savedReport.delete({ where: { id } });
  }

  /** GET /api/reports/methodology - every tracked KPI's definition and calculation methodology, independent of any report configuration. */
  async getMethodology() {
    const kpis = await this.prisma.kpiDefinition.findMany({
      where: { isActive: true },
      include: { pillar: true },
      orderBy: { code: "asc" },
    });

    const rows = kpis.map((kpi) => [
      kpi.code,
      kpi.name,
      kpi.pillar.slug,
      kpi.definition || "Not yet documented.",
      kpi.formula || "Not yet documented.",
      kpi.sourceInstitution || "Not supplied",
    ]);

    return {
      metadata: {
        title: "KPI methodology export — all tracked indicators",
        reportingPeriod: "Not period-specific — methodology, not values",
        appliedFilters: [] as { label: string; value: string }[],
        generatedAt: new Date().toISOString(),
        dataVersion: `${PLATFORM_NAME} live database, ${new Date().toISOString().slice(0, 10)}`,
        sourceNotes: "Master KPI Registry — definition and calculation methodology per indicator.",
        validationStatus: "Not applicable — methodology text, not a validated figure.",
        units: "Not applicable.",
        limitations: `Generated from the ${PLATFORM_NAME} live database.`,
      },
      sections: [
        {
          title: "Indicator methodologies",
          columns: ["ID", "Indicator", "Pillar", "Definition", "Methodology", "Source institution"],
          rows,
        },
      ],
    };
  }

  private async buildPreview(
    config: ReportConfigLike & { reportType: ReportType },
    options: ReportFilterOptions,
  ) {
    const catalogueEntry = buildReportCatalogue().find(
      (c) => c.reportType === toKebabCase(config.reportType),
    )!;
    const now = new Date().toISOString();

    return {
      metadata: {
        title: `${catalogueEntry.title} — ${reportingLabel(config, options)}`,
        reportingPeriod: reportingLabel(config, options),
        appliedFilters: reportAppliedFilters(config, options),
        generatedAt: now,
        dataVersion: `${PLATFORM_NAME} live database, ${now.slice(0, 10)}`,
        sourceNotes: catalogueEntry.dataSource,
        validationStatus: reportValidationLabel(config, options),
        units: "As recorded per indicator; see indicator metadata for unit definitions.",
        limitations:
          `Generated from the ${PLATFORM_NAME} live database. Verify against the approved Compact Progress Report before external distribution.`,
      },
      sections: await this.sectionsFor(config.reportType, config),
    };
  }

  private async sectionsFor(reportType: ReportType, config: ReportConfigLike) {
    switch (reportType) {
      case "COMPACT_PROGRESS":
      case "COMPACT_REVIEW":
        return [
          ...(await this.deliverySection(config)),
          await this.bottleneckSection(config),
          await this.lessonsLearnedSection(config),
        ];
      case "PILLAR_PERFORMANCE":
      case "KPI_INDICATOR":
        return [await this.kpiSection(config, "Indicators", reportType)];
      case "STATE_DISCO":
        return [await this.stateDiscoSection(config)];
      case "IMPLEMENTATION":
        return this.deliverySection(config);
      case "BOTTLENECK":
        return [await this.bottleneckSection(config), await this.lessonsLearnedSection(config)];
      case "FINANCIAL":
        return [await this.financialSection(config)];
      case "SUBMISSION_COMPLIANCE":
        return [await this.complianceSection(config)];
      case "DATA_QUALITY":
        return [await this.dataQualitySection(config)];
    }
  }

  private async kpiSection(config: ReportConfigLike, title: string, reportType: ReportType) {
    const selectedPeriods = config.periods.includes("all") ? null : config.periods;
    const kpis = await this.prisma.kpiDefinition.findMany({
      where: { isActive: true },
      include: KPI_PROFILE_INCLUDE,
    });
    const values = await this.prisma.kpiValue.findMany({
      where: {
        kpiDefinitionId: { in: kpis.map((k) => k.id) },
        ...(selectedPeriods ? { period: { in: selectedPeriods } } : {}),
      },
      include: VALUE_INCLUDE,
    });

    const latestByKpi = new Map<string, (typeof values)[number]>();
    const valuesByKpi = new Map<string, typeof values>();
    for (const v of values) {
      const previous = latestByKpi.get(v.kpiDefinitionId);
      if (!previous || compareReportingValues(v, previous) > 0) latestByKpi.set(v.kpiDefinitionId, v);
      const list = valuesByKpi.get(v.kpiDefinitionId) ?? [];
      list.push(v);
      valuesByKpi.set(v.kpiDefinitionId, list);
    }

    const rows2 = kpis
      .filter((kpi) => !selectedPeriods || latestByKpi.has(kpi.id))
      .map((kpi) => ({ kpi, row: toCatalogueRow(kpi, latestByKpi.get(kpi.id) ?? null) }))
      .filter(
        ({ row }) =>
          matchesPillars(config, row.pillar) &&
          (config.kpiCategory === "all" || row.category === config.kpiCategory) &&
          (config.validationStatus === "all" || row.validationStatus === config.validationStatus) &&
          (config.readinessTier === "all" || row.readiness === config.readinessTier),
      );

    const isComparable = selectedPeriods !== null && selectedPeriods.length > 1 &&
      (reportType === "KPI_INDICATOR" || reportType === "PILLAR_PERFORMANCE");
    const periodLabels = isComparable ? selectedPeriods.map(formatPeriodLabel) : [];

    const rows = rows2.map(({ kpi, row }) => {
      const profile = toKpiProfile(
        { ...kpi, pillar: kpi.pillar, targetPoints: kpi.targetPoints },
        (valuesByKpi.get(kpi.id) ?? []) as never,
      );
      const cells = [
        row.id,
        row.name,
        row.pillar,
        row.category,
        row.unit,
        profile.baseline !== null ? String(profile.baseline) : "—",
        profile.current !== null ? String(profile.current) : "—",
        profile.target !== null ? String(profile.target) : "—",
        row.validationStatus,
      ];
      if (isComparable) {
        const latestByPeriod = new Map<string, (typeof values)[number]>();
        for (const value of valuesByKpi.get(kpi.id) ?? []) {
          const previous = latestByPeriod.get(value.period);
          if (!previous || value.approvedAt > previous.approvedAt) latestByPeriod.set(value.period, value);
        }
        cells.push(...selectedPeriods!.map((period) => {
          const value = latestByPeriod.get(period);
          return value ? String(value.value) : "—";
        }));
      }
      return cells;
    });

    return {
      title,
      columns: [
        "ID",
        "Indicator",
        "Pillar",
        "Category",
        "Unit",
        "Baseline",
        "Current",
        "Target",
        "Validation status",
        ...periodLabels,
      ],
      rows,
    };
  }

  private async deliverySection(config: ReportConfigLike) {
    const [programmes, projects] = await Promise.all([
      this.prisma.programme.findMany({ include: { pillar: true } }),
      this.prisma.project.findMany({ include: { pillar: true } }),
    ]);

    const filteredProgrammes = programmes.filter(
      (p) =>
        matchesPillars(config, p.pillar.slug) &&
        (config.programmeOrAgency === "all" || p.id === config.programmeOrAgency),
    );
    const filteredProjects = projects.filter(
      (p) =>
        matchesPillars(config, p.pillar.slug) &&
        (config.programmeOrAgency === "all" || p.programmeId === config.programmeOrAgency),
    );

    return [
      {
        title: "Programmes",
        columns: ["ID", "Name", "Lead institution", "Pillar", "Status"],
        rows: filteredProgrammes.map((p) => [
          p.id,
          p.name,
          p.leadInstitution,
          p.pillar.slug,
          toKebabCase(p.status),
        ]),
      },
      {
        title: "Projects",
        columns: ["ID", "Name", "Pillar", "Status"],
        rows: filteredProjects.map((p) => [p.id, p.name, p.pillar.slug, toKebabCase(p.currentStatus)]),
      },
    ];
  }

  private async bottleneckSection(config: ReportConfigLike) {
    const now = new Date();
    const rows = await this.prisma.bottleneck.findMany({ include: { pillar: true } });
    return {
      title: "Bottlenecks",
      columns: ["ID", "Issue", "Category", "Severity", "Status", "Age (days)"],
      rows: rows
        .filter((b) => matchesPillars(config, b.pillar.slug))
        .map((b) => [
          b.id,
          b.issue,
          toKebabCase(b.category),
          toKebabCase(b.severity),
          toKebabCase(b.status),
          String(Math.floor((now.getTime() - b.dateRaised.getTime()) / (24 * 60 * 60 * 1000))),
        ]),
    };
  }

  private async lessonsLearnedSection(config: ReportConfigLike) {
    const rows = await this.prisma.bottleneck.findMany({ include: { pillar: true } });
    return {
      title: "Lessons learned and follow-up actions",
      columns: ["ID", "Issue", "Status", "Follow-up / lesson learned"],
      rows: rows
        .filter((b) => matchesPillars(config, b.pillar.slug) && b.followUp.trim().length > 0)
        .map((b) => [b.id, b.issue, toKebabCase(b.status), b.followUp]),
    };
  }

  private async stateDiscoSection(config: ReportConfigLike) {
    const records = await this.prisma.discoPerformanceRecord.findMany({
      where: {
        ...(config.periods.includes("all") ? {} : { period: { in: config.periods } }),
        ...(config.distributionCompany === "all" ? {} : { institutionId: config.distributionCompany }),
      },
      include: { institution: true },
    });
    return {
      title: "Distribution Company performance",
      columns: ["Distribution Company", "Period", "Active customers", "Metered customers", "Metering rate (%)", "ATC&C loss (%)", "Validation status"],
      rows: records.map((record) => [
        record.institution.name,
        formatPeriodLabel(record.period),
        String(record.activeCustomers),
        String(record.meteredCustomers),
        record.activeCustomers > 0
          ? ((record.meteredCustomers / record.activeCustomers) * 100).toFixed(2)
          : "—",
        String(record.atccLossRatePercent),
        toKebabCase(record.validationStatus),
      ]),
    };
  }

  private async financialSection(config: ReportConfigLike) {
    const programmes = await this.prisma.programme.findMany({ include: { pillar: true } });
    return {
      title: "Programme financing",
      columns: ["ID", "Name", "Financing", "Status"],
      rows: programmes
        .filter((p) => matchesPillars(config, p.pillar.slug) &&
          (config.programmeOrAgency === "all" || p.id === config.programmeOrAgency))
        .map((p) => [p.id, p.name, p.financing ?? "Held at project level", toKebabCase(p.status)]),
    };
  }

  private async complianceSection(config: ReportConfigLike) {
    const obligations = await this.prisma.obligation.findMany({
      where: config.periods.includes("all") ? undefined : { reportingPeriod: { in: config.periods } },
      include: OBLIGATION_INCLUDE,
    });
    const submissions = await this.prisma.submission.findMany({
      where: { obligationId: { in: obligations.map((o) => o.id) } },
      orderBy: { createdAt: "desc" },
    });
    const latestBySubmission = new Map<string, (typeof submissions)[number]>();
    for (const s of submissions) {
      if (s.obligationId && !latestBySubmission.has(s.obligationId))
        latestBySubmission.set(s.obligationId, s);
    }

    const rows = obligations.map((o) => {
      const view = toObligationView(o, latestBySubmission.get(o.id) ?? null);
      return [view.id, view.institution, view.dataset, view.reportingPeriod, view.status.label];
    });

    return {
      title: "Submission obligations",
      columns: ["ID", "Institution", "Dataset", "Reporting period", "Status"],
      rows,
    };
  }

  private async dataQualitySection(config: ReportConfigLike) {
    const submissions = await this.prisma.submission.findMany({
      where: {
        status: "PENDING",
        ...(config.periods.includes("all") ? {} : { obligation: { reportingPeriod: { in: config.periods } } }),
      },
      include: SUBMISSION_QUEUE_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    const rows = submissions.map((s) => {
      const item = toValidationQueueItem(s);
      return [item.id, item.institution, item.dataset, item.status.label];
    });

    return {
      title: "Validation queue",
      columns: ["ID", "Institution", "Dataset", "Status"],
      rows,
    };
  }
}

function titleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const REPORT_FILTERS: Record<ReportType, readonly string[]> = {
  COMPACT_PROGRESS: ["pillars"],
  COMPACT_REVIEW: ["pillars"],
  PILLAR_PERFORMANCE: ["periods", "pillars", "kpiCategory", "validationStatus", "readinessTier"],
  KPI_INDICATOR: ["periods", "pillars", "kpiCategory", "validationStatus", "readinessTier"],
  STATE_DISCO: ["periods", "distributionCompany"],
  IMPLEMENTATION: ["pillars", "programmeOrAgency"],
  BOTTLENECK: ["pillars"],
  FINANCIAL: ["pillars", "programmeOrAgency"],
  SUBMISSION_COMPLIANCE: ["periods"],
  DATA_QUALITY: ["periods"],
};

function reportingLabel(config: ReportConfigLike & { reportType: ReportType }, options: ReportFilterOptions): string {
  return REPORT_FILTERS[config.reportType].includes("periods")
    ? periodsLabel(config, options)
    : "Current snapshot";
}

function reportAppliedFilters(config: ReportConfigLike & { reportType: ReportType }, options: ReportFilterOptions) {
  const entries = appliedFiltersFor(config, options);
  const supported = REPORT_FILTERS[config.reportType];
  return entries.filter((entry) => {
    if (entry.label === "Reporting period") return supported.includes("periods");
    if (entry.label === "Validation status") return supported.includes("validationStatus");
    return true;
  });
}

function reportValidationLabel(config: ReportConfigLike & { reportType: ReportType }, options: ReportFilterOptions) {
  return REPORT_FILTERS[config.reportType].includes("validationStatus")
    ? validationStatusLabelFor(config, options)
    : "Not applicable to this report";
}

/** A selected filter must never appear in report metadata without affecting its rows. */
function assertSupportedFilters(config: ReportConfigDto): void {
  if ((config.periods.includes("all") && config.periods.length > 1) ||
      (config.pillars.includes("all") && config.pillars.length > 1)) {
    throw new BadRequestException("All cannot be combined with specific periods or pillars.");
  }
  const active = {
    periods: !config.periods.includes("all"),
    pillars: !config.pillars.includes("all"),
    kpiCategory: config.kpiCategory !== "all",
    state: config.state !== "all",
    distributionCompany: config.distributionCompany !== "all",
    programmeOrAgency: config.programmeOrAgency !== "all",
    validationStatus: config.validationStatus !== "all",
    readinessTier: config.readinessTier !== "all",
  };
  const supported = REPORT_FILTERS[config.reportType];
  for (const [filter, selected] of Object.entries(active)) {
    if (selected && !supported.includes(filter)) {
      throw new BadRequestException(`${filter} is not available for ${toKebabCase(config.reportType)} reports.`);
    }
  }
}

function REPORT_TYPE_CATEGORY_OF(reportType: ReportType): string {
  const category: Record<ReportType, string> = {
    COMPACT_PROGRESS: "compact",
    COMPACT_REVIEW: "compact",
    PILLAR_PERFORMANCE: "performance",
    KPI_INDICATOR: "performance",
    STATE_DISCO: "delivery",
    IMPLEMENTATION: "delivery",
    BOTTLENECK: "delivery",
    FINANCIAL: "delivery",
    SUBMISSION_COMPLIANCE: "data-governance",
    DATA_QUALITY: "data-governance",
  };
  return category[reportType];
}

function toSavedReportResponse(report: Prisma.SavedReportGetPayload<{ include: { requestedBy: true } }>) {
  return {
    id: report.id,
    reportType: toKebabCase(report.reportType),
    category: REPORT_TYPE_CATEGORY_OF(report.reportType),
    title: report.title,
    owner: report.requestedBy.fullName,
    filtersSummary: report.filtersSummary,
    validationStatusLabel: report.validationStatusLabel,
    version: report.version,
    format: toKebabCase(report.format),
    fileReference: report.fileReference,
    createdAt: report.createdAt.toISOString(),
    lastGeneratedAt: report.lastGeneratedAt.toISOString(),
    config: report.config,
  };
}
