import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { assertOperationalInstitutionAccess } from "@/common/guards/operational-scope";
import { resolveBottleneckVisibility } from "@/modules/bottlenecks/bottlenecks-visibility";
import { programmeVisibleTo, projectVisibleTo, resolveReadScope } from "@/modules/programs/programs-visibility";
import { BottleneckCategory, EscalationStatus, LifecycleStage, RegisterSeverity } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service";
import { paginate } from "@/modules/administration/overview/overview.mappers";
import { toKebabCase } from "@/common/utils/enum-casing";
import { loadBottleneckLinks, toBottleneckRecord, toEscalationRecord } from "@/modules/bottlenecks/bottlenecks.mappers";
import type { BottlenecksQueryDto } from "@/modules/bottlenecks/dto/bottlenecks-query.dto";
import type { CreateBottleneckDto } from "@/modules/bottlenecks/dto/create-bottleneck.dto";
import type { UpdateBottleneckStatusDto } from "@/modules/bottlenecks/dto/update-bottleneck-status.dto";

const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_ESCALATION_PAGE_SIZE = 10;

const BOTTLENECK_INCLUDE = { pillar: true, statusHistory: true } as const;

const CATEGORIES = Object.values(BottleneckCategory);
const STAGES = Object.values(LifecycleStage);
const SEVERITIES = Object.values(RegisterSeverity);

