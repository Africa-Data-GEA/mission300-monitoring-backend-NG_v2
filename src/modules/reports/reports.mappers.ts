import { toKebabCase } from "@/common/utils/enum-casing";

/**
 * Reports & Exports is a pure read-composition layer, same pattern as
 * Executive Overview/Pillar Dashboards: every report type is a filtered,
 * reshaped view over data that already exists in another module (KPI
 * Explorer, Programs, Bottlenecks, State & DisCo, Data Submissions) - there
 * is no separate "reports" dataset to keep in sync. The backend never
 * renders an actual PDF/XLSX file - confirmed directly from the frontend
 * mock's own handler comment ("The actual PDF/Excel file is produced
 * client-side from the returned preview, not by this endpoint"). This
 * module's job stops at returning the same {metadata, sections} JSON the
 * on-screen preview and the client-side file renderer both consume.
 */

export const REPORT_TYPES = [
  "COMPACT_PROGRESS",
  "COMPACT_REVIEW",
  "PILLAR_PERFORMANCE",
  "KPI_INDICATOR",
  "STATE_DISCO",
  "IMPLEMENTATION",
  "BOTTLENECK",
  "FINANCIAL",
  "SUBMISSION_COMPLIANCE",
  "DATA_QUALITY",
  "EXECUTIVE_BRIEF",
] as const;

export type ReportTypeEnum = (typeof REPORT_TYPES)[number];

/** Matches REPORT_TYPE_CATEGORY exactly (reports.ts) - a fixed derived mapping, never stored. */
export const REPORT_TYPE_CATEGORY: Record<ReportTypeEnum, string> = {
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
  EXECUTIVE_BRIEF: "executive",
};

/** Matches REPORT_TYPE_LABELS exactly (reports.ts). */
export const REPORT_TYPE_LABELS: Record<ReportTypeEnum, string> = {
  COMPACT_PROGRESS: "Compact Progress Report",
  COMPACT_REVIEW: "Compact review export",
  PILLAR_PERFORMANCE: "Pillar performance report",
  KPI_INDICATOR: "KPI baseline–current–target report",
  STATE_DISCO: "State & DisCo report",
  IMPLEMENTATION: "Implementation report",
  BOTTLENECK: "Bottleneck report",
  FINANCIAL: "Financial report",
  SUBMISSION_COMPLIANCE: "Submission-compliance report",
  DATA_QUALITY: "Data-quality report",
  EXECUTIVE_BRIEF: "Executive brief (one page)",
};

export interface CatalogueEntry {
  reportType: string;
  category: string;
  title: string;
  definition: string;
  methodology: string;
  dataSource: string;
}

/** Matches reportCatalogueCardSchema exactly - the real copy text from mocks/data/reports.ts, not paraphrased. */
export function buildReportCatalogue(): CatalogueEntry[] {
  const entry = (type: ReportTypeEnum, definition: string, methodology: string, dataSource: string) => ({
    reportType: toKebabCase(type),
    category: REPORT_TYPE_CATEGORY[type],
    title: REPORT_TYPE_LABELS[type],
    definition,
    methodology,
    dataSource,
  });

  return [
    entry(
      "COMPACT_PROGRESS",
      "Structured Compact progress output aligned to the agreed CPR format.",
      "Generate from approved indicator values and implementation records using the selected reporting period and filters.",
      "Key Performance Indicator repository, Compact Progress Report and Implementation Register.",
    ),
    entry(
      "COMPACT_REVIEW",
      "Structured Compact review output for periodic stakeholder review.",
      "Generate from approved indicator values and implementation records using the selected reporting period and filters.",
      "Key Performance Indicator repository, Compact Progress Report and Implementation Register.",
    ),
    entry(
      "PILLAR_PERFORMANCE",
      "Performance report at Compact pillar level.",
      "Preserve selected indicators, periods, units, baselines, targets, current values, validation status and source notes.",
      "Key Performance Indicator catalogue and value repository.",
    ),
    entry(
      "KPI_INDICATOR",
      "Indicator-level baseline-current and target-actual report.",
      "Preserve selected indicators, periods, units, baselines, targets, current values, validation status and source notes.",
      "Key Performance Indicator catalogue and value repository.",
    ),
    entry(
      "STATE_DISCO",
      "Geographic and utility delivery output by state and Distribution Company.",
      "Generate from the corresponding filtered dashboard modules and preserve the exact applied filters.",
      "Distribution Company data, Implementation Register, Bottleneck Register and financing records.",
    ),
    entry(
      "IMPLEMENTATION",
      "Delivery output across programmes, projects and milestones.",
      "Generate from the corresponding filtered dashboard modules and preserve the exact applied filters.",
      "Distribution Company data, Implementation Register, Bottleneck Register and financing records.",
    ),
    entry(
      "BOTTLENECK",
      "Exception output covering open, escalated and resolved constraints.",
      "Generate from the corresponding filtered dashboard modules and preserve the exact applied filters.",
      "Distribution Company data, Implementation Register, Bottleneck Register and financing records.",
    ),
    entry(
      "FINANCIAL",
      "Investment and financing output across programmes and projects.",
      "Generate from the corresponding filtered dashboard modules and preserve the exact applied filters.",
      "Distribution Company data, Implementation Register, Bottleneck Register and financing records.",
    ),
    entry(
      "SUBMISSION_COMPLIANCE",
      "Institutional submission performance against reporting obligations.",
      "Summarise expected, received, overdue, approved, returned, rejected and missing records by selected period.",
      "Submission and Validation Registers.",
    ),
    entry(
      "DATA_QUALITY",
      "Validation-queue and data-quality output for submitted records.",
      "Summarise expected, received, overdue, approved, returned, rejected and missing records by selected period.",
      "Submission and Validation Registers.",
    ),
    entry(
      "EXECUTIVE_BRIEF",
      "A standardised one-page summary of headline indicators, pillar progress, bottlenecks and priority actions for ministers and senior stakeholders.",
      "Reads the latest approved value of each headline indicator, counts projects and open bottlenecks per pillar, and lists the most severe bottlenecks and the priority reform actions that are not yet complete.",
      "Key Performance Indicator repository, Implementation Register, Bottleneck Register and Reform Action Register.",
    ),
  ];
}

