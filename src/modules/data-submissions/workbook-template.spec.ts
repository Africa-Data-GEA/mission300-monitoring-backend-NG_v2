import type { Dataset, DatasetField } from "@prisma/client";
import {
  generateWorkbookTemplateBuffer,
  loadWorkbook,
  parseSheet,
  workbookSheetNames,
} from "./dataset-template";

const dataset = (id: string, name: string, extra: Partial<Dataset> = {}) =>
  ({ id, name, frequency: "Quarterly", submissionMode: "PER_INSTITUTION", ...extra }) as Dataset;
const field = (id: string, label: string, order: number) =>
  ({ id, label, order, type: "NUMBER", required: true, unit: "" }) as unknown as DatasetField;

describe("submission workbook", () => {
  it("gives every dataset its own safe, unique sheet name", () => {
    const names = workbookSheetNames([
      dataset("a", "Generation: Capacity / Output"),
      dataset("b", "A very long dataset name that goes past the limit of thirty one characters"),
      dataset("c", "A very long dataset name that goes past the limit of thirty one characters, second"),
    ]);
    const values = [...names.values()];
    expect(new Set(values.map((name) => name.toLowerCase())).size).toBe(3);
    values.forEach((name) => {
      expect(name.length).toBeLessThanOrEqual(31);
      expect(name).not.toMatch(/[\\?*[\]:/]/);
    });
  });

  it("builds one sheet per dataset and reads each sheet back with its own columns", async () => {
    const solar = dataset("d1", "Solar Capacity");
    const grid = dataset("d2", "Grid Losses");
    const buffer = await generateWorkbookTemplateBuffer([
      { dataset: solar, fields: [field("f1", "Installed MW", 1)] },
      { dataset: grid, fields: [field("f2", "Losses %", 1)] },
    ]);
    const workbook = await loadWorkbook(buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Instructions", "Grid Losses", "Solar Capacity"]);

    const solarSheet = workbook.getWorksheet("Solar Capacity");
    solarSheet!.getCell(2, 1).value = "Q3 2026";
    solarSheet!.getCell(2, 2).value = 12;
    const rows = parseSheet(solarSheet, solar, [field("f1", "Installed MW", 1)]);
    expect(rows).toEqual([{ period: "Q3 2026", values: { f1: "12" }, institutionName: undefined, rowNumber: 2 }]);

    const prefilled = await loadWorkbook(
      await generateWorkbookTemplateBuffer([{ dataset: solar, fields: [field("f1", "Installed MW", 1)], openPeriods: ["Q3 2026", "Q4 2026"] }]),
    );
    const sheet = prefilled.getWorksheet("Solar Capacity");
    expect(parseSheet(sheet, solar, [field("f1", "Installed MW", 1)], { skipUnfilled: true })).toEqual([]);
    sheet!.getCell(3, 2).value = 5;
    expect(parseSheet(sheet, solar, [field("f1", "Installed MW", 1)], { skipUnfilled: true })).toEqual([
      { period: "Q4 2026", values: { f1: "5" }, institutionName: undefined, rowNumber: 3 },
    ]);

    expect(parseSheet(workbook.getWorksheet("Grid Losses"), grid, [field("f2", "Losses %", 1)])).toEqual([]);
  });
});
