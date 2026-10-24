import { join } from "node:path";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type ReformActionStatus } from "@prisma/client";

const DATA_PATH = join(process.cwd(), "prisma", "data", "reform-actions.json");

interface SourceAction {
  pillar: string;
  serial: string;
  commitment: string;
  action: string;
  isPriority: boolean;
  referenceDueDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  previousStatus: ReformActionStatus | null;
  status: ReformActionStatus;
  lastUpdate: string | null;
  comment: string;
}

const toDate = (value: string | null) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });
  const actions = JSON.parse(readFileSync(DATA_PATH, "utf-8")) as SourceAction[];
  const admin = await prisma.user.findFirst({ where: { role: "SYSTEM_ADMINISTRATOR" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No SYSTEM_ADMINISTRATOR user found.");

  const pillars = new Map((await prisma.pillar.findMany()).map((pillar) => [pillar.slug, pillar.id]));
  const counters = new Map<string, number>();
  let created = 0;
  let skipped = 0;

  for (const source of actions) {
    const pillarId = pillars.get(source.pillar);
    if (!pillarId) throw new Error(`Pillar ${source.pillar} is not loaded - run ingest-kpi-directory first.`);

    const position = (counters.get(source.pillar) ?? 0) + 1;
    counters.set(source.pillar, position);
    const id = `reform-action-${source.pillar}-${String(position).padStart(2, "0")}`;

    if (await prisma.reformAction.findUnique({ where: { id }, select: { id: true } })) {
      skipped += 1;
      continue;
    }

    const changedAt = toDate(source.lastUpdate) ?? new Date();
    await prisma.reformAction.create({
      data: {
        id,
        pillarId,
        commitment: source.commitment,
        action: source.action,
        isPriority: source.isPriority,
        referenceDueDate: toDate(source.referenceDueDate),
        dueDate: toDate(source.dueDate),
        completedAt: toDate(source.completedAt),
        status: source.status,
        previousStatus: source.previousStatus,
        comment: source.comment,
        createdById: admin.id,
        history: {
          create: {
            id: `${id}-change-1`,
            fromStatus: source.previousStatus,
            toStatus: source.status,
            comment: "Loaded from the Cycle 1 2026 Compact Progress Report worksheet",
            changedById: admin.id,
            changedAt,
          },
        },
      },
    });
    created += 1;
  }

  console.log(`Reform actions: ${created} created, ${skipped} already present, ${actions.length} in the worksheet.`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
