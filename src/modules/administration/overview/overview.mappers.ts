import type { Institution, RoleDefinition, ScopeAssignment, User } from "@prisma/client";
import { toKebabCase } from "@/common/utils/enum-casing";

// Mirrors MODULES in m300-frontend/src/mocks/handlers.ts exactly - the
// vocabulary a role's `modules[]` entries and the `module` filter/audit
// field are expressed in.
export const MODULE_LABELS: Record<string, string> = {
  "executive-overview": "Executive Overview",
  "kpi-explorer": "KPI Explorer",
  "implementation-register": "Implementation Register",
  "data-submissions": "Data Submissions & Validation",
  reports: "Reports & Exports",
  administration: "User Access & Administration",
};

/** Mirrors roleReachesModule() in m300-frontend/src/mocks/handlers.ts exactly. */
export function roleReachesModule(modules: readonly string[], moduleCode: string): boolean {
  if (moduleCode === "all") return true;
  if (modules.includes("All modules")) return true;

  const label = MODULE_LABELS[moduleCode];
  return modules.some(
    (entry) =>
      entry === label ||
      (entry === "All monitoring modules" &&
        moduleCode !== "data-submissions" &&
        moduleCode !== "reports" &&
        moduleCode !== "administration"),
  );
}

type UserWithInstitution = User & { institution: Institution | null };

