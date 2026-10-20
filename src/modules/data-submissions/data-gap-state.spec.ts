import { gapStateFor, type GapObligation, type GapSubmission } from "@/modules/data-submissions/data-gap-state";

const NOW = new Date("2026-10-18T00:00:00.000Z");
const obligation = (dueDate: string, id = "o1"): GapObligation => ({
  id,
  datasetId: "d1",
  dueDate: new Date(dueDate),
  acceptedSubmissionId: null,
});
const submission = (status: string, day: number, obligationId = "o1"): GapSubmission => ({
  obligationId,
  status,
  createdAt: new Date(Date.UTC(2026, 9, day)),
});

describe("why a KPI has no data", () => {
  it("has no reporting obligation when no dataset feeds the indicator", () => {
    expect(gapStateFor(null, [], [], NOW)).toMatchObject({ category: "No reporting obligation", statusCode: null });
  });

  it("has no obligation scheduled when a dataset feeds it but none exists", () => {
    expect(gapStateFor("REA Programme Financing", [], [], NOW)).toMatchObject({
      category: "No obligation scheduled",
      statusCode: null,
    });
  });

  it("is awaiting submission and overdue once the due date has passed", () => {
    expect(gapStateFor("REA Programme Financing", [obligation("2026-10-14")], [], NOW)).toMatchObject({
      category: "Awaiting submission",
      statusCode: "overdue",
      nextAction: "Submit data through the REA Programme Financing reporting obligation.",
    });
  });

  it("is awaiting submission and due before the due date", () => {
    expect(gapStateFor("X", [obligation("2026-12-31")], [], NOW).statusCode).toBe("due");
  });

  it("is in review while a submission is pending", () => {
    expect(gapStateFor("X", [obligation("2026-10-14")], [submission("PENDING", 10)], NOW)).toMatchObject({
      category: "Submission in review",
      statusCode: "pending-review",
    });
  });

  it("needs correction after a rejection, using the newest submission only", () => {
    expect(gapStateFor("X", [obligation("2026-10-14")], [submission("REJECTED", 10)], NOW)).toMatchObject({
      category: "Needs correction",
      statusCode: "rejected",
    });
    expect(
      gapStateFor("X", [obligation("2026-10-14")], [submission("REJECTED", 10), submission("RETURNED", 12)], NOW).statusCode,
    ).toBe("returned");
  });

  it("flags an approved submission that published nothing for the indicator", () => {
    expect(gapStateFor("X", [obligation("2026-10-14")], [submission("APPROVED", 10)], NOW)).toMatchObject({
      category: "Approved, value not published",
      statusCode: "approved",
    });
  });

  it("ignores submissions that belong to other obligations", () => {
    expect(gapStateFor("X", [obligation("2026-10-14")], [submission("PENDING", 10, "other")], NOW).category).toBe(
      "Awaiting submission",
    );
  });
});
