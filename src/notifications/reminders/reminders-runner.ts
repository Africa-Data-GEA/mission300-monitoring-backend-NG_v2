import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RemindersService } from "@/notifications/reminders/reminders.service";
import { SEND_FROM_UTC_HOUR } from "@/notifications/reminders/reminder-rules";

const TICK_MS = 60 * 60 * 1000;

@Injectable()
export class RemindersRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly reminders: RemindersService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>("REMINDERS_ENABLED", "false") !== "true") {
      this.logger.log("Reminders disabled");
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    if (this.running || now.getUTCHours() < SEND_FROM_UTC_HOUR) return;
    this.running = true;
    try {
      const { sent, failed } = await this.reminders.run(now);
      if (sent || failed) this.logger.log(`Reminder digests: ${sent} sent, ${failed} failed`);
    } catch (error) {
      this.logger.error(`Reminder tick failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      this.running = false;
    }
  }
}
