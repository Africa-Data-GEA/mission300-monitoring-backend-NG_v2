import type {
  Institution,
  Milestone,
  Pillar,
  Programme,
  Project,
  ProjectDocument,
  ProjectStatusHistoryEntry,
  ProjectUpdate,
} from "@prisma/client";
import { toKebabCase } from "@/common/utils/enum-casing";

const UNASSIGNED_CONTACT_EMAIL = "unassigned@example.gov.ng";
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function projectContact(project: Pick<Project, "contactName" | "contactEmail" | "leadName">) {
  return {
    contactName: project.contactName.trim() || project.leadName.trim() || "Not assigned",
    contactEmail: EMAIL_PATTERN.test(project.contactEmail.trim()) ? project.contactEmail.trim() : UNASSIGNED_CONTACT_EMAIL,
  };
}

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

type ProgrammeWithPillar = Programme & {
  pillar: Pillar;
  leadInstitutionRecord?: Institution | null;
};

/** Matches programmeRecordSchema exactly (m300-frontend/src/api/schemas/programs.ts). */
export function toProgrammeRecord(p: ProgrammeWithPillar, bottleneckIds: string[]) {
  return {
    id: p.id,
    name: p.name,
    leadInstitution: p.leadInstitution,
    leadInstitutionRecord: p.leadInstitutionRecord
      ? { id: p.leadInstitutionRecord.id, name: p.leadInstitutionRecord.name }
      : null,
    supportingInstitutions: p.supportingInstitutions,
    pillar: p.pillar.slug,
    objectives: p.objectives,
    financing: p.financing,
    status: toKebabCase(p.status),
    priority: toKebabCase(p.priority),
    startDate: p.startDate.toISOString(),
    endDate: p.endDate.toISOString(),
    bottlenecks: bottleneckIds,
    bottleneckCategory: p.bottleneckCategory ? toKebabCase(p.bottleneckCategory) : null,
    validationStatus: toKebabCase(p.validationStatus),
    lastUpdate: p.updatedAt.toISOString(),
  };
}

type ProjectFull = Project & {
  pillar: Pillar;
  programme: Programme;
  statusHistory: ProjectStatusHistoryEntry[];
  documents: ProjectDocument[];
  updates: ProjectUpdate[];
};

/** Matches projectRecordSchema exactly, including its nested `profile`. */
export function toProjectRecord(p: ProjectFull, bottleneckIds: string[]) {
  return {
    id: p.id,
    name: p.name,
    programmeId: p.programmeId,
    programmeName: p.programme.name,
    owner: p.owner,
    leadName: p.leadName,
    location: p.location,
    coverage: p.coverage,
    pillar: p.pillar.slug,
    lifecycleStage: toKebabCase(p.lifecycleStage),
    programType: toKebabCase(p.programType),
    fundingSource: p.fundingSource,
    fundingStructure: p.fundingStructure,
    fundingStatus: toKebabCase(p.fundingStatus),
    pipelineReadiness: p.pipelineReadiness ? toKebabCase(p.pipelineReadiness) : null,
    projectedStatus: toKebabCase(p.projectedStatus),
    currentStatus: toKebabCase(p.currentStatus),
    startDate: p.startDate.toISOString(),
    endDate: p.endDate ? p.endDate.toISOString() : null,
    evidenceUrl: p.evidenceUrl,
    bottlenecks: bottleneckIds,
    bottleneckCategory: p.bottleneckCategory ? toKebabCase(p.bottleneckCategory) : null,
    comment: p.comment,
    suggestion: p.suggestion,
    validationStatus: toKebabCase(p.validationStatus),
    profile: {
      description: p.description,
      budgetUsd: toNumber(p.budgetUsd),
      disbursedUsd: toNumber(p.disbursedUsd),
      contractor: p.contractor,
      ...projectContact(p),
      documents: p.documents.map((d) => ({ label: d.label, url: d.url })),
      updates: p.updates.map((u) => ({ date: u.date.toISOString(), note: u.note })),
    },
    statusHistory: p.statusHistory.map((h) => ({ period: h.period, status: toKebabCase(h.status) })),
  };
}

type MilestoneWithProject = Milestone & { project: Project };

/** Matches milestoneRecordSchema exactly. */
export function toMilestoneRecord(m: MilestoneWithProject) {
  return {
    id: m.id,
    name: m.name,
    projectId: m.projectId,
    projectName: m.project.name,
    priority: toKebabCase(m.priority),
    expectedDate: m.expectedDate.toISOString(),
    actualDate: m.actualDate ? m.actualDate.toISOString() : null,
    status: toKebabCase(m.status),
    leadInstitution: m.leadInstitution,
    evidenceUrl: m.evidenceUrl,
    risk: m.risk,
    nextAction: m.nextAction,
    bottleneckCategory: m.bottleneckCategory ? toKebabCase(m.bottleneckCategory) : null,
    validationStatus: toKebabCase(m.validationStatus),
  };
}

const PROVENANCE_NOW = () => new Date().toISOString();

function provenance(definition: string, methodology: string, source: string) {
  return { definition, methodology, source, lastUpdated: PROVENANCE_NOW() };
}

// No reporting-period snapshot table exists yet to compare against a prior
// cycle (unlike the frontend mock, which hardcodes "+2 vs Q2 2025" etc with
// no real backing data at all - see buildOverview() in mocks/data/
// programs.ts). change: 0 is the honest value until a real snapshot history
// exists to diff against - same "don't invent a number" rule as everywhere
// else in this codebase.
function noPriorPeriodTrend(direction: "higher-is-better" | "lower-is-better") {
  return { change: 0, label: "No prior period recorded yet", direction };
}

