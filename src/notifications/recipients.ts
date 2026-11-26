import type { Prisma, RoleName } from "@prisma/client";

const REVIEWER_ROLES: RoleName[] = ["DATA_REVIEWER", "VALIDATOR"];
const OVERSIGHT_ROLES: RoleName[] = ["SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER", "OVERSIGHT_USER", "READ_ONLY_USER"];

function holdsAny(roles: RoleName[]): Prisma.UserWhereInput {
  return { OR: [{ role: { in: roles } }, { roles: { hasSome: roles } }] };
}

export function reviewerWhere(institutionId: string): Prisma.UserWhereInput {
  return {
    status: "ACTIVE",
    ...holdsAny(REVIEWER_ROLES),
    AND: [
      {
        OR: [
          { institutionId },
          { reviewsAllInstitutions: true, institutionId: null },
          { role: { in: OVERSIGHT_ROLES } },
          { roles: { hasSome: OVERSIGHT_ROLES } },
        ],
      },
    ],
  };
}

export function administratorWhere(): Prisma.UserWhereInput {
  return { status: "ACTIVE", ...holdsAny(["SYSTEM_ADMINISTRATOR"]) };
}

export function providerWhere(institutionId: string): Prisma.UserWhereInput {
  return { status: "ACTIVE", institutionId, ...holdsAny(["INSTITUTIONAL_DATA_PROVIDER"]) };
}
