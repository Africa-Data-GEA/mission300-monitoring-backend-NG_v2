import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { Roles } from "@/common/decorators/roles.decorator";
import { PillarDashboardService } from "@/modules/pillar-dashboard/pillar-dashboard.service";
import { PillarDashboardQueryDto } from "@/modules/pillar-dashboard/dto/pillar-dashboard-query.dto";

// A Compact pillar dashboard (m300-frontend/src/api/schemas/pillar-
// dashboard.ts) - deliberately has no entities of its own, a filtered view
// over KPI Explorer + Programs + Bottlenecks data, same read-composition
// pattern as Executive Overview. The endpoint contract is identical for all
// six pillars even though only two currently have a built frontend page
// (a frontend rollout sequencing decision, not a backend one - confirmed
// against docs/API.md directly).
@ApiTags("pillar-dashboard")
@ApiBearerAuth()
@Roles("SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER", "OVERSIGHT_USER")
@Controller("pillars")
export class PillarDashboardController {
  constructor(private readonly pillarDashboard: PillarDashboardService) {}

  @Get(":pillar")
  getDashboard(@Param("pillar") pillar: string, @Query() query: PillarDashboardQueryDto) {
    return this.pillarDashboard.getDashboard(pillar, query.reportingPeriod, query.institution);
  }
}
