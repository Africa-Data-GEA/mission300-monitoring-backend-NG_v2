import { projectContact } from "@/modules/programs/programs.mappers";

describe("projectContact", () => {
  it("keeps a valid contact as entered", () => {
    expect(projectContact({ contactName: " Ada Obi ", contactEmail: " ada@rea.gov.ng ", leadName: "Lead" })).toEqual({
      contactName: "Ada Obi",
      contactEmail: "ada@rea.gov.ng",
    });
  });

  it("falls back to the project lead when no contact name was recorded", () => {
    expect(projectContact({ contactName: "", contactEmail: "ada@rea.gov.ng", leadName: "Fatima Suleiman" }).contactName).toBe(
      "Fatima Suleiman",
    );
  });

  it("says not assigned when there is neither a contact nor a lead", () => {
    expect(projectContact({ contactName: " ", contactEmail: "ada@rea.gov.ng", leadName: "" }).contactName).toBe("Not assigned");
  });

  it("replaces a missing or malformed email with the unassigned address", () => {
    expect(projectContact({ contactName: "Ada", contactEmail: "", leadName: "" }).contactEmail).toBe("unassigned@example.gov.ng");
    expect(projectContact({ contactName: "Ada", contactEmail: "not an email", leadName: "" }).contactEmail).toBe(
      "unassigned@example.gov.ng",
    );
    expect(projectContact({ contactName: "Ada", contactEmail: "ada@localhost", leadName: "" }).contactEmail).toBe(
      "unassigned@example.gov.ng",
    );
    expect(projectContact({ contactName: "Ada", contactEmail: "ada @rea.gov.ng", leadName: "" }).contactEmail).toBe(
      "unassigned@example.gov.ng",
    );
  });
});
