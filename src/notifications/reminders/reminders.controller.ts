import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "@/common/decorators/roles.decorator";
import { RemindersService } from "@/notifications/reminders/reminders.service";

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notification-reminders")
export class RemindersController {
  constructor(
    private readonly reminders: RemindersService,
    private readonly config: ConfigService,
  ) {}

  @Get("preview")
  @Roles("SYSTEM_ADMINISTRATOR")
  async preview() {
    const digests = await this.reminders.plan(new Date());
    return {
      enabled: this.config.get<string>("REMINDERS_ENABLED", "false") === "true",
      recipientCount: digests.length,
      recipients: digests.map(({ user, entries }) => ({
        name: user.fullName,
        email: user.email,
        items: entries.map((entry) => ({ section: entry.section, text: entry.text })),
      })),
    };
  }
}
