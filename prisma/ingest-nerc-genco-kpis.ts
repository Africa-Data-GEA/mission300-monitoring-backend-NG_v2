import { join } from "node:path";
import ExcelJS from "exceljs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * One-off historical backfill of the two real generation-capacity KPIs
 * (M300-P1-002 "Installed Generation Capacity", M300-P1-016 "Available
 * Generation Capacity") from the same compiled NERC workbook the DisCo
 * performance backfill uses (see ingest-nerc-disco-data.ts).
 *
 * Unlike DiscoPerformanceRecord, a KpiValue can ONLY be created by an
 * approved Submission (the database enforces this - KpiValue.
 * sourceSubmissionItemId is a required, unique FK to SubmissionItem, which
 * itself always belongs to a Submission). So this script builds a real
 * (if backfilled) Submission -> SubmissionItem -> ReviewDecision ->
 * KpiValue chain per period, mirroring DataSubmissionsService.
 * recordDecision()'s own KpiValue-creation logic exactly, rather than
 * writing KpiValue directly and bypassing that rule.
 *
 * Idempotent: every row uses a deterministic id derived from
 * (kpiCode, period), safe to re-run.
 *
 * Run with: DATABASE_URL=... node dist/prisma/ingest-nerc-genco-kpis.js
 */

const WORKBOOK_PATH = join(process.cwd(), "prisma", "data", "nerc-disco-data-2020-2026.xlsx");

const NISO_INSTITUTION_ID = "seed-institution-niso-tcn";
const NISO_INSTITUTION_NAME = "NISO / TCN";

const MONTH_TO_QUARTER: Record<string, number> = {
  January: 1,
  February: 1,
  March: 1,
  April: 2,
  May: 2,
  June: 2,
  July: 3,
  August: 3,
  September: 3,
  October: 4,
  November: 4,
  December: 4,
};

function plantKey(plant: string): string {
  return plant.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in (value as { text?: string })) {
    return String((value as { text?: string }).text ?? "");
  }
  return String(value).trim();
}

function cellNumber(value: ExcelJS.CellValue): number {
  if (value === null || value === undefined || value === "" || value === "NULL") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const QUARTER_END_MONTH_DAY: Record<number, [number, number]> = {
  1: [2, 31], // March 31 (JS Date month is 0-indexed)
  2: [5, 30],
  3: [8, 30],
  4: [11, 31],
};

/**
 * toKpiProfile() (kpi-explorer.mappers.ts) derives a KPI's "current" value
 * by sorting KpiValue rows on approvedAt and taking the last one - so
 * approvedAt has to reflect the period's real chronological order, not
 * whatever order this backfill script happens to process periods in
 * (which follows Map iteration order, not calendar order). Setting
 * approvedAt to "now" at processing time would make "current" depend on
 * that incidental order rather than the actual period - this derives a
 * real date from the period string instead, so sorting by approvedAt and
 * sorting by period always agree.
 */
function approvedAtFor(period: string): Date {
  const quarterMatch = /^q([1-4])-(\d{4})$/.exec(period);
  if (quarterMatch) {
    const quarter = Number(quarterMatch[1]);
    const year = Number(quarterMatch[2]);
    const [month, day] = QUARTER_END_MONTH_DAY[quarter];
    return new Date(Date.UTC(year, month, day));
  }
  const yearMatch = /^\d{4}$/.exec(period);
  if (yearMatch) {
    return new Date(Date.UTC(Number(period), 11, 31));
  }
  throw new Error(`Cannot derive a date from period "${period}" - expected "q{1-4}-{year}" or "{year}".`);
}

/**
 * Reads "Genco Installed Capacity" (Plant, Source, Year, InstalledCapacity)
 * into a national-total-per-year map. Plant names have inconsistent
 * casing/whitespace across rows for the SAME physical plant (e.g. "AFAM
 * IV-V" vs "Afam IV-V") - confirmed real exact-duplicate rows exist (e.g.
 * "GEREGU NIPP" 2024 appears twice with identical value 435) - so this
 * dedupes by (normalized plant name, year) before summing across plants,
 * to avoid double-counting a plant that appears under two spellings.
 */
function readInstalledCapacity(workbook: ExcelJS.Workbook): Map<number, number> {
  const sheet = workbook.getWorksheet("Genco Installed Capacity");
  if (!sheet) throw new Error('Sheet "Genco Installed Capacity" not found.');

  const perPlantYear = new Map<string, number>(); // key: normalizedPlant|year
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const plant = cellString(row.getCell(1).value);
    const year = cellNumber(row.getCell(3).value);
    const capacity = cellNumber(row.getCell(4).value);
    if (!plant || !year) return;
    const key = `${plantKey(plant)}|${year}`;
    // Duplicate rows found for the same plant+year always carry the same
    // value in this sheet (confirmed) - keep whichever was seen, no need
    // to prefer one over the other.
    if (!perPlantYear.has(key)) perPlantYear.set(key, capacity);
  });

  const totalsByYear = new Map<number, number>();
  for (const [key, capacity] of perPlantYear) {
    const year = Number(key.split("|")[1]);
    totalsByYear.set(year, (totalsByYear.get(year) ?? 0) + capacity);
  }
  return totalsByYear;
}

