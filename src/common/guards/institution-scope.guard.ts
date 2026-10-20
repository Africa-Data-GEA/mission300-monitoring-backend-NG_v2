import { Injectable, type CanActivate, type ExecutionContext, ForbiddenException } from "@nestjs/common";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";

const UNSCOPED_ROLES = ["SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER", "OVERSIGHT_USER", "READ_ONLY_USER"];

const REVIEW_ROLES = ["DATA_REVIEWER", "VALIDATOR"];

export function isUnscopedRole(user: AuthenticatedUser): boolean {
  const roles = user.roles?.length ? user.roles : [user.role];
  if (roles.some((role) => UNSCOPED_ROLES.includes(role))) return true;
  const reviewsOnly = roles.some((role) => REVIEW_ROLES.includes(role)) && !roles.includes("INSTITUTIONAL_DATA_PROVIDER");
  return reviewsOnly && user.reviewsAllInstitutions === true && !user.institutionId;
}

/**
 * Blocks an institutional user (data provider, reviewer, validator) from
 * reading or writing another institution's data via a path param, e.g.
 * GET /institutions/:institutionId/submissions.
 *
 * IMPORTANT: this guard only covers the :institutionId path-param case. Any
 * endpoint that LISTS across institutions (e.g. GET /submissions?status=...)
 * must apply the same scoping inside the service layer by filtering the
 * Prisma query with the caller's institutionId - see scopeInstitutionFilter()
 * below. Never trust a client-supplied institutionId query param as a filter
 * for a non-admin caller.
 */
@Injectable()
export class InstitutionScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user: AuthenticatedUser;
      params: Record<string, string>;
    }>();
    const { user, params } = request;

    if (isUnscopedRole(user)) return true;

    const requestedInstitutionId = params.institutionId;
    if (!requestedInstitutionId) return true; // route doesn't scope by institution

    if (requestedInstitutionId !== user.institutionId) {
      throw new ForbiddenException("You cannot access another institution's data");
    }
    return true;
  }
}

export function scopeSubmissionFilter(user: AuthenticatedUser): {
  OR?: ({ institutionId: string } | { submittedBy: { institutionId: string } })[];
} {
  if (isUnscopedRole(user)) return {};
  const own = user.institutionId ?? "__none__";
  return { OR: [{ institutionId: own }, { submittedBy: { institutionId: own } }] };
}

export function assertSubmissionAccess(
  user: AuthenticatedUser,
  submission: { institutionId: string; submittedBy?: { institutionId: string | null } | null },
): void {
  if (isUnscopedRole(user)) return;
  if (user.institutionId && (user.institutionId === submission.institutionId || user.institutionId === submission.submittedBy?.institutionId)) return;
  throw new ForbiddenException("You cannot act on another institution's submission");
}

/** Reuse the same allow-list from a service method's own scoping check. */
export function scopeInstitutionFilter(user: AuthenticatedUser): { institutionId?: string } {
  if (isUnscopedRole(user)) return {};
  return { institutionId: user.institutionId ?? "__none__" };
}

/**
 * Write-side counterpart to scopeInstitutionFilter(): call this before
 * creating/mutating a record on behalf of a specific institutionId (e.g. a
 * data submission against an obligation). Throws unless the caller is an
 * unscoped role or genuinely belongs to that institution - without this, an
 * institution-scoped user could submit data attributed to an institution
 * they have no membership in. See WEB-012.
 */
export function assertInstitutionMembership(user: AuthenticatedUser, institutionId: string): void {
  if (isUnscopedRole(user)) return;
  if (user.institutionId !== institutionId) {
    throw new ForbiddenException("You cannot submit data on behalf of another institution");
  }
}
