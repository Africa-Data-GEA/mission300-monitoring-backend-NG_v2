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
  changeTone,
  formatBriefChange,
  formatBriefValue,
  rankActions,
  rankBottlenecks,
  type BriefAction,
  type BriefBottleneck,
  type BriefData,
  type BriefIndicator,
  type BriefPillar,
} from "@/modules/reports/executive-brief";

export interface BriefSection {
  title: string;
  columns: string[];
  rows: string[][];
}

const AT_RISK_PROJECT_STATUSES = ["AT_RISK", "DELAYED", "BLOCKED"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export function toBriefSections(brief: BriefData): BriefSection[] {
  const { glance } = brief;
  return [
    {
      title: "At a glance",
      columns: ["Measure", "Status"],
      rows: [
        ["Headline indicators reported", `${glance.indicatorsReported} of ${glance.indicatorsTotal}`],
        ["Projects at risk, delayed or blocked", String(glance.projectsAtRisk)],
        ["Open critical or high bottlenecks", String(glance.criticalBottlenecks)],
        ["Priority actions delayed or at risk", String(glance.delayedActions)],
      ],
    },
    {
      title: "Headline indicators",
      columns: ["Indicator", "Latest", "Period", "Change", "Target"],
      rows: brief.indicators.map((indicator) => [
        indicator.name,
        indicator.value ?? "Not yet reported",
        indicator.period ?? "—",
        indicator.change ?? "—",
        indicator.target ?? "—",
      ]),
    },
    {
      title: "Progress by pillar",
      columns: ["Pillar", "Projects", "On track or complete", "At risk or delayed", "Open bottlenecks"],
      rows: brief.pillars.map((pillar) => [
        pillar.name,
        String(pillar.projects),
        String(pillar.onTrack),
        String(pillar.atRisk),
        String(pillar.bottlenecks),
      ]),
    },
    {
      title: "Bottlenecks requiring action",
      columns: ["Issue", "Severity", "Pillar", "Age (days)", "Status"],
      rows: brief.bottlenecks.length
        ? brief.bottlenecks.map((item) => [item.issue, item.severity, item.pillar, String(item.ageDays), item.status])
        : [["No open bottlenecks are recorded.", "—", "—", "—", "—"]],
    },
    {
      title: "Priority actions",
      columns: ["Action", "Lead institution", "Due", "Status"],
      rows: brief.actions.length
        ? brief.actions.map((item) => [item.action, item.lead || "—", item.due ?? "—", item.status])
        : [["No reform actions are outstanding.", "—", "—", "—"]],
    },
  ];
}

@Injectable()
export class ExecutiveBriefService {
  constructor(private readonly prisma: PrismaService) {}

  async build(config: ReportConfigLike): Promise<{ sections: BriefSection[]; brief: BriefData }> {
    const [indicators, pillars, bottlenecks, actions] = await Promise.all([
      this.headlineIndicators(config),
      this.pillarProgress(config),
      this.bottlenecksNeedingAction(config),
      this.priorityActions(config),
    ]);

    const brief: BriefData = {
      glance: {
        indicatorsReported: indicators.reported,
        indicatorsTotal: indicators.items.length,
        projectsAtRisk: pillars.atRiskProjects,
        criticalBottlenecks: bottlenecks.open,
        delayedActions: actions.delayed,
      },
      indicators: indicators.items,
      pillars: pillars.items,
      bottlenecks: bottlenecks.items,
      actions: actions.items,
    };
    return { sections: toBriefSections(brief), brief };
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
    const items: BriefIndicator[] = [];
    for (const code of HEADLINE_KPI_CODES) {
      const definition = byCode.get(code);
      if (!definition || !matchesPillars(config, definition.pillar.slug)) continue;

      const ordered = [...(valuesByKpi.get(definition.id) ?? [])].sort(compareReportingValues);
      const latest = ordered.at(-1);
      const previous = [...ordered].reverse().find((value) => value.period !== latest?.period);
      if (latest) reported += 1;

      const hasChange = latest !== undefined && previous !== undefined;
      items.push({
        name: definition.name,
        value: latest ? formatBriefValue(Number(latest.value), definition.unit) : null,
        period: latest ? formatPeriodLabel(latest.period) : null,
        change: hasChange ? formatBriefChange(Number(latest.value), Number(previous.value), definition.unit) : null,
        tone: hasChange ? changeTone(Number(latest.value) - Number(previous.value), definition.direction) : "neutral",
        target: definition.target !== null ? formatBriefValue(Number(definition.target), definition.unit) : null,
      });
    }

    return { reported, items };
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
    const items: BriefPillar[] = pillars
      .filter((pillar) => matchesPillars(config, pillar.slug))
      .map((pillar) => {
        const own = projects.filter((project) => project.pillar.slug === pillar.slug);
        const onTrack = own.filter((project) => project.currentStatus === "ON_TRACK" || project.currentStatus === "COMPLETED").length;
        const atRisk = own.filter((project) =>
          (AT_RISK_PROJECT_STATUSES as readonly string[]).includes(project.currentStatus),
        ).length;
        atRiskProjects += atRisk;
        const open = bottlenecks.filter((bottleneck) => bottleneck.pillar.slug === pillar.slug).length;
        return { name: pillar.name, projects: own.length, onTrack, atRisk, bottlenecks: open };
      });

    return { atRiskProjects, items };
  }

  private async bottlenecksNeedingAction(config: ReportConfigLike) {
    const now = Date.now();
    const records = await this.prisma.bottleneck.findMany({
      where: { status: { not: "RESOLVED" } },
      include: { pillar: true },
    });
    const scoped = records.filter((record) => matchesPillars(config, record.pillar.slug));
    const open = scoped.filter((record) => record.severity === "CRITICAL" || record.severity === "HIGH").length;
    const items: BriefBottleneck[] = rankBottlenecks(scoped)
      .slice(0, BRIEF_BOTTLENECK_LIMIT)
      .map((record) => ({
        issue: record.issue,
        severity: toKebabCase(record.severity),
        pillar: record.pillar.name,
        ageDays: Math.max(0, Math.floor((now - record.dateRaised.getTime()) / DAY_MS)),
        status: toKebabCase(record.status),
      }));

    return { open, items };
  }

  private async priorityActions(config: ReportConfigLike) {
    const records = await this.prisma.reformAction.findMany({
      where: { status: { not: "COMPLETED" } },
      include: { pillar: true },
    });
    const scoped = records.filter((record) => matchesPillars(config, record.pillar.slug));
    const delayed = scoped.filter(
      (record) => record.isPriority && (record.status === "DELAYED" || record.status === "IN_PROGRESS_AT_RISK"),
    ).length;
    const items: BriefAction[] = rankActions(scoped)
      .slice(0, BRIEF_ACTION_LIMIT)
      .map((record) => ({
        action: record.action,
        lead: record.leadInstitution,
        due: record.dueDate ? record.dueDate.toISOString().slice(0, 10) : null,
        status: toKebabCase(record.status),
      }));

    return { delayed, items };
  }
}
