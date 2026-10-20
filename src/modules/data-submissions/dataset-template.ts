import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import type { Dataset, DatasetField } from "@prisma/client";
import { DISCO_CANONICAL_NAMES, MONTH_NAMES, MONTH_TO_QUARTER } from "@/modules/data-submissions/disco-institutions";

const SHEET_NAME = "Submission";
const LOOKUP_SHEET_NAME = "Lookup";
const PERIOD_COLUMN_KEY = "period";
const DISCOS_COLUMN_KEY = "discos";
const DATE_COLUMN_KEY = "date";
const YEAR_COLUMN_KEY = "year";
const MONTH_NAME_COLUMN_KEY = "monthName";
const DROPDOWN_ROW_COUNT = 500;

function periodColumnHeader(frequency: string): string {
  if (frequency === "Monthly") return "Period (e.g. January 2026)";
  if (frequency === "Annual") return "Period (e.g. 2026)";
  return "Period (e.g. Q3 2026)";
}

export async function generateTemplateBuffer(dataset: Dataset, fields: DatasetField[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);
  const measureColumns = [...fields]
    .sort((a, b) => a.order - b.order)
    .map((field) => ({ header: field.label, key: field.id, width: 28 }));

  if (dataset.submissionMode === "NERC_CONSOLIDATED") {
    const identifierColumns = [{ header: "Discos", key: DISCOS_COLUMN_KEY, width: 32 }];
    const hasMonthColumn = dataset.frequency === "Monthly";
    if (dataset.frequency === "Monthly") {
      identifierColumns.push(
        { header: "Date", key: DATE_COLUMN_KEY, width: 16 },
        { header: "Year", key: YEAR_COLUMN_KEY, width: 10 },
        { header: "Month_Name", key: MONTH_NAME_COLUMN_KEY, width: 16 },
      );
    } else if (dataset.frequency === "Quarterly") {
      identifierColumns.push({ header: "Date", key: DATE_COLUMN_KEY, width: 16 }, { header: "Year", key: YEAR_COLUMN_KEY, width: 10 });
    } else {
      identifierColumns.push({ header: "Year", key: YEAR_COLUMN_KEY, width: 10 });
    }
    sheet.columns = [...identifierColumns, ...measureColumns];

    // Discos/Month_Name are free text otherwise, and a typo there silently
    // fails to resolve to an institution/period at upload time - a
    // dropdown constrains entry to values the parser actually recognizes.
    // Long option lists don't fit Excel's ~255-char inline list formula,
    // so they live on a hidden lookup sheet the dropdown references.
    const lookupSheet = workbook.addWorksheet(LOOKUP_SHEET_NAME, { state: "veryHidden" });
    DISCO_CANONICAL_NAMES.forEach((name, index) => {
      lookupSheet.getCell(index + 1, 1).value = name;
    });
    MONTH_NAMES.forEach((name, index) => {
      lookupSheet.getCell(index + 1, 2).value = name;
    });

    const discosColumnNumber = 1;
    const monthNameColumnNumber = hasMonthColumn ? identifierColumns.findIndex((c) => c.key === MONTH_NAME_COLUMN_KEY) + 1 : null;
    for (let row = 2; row <= DROPDOWN_ROW_COUNT + 1; row++) {
      sheet.getCell(row, discosColumnNumber).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`${LOOKUP_SHEET_NAME}!$A$1:$A$${DISCO_CANONICAL_NAMES.length}`],
        showErrorMessage: true,
        errorStyle: "error",
        error: "Pick a DisCo from the dropdown list.",
      };
      if (monthNameColumnNumber) {
        sheet.getCell(row, monthNameColumnNumber).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`${LOOKUP_SHEET_NAME}!$B$1:$B$${MONTH_NAMES.length}`],
          showErrorMessage: true,
          errorStyle: "error",
          error: "Pick a month from the dropdown list.",
        };
      }
    }
  } else {
    sheet.columns = [{ header: periodColumnHeader(dataset.frequency), key: PERIOD_COLUMN_KEY, width: 24 }, ...measureColumns];
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export interface ParsedSubmissionRow {
  period: string;
  values: Record<string, string>;
  institutionName?: string;
  rowNumber: number;
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function isPeriodHeader(headerText: string): boolean {
  return normalizeLabel(headerText).startsWith("period");
}

function isRowBlank(row: ExcelJS.Row): boolean {
  let hasValue = false;
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== "") hasValue = true;
  });
  return !hasValue;
}

type ColumnRole =
  | { kind: "period" }
  | { kind: "field"; fieldId: string }
  | { kind: "discos" }
  | { kind: "year" }
  | { kind: "monthName" }
  | { kind: "date" }
  | { kind: "ignored" };

export function monthFromDateCell(raw: unknown): string {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return MONTH_NAMES[raw.getUTCMonth()] ?? "";
  const text = String(raw ?? "").trim();
  const named = MONTH_NAMES.find((month) => month.toLowerCase() === text.toLowerCase());
  if (named) return named;
  const iso = /^(\d{4})-(\d{2})(?:-\d{2})?/.exec(text);
  if (iso) return MONTH_NAMES[Number(iso[2]) - 1] ?? "";
  return "";
}

function periodFromComponents(frequency: string, year: string, monthName: string): string {
  if (frequency === "Monthly") return `${monthName} ${year}`;
  if (frequency === "Quarterly") {
    const quarter = MONTH_TO_QUARTER[monthName];
    if (!quarter) throw new Error(`Unrecognized month name "${monthName}" while deriving a quarterly period.`);
    return `Q${quarter} ${year}`;
  }
  return year;
}

