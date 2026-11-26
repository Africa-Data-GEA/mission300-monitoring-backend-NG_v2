import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, DatasetFieldType } from "@prisma/client";

const REA_INSTITUTION_ID = "seed-institution-rea";
const REA_INSTITUTION_NAME = "Rural Electrification Agency (REA)";
const NISO_INSTITUTION_ID = "seed-institution-niso-tcn";
const NISO_INSTITUTION_NAME = "NISO / TCN";

type Cadence = "Monthly" | "Quarterly" | "Annual";

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
  ownerInstitutionId: string;
  pillarSlug: string;
  sectionTitle: string;
  fields: FieldSpec[];
}

const DATASETS: DatasetSpec[] = [
  {
    id: "rea-minigrid-output",
    name: "REA Mini-Grid & SHS Output",
    purpose: "Operational mini-grid and Solar Home System output, behind REA's last-mile access indicators.",
    frequency: "Quarterly",
    ownerInstitutionId: REA_INSTITUTION_ID,
    pillarSlug: "last-mile-access",
    sectionTitle: "Mini-grid and SHS output",
    fields: [
      { label: "Operational Mini-Grids", helpText: "Number of mini-grids operational at the end of the quarter.", unit: "Number", kpiCode: "M300-P2-026" },
      { label: "Operational Mini-Grid Installed Capacity", helpText: "Installed capacity across operational mini-grids at the end of the quarter.", unit: "MW", kpiCode: "M300-P2-027" },
      { label: "Active Household Mini-Grid Connections", helpText: "Active household connections across mini-grids at the end of the quarter.", unit: "Number", kpiCode: "M300-P2-028" },
      { label: "Active MSME Mini-Grid Connections", helpText: "Active MSME connections across mini-grids at the end of the quarter.", unit: "Number", kpiCode: "M300-P2-029" },
      { label: "Cumulative SHS Units Deployed", helpText: "Cumulative Solar Home System units deployed to date.", unit: "Number", kpiCode: "M300-P2-030" },
    ],
  },
  {
    id: "rea-minigrid-dre-pipeline",
    name: "REA Mini-Grid & DRE Pipeline",
    purpose: "Mini-grid and distributed renewable energy pipeline, procurement, and productive-use indicators.",
    frequency: "Quarterly",
    ownerInstitutionId: REA_INSTITUTION_ID,
    pillarSlug: "last-mile-access",
    sectionTitle: "Mini-grid and DRE pipeline",
    fields: [
      { label: "Planned Mini-Grid Connections", helpText: "Connections planned across the mini-grid pipeline at the end of the quarter.", unit: "Number", kpiCode: "M300-P2-031" },
      { label: "Mini-Grid Pipeline Sites", helpText: "Sites in the mini-grid pipeline at the end of the quarter.", unit: "Number", kpiCode: "M300-P2-032" },
      { label: "MSMEs Connected Through DRE", helpText: "MSMEs connected through distributed renewable energy to date.", unit: "Number", kpiCode: "M300-P2-033" },
      { label: "Productive-Use Equipment Deployed", helpText: "Productive-use equipment deployed to date.", unit: "Number", kpiCode: "M300-P2-034" },
      { label: "Women-Led or Women-Owned MSMEs Receiving DRE Connections", helpText: "Women-led or women-owned MSMEs receiving DRE connections to date.", unit: "Number", kpiCode: "M300-P2-035" },
      { label: "SHS Units Procured Through Approved DRE Framework", helpText: "SHS units procured through the approved DRE framework to date.", unit: "Number", kpiCode: "M300-P2-036" },
    ],
  },
  {
    id: "rea-private-sector-pipeline",
    name: "REA Private-Sector Pipeline",
    purpose: "Private mini-grid developer engagement behind REA's private-sector participation indicators.",
    frequency: "Quarterly",
    ownerInstitutionId: REA_INSTITUTION_ID,
    pillarSlug: "private-sector-participation",
    sectionTitle: "Private-sector pipeline",
    fields: [
      { label: "Mini-Grid Developers With Signed Grant Agreements", helpText: "Mini-grid developers with signed grant agreements at the end of the quarter.", unit: "Number", kpiCode: "M300-P4-009" },
      { label: "Planned Sites or Connections Under Signed Agreements", helpText: "Sites or connections planned under signed agreements at the end of the quarter.", unit: "Number", kpiCode: "M300-P4-010" },
    ],
  },
  {
    id: "rea-programme-financing",
    name: "REA Programme Financing",
    purpose: "Programme financing, grants, loans, and private capital mobilised across REA's implementing programmes.",
    frequency: "Quarterly",
    ownerInstitutionId: REA_INSTITUTION_ID,
    pillarSlug: "private-sector-participation",
    sectionTitle: "Programme financing",
    fields: [
      { label: "Private Capital Committed Since January 2025", helpText: "Cumulative private capital committed since January 2025.", unit: "USD", kpiCode: "M300-P4-011" },
      { label: "Private Capital Deployed or Disbursed Since January 2025", helpText: "Cumulative private capital deployed or disbursed since January 2025.", unit: "USD", kpiCode: "M300-P4-012" },
      { label: "Total Approved Programme Financing", helpText: "Total approved programme financing to date.", unit: "USD", kpiCode: "M300-PX-008" },
      { label: "Grant Amount", helpText: "Cumulative grant amount to date.", unit: "USD", kpiCode: "M300-PX-009" },
      { label: "Loan Amount", helpText: "Cumulative loan amount to date.", unit: "USD", kpiCode: "M300-PX-010" },
      { label: "Private Co-Financing", helpText: "Cumulative private co-financing to date.", unit: "USD", kpiCode: "M300-PX-011" },
      { label: "Amount Committed", helpText: "Cumulative amount committed to date.", unit: "USD", kpiCode: "M300-PX-012" },
      { label: "Amount Disbursed and Expenditure to Date", helpText: "Cumulative amount disbursed and expenditure to date.", unit: "USD", kpiCode: "M300-PX-013" },
    ],
  },
  {
    id: "niso-generation-output",
    name: "NISO Generation Output",
    purpose: "National electricity generation sent to the grid.",
    frequency: "Quarterly",
    ownerInstitutionId: NISO_INSTITUTION_ID,
    pillarSlug: "generation-network",
    sectionTitle: "Generation output",
    fields: [
      { label: "Actual Generation Sent to the Grid", helpText: "Total electricity generated and sent out by grid-connected power plants for the reporting quarter.", unit: "GWh", kpiCode: "M300-P1-005" },
    ],
  },
  {
    id: "niso-network-capacity-pipeline",
    name: "NISO Network & Capacity Pipeline",
    purpose: "Transmission network capacity and the generation capacity pipeline NISO plans against.",
    frequency: "Quarterly",
    ownerInstitutionId: NISO_INSTITUTION_ID,
    pillarSlug: "generation-network",
    sectionTitle: "Network and capacity pipeline",
    fields: [
      { label: "Total Transmission Line Length", helpText: "Total length of the national high-voltage transmission network as of the end of the quarter.", unit: "km", kpiCode: "M300-P1-017" },
      { label: "Total Installed Substation Capacity", helpText: "Total installed transformer capacity across national substations as of the end of the quarter.", unit: "MVA", kpiCode: "M300-P1-018" },
      { label: "Committed Planned Generation Capacity", helpText: "Nameplate capacity of pipeline generation projects marked \"Committed\".", unit: "MW", kpiCode: "M300-P1-019" },
      { label: "Candidate Planned Generation Capacity", helpText: "Nameplate capacity of pipeline generation projects marked \"Candidate\".", unit: "MW", kpiCode: "M300-P1-020" },
      { label: "Cross-Border Transmission Line Length", helpText: "Total length of physical cross-border transmission interconnectors as of the end of the quarter.", unit: "km", kpiCode: "M300-P5-006" },
      { label: "Projected National Peak Demand", helpText: "NISO's own forward-looking projection of national peak electricity demand for the reporting year.", unit: "MW", kpiCode: "M300-PX-014" },
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

  if (frequency === "Monthly") {
    const closed = new Date(Date.UTC(year, month - 1, 1));
    return {
      reportingPeriod: `${MONTH_NAMES[closed.getUTCMonth()]} ${closed.getUTCFullYear()}`,
      dueDate: new Date(Date.UTC(closed.getUTCFullYear(), closed.getUTCMonth() + 1, 15)),
    };
  }

  if (frequency === "Quarterly") {
    const closedQuarterStartMonth = Math.floor(month / 3) * 3 - 3;
    const closed = new Date(Date.UTC(year, closedQuarterStartMonth, 1));
    const quarter = Math.floor(closed.getUTCMonth() / 3) + 1;
    return {
      reportingPeriod: `Q${quarter} ${closed.getUTCFullYear()}`,
      dueDate: new Date(Date.UTC(closed.getUTCFullYear(), closed.getUTCMonth() + 3, 15)),
    };
  }

  return {
    reportingPeriod: String(year - 1),
    dueDate: new Date(Date.UTC(year, 0, 31)),
  };
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

  const rea = await prisma.institution.upsert({
    where: { id: REA_INSTITUTION_ID },
    create: { id: REA_INSTITUTION_ID, name: REA_INSTITUTION_NAME, type: "Federal Agency" },
    update: {},
  });
  const niso = await prisma.institution.upsert({
    where: { id: NISO_INSTITUTION_ID },
    create: { id: NISO_INSTITUTION_ID, name: NISO_INSTITUTION_NAME, type: "Federal Agency" },
    update: {},
  });
  const institutionsById: Record<string, typeof rea> = {
    [REA_INSTITUTION_ID]: rea,
    [NISO_INSTITUTION_ID]: niso,
  };

  const now = new Date();
  let datasetCount = 0;
  let fieldCount = 0;
  let obligationCount = 0;

  for (const spec of DATASETS) {
    const pillar = await prisma.pillar.findUnique({ where: { slug: spec.pillarSlug } });
    if (!pillar) throw new Error(`Pillar "${spec.pillarSlug}" not found - run ingest-kpi-directory.js first.`);

    const templateFileName = `${spec.id}.xlsx`;
    const datasetData = {
      name: spec.name,
      purpose: spec.purpose,
      pillarId: pillar.id,
      requiredDataPoints: spec.fields.map((field) => field.label),
      frequency: spec.frequency,
      ownerInstitutionId: spec.ownerInstitutionId,
      templateFileName,
      isActive: true,
    };

    const dataset = await prisma.dataset.upsert({
      where: { id: spec.id },
      create: { id: spec.id, ...datasetData },
      update: datasetData,
    });
    datasetCount++;

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
      fieldCount++;
    }

    const { reportingPeriod, dueDate } = currentPeriod(spec.frequency, now);
    const filer = institutionsById[spec.ownerInstitutionId];
    await prisma.obligation.upsert({
      where: {
        institutionId_datasetId_reportingPeriod: {
          institutionId: filer.id,
          datasetId: dataset.id,
          reportingPeriod,
        },
      },
      create: {
        institutionId: filer.id,
        datasetId: dataset.id,
        reportingPeriod,
        dueDate,
      },
      update: { dueDate },
    });
    obligationCount++;
  }

  console.log(
    `Datasets: ${datasetCount} upserted. Fields: ${fieldCount}. Obligations: ${obligationCount}.`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
