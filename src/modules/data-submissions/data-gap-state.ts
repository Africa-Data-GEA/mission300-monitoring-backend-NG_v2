export interface GapObligation {
  id: string;
  datasetId: string;
  dueDate: Date;
  acceptedSubmissionId: string | null;
}

export interface GapSubmission {
  obligationId: string | null;
  status: string;
  createdAt: Date;
}

export interface GapState {
  category: string;
  nextAction: string;
  statusCode: "pending-review" | "returned" | "rejected" | "approved" | "provisional" | "overdue" | "due" | null;
}

export const NO_DATASET_STATE: GapState = {
  category: "No reporting obligation",
  nextAction: "Assign a reporting obligation for this indicator.",
  statusCode: null,
};

export function gapStateFor(
  datasetName: string | null,
  obligations: GapObligation[],
  submissions: GapSubmission[],
  now: Date,
): GapState {
  if (!datasetName) return NO_DATASET_STATE;

  const obligationIds = new Set(obligations.map((obligation) => obligation.id));
  const own = submissions
    .filter((submission) => submission.obligationId && obligationIds.has(submission.obligationId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  if (own.some((submission) => submission.status === "PENDING" || submission.status === "UNDER_REVIEW")) {
    return {
      category: "Submission in review",
      nextAction: "A reviewer needs to decide on the submitted data.",
      statusCode: "pending-review",
    };
  }

  const latestByObligation = new Map<string, GapSubmission>();
  for (const submission of own) {
    if (submission.obligationId && !latestByObligation.has(submission.obligationId)) {
      latestByObligation.set(submission.obligationId, submission);
    }
  }
  const latest = [...latestByObligation.values()];

  const rejected = latest.find((submission) => submission.status === "REJECTED");
  const returned = latest.find((submission) => submission.status === "RETURNED");
  if (rejected || returned) {
    return {
      category: "Needs correction",
      nextAction: `Correct and resubmit the ${datasetName} return.`,
      statusCode: rejected ? "rejected" : "returned",
    };
  }

  const approved = latest.find((submission) => submission.status === "APPROVED" || submission.status === "PROVISIONALLY_APPROVED");
  if (approved) {
    return {
      category: "Approved, value not published",
      nextAction: "The submission was approved but did not publish a value for this indicator. Check the national roll-up.",
      statusCode: approved.status === "APPROVED" ? "approved" : "provisional",
    };
  }

  if (obligations.length === 0) {
    return {
      category: "No obligation scheduled",
      nextAction: `Schedule a reporting obligation for the ${datasetName} return.`,
      statusCode: null,
    };
  }

  const overdue = obligations.some((obligation) => obligation.dueDate.getTime() < now.getTime());
  return {
    category: "Awaiting submission",
    nextAction: `Submit data through the ${datasetName} reporting obligation.`,
    statusCode: overdue ? "overdue" : "due",
  };
}
