import ExcelJS from "exceljs";
import {
  numberRangeMessage,
  parseSubmissionFile,
  readPercentCell,
  validateFieldValues,
} from "@/modules/data-submissions/dataset-template";
import {
  heldBackNote,
  isSingleDiscoValueForNationalKpi,
  receivedMessage,
} from "@/modules/data-submissions/submit-flow";

jest.setTimeout(60000);

const field = (over: Record<string, unknown> = {}) =>
  ({ id: "f1", label: "Renewable Generation Share", type: "NUMBER", required: true, unit: "%", kpiDefinitionId: "k1", ...over }) as never;

describe("range rules (BULK-010)", () => {
  it.each([-5, 150, 100.01, -0.01])("rejects %s for a percentage", (value) => {
    expect(validateFieldValues([field()], { f1: String(value) })[0]?.message).toContain("between 0 and 100");
  });

  it.each([0, 65.5, 100])("accepts %s for a percentage", (value) => {
    expect(validateFieldValues([field()], { f1: String(value) })).toEqual([]);
  });

  it("rejects a negative quantity for any other unit", () => {
    expect(validateFieldValues([field({ unit: "MW", label: "Installed capacity" })], { f1: "-3" })[0].message).toBe(
      "Installed capacity cannot be negative.",
    );
  });

  it("still allows a large quantity, since only a percentage has an upper limit", () => {
    expect(validateFieldValues([field({ unit: "customers" })], { f1: "12163412" })).toEqual([]);
    expect(validateFieldValues([field({ unit: "USD" })], { f1: "750000000" })).toEqual([]);
  });

  it("treats Infinity as not a number", () => {
    expect(validateFieldValues([field({ unit: "MW" })], { f1: "Infinity" })[0].message).toContain("must be a number");
  });

  it("reports the same rule through numberRangeMessage", () => {
    expect(numberRangeMessage({ label: "X", unit: "%" }, 150)).toContain("between 0 and 100");
    expect(numberRangeMessage({ label: "X", unit: null }, 5)).toBeNull();
  });
});

describe("percentages from a spreadsheet (BULK-002)", () => {
  it("reads a percent-formatted cell showing 65.5% as 65.5, not 0.655", () => {
    expect(readPercentCell(0.655, "0.0%")).toBe("65.5");
    expect(readPercentCell(0.5, "0%")).toBe("50");
    expect(readPercentCell(1, "0.00%")).toBe("100");
  });

  it("reads a text cell such as '65.5%' without the percent sign", () => {
    expect(readPercentCell("65.5%", undefined)).toBe("65.5");
    expect(readPercentCell(" 12 % ", undefined)).toBe("12");
  });

  it("leaves everything else to the normal rules", () => {
    expect(readPercentCell(65.5, "General")).toBeNull();
    expect(readPercentCell("abc", "0.0%")).toBeNull();
    expect(readPercentCell("65.5 percent", undefined)).toBeNull();
  });

  async function fileWith(value: number | string, numFmt?: string) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow(["Period", "Renewable Generation Share"]);
    ws.addRow(["2025", value]);
    if (numFmt) ws.getCell("B2").numFmt = numFmt;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const dataset = { frequency: "Annual", submissionMode: "PER_INSTITUTION" } as never;

  it("turns the tester's percent-formatted file into 65.5", async () => {
    const rows = await parseSubmissionFile(await fileWith(0.655, "0.0%"), "a.xlsx", dataset, [field()]);
    expect(rows[0].values.f1).toBe("65.5");
    expect(validateFieldValues([field()], rows[0].values)).toEqual([]);
  });

  it("leaves a plain 65.5 as 65.5", async () => {
    const rows = await parseSubmissionFile(await fileWith(65.5), "a.xlsx", dataset, [field()]);
    expect(rows[0].values.f1).toBe("65.5");
  });

  it("does not rescale a percent-formatted cell in a column that is not a percentage", async () => {
    const rows = await parseSubmissionFile(await fileWith(0.655, "0.0%"), "a.xlsx", dataset, [field({ unit: "MW" })]);
    expect(rows[0].values.f1).toBe("0.655");
  });

  it("reads a percent-formatted 150% as 150, which the range rule then rejects", async () => {
    const rows = await parseSubmissionFile(await fileWith(1.5, "0%"), "a.xlsx", dataset, [field()]);
    expect(rows[0].values.f1).toBe("150");
    expect(validateFieldValues([field()], rows[0].values)[0].message).toContain("between 0 and 100");
  });
});

describe("honest messages (BULK-011)", () => {
  it("says exactly what was read, checked and rejected", () => {
    expect(receivedMessage(3, 6, 1)).toBe(
      "Received: 3 rows read, 6 values checked for format and range, none rejected, 1 submission was created. Nothing is published until a reviewer approves it.",
    );
    expect(receivedMessage(1, 1, 1)).toContain("1 row read, 1 value checked");
    expect(receivedMessage(12, 24, 12)).toContain("12 submissions were created");
  });

  it("no longer claims the data was validated as a whole", () => {
    expect(receivedMessage(1, 1, 1).toLowerCase()).not.toContain("validation passed");
  });
});

describe("a single DisCo does not become the national figure (INT-003)", () => {
  it("holds back a DisCo's value for a national KPI", () => {
    expect(isSingleDiscoValueForNationalKpi("Disco", "National average, weighted by household count")).toBe(true);
    expect(isSingleDiscoValueForNationalKpi("Disco", "National")).toBe(true);
  });

  it("lets a national agency report a national KPI", () => {
    expect(isSingleDiscoValueForNationalKpi("Federal Agency", "National aggregate")).toBe(false);
    expect(isSingleDiscoValueForNationalKpi("Regulator", "National")).toBe(false);
  });

  it("lets a DisCo report a KPI that is not national", () => {
    expect(isSingleDiscoValueForNationalKpi("Disco", "By DisCo")).toBe(false);
    expect(isSingleDiscoValueForNationalKpi("Disco", "")).toBe(false);
  });

  it("explains why the value was not published", () => {
    const note = heldBackNote(["ATC&C Loss Rate", "ATC&C Loss Rate", "Metering Rate"]);
    expect(note).toContain("ATC&C Loss Rate, Metering Rate");
    expect(note).toContain("every DisCo");
  });
});
