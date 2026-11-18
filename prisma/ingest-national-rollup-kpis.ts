import { join } from "node:path";
import ExcelJS from "exceljs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { aggregateEnergy, billingEfficiencyOf, type EnergyRecordLike } from "./lib/energy-basis";

/**
 * One-off historical backfill of 4 national-rollup KPIs from real NERC data
 * already in this repo, none of which had any KpiValue before this script:
 *
 * - M300-P1-015 "Renewable Installed Capacity Share" - HYDRO share of installed
 *   capacity, read directly from the "Genco Installed Capacity" sheet's
 *   Source column (THERMAL/HYDRO only - no other renewable source is
 *   tracked in this workbook, so "renewable" here means hydro).
 * - M300-P3-004 "Metering Rate", M300-P3-006 "ATC&C Loss Rate", M300-P3-009
 *   "DisCo Remittance to NBET/GenCos" - all 3 are national totals rolled up
 *   from DiscoPerformanceRecord, which ingest-nerc-disco-data.ts already
 *   populates per-DisCo per-quarter from the same workbook. This script
 *   does NOT re-read the DisCo sheets itself - it aggregates what's already
 *   in the database, so it must run after ingest-nerc-disco-data.ts.
 *
 * Same KpiValue-via-Submission-chain approach as ingest-nerc-genco-kpis.ts
 * and ingest-nerc-tariff-kpi.ts (see either file's header comment for why -
 * KpiValue.sourceSubmissionItemId is a required, unique FK, so a KpiValue
 * can only be created behind a real Submission/SubmissionItem/
 * ReviewDecision chain, never written directly).
 *
 * Two KPIs this workbook has no data for at all - M300-P3-010 "Subsidy /
 * Tariff Shortfall" (a ₦ Billion government-funding-gap figure, not
 * anything NERC's own DisCo/GenCo returns would contain) and M300-P4-002
 * "Private Capital Mobilized for Last-Mile Access" (an investment-ledger
 * figure) - are deliberately left alone. They stay at "no data yet" until
 * a real source for either is identified; nothing here approximates or
 * invents a figure for them.
 *
 * Idempotent: every row uses a deterministic id derived from
 * (kpiCode, period), safe to re-run.
 *
 * Run with: DATABASE_URL=... node dist/prisma/ingest-national-rollup-kpis.js
 * (after ingest-nerc-disco-data.js has already run against the same DB)
 */

const WORKBOOK_PATH = join(process.cwd(), "prisma", "data", "nerc-disco-data-2020-2026.xlsx");

const NISO_INSTITUTION_ID = "seed-institution-niso-tcn";
const NISO_INSTITUTION_NAME = "NISO / TCN";
const NERC_INSTITUTION_ID = "seed-institution-nerc";
const NERC_INSTITUTION_NAME = "Nigerian Electricity Regulatory Commission (NERC)";

const EVIDENCE_ORIGINAL_NAME = "Compiled NERC Data 2020 - 2026.xlsx";

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
  1: [2, 31],
  2: [5, 30],
  3: [8, 30],
  4: [11, 31],
};

/** Same derivation as ingest-nerc-genco-kpis.ts's approvedAtFor - see its
 * own comment for why approvedAt must reflect the period, not processing
 * order. */
function approvedAtFor(period: string): Date {
  const quarterMatch = /^q([1-4])-(\d{4})$/.exec(period);
  if (quarterMatch) {
    const quarter = Number(quarterMatch[1]);
    const year = Number(quarterMatch[2]);
    const [month, day] = QUARTER_END_MONTH_DAY[quarter];
    return new Date(Date.UTC(year, month, day));
  }
  const yearMatch = /^\d{4}$/.exec(period);
  if (yearMatch) return new Date(Date.UTC(Number(period), 11, 31));
  throw new Error(`Cannot derive a date from period "${period}" - expected "q{1-4}-{year}" or "{year}".`);
}

/**
 * Reads "Genco Installed Capacity" (Plant, Source, Year, InstalledCapacity)
 * into a per-(year, source) national total, deduping (plant, year) the same
 * way ingest-nerc-genco-kpis.ts's readInstalledCapacity does - same
 * duplicate-row issue in this sheet, same fix.
 */
