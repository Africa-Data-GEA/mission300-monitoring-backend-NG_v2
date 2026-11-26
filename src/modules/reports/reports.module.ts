import { Module } from "@nestjs/common";
import { AdministrationModule } from "@/modules/administration/administration.module";
import { CompactWorksheetTemplateService } from "@/modules/reports/compact-worksheet-template.service";
import { ExecutiveBriefService } from "@/modules/reports/executive-brief.service";
import { ReportScheduleRunner } from "@/modules/reports/report-schedule-runner";
import { ReportSchedulesController } from "@/modules/reports/report-schedules.controller";
import { ReportSchedulesService } from "@/modules/reports/report-schedules.service";
import { ReportsController } from "@/modules/reports/reports.controller";
import { ReportsService } from "@/modules/reports/reports.service";

@Module({
  imports: [AdministrationModule],
  controllers: [ReportsController, ReportSchedulesController],
  providers: [ReportsService, ExecutiveBriefService, ReportSchedulesService, ReportScheduleRunner, CompactWorksheetTemplateService],
})
export class ReportsModule {}
