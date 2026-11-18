import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/prisma/prisma.service";
import { toKebabCase } from "@/common/utils/enum-casing";
import { compareReportingValues } from "@/common/utils/reporting-period";
import { formatPeriodLabel } from "@/modules/kpi-explorer/kpi-explorer.mappers";
import { matchesPillars, type ReportConfigLike } from "@/modules/reports/reports.mappers";
import {
  BRIEF_ACTION_LIMIT,
  BRIEF_BOTTLENECK_LIMIT,
  HEADLINE_KPI_CODES,
  formatBriefChange,
  formatBriefValue,
  rankActions,
  rankBottlenecks,
} from "@/modules/reports/executive-brief";

export interface BriefSection {
  title: string;
  columns: string[];
  rows: string[][];
}

const AT_RISK_PROJECT_STATUSES = ["AT_RISK", "DELAYED", "BLOCKED"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ExecutiveBriefService {
  constructor(private readonly prisma: PrismaService) {}

  async sections(config: ReportConfigLike): Promise<BriefSection[]> {
    const [indicators, pillars, bottlenecks, actions] = await Promise.all([
      this.headlineIndicators(config),
      this.pillarProgress(config),
      this.bottlenecksNeedingAction(config),
      this.priorityActions(config),
    ]);

    return [
      this.atAGlance(indicators.reported, indicators.total, pillars.atRiskProjects, bottlenecks.open, actions.delayed),
      indicators.section,
      pillars.section,
      bottlenecks.section,
      actions.section,
    ];
  }

  private atAGlance(reported: number, total: number, atRisk: number, openBottlenecks: number, delayedActions: number): BriefSection {
    return {
      title: "At a glance",
      columns: ["Measure", "Status"],
      rows: [
        ["Headline indicators reported", `${reported} of ${total}`],
        ["Projects at risk, delayed or blocked", String(atRisk)],
        ["Open critical or high bottlenecks", String(openBottlenecks)],
        ["Priority actions delayed or at risk", String(delayedActions)],
      ],
    };
  }

  private async headlineIndicators(config: ReportConfigLike) {
    const selectedPeriods = config.periods.includes("all") ? null : config.periods;
    const definitions = await this.prisma.kpiDefinition.findMany({
      where: { code: { in: [...HEADLINE_KPI_CODES] }, isActive: true },
      include: { pillar: true },
    });
    const byCode = new Map(definitions.map((definition) => [definition.code, definition]));
    const values = await this.prisma.kpiValue.findMany({
      where: {
        kpiDefinitionId: { in: definitions.map((definition) => definition.id) },
        ...(selectedPeriods ? { period: { in: selectedPeriods } } : {}),
      },
    });

    const valuesByKpi = new Map<string, typeof values>();
    for (const value of values) {
      valuesByKpi.set(value.kpiDefinitionId, [...(valuesByKpi.get(value.kpiDefinitionId) ?? []), value]);
    }

    let reported = 0;
    const rows: string[][] = [];
    for (const code of HEADLINE_KPI_CODES) {
      const definition = byCode.get(code);
      if (!definition || !matchesPillars(config, definition.pillar.slug)) continue;

      const ordered = [...(valuesByKpi.get(definition.id) ?? [])].sort(compareReportingValues);
      const latest = ordered.at(-1);
      const previous = [...ordered].reverse().find((value) => value.period !== latest?.period);
      if (latest) reported += 1;

      rows.push([
        definition.name,
        latest ? formatBriefValue(Number(latest.value), definition.unit) : "Not yet reported",
        latest ? formatPeriodLabel(latest.period) : "—",
        latest && previous ? formatBriefChange(Number(latest.value), Number(previous.value), definition.unit) : "—",
        definition.target !== null ? formatBriefValue(Number(definition.target), definition.unit) : "—",
      ]);
    }

    return {
      reported,
      total: rows.length,
      section: {
        title: "Headline indicators",
        columns: ["Indicator", "Latest", "Period", "Change", "Target"],
        rows,
      },
    };
  }

  private async pillarProgress(config: ReportConfigLike) {
    const [pillars, projects, bottlenecks] = await Promise.all([
      this.prisma.pillar.findMany({ orderBy: { name: "asc" } }),
      this.prisma.project.findMany({ select: { currentStatus: true, pillar: { select: { slug: true } } } }),
      this.prisma.bottleneck.findMany({
        where: { status: { not: "RESOLVED" } },
        select: { pillar: { select: { slug: true } } },
      }),
    ]);

    let atRiskProjects = 0;
    const rows = pillars
      .filter((pillar) => matchesPillars(config, pillar.slug))
      .map((pillar) => {
        const own = projects.filter((project) => project.pillar.slug === pillar.slug);
        const onTrack = own.filter((project) => project.currentStatus === "ON_TRACK" || project.currentStatus === "COMPLETED").length;
        const atRisk = own.filter((project) =>
          (AT_RISK_PROJECT_STATUSES as readonly string[]).includes(project.currentStatus),
        ).length;
        atRiskProjects += atRisk;
        const open = bottlenecks.filter((bottleneck) => bottleneck.pillar.slug === pillar.slug).length;
        return [pillar.name, String(own.length), String(onTrack), String(atRisk), String(open)];
      });

    return {
      atRiskProjects,
      section: {
        title: "Progress by pillar",
        columns: ["Pillar", "Projects", "On track or complete", "At risk or delayed", "Open bottlenecks"],
        rows,
      },
    };
  }

  private async bottlenecksNeedingAction(config: ReportConfigLike) {
    const now = Date.now();
    const records = await this.prisma.bottleneck.findMany({
      where: { status: { not: "RESOLVED" } },
      include: { pillar: true },
    });
    const scoped = records.filter((record) => matchesPillars(config, record.pillar.slug));
    const open = scoped.filter((record) => record.severity === "CRITICAL" || record.severity === "HIGH").length;
    const rankedBottlenecks = rankBottlenecks(scoped).slice(0, BRIEF_BOTTLENECK_LIMIT);

    return {
      open,
      section: {
        title: "Bottlenecks requiring action",
        columns: ["Issue", "Severity", "Pillar", "Age (days)", "Status"],
        rows: rankedBottlenecks.length
          ? rankedBottlenecks.map((record) => [
              record.issue,
              toKebabCase(record.severity),
              record.pillar.name,
              String(Math.max(0, Math.floor((now - record.dateRaised.getTime()) / DAY_MS))),
              toKebabCase(record.status),
            ])
          : [["No open bottlenecks are recorded.", "—", "—", "—", "—"]],
      },
    };
  }

  private async priorityActions(config: ReportConfigLike) {
    const records = await this.prisma.reformAction.findMany({
      where: { status: { not: "COMPLETED" } },
      include: { pillar: true },
    });
    const scoped = records.filter((record) => matchesPillars(config, record.pillar.slug));
    const ranked = rankActions(scoped);
    const delayed = scoped.filter(
      (record) => record.isPriority && (record.status === "DELAYED" || record.status === "IN_PROGRESS_AT_RISK"),
    ).length;

    return {
      delayed,
      section: {
        title: "Priority actions",
        columns: ["Action", "Lead institution", "Due", "Status"],
        rows: ranked.length
          ? ranked.slice(0, BRIEF_ACTION_LIMIT).map((record) => [
              record.action,
              record.leadInstitution || "—",
              record.dueDate ? record.dueDate.toISOString().slice(0, 10) : "—",
              toKebabCase(record.status),
            ])
          : [["No reform actions are outstanding.", "—", "—", "—"]],
      },
    };
  }
}
