import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  DISCO_NAMES as DISCO_FULL_NAMES,
  discoInstitutionId,
  resolveDiscoName,
  MONTH_TO_QUARTER,
} from "./lib/disco-institutions";
import { quarterEndCustomerStocks, type MeteringRow } from "./lib/nerc-customer-stocks";
import { findScaleBreaks, parseAcceptedScaleBreaks } from "./lib/scale-break";
import { addMonth, commonMonths, coverageNoteFor, MONTHS, quarterOfMonth } from "./lib/period-coverage";
import { billingEfficiencyOf, energyBasisForMonth, valueBasisStart, type EnergyBasis } from "./lib/energy-basis";

/**
 * One-off historical backfill of DisCo performance data (2020-2026) from
 * the compiled NERC workbook (prisma/data/nerc-disco-data-2020-2026.xlsx,
 * originally "Compiled NERC Data 2020 - 2026 (1).xlsx"). Writes
 * DiscoPerformanceRecord only - GenCo generation-capacity data in the same
 * workbook is a separate, not-yet-built follow-up (backing a real KpiValue
 * requires a real Submission/SubmissionItem chain, since "approving a
 * submission is the only thing allowed to write a new KpiValue" - out of
 * scope for this pass).
 *
 * Idempotent: upserts by (institutionId, period), safe to re-run.
 *
 * Run with: DATABASE_URL=... node dist/prisma/ingest-nerc-disco-data.js
 * (or via ts-node -r tsconfig-paths/register locally).
 */

const WORKBOOK_PATH = join(process.cwd(), "prisma", "data", "nerc-disco-data-2020-2026.xlsx");

