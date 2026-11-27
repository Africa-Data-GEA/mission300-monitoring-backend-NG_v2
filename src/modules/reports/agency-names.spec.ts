import { agencyAliases, belongsToAgency } from "./agency-names";

describe("agency matching", () => {
  const rea = agencyAliases("Rural Electrification Agency (REA)");
  const niso = agencyAliases("NISO / TCN");

  it("matches the full name, the short name and the acronym", () => {
    expect(belongsToAgency("Rural Electrification Agency", rea)).toBe(true);
    expect(belongsToAgency("rea", rea)).toBe(true);
    expect(belongsToAgency("TCN", niso)).toBe(true);
  });

  it("matches one of several named institutions", () => {
    expect(belongsToAgency("NERC and REA", rea)).toBe(true);
  });

  it("does not match another agency or a blank", () => {
    expect(belongsToAgency("NERC", rea)).toBe(false);
    expect(belongsToAgency("", rea)).toBe(false);
    expect(belongsToAgency("Reagan Power", rea)).toBe(false);
  });
});
