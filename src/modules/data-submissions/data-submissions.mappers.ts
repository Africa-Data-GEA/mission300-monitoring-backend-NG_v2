import type {
  Dataset,
  DatasetField,
  Institution,
  KpiDefinition,
  Obligation,
  Pillar,
  ReviewDecision,
  Submission,
  SubmissionItem,
  User,
} from "@prisma/client";
import {
  submissionWorkflowStatus,
  workflowStatus,
  type WorkflowStatus,
} from "@/modules/data-submissions/workflow-status";
import { toKebabCase } from "@/common/utils/enum-casing";
import type { GapState } from "@/modules/data-submissions/data-gap-state";

const DAY_MS = 24 * 60 * 60 * 1000;

type DatasetWithRelations = Dataset & { pillar: Pillar; ownerInstitution: Institution | null };

function buildTemplate(dataset: Pick<Dataset, "id" | "templateFileName" | "templateVersion">) {
  return {
    id: dataset.id,
    version: String(dataset.templateVersion),
    fileName: dataset.templateFileName,
    downloadUrl: `/data-submissions/templates/${dataset.templateFileName}`,
  };
}

/**
 * Matches the Dataset shape in m300-frontend/src/api/schemas/data-
 * submissions/datasets.ts exactly - ownerInstitution is z.string().min(1)
 * there with no default, so "" (a null FK) would be a real contract
 * violation, not just an odd display value.
 */
export function toDatasetView(dataset: DatasetWithRelations) {
  return {
    id: dataset.id,
    name: dataset.name,
    purpose: dataset.purpose,
    pillar: dataset.pillar.slug,
    requiredDataPoints: dataset.requiredDataPoints,
    frequency: dataset.frequency,
    ownerInstitution: dataset.ownerInstitution?.name ?? "Unassigned",
    template: buildTemplate(dataset),
  };
}

function formatDueLabel(dueDate: Date): string {
  const days = Math.round((dueDate.getTime() - Date.now()) / DAY_MS);
  if (days > 0) return `Due in ${days} day${days === 1 ? "" : "s"}`;
  if (days === 0) return "Due today";
  const overdueDays = Math.abs(days);
  return `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`;
}

type ObligationWithRelations = Obligation & {
  institution: Institution;
  dataset: DatasetWithRelations;
  focalPerson: User | null;
};

// Mirrors the mock's obligation-status/availableActions transitions
// (see docs/full-dashboard-backend-logic-audit.md's Data Submissions
// section and data-submissions.mappers research): no submission yet ->
// enter/upload/download; returned or rejected -> enter/upload/download again
// (the obligation is still outstanding, so the provider must be able to
// correct and resubmit); anything else in flight -> view only. A fulfilled obligation
// (acceptedSubmissionId set) never reaches this function - see
// getObligations()'s query, which excludes those entirely.
const ACTIONS_UNSTARTED = ["enter-data", "upload-template", "download-template"];
const RESUBMITTABLE_STATUSES = ["RETURNED", "REJECTED"];
const ACTIONS_IN_FLIGHT = ["view"];

/** Matches obligationSchema exactly (m300-frontend/src/api/schemas/data-submissions/obligations.ts). */
export function toObligationView(obligation: ObligationWithRelations, latestSubmission: Submission | null) {
  let status: WorkflowStatus;
  let availableActions: string[];

  if (!latestSubmission) {
    status = workflowStatus(obligation.dueDate.getTime() < Date.now() ? "overdue" : "due");
    availableActions = ACTIONS_UNSTARTED;
  } else if (RESUBMITTABLE_STATUSES.includes(latestSubmission.status)) {
    status = submissionWorkflowStatus(latestSubmission.status);
    availableActions = ACTIONS_UNSTARTED;
  } else {
    status = submissionWorkflowStatus(latestSubmission.status);
    availableActions = ACTIONS_IN_FLIGHT;
  }

  return {
    id: obligation.id,
    institution: obligation.institution.name,
    focalPerson: obligation.focalPerson?.fullName ?? "Not supplied",
    datasetId: obligation.datasetId,
    dataset: obligation.dataset.name,
    reportingPeriod: obligation.reportingPeriod,
    frequency: obligation.dataset.frequency,
    dueDate: obligation.dueDate.toISOString(),
    dueLabel: status.code === "provisional" ? "Submitted" : formatDueLabel(obligation.dueDate),
    status,
    template: buildTemplate(obligation.dataset),
    acceptedSubmissionId: obligation.acceptedSubmissionId,
    availableActions,
  };
}

