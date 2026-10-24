import type { Prisma } from "@prisma/client";
import { toKebabCase } from "@/common/utils/enum-casing";

export const REFORM_ACTION_INCLUDE = { pillar: true, programme: true } as const;

export const REFORM_ACTION_DETAIL_INCLUDE = {
  pillar: true,
  programme: true,
  history: { include: { changedBy: true }, orderBy: { changedAt: "desc" } },
} as const;

type ReformActionRow = Prisma.ReformActionGetPayload<{ include: typeof REFORM_ACTION_INCLUDE }>;
type ReformActionDetailRow = Prisma.ReformActionGetPayload<{ include: typeof REFORM_ACTION_DETAIL_INCLUDE }>;

export function toReformAction(row: ReformActionRow) {
  return {
    id: row.id,
    pillar: row.pillar.slug,
    commitment: row.commitment,
    action: row.action,
    isPriority: row.isPriority,
    programme: row.programme ? { id: row.programme.id, name: row.programme.name } : null,
    leadInstitution: row.leadInstitution,
    referenceDueDate: row.referenceDueDate?.toISOString() ?? null,
    dueDate: row.dueDate?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    status: toKebabCase(row.status),
    previousStatus: row.previousStatus ? toKebabCase(row.previousStatus) : null,
    comment: row.comment,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toReformActionDetail(row: ReformActionDetailRow) {
  return {
    ...toReformAction(row),
    history: row.history.map((change) => ({
      id: change.id,
      fromStatus: change.fromStatus ? toKebabCase(change.fromStatus) : null,
      toStatus: toKebabCase(change.toStatus),
      comment: change.comment,
      changedBy: change.changedBy.fullName,
      changedAt: change.changedAt.toISOString(),
    })),
  };
}
