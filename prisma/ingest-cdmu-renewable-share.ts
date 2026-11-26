import { join } from "node:path";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const KPI_CODE = "M300-P1-004";
const CDMU_INSTITUTION_ID = "seed-institution-cdmu";
const CDMU_NAME = "Compact Delivery and Monitoring Unit (CDMU)";
const RETIRED_DATASET_ID = "niso-renewable-generation-mix";
const CAPITAL_CODE = "M300-P4-002";
const DIRECTORY_PATH = join(process.cwd(), "prisma", "data", "kpi-directory.json");

interface DirectoryEntry {
  code: string;
  targetPoints: { period: string; value: number; label: string }[];
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

  const kpi = await prisma.kpiDefinition.findUnique({ where: { code: KPI_CODE } });
  if (!kpi) throw new Error(`KPI ${KPI_CODE} not found - run ingest-kpi-directory.js first.`);
  const cdmu = await prisma.institution.findUnique({ where: { id: CDMU_INSTITUTION_ID } });
  if (!cdmu) throw new Error("CDMU institution not found.");

  const cdmuValues = await prisma.kpiValue.count({
    where: { kpiDefinitionId: kpi.id, institutionId: cdmu.id },
  });
  if (cdmuValues === 0) {
    throw new Error("No CDMU values for the renewable share yet - run ingest-fgn-compact-progress-kpi-values.js first.");
  }

  const removed = await prisma.kpiValue.deleteMany({
    where: {
      kpiDefinitionId: kpi.id,
      sourceSubmissionItemId: { startsWith: `niso-generation-item-${KPI_CODE}-` },
    },
  });

  await prisma.kpiDefinition.update({
    where: { id: kpi.id },
    data: {
      sourceInstitution: CDMU_NAME,
      sourceDataset: "CDMU Compact Progress Report",
      sourceReference: "Nigeria Mission 300 Compact Progress Report, Cycle 1 2026 (CDMU)",
      limitations:
        "Values are as supplied by the CDMU in the Compact Progress Report, reported by year. The 2026 value is the mid-2026 actual in the external report deck. Figures from other publishers may differ.",
    },
  });
  await prisma.kpiSourceInstitution.deleteMany({ where: { kpiDefinitionId: kpi.id } });
  await prisma.kpiSourceInstitution.create({ data: { kpiDefinitionId: kpi.id, institutionId: cdmu.id } });

  const directory = JSON.parse(readFileSync(DIRECTORY_PATH, "utf-8")) as DirectoryEntry[];
  for (const code of [KPI_CODE, CAPITAL_CODE]) {
    const points = directory.find((entry) => entry.code === code)?.targetPoints ?? [];
    const target = await prisma.kpiDefinition.findUnique({ where: { code } });
    if (!target || points.length === 0) continue;
    await prisma.kpiTargetPoint.deleteMany({ where: { kpiDefinitionId: target.id } });
    await prisma.kpiTargetPoint.createMany({ data: points.map((point) => ({ kpiDefinitionId: target.id, ...point })) });
  }

  await prisma.dataset.updateMany({ where: { id: RETIRED_DATASET_ID }, data: { isActive: false } });
  const obligations = await prisma.obligation.deleteMany({
    where: { datasetId: RETIRED_DATASET_ID, acceptedSubmissionId: null, submissions: { none: {} }, entryDraft: null },
  });

  console.log(
    `Renewable generation share now comes from the CDMU: ${removed.count} NISO values removed, ${obligations.count} unused NISO obligations removed.`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
