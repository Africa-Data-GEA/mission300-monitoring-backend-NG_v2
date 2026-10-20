import { LearningLogStatus, LearningLogType } from "@prisma/client";

const ALLOWED: Record<LearningLogType, LearningLogStatus[]> = {
  DECISION: ["PROPOSED", "DECIDED", "SUPERSEDED"],
  LEARNING: ["CAPTURED", "APPLIED", "SUPERSEDED"],
};

export function statusProblem(type: LearningLogType, status: LearningLogStatus): string | null {
  if (ALLOWED[type].includes(status)) return null;
  const label = type === "LEARNING" ? "learning" : "decision";
  return `A ${label} cannot have the status ${status.toLowerCase()}.`;
}