function periodOf(year: number, monthName: string): string {
  const quarter = MONTH_TO_QUARTER[monthName];
  if (!quarter) throw new Error(`Unrecognized month name "${monthName}"`);
  return `q${quarter}-${year}`;
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

interface MonthlyRow {
  disco: string;
  year: number;
  month: string;
  value: number;
}

/** Reads a sheet shaped discoCol|dateCol|yearCol|monthCol|valueCol - the
 * common shape of 8 of the 9 monthly/quarterly DisCo sheets in this
 * workbook. `dateCol` is ignored (see readMeteringSheet's comment on the
 * Avg-Availability sheet's mangled Date column - the same workbook has
 * that same quirk on several sheets, Year/Month_Name are always the
 * trustworthy pair). */
function readMonthlySheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  discoCol: number,
  yearCol: number,
  monthCol: number,
  valueCol: number,
): MonthlyRow[] {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found in workbook.`);

  const rows: MonthlyRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const disco = cellString(row.getCell(discoCol).value);
    if (!disco) return;
    const year = cellNumber(row.getCell(yearCol).value);
    const month = cellString(row.getCell(monthCol).value);
    if (!year || !month || month === "NULL") return;
    const value = cellNumber(row.getCell(valueCol).value);
    rows.push({ disco, year, month, value });
  });
  return rows;
}

function readMeteringSheet(workbook: ExcelJS.Workbook) {
  const sheet = workbook.getWorksheet("Disco Metering");
  if (!sheet) throw new Error(`Sheet "Disco Metering" not found in workbook.`);

  const rows: MeteringRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const disco = cellString(row.getCell(1).value);
    const customerType = cellString(row.getCell(2).value);
    const date = row.getCell(3).value;
    const count = cellNumber(row.getCell(5).value);
    if (!disco || !(date instanceof Date)) return;
    rows.push({ disco, customerType, date, count });
  });

  return quarterEndCustomerStocks(rows);
}

interface QuarterAccumulator {
  disco: string;
  period: string;
  energyReceivedGwh: number;
  energyBilledGwh: number;
  energyReceivedValueBillionNgn: number;
  energyBilledValueBillionNgn: number;
  revenueBilledMillionNgn: number;
  revenueCollectedMillionNgn: number;
  moInvoiceBillionNgn: number;
  moRemittanceBillionNgn: number;
  nbetInvoiceBillionNgn: number;
  nbetRemittanceBillionNgn: number;
  meteredCustomers: number;
  unmeteredCustomers: number;
}

function newAccumulator(disco: string, period: string): QuarterAccumulator {
  return {
    disco,
    period,
    energyReceivedGwh: 0,
    energyBilledGwh: 0,
    energyReceivedValueBillionNgn: 0,
    energyBilledValueBillionNgn: 0,
    revenueBilledMillionNgn: 0,
    revenueCollectedMillionNgn: 0,
    moInvoiceBillionNgn: 0,
    moRemittanceBillionNgn: 0,
    nbetInvoiceBillionNgn: 0,
    nbetRemittanceBillionNgn: 0,
    meteredCustomers: 0,
    unmeteredCustomers: 0,
  };
}

async function main() {
  console.log(`Reading workbook: ${WORKBOOK_PATH}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);

  const energyReceived = readMonthlySheet(workbook, "Disco Energy Recieved", 1, 3, 4, 5);
  const energyBilled = readMonthlySheet(workbook, "Disco Energy Billed", 1, 3, 4, 5);
  const revenueBilled = readMonthlySheet(workbook, "Disco Revenue Billed", 1, 3, 4, 5);
  const revenueCollected = readMonthlySheet(workbook, "Disco Revenue Collected", 1, 3, 4, 5);
  const moInvoice = readMonthlySheet(workbook, "Disco MO Invoice", 1, 3, 4, 5);
  const moRemittance = readMonthlySheet(workbook, "Disco MO Remittances", 1, 3, 4, 5);
  const nbetInvoice = readMonthlySheet(workbook, "Disco NBET Invoice", 1, 3, 4, 5);
  const nbetRemittance = readMonthlySheet(workbook, "Disco NBET Remittances", 1, 3, 4, 5);
  const customerStocks = readMeteringSheet(workbook);

  console.log(
    `Rows read: received=${energyReceived.length} billed=${energyBilled.length} ` +
      `revBilled=${revenueBilled.length} revCollected=${revenueCollected.length} ` +
      `moInvoice=${moInvoice.length} moRemit=${moRemittance.length} ` +
      `nbetInvoice=${nbetInvoice.length} nbetRemit=${nbetRemittance.length} ` +
      `metering=${customerStocks.size}`,
  );

  const flowCoverage = commonMonths(
    [energyReceived, energyBilled, revenueBilled, revenueCollected].map((rows) => {
      const months = new Map<string, Set<string>>();
      for (const row of rows) {
        const quarter = quarterOfMonth(row.month);
        if (quarter && row.value > 0) addMonth(months, `q${quarter}-${row.year}`, row.month);
      }
      return months;
    }),
  );

  const accumulators = new Map<string, QuarterAccumulator>();
  const unknownDiscoNames = new Set<string>();

  type AccumulatorField = keyof Omit<QuarterAccumulator, "disco" | "period">;
  const valueStart = valueBasisStart();

  function accumulate(rows: MonthlyRow[], target: AccumulatorField | ((row: MonthlyRow) => AccumulatorField)) {
    for (const row of rows) {
      const field = typeof target === "function" ? target(row) : target;
      const canonicalDisco = resolveDiscoName(row.disco);
      if (!canonicalDisco) {
        unknownDiscoNames.add(row.disco);
        continue;
      }
      const period = periodOf(row.year, row.month);
      const key = `${canonicalDisco}|${period}`;
      const acc = accumulators.get(key) ?? newAccumulator(canonicalDisco, period);
      acc[field] += row.value;
      accumulators.set(key, acc);
    }
  }

  const energyFieldFor = (volume: AccumulatorField, value: AccumulatorField) => (row: MonthlyRow): AccumulatorField => {
    const basis: EnergyBasis = energyBasisForMonth(row.year, MONTHS.indexOf(row.month as (typeof MONTHS)[number]) + 1, valueStart);
    return basis === "VALUE" ? value : volume;
  };
  accumulate(energyReceived, energyFieldFor("energyReceivedGwh", "energyReceivedValueBillionNgn"));
  accumulate(energyBilled, energyFieldFor("energyBilledGwh", "energyBilledValueBillionNgn"));
  accumulate(revenueBilled, "revenueBilledMillionNgn");
  accumulate(revenueCollected, "revenueCollectedMillionNgn");
  accumulate(moInvoice, "moInvoiceBillionNgn");
  accumulate(moRemittance, "moRemittanceBillionNgn");
  accumulate(nbetInvoice, "nbetInvoiceBillionNgn");
  accumulate(nbetRemittance, "nbetRemittanceBillionNgn");

  for (const [period, snapshot] of customerStocks) {
    for (const [rawDisco, stock] of snapshot.byDisco) {
      const canonicalDisco = resolveDiscoName(rawDisco);
      if (!canonicalDisco) {
        unknownDiscoNames.add(rawDisco);
        continue;
      }
      const accKey = `${canonicalDisco}|${period}`;
      const acc = accumulators.get(accKey) ?? newAccumulator(canonicalDisco, period);
      acc.meteredCustomers += stock.metered;
      acc.unmeteredCustomers += stock.unmetered;
      accumulators.set(accKey, acc);
    }
  }

  if (unknownDiscoNames.size > 0) {
    throw new Error(`Unrecognized DisCo name(s) in workbook, not in DISCO_NAME_MAP: ${[...unknownDiscoNames].join(", ")}`);
  }

  const acceptedScaleBreaks = parseAcceptedScaleBreaks(process.env.NERC_ACCEPT_SCALE_BREAKS);
  const nationalTotals = (field: "energyReceivedGwh" | "energyBilledGwh") => {
    const totals = new Map<string, number>();
    for (const acc of accumulators.values()) totals.set(acc.period, (totals.get(acc.period) ?? 0) + acc[field]);
    return totals;
  };
  const unacknowledgedBreaks = (
    [
      ["energy received", "energyReceivedGwh"],
      ["energy billed", "energyBilledGwh"],
    ] as const
  ).flatMap(([label, field]) =>
    findScaleBreaks(nationalTotals(field))
      .filter((scaleBreak) => !acceptedScaleBreaks.has(scaleBreak.period))
      .map(
        (scaleBreak) =>
          `${label} fell ${scaleBreak.ratio.toFixed(1)}x from ${scaleBreak.previousPeriod} ` +
          `(${scaleBreak.previousTotal.toFixed(0)} GWh) to ${scaleBreak.period} (${scaleBreak.total.toFixed(0)} GWh)`,
      ),
  );
  if (unacknowledgedBreaks.length > 0) {
    throw new Error(
      `Implausible scale change in the NERC workbook, nothing was loaded:\n  ${unacknowledgedBreaks.join("\n  ")}\n` +
        `If NERC has confirmed the figures, set NERC_ACCEPT_SCALE_BREAKS to the affected period(s), e.g. NERC_ACCEPT_SCALE_BREAKS=q3-2025.`,
    );
  }

  console.log(`Distinct DisCo x quarter combinations: ${accumulators.size}`);

  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

  // Institutions - upsert all 12 with the same id scheme seed.ts uses, so
  // this script works standalone against a fresh database (no dependency
  // on seed.ts having run first).
  const institutionsBySlug = new Map<string, string>();
  for (const fullName of DISCO_FULL_NAMES) {
    const id = discoInstitutionId(fullName);
    await prisma.institution.upsert({
      where: { id },
      create: { id, name: fullName, type: "Disco" },
      update: {},
    });
    institutionsBySlug.set(fullName, id);
  }
  console.log(`Institutions: ${institutionsBySlug.size} upserted (11 standard DisCos + Aba Power Limited).`);

  // Evidence file - store the actual workbook so every record created here
  // points back at it (DiscoPerformanceRecord.evidenceUrl), retrievable via
  // the existing GET /files/:id.
  const admin = await prisma.user.findFirst({ where: { role: "SYSTEM_ADMINISTRATOR" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No SYSTEM_ADMINISTRATOR user found to attribute the evidence file upload to.");

  const EVIDENCE_ORIGINAL_NAME = "Compiled NERC Data 2020 - 2026.xlsx";
  const workbookBuffer = await readFile(WORKBOOK_PATH);

  // Idempotent, same as the rest of this script - re-running it should
  // reuse the same evidence file, not upload a fresh duplicate copy and
  // orphan the previous one on disk.
  let uploadedFile = await prisma.uploadedFile.findFirst({
    where: { originalName: EVIDENCE_ORIGINAL_NAME, size: workbookBuffer.byteLength },
    orderBy: { createdAt: "asc" },
  });

  if (!uploadedFile) {
    const storageRoot = process.env.STORAGE_LOCAL_PATH ?? "./storage";
    const storageDir = join(storageRoot, "uploads");
    await mkdir(storageDir, { recursive: true });
    const storageKey = join("uploads", `${randomUUID()}.xlsx`);
    await writeFile(join(storageRoot, storageKey), workbookBuffer);

    uploadedFile = await prisma.uploadedFile.create({
      data: {
        uploadedById: admin.id,
        storageKey,
        originalName: EVIDENCE_ORIGINAL_NAME,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: workbookBuffer.byteLength,
      },
    });
    console.log(`Evidence file stored: uploadedFile.id=${uploadedFile.id}`);
  } else {
    console.log(`Evidence file already stored, reusing: uploadedFile.id=${uploadedFile.id}`);
  }

  let created = 0;
  let updated = 0;

  for (const acc of accumulators.values()) {
    const institutionId = institutionsBySlug.get(acc.disco);
    if (!institutionId) continue;

    const hasValue = acc.energyReceivedValueBillionNgn > 0 || acc.energyBilledValueBillionNgn > 0;
    const hasVolume = acc.energyReceivedGwh > 0 || acc.energyBilledGwh > 0;
    if (hasValue && hasVolume) {
      throw new Error(
        `${acc.disco} ${acc.period} mixes energy volumes and energy values within one quarter. ` +
          `Set NERC_ENERGY_VALUE_FROM to a quarter start (YYYY-01, YYYY-04, YYYY-07 or YYYY-10).`,
      );
    }
    const energyBasis: EnergyBasis = hasValue ? "VALUE" : "VOLUME";
    const energyReceivedMwh = acc.energyReceivedGwh * 1000;
    const energyBilledMwh = acc.energyBilledGwh * 1000;
    const energyReceivedValueNgn = acc.energyReceivedValueBillionNgn * 1_000_000_000;
    const energyBilledValueNgn = acc.energyBilledValueBillionNgn * 1_000_000_000;
    const energy =
      energyBasis === "VALUE"
        ? { received: energyReceivedValueNgn, billed: energyBilledValueNgn }
        : { received: energyReceivedMwh, billed: energyBilledMwh };
    const revenueBilledNgn = acc.revenueBilledMillionNgn * 1_000_000;
    const revenueCollectedNgn = acc.revenueCollectedMillionNgn * 1_000_000;

    // ATC&C = [1 - (billing efficiency x collection efficiency)] x 100.
    // Energy received minus energy billed alone captures only the technical
    // and commercial half; the collection half is the revenue ratio.
    const billingEfficiency = billingEfficiencyOf(energy) ?? 0;
    const collectionEfficiency = revenueBilledNgn > 0 ? revenueCollectedNgn / revenueBilledNgn : 0;
    const atccLossRatePercent =
      energy.received > 0 && revenueBilledNgn > 0
        ? (1 - billingEfficiency * collectionEfficiency) * 100
        : 0;

    const data = {
      activeCustomers: acc.meteredCustomers + acc.unmeteredCustomers,
      meteredCustomers: acc.meteredCustomers,
      energyBasis,
      energyReceivedMwh,
      energyBilledMwh,
      energyReceivedValueNgn,
      energyBilledValueNgn,
      revenueBilledNgn,
      revenueCollectedNgn,
      remittanceObligationNgn: (acc.moInvoiceBillionNgn + acc.nbetInvoiceBillionNgn) * 1_000_000_000,
      remittanceActualNgn: (acc.moRemittanceBillionNgn + acc.nbetRemittanceBillionNgn) * 1_000_000_000,
      atccLossRatePercent,
      coverageNote: coverageNoteFor(acc.period, flowCoverage.get(acc.period)),
      evidenceUrl: uploadedFile.id,
    };

    const existing = await prisma.discoPerformanceRecord.findUnique({
      where: { institutionId_period: { institutionId, period: acc.period } },
    });

    await prisma.discoPerformanceRecord.upsert({
      where: { institutionId_period: { institutionId, period: acc.period } },
      create: { institutionId, period: acc.period, ...data },
      update: data,
    });

    if (existing) updated++;
    else created++;
  }

  console.log(`DiscoPerformanceRecord: ${created} created, ${updated} updated, ${accumulators.size} total.`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