/**
 * Reads "Genco AVG Avail. Capacity" (Plant, Source, Date[ignored - see
 * ingest-nerc-disco-data.ts's comment on this sheet's mangled Date column],
 * Year, Month_Name, AvgAvailableCapacity_MW) into a national-total-per-
 * quarter map: sum all plants for each month, then average the (up to 3)
 * months in each quarter - matching M300-P1-016's own documented formula
 * ("Average of daily GenCo-declared available capacity over the reporting
 * period").
 *
 * Same plant-name-casing duplicate issue as the installed-capacity sheet,
 * but here 5 duplicate (plant, year, month) rows have DIFFERING values -
 * always one reading of exactly 0 against a real non-zero reading for the
 * same plant/month (e.g. "GEREGU" Apr 2024 = 0 vs "Geregu" Apr 2024 = 248).
 * A 0 in a monthly generation-availability reading for an operating plant
 * is far more likely to be a missing-data placeholder than a genuine
 * reading, so this prefers the non-zero value on conflict.
 */
function readAvailableCapacity(workbook: ExcelJS.Workbook): Map<string, number> {
  const sheet = workbook.getWorksheet("Genco AVG Avail. Capacity");
  if (!sheet) throw new Error('Sheet "Genco AVG Avail. Capacity" not found.');

  const perPlantMonth = new Map<string, number>(); // key: normalizedPlant|year|month
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const plant = cellString(row.getCell(1).value);
    const year = cellNumber(row.getCell(4).value);
    const month = cellString(row.getCell(5).value);
    const value = cellNumber(row.getCell(6).value);
    if (!plant || !year || !month || !MONTH_TO_QUARTER[month]) return;
    const key = `${plantKey(plant)}|${year}|${month}`;
    const existing = perPlantMonth.get(key);
    if (existing === undefined || (existing === 0 && value !== 0)) {
      perPlantMonth.set(key, value);
    }
  });

  // Sum all plants -> one national total per (year, month).
  const totalsByMonth = new Map<string, number>(); // key: year|month
  for (const [key, value] of perPlantMonth) {
    const [, year, month] = key.split("|");
    const monthKey = `${year}|${month}`;
    totalsByMonth.set(monthKey, (totalsByMonth.get(monthKey) ?? 0) + value);
  }

  // Average the months present in each quarter (not always 3 - a partial
  // quarter like the most recent one averages over however many months
  // have actually been reported, which is honest, not a full-quarter
  // figure presented as if it always were one).
  const quarterSums = new Map<string, { total: number; count: number }>(); // key: q{n}-{year}
  for (const [monthKey, total] of totalsByMonth) {
    const [yearStr, month] = monthKey.split("|");
    const year = Number(yearStr);
    const quarter = MONTH_TO_QUARTER[month];
    const period = `q${quarter}-${year}`;
    const entry = quarterSums.get(period) ?? { total: 0, count: 0 };
    entry.total += total;
    entry.count += 1;
    quarterSums.set(period, entry);
  }

  const averagesByQuarter = new Map<string, number>();
  for (const [period, { total, count }] of quarterSums) {
    averagesByQuarter.set(period, total / count);
  }
  return averagesByQuarter;
}

