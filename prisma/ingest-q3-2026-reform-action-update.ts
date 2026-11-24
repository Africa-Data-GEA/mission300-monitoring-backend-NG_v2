import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type ReformActionStatus } from "@prisma/client";

interface StatusUpdate {
  id: string;
  previousStatus: ReformActionStatus;
  status: ReformActionStatus;
}

const STATUS_UPDATES: StatusUpdate[] = [
  { id: "reform-action-generation-network-20", previousStatus: "IN_PROGRESS_ON_TRACK", status: "IN_PROGRESS_ON_TRACK" },
  { id: "reform-action-generation-network-21", previousStatus: "IN_PROGRESS_ON_TRACK", status: "IN_PROGRESS_ON_TRACK" },
  { id: "reform-action-generation-network-18", previousStatus: "IN_PROGRESS_ON_TRACK", status: "COMPLETED" },
  { id: "reform-action-regional-integration-03", previousStatus: "IN_PROGRESS_ON_TRACK", status: "DELAYED" },
  { id: "reform-action-private-sector-participation-01", previousStatus: "IN_PROGRESS_ON_TRACK", status: "COMPLETED" },
  { id: "reform-action-private-sector-participation-03", previousStatus: "IN_PROGRESS_ON_TRACK", status: "COMPLETED" },
  { id: "reform-action-last-mile-access-04", previousStatus: "DELAYED", status: "DELAYED" },
  { id: "reform-action-last-mile-access-05", previousStatus: "DELAYED", status: "IN_PROGRESS_ON_TRACK" },
  { id: "reform-action-financially-viable-utilities-02", previousStatus: "DELAYED", status: "IN_PROGRESS_ON_TRACK" },
  { id: "reform-action-financially-viable-utilities-04", previousStatus: "DELAYED", status: "COMPLETED" },
];

const REMOVED_BY_CDMU = [
  "reform-action-private-sector-participation-04",
  "reform-action-private-sector-participation-05",
  "reform-action-financially-viable-utilities-10",
];

const CHANGED_AT = new Date("2026-09-30T00:00:00.000Z");

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });
  const admin = await prisma.user.findFirst({ where: { role: "SYSTEM_ADMINISTRATOR" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No SYSTEM_ADMINISTRATOR user found.");

  let updated = 0;
  let missing = 0;

  for (const update of STATUS_UPDATES) {
    const existing = await prisma.reformAction.findUnique({ where: { id: update.id } });
    if (!existing) {
      missing += 1;
      continue;
    }
    if (existing.status === update.status && existing.previousStatus === update.previousStatus) continue;

    await prisma.reformAction.update({
      where: { id: update.id },
      data: { status: update.status, previousStatus: update.previousStatus },
    });
    await prisma.reformActionStatusChange.upsert({
      where: { id: `${update.id}-change-q3-2026` },
      create: {
        id: `${update.id}-change-q3-2026`,
        reformActionId: update.id,
        fromStatus: existing.status,
        toStatus: update.status,
        comment: "Updated from the Q3 2026 Compact Progress Report",
        changedById: admin.id,
        changedAt: CHANGED_AT,
      },
      update: {},
    });
    updated += 1;
  }

  const removed = await prisma.reformAction.deleteMany({ where: { id: { in: REMOVED_BY_CDMU } } });

  console.log(`Reform actions: ${updated} updated, ${missing} not found, ${removed.count} removed as requested by the CDMU.`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
