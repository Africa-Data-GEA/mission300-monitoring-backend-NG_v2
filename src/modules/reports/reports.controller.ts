import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, StreamableFile } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { ReportsService } from "@/modules/reports/reports.service";
import { CompactWorksheetTemplateService } from "@/modules/reports/compact-worksheet-template.service";
import { ReportsQueryDto } from "@/modules/reports/dto/reports-query.dto";
import { ReportConfigDto } from "@/modules/reports/dto/report-config.dto";
import { CurrentUser, type AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { AuditAction } from "@/common/decorators/audit-action.decorator";
import { Roles } from "@/common/decorators/roles.decorator";
import { OPERATIONAL_MANAGERS } from "@/common/guards/operational-scope";

// Reports & Exports (m300-frontend/src/api/schemas/reports.ts) - a pure
// read-composition layer over KPI Explorer/Programs/Bottlenecks/State &
// DisCo/Data Submissions, same pattern as Executive Overview. The backend
// never renders an actual PDF/XLSX file - confirmed directly from the real
// mock's own handler comment - so /preview and /generate both return the
// same {metadata, sections} JSON; the frontend builds the downloadable
// file client-side from it. Export and shared-library management use
// explicit server-side role checks.
@ApiTags("reports")
@ApiBearerAuth()
@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly worksheetTemplate: CompactWorksheetTemplateService,
  ) {}

  @Get("filters")
  getFilters() {
    return this.reports.getFilters();
  }

  @Get()
  getOverview(@Query() query: ReportsQueryDto) {
    return this.reports.getOverview(query);
  }

  @Get("methodology")
  getMethodology() {
    return this.reports.getMethodology();
  }

  @Get("compact-progress-worksheet-template")
  @Roles("SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER", "OVERSIGHT_USER")
  async getCompactWorksheetTemplate() {
    return new StreamableFile(await this.worksheetTemplate.read(), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: 'attachment; filename="compact-progress-worksheet.xlsx"',
    });
  }

  @Post("preview")
  @Roles("SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER", "OVERSIGHT_USER")
  @HttpCode(200)
  preview(@Body() dto: ReportConfigDto) {
    return this.reports.preview(dto);
  }

  @Post("generate")
  @Roles("SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER", "OVERSIGHT_USER")
  @AuditAction("report.requested")
  generate(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReportConfigDto) {
    return this.reports.generate(user, dto);
  }

  @Delete("saved/:id")
  @Roles(...OPERATIONAL_MANAGERS)
  @HttpCode(204)
  @AuditAction("report.deleted")
  async deleteSaved(@Param("id") id: string) {
    await this.reports.deleteSaved(id);
  }

  @Get("saved/:id/pdf")
  @Roles("SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER", "OVERSIGHT_USER")
  async getSavedPdf(@Param("id") id: string) {
    const { buffer, fileName } = await this.reports.getSavedPdf(id);
    return new StreamableFile(buffer, { type: "application/pdf", disposition: `attachment; filename="${fileName}"` });
  }

  @Get("saved/:id/preview")
  @Roles("SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER", "OVERSIGHT_USER")
  getSavedPreview(@Param("id") id: string) {
    return this.reports.getSavedPreview(id);
  }
}
