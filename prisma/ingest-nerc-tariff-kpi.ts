import { join } from "node:path";
import ExcelJS from "exceljs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const WORKBOOK_PATH = join(process.cwd(), "prisma", "data", "nerc-disco-data-2020-2026.xlsx");

const NERC_INSTITUTION_ID = "seed-institution-nerc";
const NERC_INSTITUTION_NAME = "Nigerian Electricity Regulatory Commission (NERC)";

const TARIFF_KPI_CODE = "M300-P3-012";

const DISCO_NAME_MAP: Record<string, string> = {
  Aba: "Aba Power Limited",
  Abuja: "Abuja Electricity Distribution Company",
  Benin: "Benin Electricity Distribution Company",
  Eko: "Eko Electricity Distribution Company",
  Enugu: "Enugu Electricity Distribution Company",
  Ibadan: "Ibadan Electricity Distribution Company",
  Ikeja: "Ikeja Electric",
  Jos: "Jos Electricity Distribution Company",
  Kaduna: "Kaduna Electricity Distribution Company",
  Kano: "Kano Electricity Distribution Company",
  PH: "Port Harcourt Electricity Distribution Company",
  "Port Harcourt": "Port Harcourt Electricity Distribution Company",
  Portharcourt: "Port Harcourt Electricity Distribution Company",
  Yola: "Yola Electricity Distribution Company",
};
const DISCO_NAME_MAP_LOWER = new Map(
  Object.entries(DISCO_NAME_MAP).map(([raw, canonical]) => [raw.toLowerCase(), canonical]),
);
function resolveDiscoName(raw: string): string | undefined {
  return DISCO_NAME_MAP_LOWER.get(raw.trim().toLowerCase());
}
function discoInstitutionId(fullName: string): string {
  return `seed-disco-${fullName.toLowerCase().replace(/[^a-z]+/g, "-")}`;
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

function approvedAtForYear(year: number): Date {
  return new Date(Date.UTC(year, 11, 31));
}

function readAllowedTariffs(workbook: ExcelJS.Workbook): Map<number, number[]> {
  const sheet = workbook.getWorksheet("Disco Allowed Tariffs");
  if (!sheet) throw new Error('Sheet "Disco Allowed Tariffs" not found.');

  const tariffsByYear = new Map<number, number[]>();
  const unknownDiscoNames = new Set<string>();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rawDisco = cellString(row.getCell(1).value);
    const year = cellNumber(row.getCell(2).value);
    const tariff = cellNumber(row.getCell(4).value);
    if (!rawDisco || !year || !tariff) return;

    if (!resolveDiscoName(rawDisco)) {
      unknownDiscoNames.add(rawDisco);
      return;
    }
    tariffsByYear.set(year, [...(tariffsByYear.get(year) ?? []), tariff]);
  });

  if (unknownDiscoNames.size > 0) {
    throw new Error(`Unrecognized DisCo name(s) in "Disco Allowed Tariffs": ${[...unknownDiscoNames].join(", ")}`);
  }
  return tariffsByYear;
}

async function main() {
  console.log(`Reading workbook: ${WORKBOOK_PATH}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);

  const tariffsByYear = readAllowedTariffs(workbook);
  console.log(`Allowed tariffs read for ${tariffsByYear.size} year(s).`);

  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

  const kpi = await prisma.kpiDefinition.findUnique({ where: { code: TARIFF_KPI_CODE } });
  if (!kpi) throw new Error(`KPI ${TARIFF_KPI_CODE} not found - run the KPI directory ingestion first.`);

  const institution = await prisma.institution.upsert({
    where: { id: NERC_INSTITUTION_ID },
    create: { id: NERC_INSTITUTION_ID, name: NERC_INSTITUTION_NAME, type: "Regulator" },
    update: {},
  });

  const admin = await prisma.user.findFirst({ where: { role: "SYSTEM_ADMINISTRATOR" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No SYSTEM_ADMINISTRATOR user found to attribute the backfilled submissions to.");
  const adminId = admin.id;

  const EVIDENCE_ORIGINAL_NAME = "Compiled NERC Data 2020 - 2026.xlsx";
  const uploadedFile = await prisma.uploadedFile.findFirst({
    where: { originalName: EVIDENCE_ORIGINAL_NAME },
    orderBy: { createdAt: "asc" },
  });
  if (!uploadedFile) {
    throw new Error(
      "No stored evidence file found for the NERC workbook - run ingest-nerc-disco-data.js (or ingest-nerc-genco-kpis.js) against this database first.",
    );
  }

  let backfilled = 0;

  for (const [year, tariffs] of [...tariffsByYear].sort(([a], [b]) => a - b)) {
    const nationalTariff = tariffs.reduce((sum, value) => sum + value, 0) / tariffs.length;
    const period = String(year);
    const submissionId = `nerc-tariff-submission-${period}`;
    const itemId = `nerc-tariff-item-${period}`;

    await prisma.submission.upsert({
      where: { id: submissionId },
      create: {
        id: submissionId,
        institutionId: institution.id,
        submittedById: adminId,
        method: "UPLOAD",
        status: "APPROVED",
        sourceFileUrl: uploadedFile.storageKey,
        originalFileName: uploadedFile.originalName,
        sourceReference: "Historical bulk import - Compiled NERC Data 2020-2026 (average of the NERC MYTO allowed tariffs published for the year across all DisCos)",
        notes: "Backfilled by ingest-nerc-tariff-kpi.ts, not submitted through the live review queue.",
        reviewerId: adminId,
      },
      update: {},
    });

    await prisma.submissionItem.upsert({
      where: { id: itemId },
      create: { id: itemId, submissionId, kpiDefinitionId: kpi.id, period, value: nationalTariff },
      update: { value: nationalTariff },
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
        kpiDefinitionId: kpi.id,
        institutionId: institution.id,
        period,
        value: nationalTariff,
        sourceSubmissionItemId: itemId,
        approvedAt: approvedAtForYear(year),
      },
      update: { value: nationalTariff, approvedAt: approvedAtForYear(year) },
    });

    backfilled++;
  }

  console.log(`Tariff KPI backfill complete: ${backfilled} year(s) backfilled.`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