/** Matches userAccountSchema in m300-frontend/src/api/schemas/administration.ts exactly. */
export function toUserAccountResponse(user: UserWithInstitution) {
  return {
    id: user.id,
    name: user.fullName,
    email: user.email,
    institution: user.reviewsAllInstitutions ? "All institutions" : (user.institution?.name ?? "Not assigned"),
    reviewsAllInstitutions: user.reviewsAllInstitutions,
    designation: user.designation,
    role: toKebabCase(user.role),
    roles: (user.roles.length ? user.roles : [user.role]).map(toKebabCase),
    status: toKebabCase(user.status),
    lastLogin: user.lastLogin?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Matches roleDefinitionSchema exactly - assignedUsers is passed in separately (a live count, not a column on this table). */
export function toRoleDefinitionResponse(role: RoleDefinition, assignedUsers: number) {
  return {
    role: toKebabCase(role.role),
    label: role.label,
    description: role.description,
    permissions: role.permissions.map(toKebabCase),
    modules: role.modules,
    assignedUsers,
  };
}

type ScopeAssignmentWithUser = ScopeAssignment & { user: User };

/** Matches scopeAssignmentSchema exactly. */
export function toScopeAssignmentResponse(assignment: ScopeAssignmentWithUser) {
  return {
    id: assignment.id,
    userId: assignment.userId,
    userName: assignment.user.fullName,
    level: toKebabCase(assignment.level),
    scope: assignment.scope,
    responsibility: assignment.responsibility,
    effectiveFrom: assignment.effectiveFrom.toISOString(),
    effectiveTo: assignment.effectiveTo?.toISOString() ?? null,
    active: assignment.active,
  };
}

/**
 * Human label + module for each machine action key currently in use (see
 * every @AuditAction(...) call across the app). `action` stays a machine
 * key in the database (still useful for filtering/analytics) - this is
 * where it's translated for display, matching the tone of the frontend's
 * own seed data (e.g. "Assigned system role").
 */
export const ACTION_META: Record<string, { label: string; module: string }> = {
  "file.uploaded": { label: "Uploaded a file", module: MODULE_LABELS["data-submissions"] },
  "branding.updated": { label: "Updated site branding", module: MODULE_LABELS.administration },
  "branding.fonts_updated": { label: "Updated site fonts", module: MODULE_LABELS.administration },
  "branding.reset": { label: "Reset branding to default", module: MODULE_LABELS.administration },
  "branding.logo_updated": { label: "Updated site logo", module: MODULE_LABELS.administration },
  "user.invited": { label: "Invited a user", module: MODULE_LABELS.administration },
  "user.status_changed": { label: "Changed account status", module: MODULE_LABELS.administration },
  "user.profile_updated": { label: "Updated own profile", module: MODULE_LABELS.administration },
  // Module string is "Programs" (not MODULE_LABELS["implementation-register"])
  // to match the real frontend mock's own recordAuditEvent() calls in
  // mocks/handlers/programs.ts exactly - see programs.mappers.ts's header
  // comment for why this looks inconsistent with the Administration audit
  // filter's "Implementation Register" label.
  "programme.created": { label: "Added a programme", module: "Programs" },
  "project.created": { label: "Added a project", module: "Programs" },
  "project.updated": { label: "Updated a project", module: "Programs" },
  "project.deleted": { label: "Removed a project", module: "Programs" },
  // Same reasoning as "Programs" above - matches mocks/handlers/
  // bottlenecks.ts's own recordAuditEvent() module string exactly.
  "bottleneck.created": { label: "Raised a bottleneck", module: "Bottlenecks & Exceptions" },
  "bottleneck.status_updated": { label: "Updated bottleneck status", module: "Bottlenecks & Exceptions" },
  "disco.performance_recorded": { label: "Recorded DisCo performance", module: "State & DisCo" },
  "disco.service_band_recorded": { label: "Recorded DisCo supply/tariff band", module: "State & DisCo" },
  "disco.milestone_created": { label: "Added a DisCo delivery milestone", module: "State & DisCo" },
  "disco.milestone_updated": { label: "Updated a DisCo delivery milestone", module: "State & DisCo" },
  "disco.state_validated": { label: "Validated state coverage", module: "State & DisCo" },
  "report.requested": { label: "Requested a report", module: MODULE_LABELS.reports },
  "report.deleted": { label: "Deleted a report", module: MODULE_LABELS.reports },
  "submission.created": { label: "Created a submission", module: MODULE_LABELS["data-submissions"] },
  "submission.submitted": { label: "Submitted for review", module: MODULE_LABELS["data-submissions"] },
  "submission.review_started": { label: "Started review", module: MODULE_LABELS["data-submissions"] },
  "submission.decision_recorded": {
    label: "Recorded review decision",
    module: MODULE_LABELS["data-submissions"],
  },
  "submission.manual_entry_saved": {
    label: "Submitted manual entry for review",
    module: MODULE_LABELS["data-submissions"],
  },
  "reform_action.created": { label: "Recorded a reform action", module: MODULE_LABELS["implementation-register"] },
  "reform_action.updated": { label: "Updated a reform action", module: MODULE_LABELS["implementation-register"] },
  "reform_action.deleted": { label: "Removed a reform action", module: MODULE_LABELS["implementation-register"] },
  "submission.draft_saved": { label: "Saved a data entry draft", module: MODULE_LABELS["data-submissions"] },
  "submission.draft_discarded": { label: "Discarded a data entry draft", module: MODULE_LABELS["data-submissions"] },
  "submission.uploaded": { label: "Uploaded submission", module: MODULE_LABELS["data-submissions"] },
  "kpi.metadata_updated": { label: "Updated KPI metadata", module: MODULE_LABELS["kpi-explorer"] },
  "kpi.created": { label: "Registered a new KPI", module: MODULE_LABELS["kpi-explorer"] },
  "kpi.active_toggled": { label: "Retired or restored a KPI", module: MODULE_LABELS["kpi-explorer"] },
  "webhook.created": { label: "Created a webhook subscription", module: MODULE_LABELS.administration },
  "webhook.deleted": { label: "Deleted a webhook subscription", module: MODULE_LABELS.administration },
};

const FALLBACK_MODULE = MODULE_LABELS.administration;

type AuditEntryWithActor = {
  id: string;
  createdAt: Date;
  actorId: string;
  actor: { fullName: string };
  action: string;
  entityId: string;
  before: unknown;
  after: unknown;
  result: "SUCCESS" | "FAILURE" | "REJECTED";
};

/**
 * Matches auditEventSchema exactly. `priorValue`/`newValue` are best-effort:
 * the interceptor only ever populates `after` today (see
 * audit-log.interceptor.ts's comment on why `before` isn't captured), so
 * priorValue is always null for now rather than silently wrong - the schema
 * allows this (both fields are nullable). `reference` is always null for
 * the same reason: nothing in the system generates a ticket/request id yet.
 */
export function toAuditEventResponse(entry: AuditEntryWithActor) {
  const meta = ACTION_META[entry.action];
  return {
    id: entry.id,
    timestamp: entry.createdAt.toISOString(),
    userId: entry.actorId,
    userName: entry.actor.fullName,
    action: meta?.label ?? entry.action,
    module: meta?.module ?? FALLBACK_MODULE,
    recordId: entry.entityId === "unknown" ? null : entry.entityId,
    priorValue: stringifyOrNull(entry.before),
    newValue: stringifyOrNull(entry.after),
    result: toKebabCase(entry.result),
    reference: null as string | null,
  };
}

function stringifyOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AUDIT_PERIOD_DAYS: Record<string, number> = {
  "last-7-days": 7,
  "last-30-days": 30,
  "last-90-days": 90,
};

/** Mirrors auditCutoff() in the mock, but anchored to the real current time (not a frozen demo timestamp). */
export function auditCutoff(period: string): Date | null {
  const days = AUDIT_PERIOD_DAYS[period];
  if (!days) return null; // "all-time", or unrecognized - no cutoff either way
  return new Date(Date.now() - days * MS_PER_DAY);
}

/** Same page/pageSize/total envelope as `paginated()` in administration.ts - mirrors the mock's paginate() clamping exactly. */
export function paginate<T>(items: readonly T[], requestedPage: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: items.length,
  };
}
