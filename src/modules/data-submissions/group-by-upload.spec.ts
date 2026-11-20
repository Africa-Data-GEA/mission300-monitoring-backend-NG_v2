import { publicWebhookPayload } from "@/notifications/webhooks/webhook-policy";
import { groupByUpload } from "./data-submissions.mappers";

function submission(id: string, institution: string, period: string, batchId: string | null) {
  return {
    id,
    batchId,
    obligationId: `o-${id}`,
    status: "PENDING",
    method: "UPLOAD",
    version: 1,
    createdAt: new Date(),
    institution: { name: institution },
    submittedBy: { fullName: "NERC Provider" },
    obligation: { reportingPeriod: period, dataset: { name: "DisCo Revenue Billed" }, acceptedSubmissionId: null },
    reviewer: null,
    reviewDecisions: [],
  } as never;
}

describe("validation queue grouping", () => {
  it("collapses one upload into a single row and keeps single submissions as they are", () => {
    const rows = groupByUpload([
      submission("a", "Abuja", "October 2026", "b1"),
      submission("b", "Benin", "October 2026", "b1"),
      submission("c", "Eko", "November 2026", "b1"),
      submission("d", "REA", "Q3 2026", null),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      batchId: "b1",
      batchCount: 3,
      institution: "3 institutions",
      reportingPeriod: "2 periods",
      submissionIds: ["a", "b", "c"],
    });
    expect(rows[1]).toMatchObject({ id: "d", institution: "REA" });
    expect((rows[1] as { batchId?: string }).batchId).toBeUndefined();
  });
});

describe("upload webhook payload", () => {
  it("carries one event per upload with the submission count as text", () => {
    expect(
      publicWebhookPayload("submission.uploaded", {
        submissionId: "s1",
        institutionId: "i1",
        batchId: "b1",
        submissionCount: 12,
        secret: "x",
      }),
    ).toEqual({ submissionId: "s1", institutionId: "i1", batchId: "b1", submissionCount: "12" });
  });
});