const METHOD_CODE: Record<string, string> = { MANUAL_ENTRY: "manual-entry", UPLOAD: "template-upload" };
const METHOD_LABEL: Record<string, string> = { MANUAL_ENTRY: "Manual entry", UPLOAD: "Template upload" };

type SubmissionWithRelations = Submission & {
  institution: Institution;
  submittedBy: User;
  obligation: (Obligation & { dataset: Dataset }) | null;
  reviewDecisions?: (ReviewDecision & { reviewedBy?: User })[];
};

const DECISION_LABEL_PAST: Record<string, string> = {
  APPROVE: "Approved",
  PROVISIONALLY_APPROVE: "Provisionally approved",
  RETURN_FOR_CORRECTION: "Returned",
  REJECT: "Rejected",
};

function formatDecisionDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function reviewSummary(status: string, decisions: Pick<ReviewDecision, "decision" | "createdAt">[]): string {
  const ordered = [...decisions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const latest = ordered.at(-1);
  const provisional = ordered.find((entry) => entry.decision === "PROVISIONALLY_APPROVE");

  if (status === "PROVISIONALLY_APPROVED") return "Provisional — awaiting confirmation.";
  if (!latest) return status === "PENDING" ? "Awaiting review." : "No review decision recorded.";
  if (status === "APPROVED" && provisional) {
    return `Confirmed after provisional approval on ${formatDecisionDate(provisional.createdAt)}.`;
  }
  const label = DECISION_LABEL_PAST[latest.decision] ?? "Decided";
  const withdrawn = provisional && latest.decision !== "PROVISIONALLY_APPROVE" ? " Provisional approval withdrawn." : "";
  return `${label} on ${formatDecisionDate(latest.createdAt)}.${withdrawn}`;
}

/**
 * Matches SubmissionListItem exactly (m300-frontend/src/api/schemas/data-
 * submissions/submissions.ts). dataset/reportingPeriod/validationSummary
 * are all z.string().min(1) there - an empty string is a real contract
 * violation, not just an odd display value, so every fallback here must
 * be non-empty text, never "".
 */
export function toSubmissionListItem(submission: SubmissionWithRelations, latestForObligation = false) {
  const submitted = submission.status !== "DRAFT";
  const inReview = submission.status === "PENDING" || submission.status === "UNDER_REVIEW";
  const canCorrect =
    latestForObligation && RESUBMITTABLE_STATUSES.includes(submission.status) && !submission.obligation?.acceptedSubmissionId;
  return {
    id: submission.id,
    obligationId: submission.obligationId,
    institution: submission.institution.name,
    dataset: submission.obligation?.dataset.name ?? "Unlinked submission",
    reportingPeriod: submission.obligation?.reportingPeriod ?? "Unknown period",
    method: METHOD_CODE[submission.method] ?? submission.method,
    methodLabel: METHOD_LABEL[submission.method] ?? submission.method,
    version: submission.version,
    submittedBy: submission.submittedBy.fullName,
    submittedAt: submitted ? submission.createdAt.toISOString() : null,
    submittedAtLabel: submitted ? formatAgeLabel(submission.createdAt) : "Not yet submitted",
    status: submissionWorkflowStatus(submission.status),
    validationSummary: reviewSummary(submission.status, submission.reviewDecisions ?? []),
    availableActions: inReview ? ["review"] : canCorrect ? ["view", "correct"] : ["view"],
  };
}

export function permittedDecisionsFor(status: string, canDecide: boolean) {
  if (!canDecide) return [];
  if (status === "PENDING") return ["approved", "provisional", "returned", "rejected"] as const;
  if (status === "PROVISIONALLY_APPROVED") return ["approved", "returned", "rejected"] as const;
  return [];
}

export function formatAgeLabel(date: Date): string {
  const days = Math.round((Date.now() - date.getTime()) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/** Matches overdueItemSchema exactly (m300-frontend/src/api/schemas/data-submissions/compliance.ts). */
export function toOverdueItem(obligation: ObligationWithRelations) {
  const overdueDays = Math.max(0, Math.round((Date.now() - obligation.dueDate.getTime()) / DAY_MS));
  return {
    id: obligation.id,
    institution: obligation.institution.name,
    dataset: obligation.dataset.name,
    reportingPeriod: obligation.reportingPeriod,
    dueDate: obligation.dueDate.toISOString(),
    dueDateLabel: formatDueLabel(obligation.dueDate),
    overdueLabel: `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`,
    owner: obligation.focalPerson?.fullName ?? obligation.institution.name,
    status: workflowStatus("overdue"),
    availableActions: ACTIONS_UNSTARTED,
  };
}

type KpiWithPillar = KpiDefinition & {
  pillar: Pillar;
  sourceInstitutions: { institution: Institution }[];
  datasetFields: { dataset: Pick<Dataset, "id" | "name"> }[];
};

const READINESS_LABEL: Record<string, string> = { CORE: "Core", SUPPORTING: "Supporting", FUTURE: "Future" };

export function toDataGap(kpi: KpiWithPillar, state: GapState) {
  const owners = kpi.sourceInstitutions.map((link) => link.institution.name).join(", ");
  return {
    id: `gap-${kpi.id}`,
    kpiId: kpi.code,
    kpiName: kpi.name,
    pillar: kpi.pillar.name,
    institution: owners || "Not supplied",
    reportingPeriod: kpi.frequency || "Not supplied",
    category: state.category,
    readinessTier: READINESS_LABEL[kpi.readiness] ?? "Not assessed",
    owner: owners || "Unassigned",
    nextAction: state.nextAction,
    status: state.statusCode ? workflowStatus(state.statusCode) : null,
    availableActions: ["view"] as string[],
  };
}

type ObligationWithDatasetFields = Obligation & {
  institution: Institution;
  dataset: Dataset & { fields: DatasetField[] };
};

/** Matches entryFieldSchema exactly - helpText/placeholder are required strings but never min(1), so "" is valid. */
function toEntryField(field: DatasetField) {
  return {
    id: field.id,
    label: field.label,
    helpText: field.helpText ?? "",
    type: toKebabCase(field.type),
    required: field.required,
    unit: field.unit,
    placeholder: "",
    options: (field.options as { value: string; label: string }[] | null) ?? [],
  };
}

/** Matches manualEntryDefinitionSchema exactly - the server-driven form definition behind GET .../obligations/:id/entry. */
export function toManualEntryDefinition(
  obligation: ObligationWithDatasetFields,
  extras: { periods: string[]; institutions: string[] } = { periods: [], institutions: [] },
) {
  const consolidated = obligation.dataset.submissionMode === "NERC_CONSOLIDATED";
  const sections = new Map<
    string,
    { id: string; title: string; description: string; fields: ReturnType<typeof toEntryField>[] }
  >();
  for (const field of [...obligation.dataset.fields].sort((a, b) => a.order - b.order)) {
    if (!sections.has(field.sectionId)) {
      sections.set(field.sectionId, {
        id: field.sectionId,
        title: field.sectionTitle,
        description: "",
        fields: [],
      });
    }
    sections.get(field.sectionId)!.fields.push(toEntryField(field));
  }

  return {
    obligationId: obligation.id,
    title: `${obligation.dataset.name} — ${obligation.reportingPeriod}`,
    institution: obligation.institution.name,
    dataset: obligation.dataset.name,
    reportingPeriod: obligation.reportingPeriod,
    frequency: obligation.dataset.frequency,
    consolidated,
    periods: consolidated ? [] : extras.periods,
    institutions: consolidated ? extras.institutions : [],
    sections: [...sections.values()],
  };
}

// Matches the mock's own fixture values (uploadDefinitions in
// m300-frontend/src/mocks/data/data-submissions/) - not specified per-
// dataset anywhere in this schema, so a fixed reasonable constant here.
const ACCEPTED_FILE_TYPES = [".xlsx", ".csv"];
const ACCEPTED_FILE_TYPES_LABEL = "XLSX or CSV";
const MAX_FILE_SIZE_MB = 20;

/** Matches uploadDefinitionSchema exactly - the info behind GET .../obligations/:id/upload. */
export function toUploadDefinition(obligation: ObligationWithDatasetFields) {
  return {
    obligationId: obligation.id,
    institution: obligation.institution.name,
    dataset: obligation.dataset.name,
    reportingPeriod: obligation.reportingPeriod,
    template: buildTemplate(obligation.dataset),
    acceptedFileTypes: ACCEPTED_FILE_TYPES,
    acceptedFileTypesLabel: ACCEPTED_FILE_TYPES_LABEL,
    maxFileSizeMb: MAX_FILE_SIZE_MB,
  };
}

// Mirrors ReviewDecisionType in prisma/schema.prisma, same casing pattern
// as submission-decision.ts's own decisionDisplay - kept as a plain
// string map (not the Prisma enum) so any Prisma-typed value passed in
// falls through predictably.
export const DECISION_STATUS_CODE: Record<string, string> = {
  APPROVE: "approved",
  PROVISIONALLY_APPROVE: "provisional",
  RETURN_FOR_CORRECTION: "returned",
  REJECT: "rejected",
};

type SubmissionWithQueueRelations = SubmissionWithRelations & { reviewer: User | null };

/**
 * Matches validationQueueItemSchema exactly (submissionListItemSchema +
 * reviewer/ageLabel/automatedCheck/issueCount). automatedCheck/issueCount
 * are honestly always "pass"/0 for anything reachable here: uploadSubmission()
 * rejects outright (400) on any validation failure rather than accepting
 * with issues attached, so every PENDING submission already passed by
 * construction - there's no partial/soft-issue state to report yet.
 */
export function toValidationQueueItem(submission: SubmissionWithQueueRelations) {
  return {
    ...toSubmissionListItem(submission),
    reviewer: submission.reviewer?.fullName ?? "Unassigned",
    ageLabel: formatAgeLabel(submission.createdAt),
    automatedCheck: workflowStatus("pass"),
    issueCount: 0,
  };
}

type SubmissionWithDetailRelations = Omit<SubmissionWithQueueRelations, "reviewDecisions"> & {
  items: (SubmissionItem & { kpiDefinition: KpiDefinition })[];
  reviewDecisions: (ReviewDecision & { reviewedBy: User })[];
};

/**
 * Matches submissionDetailSchema exactly (validationQueueItemSchema +
 * fileName/sourceReference/notes/issues/history/permittedDecisions/
 * extractedValues). `history` is composed from data that already exists
 * (the submission's own creation + its ReviewDecision rows) rather than a
 * separate stored log, mirroring exactly what the mock's own
 * createMockBackendSubmission()/synchronizeSubmissionDecision() build.
 */
export function toSubmissionDetail(
  submission: SubmissionWithDetailRelations,
  context: { canDecide: boolean },
) {
  const createdEntry = {
    id: `${submission.id}-created`,
    status: workflowStatus("pending-review"),
    actor: submission.submittedBy.fullName,
    occurredAt: submission.createdAt.toISOString(),
    occurredAtLabel: formatAgeLabel(submission.createdAt),
    comment: `${submission.method === "UPLOAD" ? "Template uploaded" : "Entry submitted"}: ${submission.items.length} value${submission.items.length === 1 ? "" : "s"} read and checked for format and range. These checks do not replace the reviewer's decision.`,
  };
  const decisionEntries = submission.reviewDecisions
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((decision) => ({
      id: decision.id,
      status: workflowStatus(DECISION_STATUS_CODE[decision.decision] ?? "pending"),
      actor: decision.reviewedBy.fullName,
      occurredAt: decision.createdAt.toISOString(),
      occurredAtLabel: formatAgeLabel(decision.createdAt),
      comment: decision.comment,
    }));

  const extractedValues = submission.items.map((item) => ({
    kpiId: item.kpiDefinitionId,
    kpiName: item.kpiDefinition.name,
    reportingPeriod: item.period,
    value: Number(item.value),
  }));

  return {
    ...toValidationQueueItem(submission),
    fileName: submission.originalFileName,
    sourceReference: submission.sourceReference ?? "",
    notes: submission.notes ?? "",
    issues: [] as unknown[],
    history: [createdEntry, ...decisionEntries],
    permittedDecisions: permittedDecisionsFor(submission.status, context.canDecide),
    extractedValues,
  };
}
