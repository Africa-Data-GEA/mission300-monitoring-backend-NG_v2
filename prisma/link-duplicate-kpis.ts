import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { KPI_LINKS, planCopy, validateKpiLinks, type SourceValue } from "./lib/kpi-links";

const LINKED_ITEM_PREFIX = "linked-item-";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const problems = validateKpiLinks(KPI_LINKS);
  if (problems.length > 0) throw new Error(`Invalid KPI links: ${problems.join("; ")}`);

  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });
  const admin = await prisma.user.findFirst({ where: { role: "SYSTEM_ADMINISTRATOR" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No SYSTEM_ADMINISTRATOR user found.");

  console.log(dryRun ? "DRY RUN - nothing written\n" : "Applied\n");
  let blocked = false;

  for (const link of KPI_LINKS) {
    const [canonical, alias] = await Promise.all([
      prisma.kpiDefinition.findUnique({ where: { code: link.canonical } }),
      prisma.kpiDefinition.findUnique({ where: { code: link.alias } }),
    ]);
    if (!canonical || !alias) {
      console.log(`${link.canonical} <- ${link.alias}: SKIPPED, ${!canonical ? link.canonical : link.alias} not found`);
      blocked = true;
      continue;
    }

    const aliasValues = await prisma.kpiValue.findMany({ where: { kpiDefinitionId: alias.id }, orderBy: { approvedAt: "asc" } });
    const canonicalValues = await prisma.kpiValue.findMany({ where: { kpiDefinitionId: canonical.id } });

    const source: SourceValue[] = [];
    const conflicts: string[] = [];
    for (const value of aliasValues) {
      const own = canonicalValues.find((entry) => entry.period === value.period);
      const isLinkedCopy = own?.sourceSubmissionItemId.startsWith(LINKED_ITEM_PREFIX) ?? false;
      if (own && !isLinkedCopy && Number(own.value) !== Number(value.value)) {
        conflicts.push(`${value.period}: ${link.canonical} has its own value ${own.value}, ${link.alias} has ${value.value}`);
        continue;
      }
      source.push({
        period: value.period,
        value: Number(value.value),
        coverageNote: value.coverageNote,
        institutionId: value.institutionId,
        approvedAt: value.approvedAt,
      });
    }

    const plan = planCopy(
      source,
      canonicalValues.map((value) => ({ period: value.period, value: Number(value.value), coverageNote: value.coverageNote })),
    );

    console.log(
      `${link.canonical} ${canonical.name}\n  <- ${link.alias} ${alias.name}\n` +
        `  units: "${canonical.unit}" vs "${alias.unit}"${canonical.unit === alias.unit ? "" : "  (differ - check they mean the same thing)"}\n` +
        `  values: ${plan.create.length} to copy, ${plan.update.length} to update, ${plan.unchanged} already in step`,
    );
    for (const conflict of conflicts) console.log(`  CONFLICT, not overwritten: ${conflict}`);
    if (conflicts.length > 0) blocked = true;
    if (dryRun) continue;

    await prisma.kpiDefinition.update({ where: { id: alias.id }, data: { canonicalKpiId: canonical.id, isActive: false } });

    for (const value of [...plan.create, ...plan.update]) {
      if (!value.institutionId) {
        console.log(`  SKIPPED ${value.period}: source value has no institution`);
        blocked = true;
        continue;
      }
      const submissionId = `linked-submission-${link.canonical}-${value.period}`;
      const itemId = `${LINKED_ITEM_PREFIX}${link.canonical}-${value.period}`;

      await prisma.submission.upsert({
        where: { id: submissionId },
        create: {
          id: submissionId,
          institutionId: value.institutionId,
          submittedById: admin.id,
          method: "MANUAL_ENTRY",
          status: "APPROVED",
          sourceReference: `Linked copy of ${link.alias} (same measurement), see link-duplicate-kpis.ts`,
          notes: `Copied from ${link.alias} so ${link.canonical} shows the same figure.`,
          reviewerId: admin.id,
        },
        update: {},
      });
      await prisma.submissionItem.upsert({
        where: { id: itemId },
        create: { id: itemId, submissionId, kpiDefinitionId: canonical.id, period: value.period, value: value.value },
        update: { value: value.value },
      });
      if (!(await prisma.reviewDecision.findFirst({ where: { submissionId } }))) {
        await prisma.reviewDecision.create({
          data: { submissionId, reviewedById: admin.id, decision: "APPROVE", comment: `Linked copy of ${link.alias}.` },
        });
      }
      await prisma.kpiValue.upsert({
        where: { sourceSubmissionItemId: itemId },
        create: {
          kpiDefinitionId: canonical.id,
          institutionId: value.institutionId,
          period: value.period,
          value: value.value,
          sourceSubmissionItemId: itemId,
          approvedAt: value.approvedAt,
          coverageNote: value.coverageNote,
        },
        update: { value: value.value, approvedAt: value.approvedAt, coverageNote: value.coverageNote },
      });
    }
  }

  if (blocked) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
