import { join } from "node:path";
import ExcelJS from "exceljs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Ingests the generation sheets of "EMRC - NISO Compiled Data 2020-2026 v1
 * 2026-09-11.xlsx" into M300-P1-005 "Actual Generation Sent to the Grid"
 * (GWh): the sum of the "Genco Energy Export" sheet plus the separately
 * tracked "Zungeru Energy Exports" sheet, per quarter.
 *
 * M300-P1-004 "Renewable Generation Share" is NOT written here: the CDMU
 * supplies it (see ingest-cdmu-renewable-share.ts).
 *
 * Companies are still classified by fuel so that an unrecognised company
 * stops the run rather than going unnoticed.
 *
 * Idempotent: deterministic ids derived from (kpiCode, period).
 *
 * Run with: DATABASE_URL=... node dist/prisma/ingest-niso-generation-kpis.js
 */

const NISO_WORKBOOK = join(process.cwd(), "prisma", "data", "niso-compiled-data-2020-2026.xlsx");
const NERC_WORKBOOK = join(process.cwd(), "prisma", "data", "nerc-disco-data-2020-2026.xlsx");

const NISO_INSTITUTION_ID = "seed-institution-niso-tcn";
const NISO_INSTITUTION_NAME = "NISO / TCN";
const SOURCE_REFERENCE = "EMRC - NISO Compiled Data 2020-2026 v1 2026-09-11.xlsx";

// Operating company -> plant name, for companies whose name shares no text
// with the plant they run. Both are hydro and both are named as plants in
// the NERC workbook's own fuel classification.
const COMPANY_TO_PLANT: Record<string, string> = {
  NORTHSOUTHPOWER: "SHIRORO",
  MABONDANDIKOWA: "DADINKOWA",
};

// Every company in "Genco Energy Export" whose name does not substring-match
// any plant in NERC's "Genco Installed Capacity" sheet, and is NOT one of
// the five real Nigerian hydro plants (Dadin Kowa, Jebba, Kainji, Shiroro,
// Zungeru - all five are already covered above, Zungeru via its own
// dedicated sheet). Each of these was individually checked against public
// generation-company records and confirmed gas/thermal - verified, not
// assumed. Any company NOT in this list that also fails to match a plant is
// now a hard failure (see the throw below), not a silent "unclassified", so
// a genuinely new or actually-hydro company can never quietly understate
// the renewable share the way an unclassified company used to.
const CONFIRMED_THERMAL_UNMATCHED = new Set([
  "AFAMPOWER",
  "AZURAPOWER",
  "GBARAIN",
  "MEPP",
  "TRANSAFAMPOWER",
  "TRANSCORPPOWER",
]);

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

const QUARTER_END_MONTH_DAY: Record<number, [number, number]> = {
  1: [2, 31],
  2: [5, 30],
  3: [8, 30],
  4: [11, 31],
};

function approvedAtFor(period: string): Date {
  const match = /^q([1-4])-(\d{4})$/.exec(period);
  if (!match) throw new Error(`Cannot derive a date from period "${period}".`);
  const [month, day] = QUARTER_END_MONTH_DAY[Number(match[1])];
  return new Date(Date.UTC(Number(match[2]), month, day));
}

function normalise(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in (value as { text?: string })) {
    return String((value as { text?: string }).text ?? "");
  }
  return String(value).trim();
}

async function loadFuelByPlant(): Promise<Map<string, string>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(NERC_WORKBOOK);
  const sheet = workbook.getWorksheet("Genco Installed Capacity");
  if (!sheet) throw new Error('NERC sheet "Genco Installed Capacity" not found.');

  const fuelByPlant = new Map<string, string>();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const plant = normalise(row.getCell(1).value);
    const source = cellText(row.getCell(2).value).toUpperCase();
    if (plant && (source === "THERMAL" || source === "HYDRO")) fuelByPlant.set(plant, source);
  });
  return fuelByPlant;
}

