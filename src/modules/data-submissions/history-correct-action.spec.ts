import { reviewSummary, toSubmissionListItem } from "@/modules/data-submissions/data-submissions.mappers";

const row = (status: string, acceptedSubmissionId: string | null = null) =>
  ({
    id: "sub-1",
    obligationId: "obl-1",
    status,
    method: "UPLOAD",
    version: 1,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    institution: { name: "REA" },
    submittedBy: { fullName: "Provider" },
    obligation: { reportingPeriod: "Q3 2026", acceptedSubmissionId, dataset: { name: "REA Mini-Grid & SHS Output" } },
  }) as never;

describe("what Submission History offers on a row", () => {
  it("carries the obligation so the row can link back to it", () => {
    expect(toSubmissionListItem(row("RETURNED"), true).obligationId).toBe("obl-1");
  });

  it.each(["RETURNED", "REJECTED"])("offers correction on the latest %s submission", (status) => {
    expect(toSubmissionListItem(row(status), true).availableActions).toEqual(["view", "correct"]);
  });

  it("does not offer correction on an older returned submission that has been replaced", () => {
    expect(toSubmissionListItem(row("RETURNED"), false).availableActions).toEqual(["view"]);
  });

  it("does not offer correction once the obligation has an accepted submission", () => {
    expect(toSubmissionListItem(row("RETURNED", "sub-9"), true).availableActions).toEqual(["view"]);
  });

  it("keeps review for submissions awaiting a decision", () => {
    expect(toSubmissionListItem(row("PENDING"), true).availableActions).toEqual(["review"]);
  });
});

const decision = (type: string, day: number) => ({ decision: type, createdAt: new Date(Date.UTC(2026, 9, day)) }) as never;

describe("what Submission History says about the decision", () => {
  it("says a provisional submission is awaiting confirmation", () => {
    expect(reviewSummary("PROVISIONALLY_APPROVED", [decision("PROVISIONALLY_APPROVE", 5)])).toBe(
      "Provisional — awaiting confirmation.",
    );
  });

  it("says when an approval was confirmed after being provisional", () => {
    expect(reviewSummary("APPROVED", [decision("PROVISIONALLY_APPROVE", 5), decision("APPROVE", 9)])).toBe(
      "Confirmed after provisional approval on 5 Oct 2026.",
    );
  });

  it("gives a plain approval its date", () => {
    expect(reviewSummary("APPROVED", [decision("APPROVE", 9)])).toBe("Approved on 9 Oct 2026.");
  });

  it("notes when a provisional approval was withdrawn", () => {
    expect(reviewSummary("REJECTED", [decision("PROVISIONALLY_APPROVE", 5), decision("REJECT", 9)])).toBe(
      "Rejected on 9 Oct 2026. Provisional approval withdrawn.",
    );
  });

  it("says awaiting review before any decision", () => {
    expect(reviewSummary("PENDING", [])).toBe("Awaiting review.");
  });
});
