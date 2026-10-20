import type { Prisma } from "@prisma/client";
import {
  datasetsFor,
  inputFor,
  NATIONAL_KPIS,
  nationalForQuarter,
  periodsIn,
  quarterOf,
  type ApprovedValue,
} from "@/modules/data-submissions/national-rollup";

const NERC_INSTITUTION_ID = "seed-institution-nerc";
const COUNTED_STATUSES = ["APPROVED", "PROVISIONALLY_APPROVED"] as const;

export interface RollupOutcome {
  published: string[];
  waiting: string[];
}

export function quartersTouched(periods: string[]): string[] {
  return [...new Set(periods.map((period) => quarterOf(period)?.quarter).filter((quarter): quarter is string => !!quarter))];
}

export async function rollupNationalKpis(
  tx: Prisma.TransactionClient,
  quarters: string[],
  actorId: string,
): Promise<RollupOutcome> {
  const outcome: RollupOutcome = { published: [], waiting: [] };
  if (quarters.length === 0) return outcome;

  const nerc = await tx.institution.findUnique({ where: { id: NERC_INSTITUTION_ID }, select: { id: true } });
  if (!nerc) return outcome;

  for (const quarter of quarters) {
    const periods = periodsIn(quarter);
    const ready = [];
    for (const kpi of NATIONAL_KPIS) {
      const stillWaiting = await tx.submission.count({
        where: {
          status: "PENDING",
          obligation: { datasetId: { in: datasetsFor(kpi.needs) } },
          items: { some: { period: { in: periods } } },
        },
      });
      if (stillWaiting > 0) outcome.waiting.push(`${kpi.code} ${quarter}`);
      else ready.push(kpi);
    }
    if (ready.length === 0) continue;

    const datasetIds = [...new Set(ready.flatMap((kpi) => datasetsFor(kpi.needs)))];
    const items = await tx.submissionItem.findMany({
      where: {
        period: { in: periods },
        submission: { status: { in: [...COUNTED_STATUSES] }, obligation: { datasetId: { in: datasetIds } } },
      },
      select: {
        value: true,
        period: true,
        kpiDefinition: { select: { code: true } },
        submission: { select: { institutionId: true, createdAt: true, obligation: { select: { datasetId: true } } } },
      },
    });

    const approved: ApprovedValue[] = [];
    for (const item of items) {
      const datasetId = item.submission.obligation?.datasetId;
      const input = datasetId ? inputFor(datasetId, item.kpiDefinition.code) : null;
      if (!input) continue;
      approved.push({
        institutionId: item.submission.institutionId,
        input,
        period: item.period,
        value: Number(item.value),
        decidedAt: item.submission.createdAt.getTime(),
      });
    }

    const readyCodes = new Set(ready.map((kpi) => kpi.code));
    for (const result of nationalForQuarter(approved, quarter)) {
      if (!readyCodes.has(result.code)) continue;
      await writeNational(tx, nerc.id, actorId, result.code, quarter, result.value, result.coverageNote);
      outcome.published.push(`${result.code} ${quarter}`);
    }
  }
  return outcome;
}

async function writeNational(
  tx: Prisma.TransactionClient,
  institutionId: string,
  actorId: string,
  code: string,
  quarter: string,
  value: number,
  coverageNote: string | null,
) {
  const kpi = await tx.kpiDefinition.findUnique({ where: { code }, select: { id: true } });
  if (!kpi) return;
  const approvedAt = new Date();

  const existing = await tx.kpiValue.findFirst({
    where: { kpiDefinitionId: kpi.id, period: quarter, institutionId },
    select: { id: true, sourceSubmissionItemId: true },
  });
  if (existing) {
    await tx.submissionItem.update({ where: { id: existing.sourceSubmissionItemId }, data: { value } });
    await tx.kpiValue.update({ where: { id: existing.id }, data: { value, approvedAt, coverageNote } });
    return;
  }

  const submissionId = `live-rollup-submission-${code}-${quarter}`;
  const itemId = `live-rollup-item-${code}-${quarter}`;
  await tx.submission.upsert({
    where: { id: submissionId },
    create: {
      id: submissionId,
      institutionId,
      submittedById: actorId,
      method: "MANUAL_ENTRY",
      status: "APPROVED",
      sourceReference: `National roll-up of the approved DisCo submissions for ${quarter}`,
      notes: "Worked out by the system from every approved DisCo value for the quarter.",
      reviewerId: actorId,
    },
    update: {},
  });
  await tx.submissionItem.upsert({
    where: { id: itemId },
    create: { id: itemId, submissionId, kpiDefinitionId: kpi.id, period: quarter, value },
    update: { value },
  });
  await tx.kpiValue.upsert({
    where: { sourceSubmissionItemId: itemId },
    create: { kpiDefinitionId: kpi.id, institutionId, period: quarter, value, sourceSubmissionItemId: itemId, approvedAt, coverageNote },
    update: { value, approvedAt, coverageNote },
  });
}
