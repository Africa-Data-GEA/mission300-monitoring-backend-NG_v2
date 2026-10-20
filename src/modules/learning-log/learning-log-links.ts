import type { PrismaService } from "@/prisma/prisma.service";

export interface RelatedLink {
  type: "kpi" | "programme" | "project";
  id: string;
  name: string;
}

type LinkDb = Pick<PrismaService, "kpiDefinition" | "programme" | "project">;

export async function loadRelatedLinks(prisma: LinkDb, references: (string | null)[]): Promise<Map<string, RelatedLink>> {
  const refs = [...new Set(references.filter((ref): ref is string => !!ref))];
  const links = new Map<string, RelatedLink>();
  if (refs.length === 0) return links;

  const [kpis, programmes, projects] = await Promise.all([
    prisma.kpiDefinition.findMany({ where: { code: { in: refs } }, select: { code: true, name: true } }),
    prisma.programme.findMany({ where: { id: { in: refs } }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { id: { in: refs } }, select: { id: true, name: true } }),
  ]);
  for (const kpi of kpis) links.set(kpi.code, { type: "kpi", id: kpi.code, name: kpi.name });
  for (const programme of programmes) links.set(programme.id, { type: "programme", id: programme.id, name: programme.name });
  for (const project of projects) links.set(project.id, { type: "project", id: project.id, name: project.name });
  return links;
}

export async function resolveRelated(prisma: LinkDb, reference: string): Promise<RelatedLink | null> {
  return (await loadRelatedLinks(prisma, [reference])).get(reference) ?? null;
}

export async function loadRelatedOptions(prisma: LinkDb) {
  const [kpis, programmes, projects] = await Promise.all([
    prisma.kpiDefinition.findMany({ where: { isActive: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.programme.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    kpis: kpis.map((kpi) => ({ value: kpi.code, label: `${kpi.code} — ${kpi.name}` })),
    programmes: programmes.map((programme) => ({ value: programme.id, label: programme.name })),
    projects: projects.map((project) => ({ value: project.id, label: project.name })),
  };
}
