import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuditAction } from "@/common/decorators/audit-action.decorator";
import { CurrentUser, type AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { Roles } from "@/common/decorators/roles.decorator";
import { OPERATIONAL_MANAGERS } from "@/common/guards/operational-scope";
import { CreateReformActionDto } from "@/modules/reform-actions/dto/create-reform-action.dto";
import { ReformActionQueryDto } from "@/modules/reform-actions/dto/reform-action-query.dto";
import { UpdateReformActionDto } from "@/modules/reform-actions/dto/update-reform-action.dto";
import { ReformActionsService } from "@/modules/reform-actions/reform-actions.service";

@ApiTags("reform-actions")
@ApiBearerAuth()
@Controller("reform-actions")
export class ReformActionsController {
  constructor(private readonly reformActions: ReformActionsService) {}

  @Get()
  getOverview(@Query() query: ReformActionQueryDto) {
    return this.reformActions.getOverview(query);
  }

  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.reformActions.getOne(id);
  }

  @Post()
  @Roles(...OPERATIONAL_MANAGERS)
  @AuditAction("reform_action.created")
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReformActionDto) {
    return this.reformActions.create(user, dto);
  }

  @Patch(":id")
  @Roles(...OPERATIONAL_MANAGERS)
  @AuditAction("reform_action.updated")
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateReformActionDto) {
    return this.reformActions.update(user, id, dto);
  }

  @Delete(":id")
  @HttpCode(200)
  @Roles(...OPERATIONAL_MANAGERS)
  @AuditAction("reform_action.deleted")
  delete(@Param("id") id: string) {
    return this.reformActions.delete(id);
  }
}