function buildClassifier(fuelByPlant: Map<string, string>) {
  const plants = [...fuelByPlant.keys()];
  return (company: string): string | null => {
    const normalised = normalise(company);
    const target = COMPANY_TO_PLANT[normalised] ?? normalised;
    const match = plants
      .filter((plant) => target.includes(plant) || plant.includes(target))
      .sort((a, b) => b.length - a.length)[0];
    return match ? fuelByPlant.get(match)! : null;
  };
}

interface QuarterTotals {
  totalKwh: number;
  hydroKwh: number;
  unclassifiedKwh: number;
  months: Set<string>;
}

function emptyTotals(): QuarterTotals {
  return { totalKwh: 0, hydroKwh: 0, unclassifiedKwh: 0, months: new Set<string>() };
}

async function main() {
  console.log(`Reading NISO workbook: ${NISO_WORKBOOK}`);
  const fuelByPlant = await loadFuelByPlant();
  const classify = buildClassifier(fuelByPlant);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(NISO_WORKBOOK);

  const byQuarter = new Map<string, QuarterTotals>();
  const unclassifiedCompanies = new Set<string>();
  const unnamedRows: { row: number; period: string; kwh: number }[] = [];

  const gencoSheet = workbook.getWorksheet("Genco Energy Export");
  if (!gencoSheet) throw new Error('Sheet "Genco Energy Export" not found.');
  gencoSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const company = cellText(row.getCell(1).value);
    const year = Number(row.getCell(2).value);
    const month = cellText(row.getCell(3).value);
    const kwh = Number(row.getCell(4).value) || 0;
    const quarter = MONTH_TO_QUARTER[month];
    if (!company && year && quarter && kwh > 0) unnamedRows.push({ row: rowNumber, period: `q${quarter}-${year}`, kwh });
    if (!company || !year || !quarter) return;

    const period = `q${quarter}-${year}`;
    const totals = byQuarter.get(period) ?? emptyTotals();
    totals.months.add(month);
    totals.totalKwh += kwh;
    const fuel = classify(company);
    if (!fuel) {
      // Only ever reachable for a company individually verified thermal -
      // anything else that fails to match a plant stops the run rather than
      // silently excluding a possibly-hydro company from the renewable
      // numerator. See CONFIRMED_THERMAL_UNMATCHED's own comment.
      if (!CONFIRMED_THERMAL_UNMATCHED.has(normalise(company))) {
        throw new Error(
          `"${company}" does not match any plant in the NERC fuel-classification sheet and is not in ` +
            `CONFIRMED_THERMAL_UNMATCHED. Check whether it's a new/renamed hydro plant (add it to ` +
            `COMPANY_TO_PLANT) or genuinely thermal (add it to CONFIRMED_THERMAL_UNMATCHED) before re-running.`,
        );
      }
      totals.unclassifiedKwh += kwh;
      unclassifiedCompanies.add(company);
    } else if (fuel === "HYDRO") {
      totals.hydroKwh += kwh;
    }
    byQuarter.set(period, totals);
  });

  const zungeruSheet = workbook.getWorksheet("Zungeru Energy Exports");
  if (zungeruSheet) {
    zungeruSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const year = Number(row.getCell(2).value);
      const month = cellText(row.getCell(3).value);
      const kwh = Number(row.getCell(5).value) || 0;
      const quarter = MONTH_TO_QUARTER[month];
      if (!year || !quarter) return;
      const period = `q${quarter}-${year}`;
      const totals = byQuarter.get(period) ?? emptyTotals();
      totals.totalKwh += kwh;
      totals.hydroKwh += kwh;
      byQuarter.set(period, totals);
    });
  }

  for (const skipped of unnamedRows) {
    console.warn(
      `Skipped Genco Energy Export row ${skipped.row} (${skipped.period}): ${(skipped.kwh / 1e6).toFixed(2)} GWh has no company name, so it is not counted.`,
    );
  }

  const grandTotal = [...byQuarter.values()].reduce((sum, t) => sum + t.totalKwh, 0);
  const grandUnclassified = [...byQuarter.values()].reduce((sum, t) => sum + t.unclassifiedKwh, 0);
  console.log(
    `Quarters: ${byQuarter.size}. Total generation ${(grandTotal / 1e9).toFixed(1)} TWh. ` +
      `Unclassified (treated as non-renewable): ${((grandUnclassified / grandTotal) * 100).toFixed(1)}% ` +
      `across ${unclassifiedCompanies.size} companies: ${[...unclassifiedCompanies].join(", ")}`,
  );

  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

  const admin = await prisma.user.findFirst({
    where: { role: "SYSTEM_ADMINISTRATOR" },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) throw new Error("No SYSTEM_ADMINISTRATOR user found.");
  const adminId = admin.id;

  const institution = await prisma.institution.upsert({
    where: { id: NISO_INSTITUTION_ID },
    create: { id: NISO_INSTITUTION_ID, name: NISO_INSTITUTION_NAME, type: "Federal Agency" },
    update: {},
  });

  async function backfillOne(kpiCode: string, period: string, value: number, detail: string) {
    const kpi = await prisma.kpiDefinition.findUnique({ where: { code: kpiCode } });
    if (!kpi) throw new Error(`KPI ${kpiCode} not found - run ingest-kpi-directory.js first.`);

    const submissionId = `niso-generation-submission-${kpiCode}-${period}`;
    const itemId = `niso-generation-item-${kpiCode}-${period}`;

    await prisma.submission.upsert({
      where: { id: submissionId },
      create: {
        id: submissionId,
        institutionId: institution.id,
        submittedById: adminId,
        method: "UPLOAD",
        status: "APPROVED",
        sourceReference: `${SOURCE_REFERENCE} (${detail})`,
        notes: "Backfilled by ingest-niso-generation-kpis.ts, not submitted through the live review queue.",
        reviewerId: adminId,
      },
      update: {},
    });

    await prisma.submissionItem.upsert({
      where: { id: itemId },
      create: { id: itemId, submissionId, kpiDefinitionId: kpi.id, period, value },
      update: { value },
    });

    const existingDecision = await prisma.reviewDecision.findFirst({ where: { submissionId } });
    if (!existingDecision) {
      await prisma.reviewDecision.create({
        data: {
          submissionId,
          reviewedById: adminId,
          decision: "APPROVE",
          comment: "Historical bulk import - approved as part of the NISO generation backfill.",
        },
      });
    }

    await prisma.kpiValue.upsert({
      where: { sourceSubmissionItemId: itemId },
      create: {
        kpiDefinitionId: kpi.id,
        institutionId: institution.id,
        period,
        value,
        sourceSubmissionItemId: itemId,
        approvedAt: approvedAtFor(period),
      },
      update: { value, approvedAt: approvedAtFor(period) },
    });
  }

  let written = 0;
  const partialQuarters: string[] = [];
  for (const [period, totals] of byQuarter) {
    if (totals.totalKwh <= 0) continue;
    // A quarter still mid-collection reports one or two months of energy
    // against a three-month KPI. Publishing it would show a ~60% drop in
    // generation that is a reporting artefact, not a real one.
    if (totals.months.size < 3) {
      partialQuarters.push(`${period} (${totals.months.size}/3 months)`);
      continue;
    }
    await backfillOne("M300-P1-005", period, totals.totalKwh / 1e6, "Genco Energy Export + Zungeru Energy Exports");
    written++;
  }

  if (partialQuarters.length > 0) {
    console.log(`Skipped incomplete quarter(s): ${partialQuarters.join(", ")}`);
  }
  console.log(`KpiValue backfill complete: ${written} values for M300-P1-005.`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
