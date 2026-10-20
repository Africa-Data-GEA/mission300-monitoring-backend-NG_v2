import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, DatasetFieldType } from "@prisma/client";

const CDMU_INSTITUTION_ID = "seed-institution-cdmu";

type Cadence = "Quarterly" | "Annual";

interface FieldSpec {
  label: string;
  helpText: string;
  unit: string;
  kpiCode: string;
}

interface DatasetSpec {
  id: string;
  name: string;
  purpose: string;
  frequency: Cadence;
  pillarSlug: string;
  sectionTitle: string;
  fields: FieldSpec[];
}

const DATASETS: DatasetSpec[] = [
  {
    id: "cdmu-compact-progress",
    name: "CDMU Compact Progress Report",
    purpose: "National access figures reported in the Compact Progress Report.",
    frequency: "Annual",
    pillarSlug: "last-mile-access",
    sectionTitle: "Compact Progress Report",
    fields: [
      {
        label: "People Connected to Electricity",
        helpText: "National number of people with electricity access, as stated in the Compact Progress Report.",
        unit: "people",
        kpiCode: "M300-P2-024",
      },
      {
        label: "Clean Cooking Access Rate",
        helpText: "Share of the population with access to clean cooking, as stated in the Compact Progress Report.",
        unit: "%",
        kpiCode: "M300-P2-008",
      },
    ],
  },
  {
    id: "cdmu-compact-monitoring",
    name: "CDMU Compact Monitoring",
    purpose: "Delivery of Compact milestones, from the CDMU Compact Monitoring Tool.",
    frequency: "Quarterly",
    pillarSlug: "generation-network",
    sectionTitle: "Compact milestones",
    fields: [
      {
        label: "Compact Milestone Delivery Rate",
        helpText: "Share of Compact milestones delivered to date, from the CDMU Compact Monitoring Tool.",
        unit: "%",
        kpiCode: "M300-PX-003",
      },
    ],
  },
];

function currentPeriod(frequency: Cadence, now: Date): { reportingPeriod: string; dueDate: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  if (frequency === "Quarterly") {
    const closed = new Date(Date.UTC(year, Math.floor(month / 3) * 3 - 3, 1));
    const quarter = Math.floor(closed.getUTCMonth() / 3) + 1;
    return {
      reportingPeriod: `Q${quarter} ${closed.getUTCFullYear()}`,
      dueDate: new Date(Date.UTC(closed.getUTCFullYear(), closed.getUTCMonth() + 3, 15)),
    };
  }

  return { reportingPeriod: String(year - 1), dueDate: new Date(Date.UTC(year, 0, 31)) };
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });
  const cdmu = await prisma.institution.findUnique({ where: { id: CDMU_INSTITUTION_ID } });
  if (!cdmu) throw new Error("CDMU institution not found - run the CDMU consolidation migration first.");

  const now = new Date();
  for (const spec of DATASETS) {
    const pillar = await prisma.pillar.findUnique({ where: { slug: spec.pillarSlug } });
    if (!pillar) throw new Error(`Pillar "${spec.pillarSlug}" not found - run ingest-kpi-directory.js first.`);

    const datasetData = {
      name: spec.name,
      purpose: spec.purpose,
      pillarId: pillar.id,
      requiredDataPoints: spec.fields.map((field) => field.label),
      frequency: spec.frequency,
      ownerInstitutionId: CDMU_INSTITUTION_ID,
      templateFileName: `${spec.id}.xlsx`,
      isActive: true,
    };
    const dataset = await prisma.dataset.upsert({
      where: { id: spec.id },
      create: { id: spec.id, ...datasetData },
      update: datasetData,
    });

    await prisma.datasetField.deleteMany({ where: { datasetId: dataset.id } });
    for (const [index, field] of spec.fields.entries()) {
      const kpi = await prisma.kpiDefinition.findUnique({ where: { code: field.kpiCode } });
      if (!kpi) throw new Error(`KPI ${field.kpiCode} not found for dataset ${spec.id}.`);
      await prisma.datasetField.create({
        data: {
          id: `${spec.id}-field-${index + 1}`,
          datasetId: dataset.id,
          sectionId: spec.sectionTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          sectionTitle: spec.sectionTitle,
          label: field.label,
          helpText: field.helpText,
          type: DatasetFieldType.NUMBER,
          required: true,
          unit: field.unit,
          order: index + 1,
          kpiDefinitionId: kpi.id,
        },
      });
    }

    const { reportingPeriod, dueDate } = currentPeriod(spec.frequency, now);
    await prisma.obligation.upsert({
      where: {
        institutionId_datasetId_reportingPeriod: {
          institutionId: cdmu.id,
          datasetId: dataset.id,
          reportingPeriod,
        },
      },
      create: { institutionId: cdmu.id, datasetId: dataset.id, reportingPeriod, dueDate },
      update: { dueDate },
    });
    console.log(`${spec.name}: ${spec.fields.length} field(s), obligation ${reportingPeriod}`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
