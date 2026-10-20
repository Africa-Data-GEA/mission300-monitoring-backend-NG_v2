import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { ownerMatchesInstitution } from "@/common/institutions/owner-match";
import { programmeVisibleTo, projectVisibleTo, resolveReadScope } from "@/modules/programs/programs-visibility";
import type { PrismaService } from "@/prisma/prisma.service";

type BottleneckReadDb = Pick<PrismaService, "institution" | "project" | "programme" | "bottleneck">;

export async function resolveBottleneckVisibility(
  prisma: BottleneckReadDb,
  user: AuthenticatedUser,
): Promise<Prisma.BottleneckWhereInput> {
  const scope = await resolveReadScope(prisma, user);
  if (scope === null) return {};
  if (scope === "none") return { id: { in: [] } };

  const [recorded, projects, programmes] = await Promise.all([
    prisma.bottleneck.findMany({ select: { institution: true }, distinct: ["institution"] }),
    prisma.project.findMany({ where: projectVisibleTo(scope), select: { id: true } }),
    prisma.programme.findMany({ where: programmeVisibleTo(scope), select: { id: true } }),
  ]);

  const institutionNames = [
    scope.name,
    ...recorded
      .map((entry) => entry.institution)
      .filter((name) => ownerMatchesInstitution(name, { id: scope.institutionId, name: scope.name })),
  ];

  return {
    OR: [
      ...[...new Set(institutionNames)].map((name) => ({
        institution: { equals: name.trim(), mode: "insensitive" as const },
      })),
      { linkedRecord: { in: [...projects, ...programmes].map((record) => record.id) } },
    ],
  };
}
