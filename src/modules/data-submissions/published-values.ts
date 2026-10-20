import type { Prisma } from "@prisma/client";

export const LINKED_ITEM_PREFIX = "live-linked-item-";

export const linkedItemId = (itemId: string, counterpartKpiId: string) =>
  `${LINKED_ITEM_PREFIX}${itemId}-${counterpartKpiId}`;

interface PublishedItem {
  itemId: string;
  submissionId: string;
  kpiDefinitionId: string;
  canonicalKpiId: string | null;
  period: string;
  value: Prisma.Decimal | number;
}

async function putValue(
  tx: Prisma.TransactionClient,
  args: { kpiDefinitionId: string; institutionId: string; period: string; value: Prisma.Decimal | number; itemId: string; approvedAt: Date },
) {
  const own = await tx.kpiValue.findUnique({ where: { sourceSubmissionItemId: args.itemId }, select: { id: true } });
  if (own) {
    await tx.kpiValue.update({ where: { id: own.id }, data: { value: args.value, approvedAt: args.approvedAt } });
    return;
  }
  const existing = await tx.kpiValue.findFirst({
    where: { kpiDefinitionId: args.kpiDefinitionId, institutionId: args.institutionId, period: args.period },
    select: { id: true },
  });
  if (existing) {
    await tx.kpiValue.update({
      where: { id: existing.id },
      data: { sourceSubmissionItemId: args.itemId, value: args.value, approvedAt: args.approvedAt, coverageNote: null },
    });
    return;
  }
  await tx.kpiValue.create({
    data: {
      kpiDefinitionId: args.kpiDefinitionId,
      institutionId: args.institutionId,
      period: args.period,
      value: args.value,
      sourceSubmissionItemId: args.itemId,
      approvedAt: args.approvedAt,
    },
  });
}

export async function publishItemValue(
  tx: Prisma.TransactionClient,
  item: PublishedItem,
  context: { institutionId: string; approvedAt: Date; actorId: string },
) {
  await putValue(tx, {
    kpiDefinitionId: item.kpiDefinitionId,
    institutionId: context.institutionId,
    period: item.period,
    value: item.value,
    itemId: item.itemId,
    approvedAt: context.approvedAt,
  });

  const aliases = await tx.kpiDefinition.findMany({ where: { canonicalKpiId: item.kpiDefinitionId }, select: { id: true } });
  const counterparts = [...(item.canonicalKpiId ? [item.canonicalKpiId] : []), ...aliases.map((alias) => alias.id)];
  if (counterparts.length === 0) return;

  const submissionId = `live-linked-submission-${item.submissionId}`;
  await tx.submission.upsert({
    where: { id: submissionId },
    create: {
      id: submissionId,
      institutionId: context.institutionId,
      submittedById: context.actorId,
      method: "MANUAL_ENTRY",
      status: "APPROVED",
      sourceReference: "Linked copy of a value published through the platform",
      notes: "Copied so a KPI that records the same measurement shows the same figure.",
      reviewerId: context.actorId,
    },
    update: {},
  });
  for (const counterpartId of counterparts) {
    const mirrorId = linkedItemId(item.itemId, counterpartId);
    await tx.submissionItem.upsert({
      where: { id: mirrorId },
      create: { id: mirrorId, submissionId, kpiDefinitionId: counterpartId, period: item.period, value: item.value },
      update: { value: item.value },
    });
    await putValue(tx, {
      kpiDefinitionId: counterpartId,
      institutionId: context.institutionId,
      period: item.period,
      value: item.value,
      itemId: mirrorId,
      approvedAt: context.approvedAt,
    });
  }
}

export async function withdrawItemValues(tx: Prisma.TransactionClient, itemIds: string[]) {
  if (itemIds.length === 0) return;
  await tx.kpiValue.deleteMany({
    where: {
      OR: [
        { sourceSubmissionItemId: { in: itemIds } },
        ...itemIds.map((itemId) => ({ sourceSubmissionItemId: { startsWith: `${LINKED_ITEM_PREFIX}${itemId}-` } })),
      ],
    },
  });
}
