import { PrismaClient, RoleName, AccountStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { ROLE_DEFINITIONS } from "../src/modules/auth/role-definitions";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

async function main() {
  for (const definition of ROLE_DEFINITIONS) {
    await prisma.roleDefinition.upsert({
      where: { role: definition.role },
      create: definition,
      update: definition,
    });
  }

  const institution = await prisma.institution.upsert({
    where: { id: "seed-institution" },
    create: { id: "seed-institution", name: "Sample DisCo", type: "Disco" },
    update: {},
  });

  const adminPasswordHash = await argon2.hash("ChangeMe123!");
  const admin = await prisma.user.upsert({
    where: { email: "admin@m300.local" },
    create: {
      email: "admin@m300.local",
      fullName: "Seed Administrator",
      designation: "System Administrator",
      role: RoleName.SYSTEM_ADMINISTRATOR,
      status: AccountStatus.ACTIVE,
      passwordHash: adminPasswordHash,
    },
    update: {},
  });

  const providerPasswordHash = await argon2.hash("ChangeMe123!");
  const provider = await prisma.user.upsert({
    where: { email: "provider@m300.local" },
    create: {
      email: "provider@m300.local",
      fullName: "Seed Data Provider",
      designation: "Monitoring Officer",
      role: RoleName.INSTITUTIONAL_DATA_PROVIDER,
      status: AccountStatus.ACTIVE,
      institutionId: institution.id,
      passwordHash: providerPasswordHash,
    },
    update: {},
  });

  // Without at least one active DATA_REVIEWER/VALIDATOR, pickReviewer() in
  // DataSubmissionsService.uploadSubmission()/saveManualEntry() finds no
  // one to assign, and every submission lands "Unassigned" in the
  // validation queue on a fresh install.
  const reviewerPasswordHash = await argon2.hash("ChangeMe123!");
  await prisma.user.upsert({
    where: { email: "reviewer@m300.local" },
    create: {
      email: "reviewer@m300.local",
      fullName: "Seed Data Reviewer",
      designation: "Data Reviewer",
      role: RoleName.DATA_REVIEWER,
      roles: [RoleName.DATA_REVIEWER],
      status: AccountStatus.ACTIVE,
      reviewsAllInstitutions: true,
      passwordHash: reviewerPasswordHash,
    },
    update: {},
  });

  // One example row for Administration > Access Scope - this table is
  // read-only from the API (see ScopeAssignment's comment in schema.prisma),
  // so seed data is the only way anything shows up in it for now.
  await prisma.scopeAssignment.upsert({
    where: { id: "seed-scope-assignment" },
    create: {
      id: "seed-scope-assignment",
      userId: provider.id,
      level: "DISTRIBUTION_COMPANY",
      scope: institution.name,
      responsibility: "Submits and tracks monthly access-expansion data",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
      active: true,
    },
    update: {},
  });

  // Matches pillarIdSchema in m300-frontend/src/api/schemas/common.ts
  // exactly - all 6, not just the one the old seed had ("Access Expansion",
  // which matched none of the real slugs).
  const PILLARS: { slug: string; name: string }[] = [
    { slug: "generation-network", name: "Generation & network" },
    { slug: "last-mile-access", name: "Last-mile access" },
    { slug: "financially-viable-utilities", name: "Financially Viable Utilities" },
    { slug: "private-sector-participation", name: "Private sector" },
    { slug: "regional-integration", name: "Regional integration" },
    { slug: "clean-cooking", name: "Clean cooking" },
  ];
  const pillarsBySlug = new Map<string, Awaited<ReturnType<typeof prisma.pillar.upsert>>>();
  for (const p of PILLARS) {
    const row = await prisma.pillar.upsert({
      where: { slug: p.slug },
      create: p,
      update: { name: p.name },
    });
    pillarsBySlug.set(p.slug, row);
  }
  const lastMileAccess = pillarsBySlug.get("last-mile-access")!;

  // Real KPI Explorer contract fields all filled with real values (not
  // left at the column defaults) - several are required non-empty
  // strings on the frontend's own schema (definition/formula/unit/
  // sourceInstitution/sourceDataset/category), so a seed row left at
  // "" would violate the real contract the moment this KPI is exposed.
  const accessRateKpi = await prisma.kpiDefinition.upsert({
    where: { code: "access-rate-national" },
    create: {
      code: "access-rate-national",
      name: "National Electricity Access Rate",
      unit: "%",
      pillarId: lastMileAccess.id,
      category: "Outcome",
      readiness: "CORE",
      definition: "Percentage of Nigerian households with a grid or off-grid electricity connection.",
      formula: "(Connected households / Total households) x 100",
      aggregation: "National average, weighted by household count",
      frequency: "Quarterly",
      disaggregation: "By state and by Distribution Company",
      limitations: "Off-grid connections are self-reported by institutions and not independently metered.",
      sourceInstitution: "Sample DisCo",
      sourceDataset: "Quarterly Electricity Access Expansion",
      sourceReference: "M300 KPI Matrix v2.0",
      baseline: 45.2,
      baselineLabel: "45.2% (2025 baseline)",
      target: 90,
      targetLabel: "90% national access by 2030",
      targetDate: "2030",
      targetBasis: "LEVEL",
    },
    update: {},
  });

  // State/DisCo Phase A: real Nigerian geography (37 states incl. FCT,
  // grouped by the 6 geopolitical zones) and the 11 real Distribution
  // Companies as Institution rows (type "Disco" - a DisCo is not a
  // separate entity, see schema.prisma's comment on DiscoPerformanceRecord).
  // State/zone names are real reference data, same category as Pillar
  // names - only the DisCo PERFORMANCE figures below are placeholder test
  // fixtures pending real admin entry.
  const STATES: { name: string; zone: string }[] = [
    { name: "Benue", zone: "North Central" },
    { name: "Kogi", zone: "North Central" },
    { name: "Kwara", zone: "North Central" },
    { name: "Nasarawa", zone: "North Central" },
    { name: "Niger", zone: "North Central" },
    { name: "Plateau", zone: "North Central" },
    { name: "Federal Capital Territory", zone: "North Central" },
    { name: "Adamawa", zone: "North East" },
    { name: "Bauchi", zone: "North East" },
    { name: "Borno", zone: "North East" },
    { name: "Gombe", zone: "North East" },
    { name: "Taraba", zone: "North East" },
    { name: "Yobe", zone: "North East" },
    { name: "Jigawa", zone: "North West" },
    { name: "Kaduna", zone: "North West" },
    { name: "Kano", zone: "North West" },
    { name: "Katsina", zone: "North West" },
    { name: "Kebbi", zone: "North West" },
    { name: "Sokoto", zone: "North West" },
    { name: "Zamfara", zone: "North West" },
    { name: "Abia", zone: "South East" },
    { name: "Anambra", zone: "South East" },
    { name: "Ebonyi", zone: "South East" },
    { name: "Enugu", zone: "South East" },
    { name: "Imo", zone: "South East" },
    { name: "Akwa Ibom", zone: "South South" },
    { name: "Bayelsa", zone: "South South" },
    { name: "Cross River", zone: "South South" },
    { name: "Delta", zone: "South South" },
    { name: "Edo", zone: "South South" },
    { name: "Rivers", zone: "South South" },
    { name: "Ekiti", zone: "South West" },
    { name: "Lagos", zone: "South West" },
    { name: "Ogun", zone: "South West" },
    { name: "Ondo", zone: "South West" },
    { name: "Osun", zone: "South West" },
    { name: "Oyo", zone: "South West" },
  ];
  const statesByName = new Map<string, Awaited<ReturnType<typeof prisma.state.upsert>>>();
  for (const s of STATES) {
    const row = await prisma.state.upsert({ where: { name: s.name }, create: s, update: { zone: s.zone } });
    statesByName.set(s.name, row);
  }

  const DISCOS = [
    "Abuja Electricity Distribution Company",
    "Benin Electricity Distribution Company",
    "Eko Electricity Distribution Company",
    "Enugu Electricity Distribution Company",
    "Ibadan Electricity Distribution Company",
    "Ikeja Electric",
    "Jos Electricity Distribution Company",
    "Kaduna Electricity Distribution Company",
    "Kano Electricity Distribution Company",
    "Port Harcourt Electricity Distribution Company",
    "Yola Electricity Distribution Company",
    // Not one of the 11 standard privatization-era DisCos - a separate,
    // newer independent distribution franchise for Aba and its metro area
    // (Abia State). Matches the id scheme ingest-nerc-disco-data.ts uses
    // for the same institution, so both converge on one row.
    "Aba Power Limited",
  ];
  const discosByName = new Map<string, Awaited<ReturnType<typeof prisma.institution.upsert>>>();
  for (const name of DISCOS) {
    const row = await prisma.institution.upsert({
      where: { id: `seed-disco-${name.toLowerCase().replace(/[^a-z]+/g, "-")}` },
      create: { id: `seed-disco-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, name, type: "Disco" },
      update: {},
    });
    discosByName.set(name, row);
  }

  // Two reporting periods for Ikeja Electric specifically, so a real
  // period-over-period trend can be computed (every other DisCo gets a
  // single period - honest zero-trend, not an invented comparison).
  const ikeja = discosByName.get("Ikeja Electric")!;
  await prisma.discoPerformanceRecord.upsert({
    where: { institutionId_period: { institutionId: ikeja.id, period: "Q2 2025" } },
    create: {
      institutionId: ikeja.id,
      period: "Q2 2025",
      activeCustomers: 1_450_000,
      meteredCustomers: 870_000,
      energyReceivedMwh: 620_000,
      energyBilledMwh: 470_000,
      revenueBilledNgn: 42_000_000_000,
      revenueCollectedNgn: 33_000_000_000,
      remittanceObligationNgn: 18_000_000_000,
      remittanceActualNgn: 12_000_000_000,
      allowedLossRatePercent: 18,
      atccLossRatePercent: 26.5,
      validationStatus: "CONFIRMED",
    },
    update: {},
  });
  await prisma.discoPerformanceRecord.upsert({
    where: { institutionId_period: { institutionId: ikeja.id, period: "Q3 2025" } },
    create: {
      institutionId: ikeja.id,
      period: "Q3 2025",
      activeCustomers: 1_480_000,
      meteredCustomers: 930_000,
      energyReceivedMwh: 640_000,
      energyBilledMwh: 500_000,
      revenueBilledNgn: 44_000_000_000,
      revenueCollectedNgn: 36_000_000_000,
      remittanceObligationNgn: 18_500_000_000,
      remittanceActualNgn: 14_000_000_000,
      allowedLossRatePercent: 18,
      atccLossRatePercent: 24.8,
      validationStatus: "CONFIRMED",
    },
    update: {},
  });

  const eko = discosByName.get("Eko Electricity Distribution Company")!;
  await prisma.discoPerformanceRecord.upsert({
    where: { institutionId_period: { institutionId: eko.id, period: "Q3 2025" } },
    create: {
      institutionId: eko.id,
      period: "Q3 2025",
      activeCustomers: 980_000,
      meteredCustomers: 640_000,
      energyReceivedMwh: 410_000,
      energyBilledMwh: 330_000,
      revenueBilledNgn: 31_000_000_000,
      revenueCollectedNgn: 26_500_000_000,
      remittanceObligationNgn: 13_000_000_000,
      remittanceActualNgn: 10_500_000_000,
      allowedLossRatePercent: 15,
      atccLossRatePercent: 19.2,
      validationStatus: "PROVISIONAL",
    },
    update: {},
  });

  // State/DisCo Phase B: 5 real service bands for Ikeja Electric only (a
  // DisCo is only ever included in GET .../supply-tariff once all 5 exist -
  // see state-disco.mappers.ts's toUtilityOperationsRow comment), plus a
  // couple of delivery milestones exercising both an on-track and an
  // achieved-with-evidence state.
  const IKEJA_BANDS: {
    band: "A" | "B" | "C" | "D" | "E";
    supplyHoursPerDay: number;
    tariffNgnPerKwh: number;
    intensityPercent: number;
  }[] = [
    { band: "A", supplyHoursPerDay: 20, tariffNgnPerKwh: 209.5, intensityPercent: 8 },
    { band: "B", supplyHoursPerDay: 16, tariffNgnPerKwh: 174.3, intensityPercent: 22 },
    { band: "C", supplyHoursPerDay: 12, tariffNgnPerKwh: 155.9, intensityPercent: 35 },
    { band: "D", supplyHoursPerDay: 8, tariffNgnPerKwh: 138.2, intensityPercent: 25 },
    { band: "E", supplyHoursPerDay: 4, tariffNgnPerKwh: 120.6, intensityPercent: 10 },
  ];
  for (const b of IKEJA_BANDS) {
    await prisma.discoServiceBand.upsert({
      where: { institutionId_band: { institutionId: ikeja.id, band: b.band } },
      create: {
        institutionId: ikeja.id,
        band: b.band,
        effectiveOrder: "MYTO 2024 Minor Review",
        supplyHoursPerDay: b.supplyHoursPerDay,
        tariffNgnPerKwh: b.tariffNgnPerKwh,
        intensityPercent: b.intensityPercent,
      },
      update: {},
    });
  }

  await prisma.discoDeliveryMilestone.upsert({
    where: { id: "seed-disco-milestone-ikeja-meter-rollout" },
    create: {
      id: "seed-disco-milestone-ikeja-meter-rollout",
      institutionId: ikeja.id,
      milestone: "Complete Phase 2 meter asset provider rollout in Band A/B franchise areas",
      serviceBand: "A",
      dueDate: new Date("2025-12-31T00:00:00Z"),
      executionStatus: "ON_TRACK",
      reportingCompliance: "3 of 4 quarterly submissions received on time",
      bottleneck: "",
      validationStatus: "CONFIRMED",
    },
    update: {},
  });
  await prisma.discoDeliveryMilestone.upsert({
    where: { id: "seed-disco-milestone-ikeja-band-c-upgrade" },
    create: {
      id: "seed-disco-milestone-ikeja-band-c-upgrade",
      institutionId: ikeja.id,
      milestone: "Commission Band C feeder upgrade, Q3 2025",
      serviceBand: "C",
      dueDate: new Date("2025-09-30T00:00:00Z"),
      achievedDate: new Date("2025-09-25T00:00:00Z"),
      executionStatus: "COMPLETED",
      evidenceUrl: "https://files.example.gov.ng/ikeja/band-c-feeder-upgrade-commissioning.pdf",
      reportingCompliance: "4 of 4 quarterly submissions received on time",
      bottleneck: "",
      validationStatus: "CONFIRMED",
    },
    update: {},
  });

  // One example Dataset/DatasetField/Obligation so the Data Submissions
  // module's read endpoints (GET .../datasets, .../obligations) have
  // something real to return - the manual-entry form definition is built
  // directly from these DatasetField rows.
  const accessDataset = await prisma.dataset.upsert({
    where: { id: "seed-dataset-access-expansion" },
    create: {
      id: "seed-dataset-access-expansion",
      name: "Quarterly Electricity Access Expansion",
      purpose: "Tracks new household electricity connections by DisCo each quarter.",
      pillarId: lastMileAccess.id,
      requiredDataPoints: ["New connections", "Total connected households", "Access rate (%)"],
      frequency: "Quarterly",
      ownerInstitutionId: institution.id,
      templateFileName: "quarterly-access-expansion.xlsx",
      templateVersion: 1,
    },
    update: {},
  });

  await prisma.datasetField.upsert({
    where: { id: "seed-field-access-rate" },
    create: {
      id: "seed-field-access-rate",
      datasetId: accessDataset.id,
      sectionId: "connections",
      sectionTitle: "Connections",
      label: "National Electricity Access Rate",
      helpText: "Percentage of households with a grid connection as of period end.",
      type: "NUMBER",
      required: true,
      unit: "%",
      order: 1,
      kpiDefinitionId: accessRateKpi.id,
    },
    update: {},
  });

  await prisma.obligation.upsert({
    where: {
      institutionId_datasetId_reportingPeriod: {
        institutionId: institution.id,
        datasetId: accessDataset.id,
        reportingPeriod: "Q3 2025",
      },
    },
    create: {
      institutionId: institution.id,
      datasetId: accessDataset.id,
      reportingPeriod: "Q3 2025",
      dueDate: new Date("2025-10-15T00:00:00Z"),
      focalPersonId: provider.id,
    },
    update: {},
  });

  // Programs Phase A: enough real-shaped Programme/Project/Milestone rows to
  // exercise every headline-card rule in programs.mappers.ts's
  // buildHeadlineCards() (a due-and-delayed priority milestone, a completed-
  // on-time one, a pipeline-stage project, missing evidence on both a
  // project and a milestone) - not a full copy of the frontend mock's
  // fixture set, just enough to prove the real computation live.
  const generationNetwork = pillarsBySlug.get("generation-network")!;

  const transmissionProgramme = await prisma.programme.upsert({
    where: { id: "seed-programme-transmission-rehab" },
    create: {
      id: "seed-programme-transmission-rehab",
      name: "Transmission Rehabilitation Programme",
      leadInstitution: "Transmission Company of Nigeria",
      supportingInstitutions: ["Federal Ministry of Power"],
      pillarId: generationNetwork.id,
      objectives: "Rehabilitate ageing transmission infrastructure to reduce evacuation constraints.",
      financing: "World Bank DARES facility",
      status: "DELAYED",
      priority: "PRIORITY",
      startDate: new Date("2024-02-01T00:00:00Z"),
      endDate: new Date("2027-12-31T00:00:00Z"),
      bottleneckCategory: "TECHNICAL_CONSTRAINT",
      validationStatus: "CONFIRMED",
    },
    update: {},
  });

  const miniGridProgramme = await prisma.programme.upsert({
    where: { id: "seed-programme-dares-minigrid" },
    create: {
      id: "seed-programme-dares-minigrid",
      name: "DARES Mini-Grid Cluster Rollout",
      leadInstitution: "Rural Electrification Agency",
      supportingInstitutions: ["State Ministries of Energy"],
      pillarId: lastMileAccess.id,
      objectives: "Deploy mini-grid clusters to unserved and underserved rural communities.",
      financing: "World Bank DARES facility",
      status: "ON_TRACK",
      priority: "PRIORITY",
      startDate: new Date("2024-01-15T00:00:00Z"),
      endDate: new Date("2028-01-15T00:00:00Z"),
      bottleneckCategory: null,
      validationStatus: "CONFIRMED",
    },
    update: {},
  });

  const lineUpgradeProject = await prisma.project.upsert({
    where: { id: "seed-project-north-east-line-upgrade" },
    create: {
      id: "seed-project-north-east-line-upgrade",
      programmeId: transmissionProgramme.id,
      name: "North East 330kV Line Upgrade",
      owner: "Transmission Company of Nigeria",
      leadName: "Ahmed Bello",
      location: "North East",
      latitude: 11.8333,
      longitude: 13.15,
      coverage: "Regional",
      pillarId: generationNetwork.id,
      lifecycleStage: "IMPLEMENTATION",
      programType: "CONCESSIONAL_LOAN",
      fundingSource: "World Bank DARES facility",
      fundingStructure: "Concessional loan with federal government counterpart funding",
      fundingStatus: "DISBURSING",
      pipelineReadiness: null,
      projectedStatus: "ON_TRACK",
      currentStatus: "DELAYED",
      startDate: new Date("2024-05-01T00:00:00Z"),
      endDate: new Date("2026-11-30T00:00:00Z"),
      evidenceUrl: "https://files.example.gov.ng/tcn/north-east-line-upgrade-q3.pdf",
      bottleneckCategory: "TECHNICAL_CONSTRAINT",
      comment: "Contractor mobilisation delays following the interim load-shedding protocol.",
      suggestion: "Expedite contractor mobilisation incentives and confirm a revised energisation date.",
      validationStatus: "CONFIRMED",
      description: "Upgrade of the 330kV North East evacuation line to relieve dispatch constraints.",
      budgetUsd: 42_000_000,
      disbursedUsd: 18_500_000,
      contractor: "Northline Power Contractors Ltd",
      contactName: "Ahmed Bello",
      contactEmail: "ahmed.bello@tcn.example.gov.ng",
      statusHistory: {
        create: [
          { period: "Q2 2025", status: "ON_TRACK" },
          { period: "Q3 2025", status: "DELAYED" },
        ],
      },
      documents: {
        create: [
          {
            label: "Q3 2025 progress report",
            url: "https://files.example.gov.ng/tcn/north-east-line-upgrade-q3.pdf",
          },
        ],
      },
      updates: {
        create: [
          {
            date: new Date("2025-09-01T00:00:00Z"),
            note: "Contractor mobilised to site; tower foundation works underway.",
          },
        ],
      },
    },
    update: {},
  });

  const miniGridCluster4Project = await prisma.project.upsert({
    where: { id: "seed-project-dares-cluster-4" },
    create: {
      id: "seed-project-dares-cluster-4",
      programmeId: miniGridProgramme.id,
      name: "DARES Mini-Grid Cluster 4 Commissioning",
      owner: "Rural Electrification Agency",
      leadName: "Fatima Suleiman",
      location: "Cluster 4, North Central",
      latitude: 9.0833,
      longitude: 7.5333,
      coverage: "Cluster",
      pillarId: lastMileAccess.id,
      lifecycleStage: "COMMISSIONING",
      programType: "GRANT",
      fundingSource: "World Bank DARES facility",
      fundingStructure: "Results-based grant financing",
      fundingStatus: "DISBURSING",
      pipelineReadiness: null,
      projectedStatus: "ON_TRACK",
      currentStatus: "ON_TRACK",
      startDate: new Date("2024-02-01T00:00:00Z"),
      endDate: new Date("2025-12-31T00:00:00Z"),
      evidenceUrl: "https://files.example.gov.ng/rea/dares-cluster-4-commissioning.pdf",
      bottleneckCategory: null,
      comment: "None outstanding - on track for commissioning in November.",
      suggestion: "None - proceed to commissioning as scheduled.",
      validationStatus: "CONFIRMED",
      description: "Commissioning of a 400kW solar hybrid mini-grid serving four communities.",
      budgetUsd: 3_600_000,
      disbursedUsd: 3_100_000,
      contractor: "GreenGrid Nigeria Ltd",
      contactName: "Fatima Suleiman",
      contactEmail: "fatima.suleiman@rea.example.gov.ng",
      statusHistory: { create: [{ period: "Q3 2025", status: "ON_TRACK" }] },
    },
    update: {},
  });

  // Pipeline-stage project (not yet active delivery) with no evidence url -
  // exercises pipelineReadiness and the evidenceOverdue headline card.
  await prisma.project.upsert({
    where: { id: "seed-project-dares-cluster-12-pipeline" },
    create: {
      id: "seed-project-dares-cluster-12-pipeline",
      programmeId: miniGridProgramme.id,
      name: "DARES Mini-Grid Cluster 12 (Pipeline)",
      owner: "Rural Electrification Agency",
      leadName: "Fatima Suleiman",
      contactName: "Fatima Suleiman",
      contactEmail: "fatima.suleiman@rea.example.gov.ng",
      location: "Cluster 12, North East",
      latitude: 12.0,
      longitude: 13.7,
      coverage: "Cluster",
      pillarId: lastMileAccess.id,
      lifecycleStage: "IDENTIFICATION",
      programType: "GRANT",
      fundingSource: null,
      fundingStructure: "Results-based grant financing, subject to feasibility outcome",
      fundingStatus: "UNFUNDED",
      pipelineReadiness: "FEASIBILITY_STUDY",
      projectedStatus: "ON_TRACK",
      currentStatus: "ON_TRACK",
      startDate: new Date("2025-09-01T00:00:00Z"),
      endDate: new Date("2026-03-31T00:00:00Z"),
      evidenceUrl: null,
      bottleneckCategory: null,
      comment: "Feasibility study underway; site selection confirmed.",
      suggestion: "None - proceed with feasibility study as scheduled.",
      validationStatus: "PROVISIONAL",
      description: "Candidate 400kW solar hybrid mini-grid site, currently at feasibility study stage.",
      statusHistory: { create: [{ period: "Q3 2025", status: "ON_TRACK" }] },
    },
    update: {},
  });

  // Due, delayed priority milestone with no evidence - exercises
  // milestoneOnTime's delayed/blocked counts and evidenceOverdue together.
  await prisma.milestone.upsert({
    where: { id: "seed-milestone-north-east-energisation" },
    create: {
      id: "seed-milestone-north-east-energisation",
      projectId: lineUpgradeProject.id,
      name: "North East line upgrade energisation",
      priority: "PRIORITY",
      expectedDate: new Date("2025-08-15T00:00:00Z"),
      actualDate: null,
      status: "DELAYED",
      leadInstitution: "Transmission Company of Nigeria",
      evidenceUrl: null,
      risk: "Contractor mobilisation delays following interim load-shedding protocol.",
      nextAction: "Confirm revised energisation date with contractor.",
      bottleneckCategory: "TECHNICAL_CONSTRAINT",
      validationStatus: "CONFIRMED",
    },
    update: {},
  });

  // Completed-on-time priority milestone - exercises the completedOnTime
  // path of the milestoneOnTime headline card.
  await prisma.milestone.upsert({
    where: { id: "seed-milestone-cluster-4-sat" },
    create: {
      id: "seed-milestone-cluster-4-sat",
      projectId: miniGridCluster4Project.id,
      name: "Cluster 4 site acceptance testing",
      priority: "PRIORITY",
      expectedDate: new Date("2025-10-15T00:00:00Z"),
      actualDate: new Date("2025-10-08T00:00:00Z"),
      status: "COMPLETED",
      leadInstitution: "Rural Electrification Agency",
      evidenceUrl: "https://files.example.gov.ng/rea/dares-cluster-4-sat.pdf",
      risk: "None outstanding.",
      nextAction: "Proceed to commissioning in November.",
      bottleneckCategory: null,
      validationStatus: "CONFIRMED",
    },
    update: {},
  });

  // State/DisCo Phase C: tag two of the projects just seeded above with a
  // real state, so the coverage aggregation in state-disco.service.ts's
  // getStates()/getStateDetail() has something real to compute over - the
  // spec forbids inferring a state from free-text location, so this is a
  // deliberate, explicit tag, not a geocode guess.
  await prisma.project.update({
    where: { id: "seed-project-north-east-line-upgrade" },
    data: { stateId: statesByName.get("Borno")!.id },
  });
  await prisma.project.update({
    where: { id: "seed-project-dares-cluster-4" },
    data: { stateId: statesByName.get("Niger")!.id },
  });

  // Bottlenecks & Exceptions Phase B: enough real-shaped Bottleneck/
  // Escalation rows to exercise every headline-alert rule in
  // bottlenecks.service.ts's getOverview() (open-high-or-critical,
  // delayed via IN_PROGRESS, blocked, a resolved one correctly excluded
  // from "open", and an overdue vs. not-yet-due escalation). One
  // bottleneck's linkedRecord is set to a real seeded project id and
  // another to a real seeded programme id, proving the linkedRecord ->
  // Programme/Project.bottlenecks[] derivation actually works live.
  const financiallyViableUtilities = pillarsBySlug.get("financially-viable-utilities")!;

  const lineUpgradeBottleneck = await prisma.bottleneck.upsert({
    where: { id: "seed-bottleneck-transmission-evacuation" },
    create: {
      id: "seed-bottleneck-transmission-evacuation",
      issue: "Transmission evacuation constraint limiting dispatch, North East",
      category: "TECHNICAL_CONSTRAINT",
      severity: "CRITICAL",
      pillarId: generationNetwork.id,
      linkedRecord: lineUpgradeProject.id,
      institution: "Transmission Company of Nigeria",
      dateRaised: new Date("2025-09-25T00:00:00Z"),
      followUp: "Line upgrade contractor mobilised; interim load-shedding protocol in place.",
      escalationStatus: "ESCALATED",
      status: "ESCALATED",
      lifecycleStage: "IMPLEMENTATION",
      statusHistory: {
        create: [
          { period: "Sep 2025", status: "OPEN" },
          { period: "Sep 2025", status: "ESCALATED" },
        ],
      },
    },
    update: {},
  });

  await prisma.bottleneck.upsert({
    where: { id: "seed-bottleneck-minigrid-financing" },
    create: {
      id: "seed-bottleneck-minigrid-financing",
      issue: "Co-investor first-loss guarantee approval outstanding",
      category: "FINANCING",
      severity: "MEDIUM",
      pillarId: lastMileAccess.id,
      linkedRecord: miniGridProgramme.id,
      institution: "Rural Electrification Agency",
      dateRaised: new Date("2025-09-20T00:00:00Z"),
      followUp: "Awaiting guarantee approval to reach financial close.",
      escalationStatus: "NOT_ESCALATED",
      status: "OPEN",
      lifecycleStage: "DESIGN",
      statusHistory: { create: [{ period: "Sep 2025", status: "OPEN" }] },
    },
    update: {},
  });

  await prisma.bottleneck.upsert({
    where: { id: "seed-bottleneck-bilateral-contracts" },
    create: {
      id: "seed-bottleneck-bilateral-contracts",
      issue: "Bilateral contracts on hold pending regulatory determination",
      category: "REGULATORY_APPROVAL",
      severity: "HIGH",
      pillarId: financiallyViableUtilities.id,
      linkedRecord: "",
      institution: "NERC",
      dateRaised: new Date("2025-08-01T00:00:00Z"),
      followUp: "Awaiting NERC board determination, next sitting Q4 2025.",
      escalationStatus: "NOT_ESCALATED",
      status: "IN_PROGRESS",
      lifecycleStage: "DESIGN",
      statusHistory: {
        create: [
          { period: "Aug 2025", status: "OPEN" },
          { period: "Sep 2025", status: "IN_PROGRESS" },
        ],
      },
    },
    update: {},
  });

  await prisma.bottleneck.upsert({
    where: { id: "seed-bottleneck-feeder-procurement" },
    create: {
      id: "seed-bottleneck-feeder-procurement",
      issue: "Procurement for feeder rehabilitation lots re-advertised",
      category: "PROCUREMENT",
      severity: "LOW",
      pillarId: generationNetwork.id,
      linkedRecord: "",
      institution: "Transmission Company of Nigeria",
      dateRaised: new Date("2025-09-30T00:00:00Z"),
      followUp: "Technical evaluation committee reconvenes next week.",
      escalationStatus: "NOT_ESCALATED",
      status: "BLOCKED",
      lifecycleStage: "PROCUREMENT",
      statusHistory: {
        create: [
          { period: "Sep 2025", status: "OPEN" },
          { period: "Oct 2025", status: "BLOCKED" },
        ],
      },
    },
    update: {},
  });

  // Resolved - must NOT appear in any "open" aggregate (byCategory/
  // byLifecycleStage/byInstitution/open-high-or-critical alert).
  await prisma.bottleneck.upsert({
    where: { id: "seed-bottleneck-permit-resolved" },
    create: {
      id: "seed-bottleneck-permit-resolved",
      issue: "Environmental permit renewal overdue for mini-grid cluster",
      category: "PERMITTING",
      severity: "MEDIUM",
      pillarId: lastMileAccess.id,
      linkedRecord: "",
      institution: "Rural Electrification Agency",
      dateRaised: new Date("2025-07-22T00:00:00Z"),
      followUp: "Permit resubmitted after clarifying site boundary; awaiting response.",
      escalationStatus: "RESOLVED",
      status: "RESOLVED",
      lifecycleStage: "COMMISSIONING",
      statusHistory: {
        create: [
          { period: "Jul 2025", status: "OPEN" },
          { period: "Sep 2025", status: "IN_PROGRESS" },
          { period: "Oct 2025", status: "RESOLVED" },
        ],
      },
    },
    update: {},
  });

  await prisma.escalation.upsert({
    where: { id: "seed-escalation-transmission-budget-overdue" },
    create: {
      id: "seed-escalation-transmission-budget-overdue",
      bottleneckId: lineUpgradeBottleneck.id,
      decisionRequired: "Authorise emergency transmission line upgrade budget",
      level: "STEERING_COMMITTEE",
      owner: "Transmission Company of Nigeria",
      dueDate: new Date("2025-08-01T00:00:00Z"),
      status: "OVERDUE",
      resolution: null,
      evidenceUrl: null,
    },
    update: {},
  });

  await prisma.escalation.upsert({
    where: { id: "seed-escalation-transmission-followup-pending" },
    create: {
      id: "seed-escalation-transmission-followup-pending",
      bottleneckId: lineUpgradeBottleneck.id,
      decisionRequired: "Confirm revised energisation date with WAPP",
      level: "INSTITUTION_LEADERSHIP",
      owner: "Transmission Company of Nigeria",
      dueDate: new Date("2027-01-15T00:00:00Z"),
      status: "ESCALATED",
      resolution: null,
      evidenceUrl: null,
    },
    update: {},
  });

  // No branding seed here on purpose - BrandingService.get() lazily
  // upserts the full default row (countryName/colors/fonts/currency) on
  // its first call, so seeding a partial row here would just be a second,
  // driftable copy of the same defaults.

  // Learning & Decision Log - the first three entries are real: they
  // record the actual decisions made during the SE4ALL MRL alignment
  // review (docs/se4all-mrl-alignment-renewable-private-capital.md),
  // matching the frontend mock's own seed data exactly, not invented
  // examples.
  await prisma.learningLogEntry.upsert({
    where: { id: "seed-learning-log-001" },
    create: {
      id: "seed-learning-log-001",
      title: "Split renewable share into two distinct KPIs",
      area: "KPI_METHODOLOGY",
      decision:
        'Renamed M300-P1-004 to "Renewable Generation Share" (unchanged GWh/GWh figure) and added a new KPI, M300-P1-015 "Renewable Installed Capacity Share" (MW/MW). Both are preserved; neither replaces the other. The Compact Progress Report export now reads M300-P1-015, while the day-to-day dashboard headline keeps showing M300-P1-004.',
      rationale:
        "SE4ALL's CPR-canonical indicator is installed capacity share, not generation-mix share - a genuinely different quantity (a grid can have high capacity share and low generation share, or vice versa). Reporting one as the other would misstate progress against the CPR target in either direction.",
      relatedRecord: "M300-P1-015",
      reviewCycle: "SE4ALL MRL alignment review, Sep 2026",
      status: "DECIDED",
      decidedById: admin.id,
      decidedAt: new Date("2026-09-10T09:00:00Z"),
    },
    update: {},
  });

  await prisma.learningLogEntry.upsert({
    where: { id: "seed-learning-log-002" },
    create: {
      id: "seed-learning-log-002",
      title: "Added a transaction-level private-capital ledger",
      area: "KPI_METHODOLOGY",
      decision:
        "Added M300-P4-008, a canonical private-capital KPI computed from a real transaction ledger that excludes public co-funding and collapses guarantee-for-loan pairs. M300-P4-002 (the existing manually-entered total) is left untouched pending national-scale ledger coverage. The Compact Progress Report export now reads M300-P4-008.",
      rationale:
        "SE4ALL requires the private-capital figure to exclude public funding and duplicate guarantees - a rule that can only be checked against individual transactions, not a single rolled-up quarterly total. A manually-typed number can't be audited for double-counting after the fact.",
      relatedRecord: "M300-P4-008",
      reviewCycle: "SE4ALL MRL alignment review, Sep 2026",
      status: "DECIDED",
      decidedById: admin.id,
      decidedAt: new Date("2026-09-10T09:15:00Z"),
    },
    update: {},
  });

  await prisma.learningLogEntry.upsert({
    where: { id: "seed-learning-log-003" },
    create: {
      id: "seed-learning-log-003",
      title: "Dashboard headline figures stay on legacy KPIs pending national scale",
      area: "KPI_METHODOLOGY",
      decision:
        "Chose NOT to switch the Executive Overview dashboard's renewable-share and private-capital headline cards to the new canonical KPIs yet - they still show M300-P1-004 and M300-P4-002. Only the Compact Progress Report export was repointed.",
      rationale:
        "Silently changing an already-published headline figure carries real risk if the new KPI is still pilot-scale (10 sample transactions; a hydro-plus-estimate capacity figure). The CPR is the one place SE4ALL actually reads, so that got the canonical figure first; the dashboard switches once the underlying data reaches national submission volume.",
      relatedRecord: null,
      reviewCycle: "SE4ALL MRL alignment review, Sep 2026",
      status: "DECIDED",
      decidedById: admin.id,
      decidedAt: new Date("2026-09-10T09:20:00Z"),
    },
    update: {},
  });

  await prisma.learningLogEntry.upsert({
    where: { id: "seed-learning-log-004" },
    create: {
      id: "seed-learning-log-004",
      title: "Workbook row shift for private capital - needs Victor to scope",
      area: "DATA_GOVERNANCE",
      decision: "Not yet actioned - could not be located in this frontend repository.",
      rationale:
        "Victor's memo flags a workbook row that shifted for the private-capital figure. Nothing in this repo (export-excel.ts, data-submissions templates) has private-capital-specific row logic, so this is very likely in an external submission workbook or the backend repo. Logged here so it isn't lost, pending Victor pointing at the specific file.",
      relatedRecord: "M300-P4-002",
      reviewCycle: "SE4ALL MRL alignment review, Sep 2026",
      status: "PROPOSED",
      decidedById: admin.id,
      decidedAt: new Date("2026-09-10T09:25:00Z"),
    },
    update: {},
  });

  console.log(
    "Seed complete. Login as admin@m300.local / provider@m300.local / reviewer@m300.local, password: ChangeMe123!",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
