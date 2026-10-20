import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { LearningLogType } from "@prisma/client";
import { statusProblem } from "@/modules/learning-log/learning-log-status";
import { PrismaService } from "@/prisma/prisma.service";
import { paginate } from "@/modules/administration/overview/overview.mappers";
import { toLearningLogEntry } from "@/modules/learning-log/learning-log.mappers";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import type { LearningLogQueryDto } from "@/modules/learning-log/dto/learning-log-query.dto";
import type { CreateLearningLogEntryDto } from "@/modules/learning-log/dto/create-learning-log-entry.dto";
import type { UpdateLearningLogEntryDto } from "@/modules/learning-log/dto/update-learning-log-entry.dto";

const DEFAULT_PAGE_SIZE = 25;
const ENTRY_INCLUDE = { decidedBy: true } as const;

@Injectable()
export class LearningLogService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(query: LearningLogQueryDto) {
    // Newest first - a decision log reads as a timeline, not a stable-
    // sorted table, matching the real mock's own handler exactly.
    const type = query.entryType?.toUpperCase();
    const entries = await this.prisma.learningLogEntry.findMany({
      where: type === "DECISION" || type === "LEARNING" ? { entryType: type } : {},
      include: ENTRY_INCLUDE,
      orderBy: { decidedAt: "desc" },
    });

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const paged = paginate(entries, page, pageSize);

    return {
      lastUpdated: entries[0]?.decidedAt.toISOString() ?? new Date().toISOString(),
      entries: {
        items: paged.items.map(toLearningLogEntry),
        page: paged.page,
        pageSize: paged.pageSize,
        total: paged.total,
      },
    };
  }

  async create(user: AuthenticatedUser, dto: CreateLearningLogEntryDto) {
    const entryType = dto.entryType ?? LearningLogType.DECISION;
    const problem = statusProblem(entryType, dto.status);
    if (problem) throw new BadRequestException(problem);

    const entry = await this.prisma.learningLogEntry.create({
      data: {
        entryType,
        title: dto.title.trim(),
        area: dto.area,
        decision: dto.decision?.trim() ?? "",
        rationale: dto.rationale?.trim() ?? "",
        context: dto.context?.trim() ?? "",
        lesson: dto.lesson?.trim() ?? "",
        recommendation: dto.recommendation?.trim() ?? "",
        evidence: dto.evidence?.trim() ?? "",
        relatedRecord: dto.relatedRecord?.trim() || null,
        reviewCycle: dto.reviewCycle.trim(),
        status: dto.status,
        decidedById: user.id,
      },
      include: ENTRY_INCLUDE,
    });

    return {
      entry: toLearningLogEntry(entry),
      message: `${entry.id} has been added to the learning log.`,
    };
  }

  async update(id: string, dto: UpdateLearningLogEntryDto) {
    const existing = await this.prisma.learningLogEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("The learning log entry was not found.");
    if (dto.status) {
      const problem = statusProblem(existing.entryType, dto.status);
      if (problem) throw new BadRequestException(problem);
    }

    const entry = await this.prisma.learningLogEntry.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        area: dto.area,
        decision: dto.decision?.trim(),
        rationale: dto.rationale?.trim(),
        context: dto.context?.trim(),
        lesson: dto.lesson?.trim(),
        recommendation: dto.recommendation?.trim(),
        evidence: dto.evidence?.trim(),
        relatedRecord: dto.relatedRecord === undefined ? undefined : dto.relatedRecord.trim() || null,
        reviewCycle: dto.reviewCycle?.trim(),
        status: dto.status,
      },
      include: ENTRY_INCLUDE,
    });

    return {
      entry: toLearningLogEntry(entry),
      message: `${entry.id} has been updated.`,
    };
  }

  async delete(id: string) {
    const existing = await this.prisma.learningLogEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("The learning log entry was not found.");

    await this.prisma.learningLogEntry.delete({ where: { id } });
    return { message: `${existing.id} has been removed from the learning log.` };
  }
}
