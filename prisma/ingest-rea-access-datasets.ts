import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, DatasetFieldType } from "@prisma/client";

const REA_INSTITUTION_ID = "seed-institution-rea";

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
    id: "rea-facilities-electrification",
    name: "REA Facilities Electrification",
    purpose: "Health and education facilities electrified through REA programmes.",
    frequency: "Annual",
    pillarSlug: "last-mile-access",
    sectionTitle: "Facilities electrified",
    fields: [
      {
        label: "Health Facilities Electrified",
        helpText:
          "Primary Health Centres electrified through REA programmes plus hospitals electrified under the Energizing Education Programme, as reported by REA and NPHCDA.",
        unit: "facilities",
        kpiCode: "M300-P2-017",
      },
      {
        label: "Education Facilities Electrified",
        helpText:
          "Federal universities electrified under the Energizing Education Programme plus public schools electrified through REA programmes, as reported by REA and FMoE.",
        unit: "institutions",
        kpiCode: "M300-P2-018",
      },
    ],
  },
  {
    id: "rea-clean-cookstoves",
    name: "REA Clean Cookstoves Distribution",
    purpose: "Improved cookstoves distributed under the National Clean Cooking Policy.",
    frequency: "Quarterly",
    pillarSlug: "clean-cooking",
    sectionTitle: "Cookstoves distributed",
    fields: [
      {
        label: "Improved Cookstoves Distributed",
        helpText: "Cumulative number of improved cookstoves distributed and verified.",
        unit: "stoves",
        kpiCode: "M300-P2-011",
      },
    ],
  },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
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
  const rea = await prisma.institution.findUnique({ where: { id: REA_INSTITUTION_ID } });
  if (!rea) throw new Error("REA institution not found - run ingest-rea-niso-datasets-obligations.ts first.");

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
      ownerInstitutionId: REA_INSTITUTION_ID,
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
          institutionId: rea.id,
          datasetId: dataset.id,
          reportingPeriod,
        },
      },
      create: { institutionId: rea.id, datasetId: dataset.id, reportingPeriod, dueDate },
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