export async function parseSubmissionFile(
  buffer: Buffer,
  fileName: string,
  dataset: Dataset,
  fields: DatasetField[],
): Promise<ParsedSubmissionRow[]> {
  const workbook = new ExcelJS.Workbook();
  if (fileName.toLowerCase().endsWith(".csv")) {
    await workbook.csv.read(Readable.from(buffer));
  } else {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  }

  const sheet = workbook.worksheets[0];
  const headerRow = sheet?.getRow(1);
  if (!sheet || !headerRow) {
    throw new Error("The uploaded file has no header row to read.");
  }

  const consolidated = dataset.submissionMode === "NERC_CONSOLIDATED";
  const fieldByLabel = new Map(fields.map((field) => [normalizeLabel(field.label), field]));
  const columnRoles = new Map<number, ColumnRole>();
  headerRow.eachCell((cell, columnNumber) => {
    const headerText = String(cell.value ?? "");
    const normalized = normalizeLabel(headerText);

    if (consolidated) {
      if (normalized === "discos") {
        columnRoles.set(columnNumber, { kind: "discos" });
        return;
      }
      if (normalized === "year") {
        columnRoles.set(columnNumber, { kind: "year" });
        return;
      }
      if (normalized === "month_name") {
        columnRoles.set(columnNumber, { kind: "monthName" });
        return;
      }
      if (normalized === "date") {
        columnRoles.set(columnNumber, { kind: "date" });
        return;
      }
    } else if (isPeriodHeader(headerText)) {
      columnRoles.set(columnNumber, { kind: "period" });
      return;
    }

    const field = fieldByLabel.get(normalized);
    if (field) columnRoles.set(columnNumber, { kind: "field", fieldId: field.id });
  });

  const rows: ParsedSubmissionRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const dataRow = sheet.getRow(rowNumber);
    if (isRowBlank(dataRow)) continue;

    let period = "";
    let institutionName: string | undefined;
    let year = "";
    let monthName = "";
    let dateMonth = "";
    const values: Record<string, string> = {};
    for (const [columnNumber, role] of columnRoles) {
      const cell = dataRow.getCell(columnNumber);
      const raw = cell.value;
      let text = raw === null || raw === undefined ? "" : String(raw).trim();
      if (role.kind === "field") {
        const field = fields.find((candidate) => candidate.id === role.fieldId);
        const percent = field && isPercentField(field) ? readPercentCell(raw, cell.numFmt) : null;
        if (percent !== null) text = percent;
      }
      if (role.kind === "period") period = text;
      else if (role.kind === "discos") institutionName = text;
      else if (role.kind === "year") year = text;
      else if (role.kind === "monthName") monthName = text;
      else if (role.kind === "date") dateMonth = monthFromDateCell(raw);
      else if (role.kind === "field") values[role.fieldId] = text;
    }

    if (consolidated) {
      period = year ? periodFromComponents(dataset.frequency, year, monthName || dateMonth) : "";
    }
    rows.push({ period, values, institutionName, rowNumber });
  }

  return rows;
}

const PERCENT_UNIT = "%";

function isPercentField(field: Pick<DatasetField, "unit">): boolean {
  return (field.unit ?? "").trim() === PERCENT_UNIT;
}

export function numberRangeMessage(field: Pick<DatasetField, "label" | "unit">, value: number): string | null {
  if (isPercentField(field)) {
    return value < 0 || value > 100 ? `${field.label} must be between 0 and 100, because it is a percentage.` : null;
  }
  return value < 0 ? `${field.label} cannot be negative.` : null;
}

export function readPercentCell(raw: unknown, numFmt: string | undefined): string | null {
  if (typeof raw === "number" && numFmt && numFmt.includes("%")) {
    return String(Number((raw * 100).toFixed(10)));
  }
  if (typeof raw === "string") {
    const match = /^\s*(-?\d+(?:\.\d+)?)\s*%\s*$/.exec(raw);
    if (match) return match[1];
  }
  return null;
}

export interface FieldValidationIssue {
  fieldId: string;
  label: string;
  message: string;
}

export function validateFieldValues(
  fields: DatasetField[],
  values: Record<string, string>,
): FieldValidationIssue[] {
  const issues: FieldValidationIssue[] = [];
  for (const field of fields) {
    const trimmed = values[field.id]?.trim() ?? "";
    if (field.required && !trimmed) {
      issues.push({ fieldId: field.id, label: field.label, message: `${field.label} is required.` });
      continue;
    }
    if (trimmed && field.type === "NUMBER") {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        issues.push({ fieldId: field.id, label: field.label, message: `${field.label} must be a number.` });
      } else {
        const rangeMessage = numberRangeMessage(field, parsed);
        if (rangeMessage) issues.push({ fieldId: field.id, label: field.label, message: rangeMessage });
      }
    }
  }
  return issues;
}

export function buildSubmissionItems(
  fields: DatasetField[],
  values: Record<string, string>,
  period: string,
): { kpiDefinitionId: string; period: string; value: number }[] {
  const items: { kpiDefinitionId: string; period: string; value: number }[] = [];
  for (const field of fields) {
    if (!field.kpiDefinitionId) continue;
    const trimmed = values[field.id]?.trim();
    if (!trimmed) continue;
    const value = Number(trimmed);
    if (Number.isNaN(value)) continue;
    items.push({ kpiDefinitionId: field.kpiDefinitionId, period, value });
  }
  return items;
}
