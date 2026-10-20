import ExcelJS from "exceljs";
import { monthFromDateCell, parseSubmissionFile } from "@/modules/data-submissions/dataset-template";

jest.setTimeout(30000);

const dataset = { id: "d1", frequency: "Quarterly", submissionMode: "NERC_CONSOLIDATED" } as never;
const fields = [
  { id: "f1", label: "Metered Customers", type: "NUMBER", unit: null },
  { id: "f2", label: "Unmetered Customers", type: "NUMBER", unit: null },
] as never;

async function file(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Submission");
  ws.addRow(["Discos", "Date", "Year", "Metered Customers", "Unmetered Customers"]);
  rows.forEach((row) => ws.addRow(row));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("a quarterly consolidated NERC file, which has no Month_Name column", () => {
  it("takes the quarter from a month name in the Date column", async () => {
    const rows = await parseSubmissionFile(await file([["Ikeja Electric", "September", 2026, 10, 5]]), "t.xlsx", dataset, fields);
    expect(rows[0].period).toBe("Q3 2026");
    expect(rows[0].institutionName).toBe("Ikeja Electric");
  });

  it("takes the quarter from a real date", async () => {
    const rows = await parseSubmissionFile(await file([["Ikeja Electric", new Date(Date.UTC(2026, 5, 30)), 2026, 10, 5]]), "t.xlsx", dataset, fields);
    expect(rows[0].period).toBe("Q2 2026");
  });

  it("reads the month from several date spellings", () => {
    expect(monthFromDateCell("march")).toBe("March");
    expect(monthFromDateCell("2026-11-30")).toBe("November");
    expect(monthFromDateCell(new Date(Date.UTC(2026, 0, 31)))).toBe("January");
    expect(monthFromDateCell("not a date")).toBe("");
  });

  it("still refuses a row with no usable month, instead of guessing", async () => {
    await expect(parseSubmissionFile(await file([["Ikeja Electric", "", 2026, 10, 5]]), "t.xlsx", dataset, fields)).rejects.toThrow(/Unrecognized month/);
  });
});
