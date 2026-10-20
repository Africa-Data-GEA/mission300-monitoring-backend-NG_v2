import type { Prisma } from "@prisma/client";
import { toKebabCase } from "@/common/utils/enum-casing";
import type { RelatedLink } from "@/modules/learning-log/learning-log-links";

/** Matches learningLogEntrySchema exactly (learning-log.ts). */
export function toLearningLogEntry(
  entry: Prisma.LearningLogEntryGetPayload<{ include: { decidedBy: true } }>,
  links: Map<string, RelatedLink> = new Map(),
) {
  return {
    id: entry.id,
    title: entry.title,
    area: toKebabCase(entry.area),
    entryType: toKebabCase(entry.entryType),
    decision: entry.decision,
    rationale: entry.rationale,
    context: entry.context,
    lesson: entry.lesson,
    recommendation: entry.recommendation,
    evidence: entry.evidence,
    relatedRecord: entry.relatedRecord,
    related: links.get(entry.relatedRecord ?? "") ?? null,
    reviewCycle: entry.reviewCycle,
    status: toKebabCase(entry.status),
    decidedBy: entry.decidedBy.fullName,
    decidedAt: entry.decidedAt.toISOString(),
  };
}
