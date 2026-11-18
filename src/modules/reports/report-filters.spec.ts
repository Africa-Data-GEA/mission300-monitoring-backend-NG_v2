import { BadRequestException } from "@nestjs/common";
import type { PrismaService } from "@/prisma/prisma.service";
import type { RabbitmqService } from "@/events/rabbitmq.service";
import type { ExecutiveBriefService } from "./executive-brief.service";
import { ReportsService } from "./reports.service";
import type { ReportConfigDto } from "./dto/report-config.dto";

const base = {
  reportType: "COMPACT_PROGRESS",
  periods: ["all"],
  pillars: ["all"],
  kpiCategory: "all",
  state: "all",
  distributionCompany: "all",
  programmeOrAgency: "all",
  validationStatus: "all",
  readinessTier: "all",
  format: "PDF",
} as ReportConfigDto;

describe("report filter boundaries", () => {
  const service = new ReportsService({} as PrismaService, {} as RabbitmqService, {} as ExecutiveBriefService);

  it("rejects a reporting period for current-snapshot Compact reports", async () => {
    await expect(service.preview({ ...base, periods: ["q3-2025"] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a state selection until state-level report rows exist", async () => {
    await expect(service.preview({ ...base, state: "lagos" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects all periods combined with a specific period", async () => {
    await expect(service.preview({ ...base, periods: ["all", "q3-2025"] })).rejects.toBeInstanceOf(BadRequestException);
  });
});
