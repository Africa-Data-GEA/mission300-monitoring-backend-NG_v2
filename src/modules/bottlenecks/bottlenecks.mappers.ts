import type { Bottleneck, BottleneckStatusHistoryEntry, Escalation, Pillar } from "@prisma/client";
import { toKebabCase } from "@/common/utils/enum-casing";
import type { PrismaService } from "@/prisma/prisma.service";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

type BottleneckFull = Bottleneck & { pillar: Pillar; statusHistory: BottleneckStatusHistoryEntry[] };

export interface BottleneckLink {
  type: "programme" | "project";
  id: string;
  name: string;
}

export async function loadBottleneckLinks(
  prisma: Pick<PrismaService, "project" | "programme">,
  linkedRecords: string[],
): Promise<Map<string, BottleneckLink>> {
  const ids = [...new Set(linkedRecords.filter((id) => id))];
  const links = new Map<string, BottleneckLink>();
  if (ids.length === 0) return links;
  const [projects, programmes] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.programme.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
  ]);
  for (const programme of programmes) links.set(programme.id, { type: "programme", id: programme.id, name: programme.name });
  for (const project of projects) links.set(project.id, { type: "project", id: project.id, name: project.name });
  return links;
}

/** Matches bottleneckRecordSchema exactly. `ageDays` is derived from `dateRaised`, never stored. */
export function toBottleneckRecord(b: BottleneckFull, now: Date, links: Map<string, BottleneckLink> = new Map()) {
  return {
    id: b.id,
    issue: b.issue,
    category: toKebabCase(b.category),
    severity: toKebabCase(b.severity),
    pillar: b.pillar.slug,
    linkedRecord: b.linkedRecord,
    link: links.get(b.linkedRecord) ?? null,
    institution: b.institution,
    dateRaised: b.dateRaised.toISOString(),
    ageDays: daysBetween(b.dateRaised, now),
    followUp: b.followUp,
    escalationStatus: toKebabCase(b.escalationStatus),
    status: toKebabCase(b.status),
    lifecycleStage: toKebabCase(b.lifecycleStage),
    statusHistory: b.statusHistory.map((h) => ({ period: h.period, status: toKebabCase(h.status) })),
  };
}

/**
 * Matches escalationRecordSchema exactly. `daysOverdue` is derived from
 * `dueDate`, never stored - negative means not yet due (see the schema's
 * own comment on ESC-2025-022 in the frontend mock). Pinned to 0 once
 * resolved, matching the mock's own ESC-2025-009 example, rather than
 * letting a resolved item's "overdue" figure keep growing after the fact.
 */
export function toEscalationRecord(e: Escalation, now: Date) {
  return {
    id: e.id,
    bottleneckId: e.bottleneckId,
    decisionRequired: e.decisionRequired,
    level: toKebabCase(e.level),
    owner: e.owner,
    dueDate: e.dueDate.toISOString(),
    daysOverdue: e.status === "RESOLVED" ? 0 : daysBetween(e.dueDate, now),
    status: toKebabCase(e.status),
    resolution: e.resolution,
    evidenceUrl: e.evidenceUrl,
  };
}

/**
 * Bottleneck ids linked to each of the given Programme/Project ids -
 * `linkedRecord` matching, exactly one query for the whole batch (not
 * one-per-record). Used by programs.service.ts to derive
 * ProgrammeRecord.bottlenecks / ProjectRecord.bottlenecks without storing a
 * redundant array anywhere - see the schema comment on `Bottleneck.
 * linkedRecord`.
 */
export async function loadBottleneckIdsByLinkedRecord(
  prisma: PrismaService,
  recordIds: string[],
): Promise<Map<string, string[]>> {
  if (recordIds.length === 0) return new Map();
  const rows = await prisma.bottleneck.findMany({
    where: { linkedRecord: { in: recordIds } },
    select: { id: true, linkedRecord: true },
  });
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.linkedRecord) ?? [];
    list.push(row.id);
    map.set(row.linkedRecord, list);
  }
  return map;
}
