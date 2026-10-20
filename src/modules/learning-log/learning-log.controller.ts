import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { LearningLogService } from "@/modules/learning-log/learning-log.service";
import { LearningLogQueryDto } from "@/modules/learning-log/dto/learning-log-query.dto";
import { CreateLearningLogEntryDto } from "@/modules/learning-log/dto/create-learning-log-entry.dto";
import { UpdateLearningLogEntryDto } from "@/modules/learning-log/dto/update-learning-log-entry.dto";
import { CurrentUser, type AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { AuditAction } from "@/common/decorators/audit-action.decorator";
import { Roles } from "@/common/decorators/roles.decorator";
import { OPERATIONAL_MANAGERS } from "@/common/guards/operational-scope";

// The Learning & Decision Log (m300-frontend/src/api/schemas/learning-
// log.ts) - added per the SE4ALL MRL alignment review. Course-correction
// decisions and their rationale, distinct from Bottlenecks & Exceptions
// (what's currently blocked). Writes require operational manager access.
@ApiTags("learning-log")
@ApiBearerAuth()
@Controller("learning-log")
export class LearningLogController {
  constructor(private readonly learningLog: LearningLogService) {}

  @Get()
  getOverview(@Query() query: LearningLogQueryDto) {
    return this.learningLog.getOverview(query);
  }

  @Get("options")
  getRelatedOptions() {
    return this.learningLog.getRelatedOptions();
  }

  @Post()
  @Roles(...OPERATIONAL_MANAGERS)
  @AuditAction("learning_log.entry_created")
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLearningLogEntryDto) {
    return this.learningLog.create(user, dto);
  }

  @Patch(":id")
  @Roles(...OPERATIONAL_MANAGERS)
  @AuditAction("learning_log.entry_updated")
  update(@Param("id") id: string, @Body() dto: UpdateLearningLogEntryDto) {
    return this.learningLog.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(200)
  @Roles(...OPERATIONAL_MANAGERS)
  @AuditAction("learning_log.entry_deleted")
  delete(@Param("id") id: string) {
    return this.learningLog.delete(id);
  }
}