function currentPeriodLabel(): string {
  return new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function titleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

@Injectable()
export class BottlenecksService {
  constructor(private readonly prisma: PrismaService) {}

  async getFilters(user: AuthenticatedUser) {
    const visible = await resolveBottleneckVisibility(this.prisma, user);
    const scope = await resolveReadScope(this.prisma, user);
    const registered =
      scope === null
        ? await this.prisma.institution.findMany({ select: { name: true }, orderBy: { name: "asc" } })
        : scope === "none"
          ? []
          : [{ name: scope.name }];
    const [pillars, institutions, linkedRecords, programmes, projects] = await Promise.all([
      this.prisma.pillar.findMany({ orderBy: { name: "asc" } }),
      this.prisma.bottleneck.findMany({ where: visible, select: { institution: true }, distinct: ["institution"] }),
      this.prisma.bottleneck.findMany({
        where: { AND: [visible, { linkedRecord: { not: "" } }] },
        select: { linkedRecord: true },
        distinct: ["linkedRecord"],
      }),
      this.prisma.programme.findMany({ where: programmeVisibleTo(scope), select: { id: true, name: true }, orderBy: { name: "asc" } }),
      this.prisma.project.findMany({ where: projectVisibleTo(scope), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const withAll = (label: string, options: { value: string; label: string }[]) => [
      { value: "all", label: `All ${label}` },
      ...options,
    ];

    return {
      severities: withAll(
        "severities",
        SEVERITIES.map((s) => ({ value: toKebabCase(s), label: titleCase(toKebabCase(s)) })),
      ),
      categories: withAll(
        "categories",
        CATEGORIES.map((c) => ({ value: toKebabCase(c), label: titleCase(toKebabCase(c)) })),
      ),
      institutions: withAll(
        "institutions",
        institutions
          .map((i) => ({ value: i.institution, label: i.institution }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      ),
      responsibleInstitutions: registered.map((i) => ({ value: i.name, label: i.name })),
      pillars: withAll(
        "pillars",
        pillars.map((p) => ({ value: p.slug, label: p.name })),
      ),
      linkedRecords: withAll(
        "linked records",
        linkedRecords.map((r) => ({ value: r.linkedRecord, label: r.linkedRecord })),
      ),
      programmes: programmes.map((p) => ({ value: p.id, label: p.name })),
      projects: projects.map((p) => ({ value: p.id, label: p.name })),
      lifecycleStages: withAll(
        "stages",
        STAGES.map((s) => ({ value: toKebabCase(s), label: titleCase(toKebabCase(s)) })),
      ),
      escalationStatuses: withAll(
        "escalation statuses",
        Object.values(EscalationStatus).map((s) => ({
          value: toKebabCase(s),
          label: titleCase(toKebabCase(s)),
        })),
      ),
      // No real validationStatus/reportingPeriod field exists on a
      // bottleneck record (confirmed against bottlenecks.ts directly) - no
      // real data to build these two groups from, so they're static,
      // matching the frontend mock's own hardcoded content for the same
      // two groups exactly.
      validationStatuses: [
        { value: "all", label: "All validation statuses" },
        { value: "confirmed", label: "Confirmed" },
        { value: "requires-validation", label: "Requires validation" },
      ],
      reportingPeriods: [{ value: "all-time", label: "All time" }],
    };
  }

  async getOverview(user: AuthenticatedUser, query: BottlenecksQueryDto) {
    const now = new Date();
    const visible = await resolveBottleneckVisibility(this.prisma, user);
    const [register, escalations] = await Promise.all([
      this.prisma.bottleneck.findMany({ where: visible, include: BOTTLENECK_INCLUDE, orderBy: { dateRaised: "desc" } }),
      this.prisma.escalation.findMany({ where: { bottleneck: visible }, orderBy: { dueDate: "asc" } }),
    ]);

    // "Open" excludes both resolved AND blocked, matching the frontend
    // mock's own buildOverview() exactly - Section C/D describe open
    // (still-moving) constraints, not every unresolved one.
    const open = register.filter(
      (b) => b.status === "OPEN" || b.status === "IN_PROGRESS" || b.status === "ESCALATED",
    );
    const openHighOrCritical = open.filter((b) => b.severity === "CRITICAL" || b.severity === "HIGH");
    const delayed = register.filter((b) => b.status === "IN_PROGRESS");
    const blocked = register.filter((b) => b.status === "BLOCKED");
    const overdueEscalations = escalations.filter((e) => e.status === "OVERDUE");

    const provenance = (definition: string, methodology: string, source: string) => ({
      definition,
      methodology,
      source,
      lastUpdated: now.toISOString(),
    });
    const noPriorPeriodTrend = () => ({
      change: 0,
      label: "No prior period recorded yet",
      direction: "lower-is-better" as const,
    });
    const ageDaysOf = (b: (typeof register)[number]) =>
      Math.floor((now.getTime() - b.dateRaised.getTime()) / (24 * 60 * 60 * 1000));

    const alerts = [
      {
        id: "open-high-critical",
        title: "Open high or critical bottlenecks",
        count: openHighOrCritical.length,
        targetLabel: "Zero unresolved high or critical bottlenecks",
        supportingLabel:
          openHighOrCritical.length === 0
            ? "None open"
            : `median ${median(openHighOrCritical.map(ageDaysOf))} days open`,
        trend: noPriorPeriodTrend(),
        provenance: provenance(
          "Open bottlenecks classified High or Critical.",
          "Count unique unresolved bottleneck records at the selected severities.",
          "Bottleneck Register.",
        ),
      },
      {
        id: "delayed-priority",
        title: "Delayed priority records",
        count: delayed.length,
        targetLabel: "Zero delayed priority records",
        supportingLabel:
          delayed.length === 0
            ? "None delayed"
            : `average ${Math.round(delayed.map(ageDaysOf).reduce((a, b) => a + b, 0) / delayed.length)} days open`,
        trend: noPriorPeriodTrend(),
        provenance: provenance(
          "Priority implementation records currently delayed.",
          "Count unique priority records with Delayed status.",
          "Implementation Register.",
        ),
      },
      {
        id: "blocked-priority",
        title: "Blocked priority records",
        count: blocked.length,
        targetLabel: "Zero blocked priority records",
        supportingLabel: `affects ${new Set(blocked.map((b) => b.pillar.slug)).size} pillar${new Set(blocked.map((b) => b.pillar.slug)).size === 1 ? "" : "s"}`,
        trend: noPriorPeriodTrend(),
        provenance: provenance(
          "Priority records that cannot progress because of an unresolved dependency or constraint.",
          "Count unique priority records with Blocked status.",
          "Implementation Register and Bottleneck Register.",
        ),
      },
      {
        id: "overdue-escalations",
        title: "Overdue escalations or decisions",
        count: overdueEscalations.length,
        targetLabel: "Zero overdue escalation actions or decisions",
        supportingLabel:
          overdueEscalations.length === 0
            ? "None overdue"
            : `oldest: ${Math.max(...overdueEscalations.map((e) => Math.floor((now.getTime() - e.dueDate.getTime()) / (24 * 60 * 60 * 1000))))} days overdue`,
        trend: noPriorPeriodTrend(),
        provenance: provenance(
          "Escalation actions or leadership decisions past their due date.",
          "Count unresolved escalation records whose due date is earlier than the reporting date.",
          "Bottleneck Register and escalation tracker.",
        ),
      },
    ];

    const search = query.search?.trim().toLowerCase() ?? "";
    const severity = query.severity ?? "all";
    const category = query.category ?? "all";
    const institution = query.institution ?? "all";
    const pillar = query.pillar ?? "all";
    const linkedRecord = query.linkedRecord ?? "all";
    const lifecycleStage = query.lifecycleStage ?? "all";
    const escalationStatus = query.escalationStatus ?? "all";

    const filtered = register.filter((b) => {
      const matchesSearch =
        !search || [b.id, b.issue, b.institution].some((field) => field.toLowerCase().includes(search));
      return (
        matchesSearch &&
        (severity === "all" || toKebabCase(b.severity) === severity) &&
        (category === "all" || toKebabCase(b.category) === category) &&
        (institution === "all" || b.institution === institution) &&
        (pillar === "all" || b.pillar.slug === pillar) &&
        (linkedRecord === "all" || b.linkedRecord === linkedRecord) &&
        (lifecycleStage === "all" || toKebabCase(b.lifecycleStage) === lifecycleStage) &&
        (escalationStatus === "all" || toKebabCase(b.escalationStatus) === escalationStatus)
      );
    });

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const registerPage = paginate(filtered, page, pageSize);
    const links = await loadBottleneckLinks(
      this.prisma,
      registerPage.items.map((b) => b.linkedRecord),
    );

    const escalationPage = query.escalationPage ?? 1;
    const escalationsPaged = paginate(escalations, escalationPage, DEFAULT_ESCALATION_PAGE_SIZE);

    return {
      lastUpdated: now.toISOString(),
      alerts,
      register: {
        items: registerPage.items.map((b) => toBottleneckRecord(b, now, links)),
        page: registerPage.page,
        pageSize: registerPage.pageSize,
        total: registerPage.total,
      },
      byCategory: CATEGORIES.map((cat) => ({
        category: toKebabCase(cat),
        label: titleCase(toKebabCase(cat)),
        count: open.filter((b) => b.category === cat).length,
      })),
      byLifecycleStage: STAGES.map((stage) => {
        const rows = open.filter((b) => b.lifecycleStage === stage);
        return {
          stage: toKebabCase(stage),
          label: titleCase(toKebabCase(stage)),
          total: rows.length,
          bySeverity: SEVERITIES.map((sev) => ({
            severity: toKebabCase(sev),
            count: rows.filter((b) => b.severity === sev).length,
          })),
        };
      }),
      byInstitution: [...new Set(open.map((b) => b.institution))]
        .map((inst) => {
          const rows = open.filter((b) => b.institution === inst);
          return {
            institution: inst,
            openCount: rows.length,
            criticalOrHighCount: rows.filter((b) => b.severity === "CRITICAL" || b.severity === "HIGH")
              .length,
          };
        })
        .sort((a, b) => b.criticalOrHighCount - a.criticalOrHighCount),
      escalations: {
        items: escalationsPaged.items.map((e) => toEscalationRecord(e, now)),
        page: escalationsPaged.page,
        pageSize: escalationsPaged.pageSize,
        total: escalationsPaged.total,
      },
    };
  }

  async create(user: AuthenticatedUser, dto: CreateBottleneckDto) {
    await assertOperationalInstitutionAccess(this.prisma, user, dto.institution);
    const linkedRecord = dto.linkedRecord?.trim() ?? "";
    if (linkedRecord) await this.assertLinkTarget(user, linkedRecord);
    const pillar = await this.prisma.pillar.findUnique({ where: { slug: dto.pillar } });
    if (!pillar) throw new NotFoundException("Unknown pillar.");

    const bottleneck = await this.prisma.bottleneck.create({
      data: {
        issue: dto.issue.trim(),
        category: dto.category,
        severity: dto.severity,
        pillarId: pillar.id,
        linkedRecord,
        institution: dto.institution.trim(),
        followUp: dto.followUp?.trim() ?? "",
        escalationStatus: "NOT_ESCALATED",
        status: "OPEN",
        lifecycleStage: dto.lifecycleStage,
      },
      include: BOTTLENECK_INCLUDE,
    });

    const links = await loadBottleneckLinks(this.prisma, [bottleneck.linkedRecord]);
    return {
      record: toBottleneckRecord(bottleneck, new Date(), links),
      message: `${bottleneck.id} has been added to the bottleneck register.`,
    };
  }

  private async assertLinkTarget(user: AuthenticatedUser, id: string) {
    const project = await this.prisma.project.findUnique({ where: { id }, select: { owner: true } });
    if (project) {
      await assertOperationalInstitutionAccess(this.prisma, user, project.owner);
      return;
    }
    const scope = await resolveReadScope(this.prisma, user);
    const programme = await this.prisma.programme.findFirst({
      where: { id, ...programmeVisibleTo(scope) },
      select: { id: true },
    });
    if (!programme) {
      throw new BadRequestException("Select a project or programme from the list.");
    }
  }

  async updateStatus(user: AuthenticatedUser, id: string, dto: UpdateBottleneckStatusDto) {
    const existing = await this.prisma.bottleneck.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("The bottleneck was not found.");

    await assertOperationalInstitutionAccess(this.prisma, user, existing.institution);

    const statusChanged = dto.status !== existing.status;

    const bottleneck = await this.prisma.bottleneck.update({
      where: { id, institution: existing.institution },
      data: {
        status: dto.status,
        followUp: dto.followUp !== undefined ? dto.followUp.trim() : existing.followUp,
        ...(statusChanged
          ? { statusHistory: { create: { period: currentPeriodLabel(), status: dto.status } } }
          : {}),
      },
      include: BOTTLENECK_INCLUDE,
    });

    const links = await loadBottleneckLinks(this.prisma, [bottleneck.linkedRecord]);
    return { record: toBottleneckRecord(bottleneck, new Date(), links) };
  }

  async delete(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.bottleneck.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("The bottleneck was not found.");
      await tx.escalation.deleteMany({ where: { bottleneckId: id } });
      // Status history is removed by its foreign key's ON DELETE CASCADE.
      await tx.bottleneck.delete({ where: { id } });
    });
  }

  async getByProject(user: AuthenticatedUser, projectId: string, query: BottlenecksQueryDto) {
    const scope = await resolveReadScope(this.prisma, user);
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...projectVisibleTo(scope) } });
    if (!project) throw new NotFoundException("The project was not found.");

    const now = new Date();
    const bottlenecks = await this.prisma.bottleneck.findMany({
      where: { linkedRecord: projectId },
      include: BOTTLENECK_INCLUDE,
      orderBy: { dateRaised: "desc" },
    });

    const links = await loadBottleneckLinks(this.prisma, [projectId]);
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    return paginate(
      bottlenecks.map((b) => toBottleneckRecord(b, now, links)),
      query.page ?? 1,
      pageSize,
    );
  }
}
