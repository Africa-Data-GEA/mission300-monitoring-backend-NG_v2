import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ReformActionStatus } from "@prisma/client";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { parseKebabEnum, toKebabCase } from "@/common/utils/enum-casing";
import { paginate } from "@/modules/administration/overview/overview.mappers";
import type { CreateReformActionDto } from "@/modules/reform-actions/dto/create-reform-action.dto";
import type { ReformActionQueryDto } from "@/modules/reform-actions/dto/reform-action-query.dto";
import type { UpdateReformActionDto } from "@/modules/reform-actions/dto/update-reform-action.dto";
import {
  REFORM_ACTION_DETAIL_INCLUDE,
  REFORM_ACTION_INCLUDE,
  toReformAction,
  toReformActionDetail,
} from "@/modules/reform-actions/reform-actions.mappers";
import { REFORM_ACTION_STATUSES, summariseReformActions } from "@/modules/reform-actions/reform-actions-summary";
import { PrismaService } from "@/prisma/prisma.service";

const DEFAULT_PAGE_SIZE = 25;

type ReformActionRow = Prisma.ReformActionGetPayload<{ include: typeof REFORM_ACTION_INCLUDE }>;

function latestUpdate(rows: readonly ReformActionRow[]): string {
  const latest = rows.reduce<Date | null>((newest, row) => (!newest || row.updatedAt > newest ? row.updatedAt : newest), null);
  return (latest ?? new Date()).toISOString();
}

@Injectable()
export class ReformActionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(query: ReformActionQueryDto) {
    const [all, pillars, programmes] = await Promise.all([
      this.prisma.reformAction.findMany({
        include: REFORM_ACTION_INCLUDE,
        orderBy: [{ pillar: { name: "asc" } }, { createdAt: "asc" }],
      }),
      this.prisma.pillar.findMany({ orderBy: { name: "asc" } }),
      this.prisma.programme.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const matching = all.filter((row) => this.matches(row, query));
    const paged = paginate(matching, query.page ?? 1, query.pageSize ?? DEFAULT_PAGE_SIZE);

    return {
      lastUpdated: latestUpdate(all),
      summary: summariseReformActions(
        all.map((row) => ({ pillarSlug: row.pillar.slug, isPriority: row.isPriority, status: row.status })),
      ),
      filters: {
        pillars: pillars.map((pillar) => ({ value: pillar.slug, label: pillar.name })),
        statuses: REFORM_ACTION_STATUSES.map((status) => ({ value: toKebabCase(status), label: status })),
        programmes: programmes.map((programme) => ({ value: programme.id, label: programme.name })),
      },
      actions: {
        items: paged.items.map(toReformAction),
        page: paged.page,
        pageSize: paged.pageSize,
        total: paged.total,
      },
    };
  }

  async getOne(id: string) {
    const row = await this.prisma.reformAction.findUnique({ where: { id }, include: REFORM_ACTION_DETAIL_INCLUDE });
    if (!row) throw new NotFoundException("The reform action was not found.");
    return toReformActionDetail(row);
  }

  async create(user: AuthenticatedUser, dto: CreateReformActionDto) {
    const pillarId = await this.pillarIdFor(dto.pillar);
    await this.assertProgramme(dto.programmeId);
    const status = dto.status ?? ReformActionStatus.NOT_YET_DUE;

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.reformAction.create({
        data: {
          pillarId,
          commitment: dto.commitment.trim(),
          action: dto.action.trim(),
          isPriority: dto.isPriority ?? false,
          programmeId: dto.programmeId || null,
          leadInstitution: dto.leadInstitution?.trim() ?? "",
          referenceDueDate: dto.referenceDueDate ? new Date(dto.referenceDueDate) : null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          completedAt: status === ReformActionStatus.COMPLETED ? new Date() : null,
          status,
          comment: dto.comment?.trim() ?? "",
          createdById: user.id,
        },
      });
      await tx.reformActionStatusChange.create({
        data: { reformActionId: row.id, fromStatus: null, toStatus: status, comment: "Recorded", changedById: user.id },
      });
      return row;
    });

    return { action: await this.getOne(created.id), message: "The reform action has been recorded." };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateReformActionDto) {
    const existing = await this.prisma.reformAction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("The reform action was not found.");

    const data: Prisma.ReformActionUncheckedUpdateInput = {
      commitment: dto.commitment?.trim(),
      action: dto.action?.trim(),
      isPriority: dto.isPriority,
      leadInstitution: dto.leadInstitution?.trim(),
      comment: dto.comment?.trim(),
    };
    if (dto.pillar) data.pillarId = await this.pillarIdFor(dto.pillar);
    if (dto.programmeId !== undefined) {
      await this.assertProgramme(dto.programmeId);
      data.programmeId = dto.programmeId || null;
    }
    if (dto.referenceDueDate !== undefined) data.referenceDueDate = dto.referenceDueDate ? new Date(dto.referenceDueDate) : null;
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;

    const nextStatus = dto.status !== undefined && dto.status !== existing.status ? dto.status : null;
    if (nextStatus) {
      data.status = nextStatus;
      data.previousStatus = existing.status;
      data.completedAt = nextStatus === ReformActionStatus.COMPLETED ? new Date() : null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reformAction.update({ where: { id }, data });
      if (nextStatus) {
        await tx.reformActionStatusChange.create({
          data: {
            reformActionId: id,
            fromStatus: existing.status,
            toStatus: nextStatus,
            comment: dto.statusNote?.trim() ?? "",
            changedById: user.id,
          },
        });
      }
    });

    return { action: await this.getOne(id), message: "The reform action has been updated." };
  }

  async delete(id: string) {
    const existing = await this.prisma.reformAction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("The reform action was not found.");
    await this.prisma.reformAction.delete({ where: { id } });
    return { message: "The reform action has been removed." };
  }

  private matches(row: ReformActionRow, query: ReformActionQueryDto) {
    if (query.pillar && query.pillar !== "all" && row.pillar.slug !== query.pillar) return false;
    if (query.priority === "priority" && !row.isPriority) return false;
    if (query.priority === "other" && row.isPriority) return false;
    if (query.status && query.status !== "all") {
      const status = parseKebabEnum(query.status, Object.values(ReformActionStatus), "status");
      if (row.status !== status) return false;
    }
    const search = query.search?.trim().toLowerCase();
    if (search) {
      const haystack = `${row.commitment} ${row.action} ${row.leadInstitution} ${row.comment}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }

  private async pillarIdFor(slug: string) {
    const pillar = await this.prisma.pillar.findUnique({ where: { slug } });
    if (!pillar) throw new BadRequestException("Select a Compact pillar from the list.");
    return pillar.id;
  }

  private async assertProgramme(programmeId: string | null | undefined) {
    if (!programmeId) return;
    const programme = await this.prisma.programme.findUnique({ where: { id: programmeId }, select: { id: true } });
    if (!programme) throw new BadRequestException("Select a programme from the list.");
  }
}
