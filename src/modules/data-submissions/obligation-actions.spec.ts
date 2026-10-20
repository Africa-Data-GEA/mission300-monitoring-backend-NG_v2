import { toObligationView } from "@/modules/data-submissions/data-submissions.mappers";

const obligation = {
  id: "obl-1",
  datasetId: "d1",
  reportingPeriod: "Q3 2026",
  dueDate: new Date("2026-10-01T00:00:00.000Z"),
  acceptedSubmissionId: null,
  institution: { name: "REA" },
  focalPerson: null,
  dataset: { id: "d1", name: "REA Mini-Grid & SHS Output", frequency: "Quarterly", templateFileName: "t.xlsx", templateVersion: "1" },
} as never;

const withStatus = (status: string) => toObligationView(obligation, { status } as never).availableActions;
const FULL = ["enter-data", "upload-template", "download-template"];

describe("what a provider can do on an obligation", () => {
  it("offers entry, upload and download before anything is submitted", () => {
    expect(toObligationView(obligation, null).availableActions).toEqual(FULL);
  });

  it.each(["REJECTED", "RETURNED"])("offers entry, upload and download again after %s", (status) => {
    expect(withStatus(status)).toEqual(FULL);
  });

  it.each(["PENDING", "UNDER_REVIEW"])("only allows viewing while %s is awaiting a decision", (status) => {
    expect(withStatus(status)).toEqual(["view"]);
  });

  it("stays listed as provisionally approved, view only, with no overdue label", () => {
    const view = toObligationView(obligation, { status: "PROVISIONALLY_APPROVED" } as never);
    expect(view.status.code).toBe("provisional");
    expect(view.availableActions).toEqual(["view"]);
    expect(view.dueLabel).toBe("Submitted");
  });
});
