import { Module } from "@nestjs/common";
import { WebhooksService } from "@/notifications/webhooks/webhooks.service";
import { WebhooksController } from "@/notifications/webhooks/webhooks.controller";
import { NotificationsConsumer } from "@/notifications/notifications.consumer";
import { NotificationsFeedController } from "@/notifications/feed/notifications-feed.controller";
import { NotificationsFeedService } from "@/notifications/feed/notifications-feed.service";
import { AuthModule } from "@/modules/auth/auth.module";
import { AdministrationModule } from "@/modules/administration/administration.module";
import { RemindersController } from "@/notifications/reminders/reminders.controller";
import { RemindersRunner } from "@/notifications/reminders/reminders-runner";
import { RemindersService } from "@/notifications/reminders/reminders.service";

// EmailService is NOT provided here - it's global (see email.module.ts).
@Module({
  imports: [AuthModule, AdministrationModule], // AdministrationModule for BrandingService
  controllers: [WebhooksController, NotificationsFeedController, RemindersController],
  providers: [WebhooksService, NotificationsConsumer, NotificationsFeedService, RemindersService, RemindersRunner],
  exports: [WebhooksService],
})
export class NotificationsModule {}
