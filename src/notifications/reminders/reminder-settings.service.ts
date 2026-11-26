import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/prisma/prisma.service";

const SETTING_ID = "default";

@Injectable()
export class ReminderSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const setting = await this.prisma.reminderSetting.findUnique({ where: { id: SETTING_ID } });
    return {
      enabled: setting?.enabled ?? false,
      updatedByName: setting?.updatedByName ?? null,
      updatedAt: setting?.updatedAt.toISOString() ?? null,
      lastRunAt: setting?.lastRunAt?.toISOString() ?? null,
      lastSent: setting?.lastSent ?? 0,
      lastFailed: setting?.lastFailed ?? 0,
    };
  }

  async setEnabled(enabled: boolean, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    const data = { enabled, updatedByName: user?.fullName ?? null, updatedAt: new Date() };
    await this.prisma.reminderSetting.upsert({ where: { id: SETTING_ID }, create: { id: SETTING_ID, ...data }, update: data });
    return this.get();
  }

  async recordRun(lastRunAt: Date, lastSent: number, lastFailed: number) {
    await this.prisma.reminderSetting.update({ where: { id: SETTING_ID }, data: { lastRunAt, lastSent, lastFailed } });
  }
}