async function main() {
  console.log(`Reading workbook: ${WORKBOOK_PATH}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);

  const installedByYear = readInstalledCapacity(workbook);
  const availableByQuarter = readAvailableCapacity(workbook);
  console.log(`Installed capacity: ${installedByYear.size} years. Available capacity: ${availableByQuarter.size} quarters.`);

  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

  const institution = await prisma.institution.upsert({
    where: { id: NISO_INSTITUTION_ID },
    create: { id: NISO_INSTITUTION_ID, name: NISO_INSTITUTION_NAME, type: "Federal Agency" },
    update: {},
  });

  const admin = await prisma.user.findFirst({ where: { role: "SYSTEM_ADMINISTRATOR" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No SYSTEM_ADMINISTRATOR user found to attribute the backfilled submissions to.");
  const adminId = admin.id;

  // Reuse the same evidence file ingest-nerc-disco-data.ts stores (or
  // create it if this script runs first / standalone) - both backfills
  // point at the one real source workbook.
  const EVIDENCE_ORIGINAL_NAME = "Compiled NERC Data 2020 - 2026.xlsx";
  let uploadedFile = await prisma.uploadedFile.findFirst({
    where: { originalName: EVIDENCE_ORIGINAL_NAME },
    orderBy: { createdAt: "asc" },
  });
  if (!uploadedFile) {
    const { mkdir, readFile, writeFile } = await import("node:fs/promises");
    const { randomUUID } = await import("node:crypto");
    const storageRoot = process.env.STORAGE_LOCAL_PATH ?? "./storage";
    const storageDir = join(storageRoot, "uploads");
    await mkdir(storageDir, { recursive: true });
    const storageKey = join("uploads", `${randomUUID()}.xlsx`);
    const buffer = await readFile(WORKBOOK_PATH);
    await writeFile(join(storageRoot, storageKey), buffer);
    uploadedFile = await prisma.uploadedFile.create({
      data: {
        uploadedById: adminId,
        storageKey,
        originalName: EVIDENCE_ORIGINAL_NAME,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: buffer.byteLength,
      },
    });
  }
  console.log(`Evidence file: uploadedFile.id=${uploadedFile.id}`);

  const kpiInstalled = await prisma.kpiDefinition.findUnique({ where: { code: "M300-P1-002" } });
  const kpiAvailable = await prisma.kpiDefinition.findUnique({ where: { code: "M300-P1-016" } });
  if (!kpiInstalled) throw new Error("KPI M300-P1-002 not found - run the KPI directory ingestion first.");
  if (!kpiAvailable) throw new Error("KPI M300-P1-016 not found - run the KPI directory ingestion first.");

  async function backfillOne(kpiCode: string, kpiDefinitionId: string, period: string, value: number) {
    const submissionId = `nerc-genco-submission-${kpiCode}-${period}`;
    const itemId = `nerc-genco-item-${kpiCode}-${period}`;

    await prisma.submission.upsert({
      where: { id: submissionId },
      create: {
        id: submissionId,
        institutionId: institution.id,
        submittedById: adminId,
        method: "UPLOAD",
        status: "APPROVED",
        sourceFileUrl: uploadedFile!.storageKey,
        originalFileName: uploadedFile!.originalName,
        sourceReference: "Historical bulk import - Compiled NERC Data 2020-2026",
        notes: "Backfilled by ingest-nerc-genco-kpis.ts, not submitted through the live review queue.",
        reviewerId: adminId,
      },
      update: {},
    });

    await prisma.submissionItem.upsert({
      where: { id: itemId },
      create: { id: itemId, submissionId, kpiDefinitionId, period, value },
      update: { value },
    });

    const existingDecision = await prisma.reviewDecision.findFirst({ where: { submissionId } });
    if (!existingDecision) {
      await prisma.reviewDecision.create({
        data: {
          submissionId,
          reviewedById: adminId,
          decision: "APPROVE",
          comment: "Historical bulk import - approved as part of the NERC data backfill.",
        },
      });
    }

    // Mirrors DataSubmissionsService.recordDecision()'s own KpiValue-
    // creation exactly - same upsert shape, same fields.
    await prisma.kpiValue.upsert({
      where: { sourceSubmissionItemId: itemId },
      create: {
        kpiDefinitionId,
        institutionId: institution.id,
        period,
        value,
        sourceSubmissionItemId: itemId,
        approvedAt: approvedAtFor(period),
      },
      update: { value, approvedAt: approvedAtFor(period) },
    });
  }

  let count = 0;
  for (const [year, value] of installedByYear) {
    await backfillOne("M300-P1-002", kpiInstalled.id, String(year), value);
    count++;
  }
  for (const [period, value] of availableByQuarter) {
    await backfillOne("M300-P1-016", kpiAvailable.id, period, value);
    count++;
  }

  console.log(`KpiValue backfill complete: ${count} values (${installedByYear.size} installed-capacity years, ${availableByQuarter.size} available-capacity quarters).`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
