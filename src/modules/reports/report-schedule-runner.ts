import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ReportSchedulesService } from "@/modules/reports/report-schedules.service";

const TICK_MS = 60_000;

@Injectable()
export class ReportScheduleRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportScheduleRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly schedules: ReportSchedulesService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>("REPORT_SCHEDULER_ENABLED", "true") === "false") {
      this.logger.log("Report scheduler disabled");
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.schedules.runDue(new Date());
    } catch (error) {
      this.logger.error(`Report scheduler tick failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      this.running = false;
    }
  }
}
