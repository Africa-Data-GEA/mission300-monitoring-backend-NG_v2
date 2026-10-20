import { CANONICAL_INSTITUTIONS, resolveInstitutionSources } from "@/common/institutions/institution-alias";
import { ownerMatchesInstitution } from "@/common/institutions/owner-match";
import type { PrismaService } from "@/prisma/prisma.service";

export interface PillarInstitutionFilter {
  institutionId: string | null;
  names: string[];
}

type FilterDb = Pick<PrismaService, "institution" | "project" | "programme" | "bottleneck">;

export const anyName = (names: string[]) =>
  names.map((name) => ({ equals: name.trim(), mode: "insensitive" as const }));

export async function resolvePillarInstitutionFilter(
  prisma: FilterDb,
  requested: string | undefined,
): Promise<PillarInstitutionFilter | null> {
  const value = requested?.trim();
  if (!value || value === "all") return null;

  let institution = await prisma.institution.findFirst({
    where: { OR: [{ id: value }, { name: { equals: value, mode: "insensitive" } }] },
    select: { id: true, name: true },
  });
  if (!institution) {
    const resolved = resolveInstitutionSources(value);
    if (resolved.slugs.length === 1 && resolved.unresolved.length === 0 && !resolved.allDiscos) {
      institution = await prisma.institution.findUnique({
        where: { id: CANONICAL_INSTITUTIONS[resolved.slugs[0]].id },
        select: { id: true, name: true },
      });
    }
  }
  if (!institution) return { institutionId: null, names: [value] };

  const [owners, leads, raisedBy] = await Promise.all([
    prisma.project.findMany({ select: { owner: true }, distinct: ["owner"] }),
    prisma.programme.findMany({ select: { leadInstitution: true }, distinct: ["leadInstitution"] }),
    prisma.bottleneck.findMany({ select: { institution: true }, distinct: ["institution"] }),
  ]);
  const recorded = [
    ...owners.map((entry) => entry.owner),
    ...leads.map((entry) => entry.leadInstitution),
    ...raisedBy.map((entry) => entry.institution),
  ].filter((name) => ownerMatchesInstitution(name, institution));

  return { institutionId: institution.id, names: [...new Set([institution.name, value, ...recorded])] };
}