type MilestoneForCard = Pick<Milestone, "priority" | "expectedDate" | "status" | "actualDate">;
type ProjectForCard = Pick<Project, "currentStatus" | "evidenceUrl" | "updatedAt"> & { id: string };
type MilestoneForEvidence = Pick<Milestone, "status" | "evidenceUrl" | "updatedAt"> & { id: string };

/**
 * Matches programsHeadlineCardsSchema exactly - the four named fields from
 * docs/specs/implementation-register.md Section A. The computation mirrors
 * buildOverview() in the frontend's own mock (mocks/data/programs.ts)
 * field-for-field: due/completed/delayed/blocked priority-milestone counts,
 * delayed-or-blocked across all three record types, and evidence/update
 * gaps across projects and milestones - so this backend reproduces the same
 * real logic the frontend was built and tested against, not an approximation.
 */
export function buildHeadlineCards(
  programmes: { status: string; pillar: string }[],
  projects: ProjectForCard[],
  milestones: MilestoneForCard[],
  evidenceCandidates: (ProjectForCard | MilestoneForEvidence)[],
) {
  const now = new Date();

  const activeProgrammes = programmes.filter((p) => p.status !== "COMPLETED").length;
  const activeProjects = projects.filter((p) => p.currentStatus !== "COMPLETED").length;

  const priorityMilestones = milestones.filter((m) => m.priority === "PRIORITY");
  const dueMilestones = priorityMilestones.filter((m) => m.expectedDate <= now);
  const completedOnTime = dueMilestones.filter(
    (m) => m.status === "COMPLETED" && m.actualDate !== null && m.actualDate <= m.expectedDate,
  );
  const delayedMilestones = dueMilestones.filter((m) => m.status === "DELAYED" || m.status === "AT_RISK");
  const blockedMilestones = dueMilestones.filter((m) => m.status === "BLOCKED");
  const percentOnTime =
    dueMilestones.length === 0 ? 0 : Math.round((completedOnTime.length / dueMilestones.length) * 100);

  const allStatuses = [
    ...programmes.map((p) => p.status),
    ...projects.map((p) => p.currentStatus),
    ...milestones.map((m) => m.status),
  ];
  const delayedOrBlockedCount = allStatuses.filter((s) => s === "DELAYED" || s === "BLOCKED").length;
  const delayedOrBlockedPillars = new Set(
    programmes.filter((p) => p.status === "DELAYED" || p.status === "BLOCKED").map((p) => p.pillar),
  ).size;

  const daysSince = (updatedAt: Date) =>
    Math.floor((now.getTime() - updatedAt.getTime()) / (24 * 60 * 60 * 1000));
  const evidenceDays = evidenceCandidates.map((r) => daysSince(r.updatedAt)).sort((a, b) => a - b);
  const medianDays =
    evidenceDays.length === 0
      ? 0
      : evidenceDays.length % 2 === 1
        ? evidenceDays[(evidenceDays.length - 1) / 2]
        : Math.round((evidenceDays[evidenceDays.length / 2 - 1] + evidenceDays[evidenceDays.length / 2]) / 2);

  return {
    summary: {
      title: "Active programmes and projects",
      icon: "milestones" as const,
      activeProgrammes,
      activeProjects,
      // No reporting-cycle boundary is tracked yet to count records added/
      // closed "this cycle" against - 0 is the honest value, not invented.
      newThisCycle: 0,
      closedThisCycle: 0,
      trend: noPriorPeriodTrend("higher-is-better"),
      provenance: provenance(
        "Approved active programmes and projects in the portfolio.",
        "Count unique active programme records and unique active project records separately.",
        "Programme and institutional project registers.",
      ),
    },
    milestoneOnTime: {
      title: "Priority milestones delivered on time",
      icon: "milestones" as const,
      percentOnTime,
      dueCount: dueMilestones.length,
      completedCount: completedOnTime.length,
      delayedCount: delayedMilestones.length,
      blockedCount: blockedMilestones.length,
      targetLabel: "100% of due priority milestones delivered on time",
      trend: noPriorPeriodTrend("higher-is-better"),
      provenance: provenance(
        "Priority milestones completed by their due dates.",
        "On-time completed priority milestones divided by priority milestones due by the selected date, multiplied by 100.",
        "Compact Progress Report and project milestone tracker.",
      ),
    },
    delayedOrBlocked: {
      title: "Delayed or blocked records",
      icon: "escalations" as const,
      count: delayedOrBlockedCount,
      targetLabel: "Zero delayed or blocked priority records",
      supportingLabel: `affects ${delayedOrBlockedPillars} pillar${delayedOrBlockedPillars === 1 ? "" : "s"}`,
      trend: noPriorPeriodTrend("lower-is-better"),
      provenance: provenance(
        "Approved priority records currently delayed or blocked.",
        "Count unique records with current status Delayed or Blocked.",
        "Programme, project and milestone registers.",
      ),
    },
    evidenceOverdue: {
      title: "Records requiring evidence or update",
      icon: "generic" as const,
      count: evidenceCandidates.length,
      targetLabel: "Zero overdue priority records without current evidence or update",
      supportingLabel:
        evidenceCandidates.length === 0
          ? "No records outstanding"
          : `median ${medianDays} days since last update`,
      trend: noPriorPeriodTrend("lower-is-better"),
      provenance: provenance(
        "Priority records missing required evidence or a current update.",
        "Count records whose evidence field is missing or whose required update date has passed.",
        "Project and milestone registers and evidence log.",
      ),
    },
  };
}
