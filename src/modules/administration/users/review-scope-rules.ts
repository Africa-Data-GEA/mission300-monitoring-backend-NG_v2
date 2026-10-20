import type { RoleName } from "@prisma/client";

const REVIEW_ROLES: RoleName[] = ["DATA_REVIEWER", "VALIDATOR"];

export function isReviewerOnly(roles: RoleName[]): boolean {
  return roles.length > 0 && roles.every((role) => REVIEW_ROLES.includes(role));
}

export function reviewScopeProblem(
  roles: RoleName[],
  institution: string | null | undefined,
  reviewsAllInstitutions: boolean,
): string | null {
  const hasInstitution = Boolean(institution?.trim());
  if (reviewsAllInstitutions) {
    if (!isReviewerOnly(roles)) return "Only a Data Reviewer or Validator can review all institutions.";
    if (hasInstitution) return "Choose either one institution or all institutions, not both.";
    return null;
  }
  if (roles.some((role) => REVIEW_ROLES.includes(role)) && isReviewerOnly(roles) && !hasInstitution) {
    return "A reviewer needs an institution, or must be set to review all institutions.";
  }
  if (roles.includes("INSTITUTIONAL_DATA_PROVIDER") && !hasInstitution) {
    return "A data provider needs an institution.";
  }
  return null;
}