/** Matches compactExportCardSchema exactly (2 fixed cards). */
export function buildCompactExportCards() {
  return [
    {
      id: "compact-progress-report",
      title: "Compact Progress Report export",
      definition: "Compact Progress Report-aligned output for review.",
      methodology:
        "Maps approved action, milestone, status, evidence, risk, next action and verification fields to the agreed export structure.",
      dataSource: "Compact Progress Report Master and Milestone Evidence Log.",
      reportType: "compact-progress",
    },
    {
      id: "implementation-register",
      title: "Implementation Register export",
      definition: "Filtered programme, project, milestone and action records.",
      methodology:
        "Preserves identifiers, linkages, statuses, dates, evidence, versions and validation status.",
      dataSource: "Implementation Register.",
      reportType: "implementation",
    },
  ];
}

function labelFor(options: { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export interface ReportFilterOptions {
  reportingPeriods: { value: string; label: string }[];
  pillars: { value: string; label: string }[];
  kpiCategories: { value: string; label: string }[];
  states: { value: string; label: string }[];
  distributionCompanies: { value: string; label: string }[];
  programmesOrAgencies: { value: string; label: string }[];
  validationStatuses: { value: string; label: string }[];
  readinessTiers: { value: string; label: string }[];
}

export interface ReportConfigLike {
  periods: string[];
  pillars: string[];
  kpiCategory: string;
  state: string;
  distributionCompany: string;
  programmeOrAgency: string;
  validationStatus: string;
  readinessTier: string;
}

/** Matches appliedFilterSchema[] exactly - validation status is always included, per the real mock's own comment (whether a report includes non-validated data is essential context either way). */
export function appliedFiltersFor(config: ReportConfigLike, options: ReportFilterOptions) {
  const entries: { label: string; value: string }[] = [
    {
      label: "Reporting period",
      value: config.periods.map((p) => labelFor(options.reportingPeriods, p)).join(", "),
    },
  ];

  if (!config.pillars.includes("all")) {
    entries.push({
      label: "Compact pillar",
      value: config.pillars.map((p) => labelFor(options.pillars, p)).join(", "),
    });
  }
  if (config.kpiCategory !== "all") {
    entries.push({ label: "KPI category", value: labelFor(options.kpiCategories, config.kpiCategory) });
  }
  if (config.state !== "all") {
    entries.push({ label: "State", value: labelFor(options.states, config.state) });
  }
  if (config.distributionCompany !== "all") {
    entries.push({
      label: "Distribution Company",
      value: labelFor(options.distributionCompanies, config.distributionCompany),
    });
  }
  if (config.programmeOrAgency !== "all") {
    entries.push({
      label: "Programme or agency",
      value: labelFor(options.programmesOrAgencies, config.programmeOrAgency),
    });
  }
  entries.push({
    label: "Validation status",
    value:
      config.validationStatus === "all"
        ? "All (includes non-validated)"
        : labelFor(options.validationStatuses, config.validationStatus),
  });
  if (config.readinessTier !== "all") {
    entries.push({ label: "Readiness tier", value: labelFor(options.readinessTiers, config.readinessTier) });
  }

  return entries;
}

export function validationStatusLabelFor(config: ReportConfigLike, options: ReportFilterOptions): string {
  return config.validationStatus === "all"
    ? "All (includes non-validated)"
    : labelFor(options.validationStatuses, config.validationStatus);
}

export function periodsLabel(config: ReportConfigLike, options: ReportFilterOptions): string {
  return config.periods.map((p) => labelFor(options.reportingPeriods, p)).join(" vs ");
}

export function matchesPillars(config: ReportConfigLike, pillar: string): boolean {
  return config.pillars.includes("all") || config.pillars.includes(pillar);
}

/**
 * Identifies "the same report configuration" for the version-increment rule
 * - excludes format (switching PDF<->XLSX is still "the same report
 * regenerated"), matches the real mock's own configSignature() exactly.
 */
export function configSignature(config: ReportConfigLike & { reportType: string }): string {
  return JSON.stringify({
    reportType: config.reportType,
    periods: [...config.periods].sort(),
    pillars: [...config.pillars].sort(),
    kpiCategory: config.kpiCategory,
    state: config.state,
    distributionCompany: config.distributionCompany,
    programmeOrAgency: config.programmeOrAgency,
    validationStatus: config.validationStatus,
    readinessTier: config.readinessTier,
  });
}

/** Ordinal column labels counting back from "Current" - deliberately not calendar-quarter labels, matching the real mock's own trailingPeriodLabels() and its reasoning (not every indicator's history[] periods line up one-to-one). */
export function trailingPeriodLabels(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const stepsBack = count - 1 - index;
    if (stepsBack === 0) return "Current";
    if (stepsBack === 1) return "Previous";
    return `${stepsBack} periods ago`;
  });
}
