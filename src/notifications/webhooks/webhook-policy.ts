import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";

export const WEBHOOK_PATTERNS = [
  "submission.decision_recorded",
  "submission.uploaded",
  "submission.decisions_recorded",
  "submission.*",
  "user.invited",
  "user.*",
  "report.ready",
  "report.*",
] as const;

export function assertWebhookAdministrator(user: AuthenticatedUser): void {
  if (!(user.roles?.length ? user.roles : [user.role]).includes("SYSTEM_ADMINISTRATOR")) {
    throw new ForbiddenException("Only integration administrators can manage webhooks.");
  }
}

export function assertWebhookPatterns(patterns: string[]): void {
  if (
    !patterns.length ||
    patterns.length > WEBHOOK_PATTERNS.length ||
    patterns.some((pattern) => !WEBHOOK_PATTERNS.some((allowed) => allowed === pattern))
  ) {
    throw new BadRequestException("Select approved webhook events.");
  }
}

// New domain events and fields are private until explicitly approved here.
// In particular, recovery URLs, passwords and credentials must never be sent.
export function publicWebhookPayload(event: string, payload: unknown): Record<string, string> | null {
  const fields: Record<string, readonly string[]> = {
    "submission.decision_recorded": ["submissionId", "institutionId", "decision"],
    "submission.uploaded": ["submissionId", "institutionId", "batchId", "submissionCount", "datasetCount"],
    "submission.decisions_recorded": ["submissionId", "institutionId", "decision", "batchId", "submissionCount"],
    "user.invited": ["userId", "email"],
    "report.ready": ["reportId"],
  };
  const keys = fields[event];
  if (!keys || !payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;
  return Object.fromEntries(
    keys
      .filter((key) => typeof source[key] === "string" || typeof source[key] === "number")
      .map((key) => [key, String(source[key])]),
  );
}
