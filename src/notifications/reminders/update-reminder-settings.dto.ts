import { IsBoolean } from "class-validator";

export class UpdateReminderSettingsDto {
  @IsBoolean()
  enabled!: boolean;
}
