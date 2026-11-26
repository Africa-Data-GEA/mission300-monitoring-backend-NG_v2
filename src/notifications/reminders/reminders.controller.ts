import { Body, Controller, Get, Put } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "@/common/decorators/roles.decorator";
import { AuditAction } from "@/common/decorators/audit-action.decorator";
import { CurrentUser, type AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { RemindersService } from "@/notifications/reminders/reminders.service";
import { ReminderSettingsService } from "@/notifications/reminders/reminder-settings.service";
import { UpdateReminderSettingsDto } from "@/notifications/reminders/update-reminder-settings.dto";

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notification-reminders")
export class RemindersController {
  constructor(
    private readonly reminders: RemindersService,
    private readonly settings: ReminderSettingsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Roles("SYSTEM_ADMINISTRATOR")
  async overview() {
    const [setting, digests] = await Promise.all([this.settings.get(), this.reminders.plan(new Date())]);
    return {
      ...setting,
      emailConfigured: Boolean(this.config.get<string>("RESEND_API_KEY")),
      recipients: digests.map(({ user, entries }) => ({
        name: user.fullName,
        email: user.email,
        items: entries.map((entry) => ({ section: entry.section, text: entry.text })),
      })),
    };
  }

  @Put()
  @Roles("SYSTEM_ADMINISTRATOR")
  @AuditAction("reminders.updated")
  async update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateReminderSettingsDto) {
    await this.settings.setEnabled(dto.enabled, user.id);
    return this.overview();
  }
}