function readInstalledCapacityBySource(
  workbook: ExcelJS.Workbook,
): Map<number, { thermal: number; hydro: number }> {
  const sheet = workbook.getWorksheet("Genco Installed Capacity");
  if (!sheet) throw new Error('Sheet "Genco Installed Capacity" not found.');

  const perPlantYear = new Map<string, { source: string; capacity: number }>(); // key: normalizedPlant|year
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const plant = cellString(row.getCell(1).value);
    const source = cellString(row.getCell(2).value).toUpperCase();
    const year = cellNumber(row.getCell(3).value);
    const capacity = cellNumber(row.getCell(4).value);
    if (!plant || !year || (source !== "THERMAL" && source !== "HYDRO")) return;
    const key = `${plant.toLowerCase()}|${year}`;
    if (!perPlantYear.has(key)) perPlantYear.set(key, { source, capacity });
  });

  const totalsByYear = new Map<number, { thermal: number; hydro: number }>();
  for (const [key, { source, capacity }] of perPlantYear) {
    const year = Number(key.split("|")[1]);
    const totals = totalsByYear.get(year) ?? { thermal: 0, hydro: 0 };
    if (source === "THERMAL") totals.thermal += capacity;
    else totals.hydro += capacity;
    totalsByYear.set(year, totals);
  }
  return totalsByYear;
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

  const admin = await prisma.user.findFirst({
    where: { role: "SYSTEM_ADMINISTRATOR" },
    orderBy: { createdAt: "asc" },
  });
  if (!admin)
    throw new Error("No SYSTEM_ADMINISTRATOR user found to attribute the backfilled submissions to.");
  const adminId = admin.id;

  const uploadedFile = await prisma.uploadedFile.findFirst({
    where: { originalName: EVIDENCE_ORIGINAL_NAME },
    orderBy: { createdAt: "asc" },
  });
  if (!uploadedFile) {
    throw new Error(
      "No stored evidence file found for the NERC workbook - run ingest-nerc-disco-data.js (or ingest-nerc-genco-kpis.js) against this database first.",
    );
  }
  const evidenceFile = uploadedFile;

  async function backfillOne(
    kpiCode: string,
    kpiDefinitionId: string,
    institutionId: string,
    period: string,
    value: number,
    sourceReference: string,
  ) {
    const submissionId = `nerc-rollup-submission-${kpiCode}-${period}`;
    const itemId = `nerc-rollup-item-${kpiCode}-${period}`;

    await prisma.submission.upsert({
      where: { id: submissionId },
      create: {
        id: submissionId,
        institutionId,
        submittedById: adminId,
        method: "UPLOAD",
        status: "APPROVED",
        sourceFileUrl: evidenceFile.storageKey,
        originalFileName: evidenceFile.originalName,
        sourceReference,
        notes: "Backfilled by ingest-national-rollup-kpis.ts, not submitted through the live review queue.",
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

    await prisma.kpiValue.upsert({
      where: { sourceSubmissionItemId: itemId },
      create: {
        kpiDefinitionId,
        institutionId,
        period,
        value,
        sourceSubmissionItemId: itemId,
        approvedAt: approvedAtFor(period),
      },
      update: { value, approvedAt: approvedAtFor(period) },
    });
  }

  let count = 0;

  // --- Renewable Installed Capacity Share (M300-P1-015) -----------------
  const kpiRenewable = await prisma.kpiDefinition.findUnique({ where: { code: "M300-P1-015" } });
  if (!kpiRenewable) throw new Error("KPI M300-P1-015 not found - run the KPI directory ingestion first.");

  const niso = await prisma.institution.upsert({
    where: { id: NISO_INSTITUTION_ID },
    create: { id: NISO_INSTITUTION_ID, name: NISO_INSTITUTION_NAME, type: "Federal Agency" },
    update: {},
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const capacityBySourceByYear = readInstalledCapacityBySource(workbook);

  for (const [year, { thermal, hydro }] of capacityBySourceByYear) {
    const total = thermal + hydro;
    if (total <= 0) continue;
    const share = (hydro / total) * 100;
    await backfillOne(
      "M300-P1-015",
      kpiRenewable.id,
      niso.id,
      String(year),
      share,
      "Historical bulk import - Compiled NERC Data 2020-2026 (hydro share of total installed GenCo capacity; no other renewable source is tracked in this workbook)",
    );
    count++;
  }

  // --- National rollups from DiscoPerformanceRecord ----------------------
  const nerc = await prisma.institution.upsert({
    where: { id: NERC_INSTITUTION_ID },
    create: { id: NERC_INSTITUTION_ID, name: NERC_INSTITUTION_NAME, type: "Regulator" },
    update: {},
  });

  const records = await prisma.discoPerformanceRecord.findMany();
  const byPeriod = new Map<
    string,
    {
      activeCustomers: number;
      meteredCustomers: number;
      energyRecords: EnergyRecordLike[];
      revenueBilledNgn: number;
      revenueCollectedNgn: number;
      remittanceObligationNgn: number;
      remittanceActualNgn: number;
    }
  >();

  const QUARTER_PERIOD = /^q[1-4]-\d{4}$/;
  const skippedPeriods = new Set<string>();

  for (const record of records) {
    if (!QUARTER_PERIOD.test(record.period)) {
      skippedPeriods.add(record.period);
      continue;
    }
    const totals = byPeriod.get(record.period) ?? {
      activeCustomers: 0,
      meteredCustomers: 0,
      energyRecords: [],
      revenueBilledNgn: 0,
      revenueCollectedNgn: 0,
      remittanceObligationNgn: 0,
      remittanceActualNgn: 0,
    };
    totals.activeCustomers += record.activeCustomers;
    totals.meteredCustomers += record.meteredCustomers;
    totals.energyRecords.push(record);
    totals.revenueBilledNgn += Number(record.revenueBilledNgn);
    totals.revenueCollectedNgn += Number(record.revenueCollectedNgn);
    totals.remittanceObligationNgn += Number(record.remittanceObligationNgn);
    totals.remittanceActualNgn += Number(record.remittanceActualNgn);
    byPeriod.set(record.period, totals);
  }

  if (skippedPeriods.size > 0) {
    console.log(
      `Skipped ${skippedPeriods.size} non-quarter period(s) not in "q{1-4}-{year}" form (e.g. seed.ts's own illustrative DiscoPerformanceRecord rows): ${[...skippedPeriods].join(", ")}`,
    );
  }

  if (byPeriod.size === 0) {
    throw new Error(
      "No DiscoPerformanceRecord rows found - run ingest-nerc-disco-data.js against this database first.",
    );
  }

  const kpiMetering = await prisma.kpiDefinition.findUnique({ where: { code: "M300-P3-004" } });
  const kpiAtcc = await prisma.kpiDefinition.findUnique({ where: { code: "M300-P3-006" } });
  const kpiRemittance = await prisma.kpiDefinition.findUnique({ where: { code: "M300-P3-009" } });
  if (!kpiMetering) throw new Error("KPI M300-P3-004 not found - run the KPI directory ingestion first.");
  if (!kpiAtcc) throw new Error("KPI M300-P3-006 not found - run the KPI directory ingestion first.");
  if (!kpiRemittance) throw new Error("KPI M300-P3-009 not found - run the KPI directory ingestion first.");

  for (const [period, totals] of byPeriod) {
    if (totals.activeCustomers > 0) {
      const meteringRate = (totals.meteredCustomers / totals.activeCustomers) * 100;
      await backfillOne(
        "M300-P3-004",
        kpiMetering.id,
        nerc.id,
        period,
        meteringRate,
        "Historical bulk import - Compiled NERC Data 2020-2026 (national metered ÷ active customers, summed across all 12 DisCos)",
      );
      count++;
    }

    const energy = aggregateEnergy(totals.energyRecords);
    if (energy.received > 0 && totals.revenueBilledNgn > 0) {
      // ATC&C = [1 - (billing efficiency x collection efficiency)] x 100.
      const billingEfficiency = billingEfficiencyOf(energy) ?? 0;
      const collectionEfficiency = totals.revenueCollectedNgn / totals.revenueBilledNgn;
      const atccLossRate = (1 - billingEfficiency * collectionEfficiency) * 100;
      await backfillOne(
        "M300-P3-006",
        kpiAtcc.id,
        nerc.id,
        period,
        atccLossRate,
        "Historical bulk import - Compiled NERC Data 2020-2026 (national billing efficiency x collection efficiency, summed across all 12 DisCos - not an average of per-DisCo loss rates)",
      );
      count++;
    }

    if (totals.remittanceObligationNgn > 0) {
      const remittanceRate = (totals.remittanceActualNgn / totals.remittanceObligationNgn) * 100;
      await backfillOne(
        "M300-P3-009",
        kpiRemittance.id,
        nerc.id,
        period,
        remittanceRate,
        "Historical bulk import - Compiled NERC Data 2020-2026 (national MO + NBET remittance actual ÷ obligation, summed across all 12 DisCos)",
      );
      count++;
    }
  }

  console.log(`KpiValue backfill complete: ${count} values across 4 national-rollup KPIs.`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
