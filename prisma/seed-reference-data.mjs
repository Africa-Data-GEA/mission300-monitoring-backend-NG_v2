import { spawnSync } from "node:child_process";
import prismaPkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Loads the Mission 300 reference data (KPI directory, historical NERC/NISO/REA
// values, datasets and obligations, project registers) by running the compiled
// ingest scripts in dependency order. Every script is idempotent (upserts), so
// this is safe to run on every deploy. Deliberately does NOT run prisma/seed.ts:
// that creates demo accounts with a known password and demo programmes.
//
// Run inside the api container (same DB, same storage volume for evidence
// files): node prisma/seed-reference-data.mjs
//
// LOAD-ONCE: the scripts upsert from the source files, which would put back
// the file's values over anything edited in the app since (KPI definitions and
// targets, programme/project records, DisCo performance rows). So by default
// this only runs while the database has no KPI values yet -
// and is a no-op on every later deploy. Pass --force to reload deliberately.

const ORDER = [
  "ingest-kpi-directory",
  "ingest-rea-kpi-baseline",
  "ingest-nerc-disco-data",
  "ingest-nerc-genco-kpis",
  "ingest-nerc-tariff-kpi",
  "ingest-national-rollup-kpis",
  "ingest-access-delivery-kpis",
  "ingest-derived-utility-kpis",
  "ingest-niso-generation-kpis",
  "ingest-niso-bilateral-kpi",
  "ingest-niso-remaining-sheets",
  "ingest-nerc-datasets-obligations",
  "ingest-rea-niso-datasets-obligations",
  "ingest-rea-project-register",
  "ingest-niso-project-register",
  "ingest-fgn-powerco-project-register",
  "ingest-fgn-compact-progress-kpi-values",
  "ingest-fgn-compact-progress-electricity-access",
  "ingest-fgn-compact-progress-clean-cooking-headline",
  "ingest-reform-actions",
  "backfill-institution-traceability",
  "link-duplicate-kpis",
];

const CORRECTIONS = ["correct-nerc-customer-stocks", "apply-period-coverage", "load-status-values"];

const force = process.argv.includes("--force");
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length) : null;
if (only) {
  if (![...ORDER, ...CORRECTIONS].includes(only)) {
    console.error(`Unknown ingest script "${only}". Choose one of: ${[...ORDER, ...CORRECTIONS].join(", ")}`);
    process.exit(1);
  }
  const passthrough = process.argv.slice(2).filter((arg) => arg === "--dry-run");
  const result = spawnSync(process.execPath, [`dist/prisma/${only}.js`, ...passthrough], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
if (!force) {
  const prisma = new prismaPkg.PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });
  const kpiValues = await prisma.kpiValue.count();
  await prisma.$disconnect();
  if (kpiValues > 0) {
    console.log(`Reference data already loaded (${kpiValues} KPI values) - skipping. Use --force to reload.`);
    process.exit(0);
  }
}

for (const [index, name] of ORDER.entries()) {
  console.log(`\n[${index + 1}/${ORDER.length}] ${name}`);
  const result = spawnSync(process.execPath, [`dist/prisma/${name}.js`], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\nReference data load failed at ${name} (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nReference data loaded (${ORDER.length} scripts).`);
