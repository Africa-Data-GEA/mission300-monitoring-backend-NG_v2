import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { assertInstitutionMembership } from "@/common/guards/institution-scope.guard";
import type { ManualEntryDto } from "@/modules/data-submissions/dto/manual-entry.dto";
import { PrismaService } from "@/prisma/prisma.service";

const MAX_DRAFT_ROWS = 500;

export interface EntryDraftView {
  draft: {
    values: Record<string, string> | null;
    rows: ManualEntryDto["rows"] | null;
    sourceReference: string;
    notes: string;
    savedAt: string;
    savedBy: string;
  } | null;
}

export function hasDraftContent(dto: ManualEntryDto): boolean {
  const typedValue = (values: Record<string, string> | undefined) =>
    Object.values(values ?? {}).some((value) => value.trim() !== "");
  return (
    typedValue(dto.values) ||
    Boolean(dto.rows?.some((row) => typedValue(row.values) || row.institution?.trim())) ||
    Boolean(dto.sourceReference?.trim()) ||
    Boolean(dto.notes?.trim())
  );
}

@Injectable()
export class EntryDraftsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthenticatedUser, obligationId: string): Promise<EntryDraftView> {
    await this.assertAccess(user, obligationId);
    const saved = await this.prisma.entryDraft.findUnique({
      where: { obligationId },
      include: { savedBy: { select: { fullName: true } } },
    });
    if (!saved) return { draft: null };
    const payload = saved.payload as Prisma.JsonObject;
    return {
      draft: {
        values: (payload.values as Record<string, string> | undefined) ?? null,
        rows: (payload.rows as ManualEntryDto["rows"] | undefined) ?? null,
        sourceReference: (payload.sourceReference as string | undefined) ?? "",
        notes: (payload.notes as string | undefined) ?? "",
        savedAt: saved.updatedAt.toISOString(),
        savedBy: saved.savedBy.fullName,
      },
    };
  }

  async save(user: AuthenticatedUser, obligationId: string, dto: ManualEntryDto) {
    await this.assertAccess(user, obligationId);
    if ((dto.rows?.length ?? 0) > MAX_DRAFT_ROWS) {
      throw new BadRequestException(`A draft holds no more than ${MAX_DRAFT_ROWS} rows.`);
    }
    if (!hasDraftContent(dto)) {
      throw new BadRequestException("Enter something before saving a draft.");
    }
    const payload = {
      values: dto.values ?? null,
      rows: dto.rows ?? null,
      sourceReference: dto.sourceReference ?? "",
      notes: dto.notes ?? "",
    } as unknown as Prisma.InputJsonValue;
    const saved = await this.prisma.entryDraft.upsert({
      where: { obligationId },
      create: { obligationId, payload, savedById: user.id },
      update: { payload, savedById: user.id },
    });
    return {
      savedAt: saved.updatedAt.toISOString(),
      message: "Draft saved. It has not been sent for review.",
    };
  }

  async discard(user: AuthenticatedUser, obligationId: string) {
    await this.assertAccess(user, obligationId);
    await this.prisma.entryDraft.deleteMany({ where: { obligationId } });
    return { message: "Draft discarded." };
  }

  async clearAfterSubmit(obligationId: string) {
    await this.prisma.entryDraft.deleteMany({ where: { obligationId } });
  }

  private async assertAccess(user: AuthenticatedUser, obligationId: string) {
    const obligation = await this.prisma.obligation.findUnique({
      where: { id: obligationId },
      select: { institutionId: true },
    });
    if (!obligation) throw new NotFoundException("Obligation not found.");
    assertInstitutionMembership(user, obligation.institutionId);
  }
}
