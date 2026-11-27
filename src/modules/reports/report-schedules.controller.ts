import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuditAction } from "@/common/decorators/audit-action.decorator";
import { CurrentUser, type AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { Roles } from "@/common/decorators/roles.decorator";
import { ReportScheduleDto, SendReportScheduleDto } from "@/modules/reports/dto/report-schedule.dto";
import { ReportSchedulesService } from "@/modules/reports/report-schedules.service";

@ApiTags("reports")
@ApiBearerAuth()
@Controller("reports/schedules")
@Roles("SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER")
export class ReportSchedulesController {
  constructor(private readonly schedules: ReportSchedulesService) {}

  @Get()
  list() {
    return this.schedules.list();
  }

  @Get("audiences")
  audiences() {
    return this.schedules.audiences();
  }

  @Post()
  @AuditAction("report_schedule.created")
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReportScheduleDto) {
    return this.schedules.create(user, dto);
  }

  @Put(":id")
  @AuditAction("report_schedule.updated")
  update(@Param("id") id: string, @Body() dto: ReportScheduleDto) {
    return this.schedules.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @AuditAction("report_schedule.deleted")
  async remove(@Param("id") id: string) {
    await this.schedules.remove(id);
  }

  @Get(":id/deliveries")
  deliveries(@Param("id") id: string) {
    return this.schedules.deliveries(id);
  }

  @Post(":id/send")
  @HttpCode(200)
  @AuditAction("report_schedule.sent")
  send(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: SendReportScheduleDto) {
    return this.schedules.sendNow(user, id, dto.test === true);
  }
}
