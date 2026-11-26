import type { PrismaService } from "@/prisma/prisma.service";
import { ReminderSettingsService } from "./reminder-settings.service";
import { RemindersRunner } from "./reminders-runner";
import type { RemindersService } from "./reminders.service";

const morning = new Date("2026-11-27T08:00:00.000Z");

function runner(enabled: boolean) {
  const reminders = { run: jest.fn().mockResolvedValue({ sent: 2, failed: 0 }) };
  const settings = { get: jest.fn().mockResolvedValue({ enabled }), recordRun: jest.fn() };
  const instance = new RemindersRunner(
    reminders as unknown as RemindersService,
    settings as unknown as ReminderSettingsService,
  );
  return { instance, reminders, settings };
}

describe("reminder settings", () => {
  it("is off until a system administrator switches it on", async () => {
    const prisma = { reminderSetting: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new ReminderSettingsService(prisma as unknown as PrismaService);
    await expect(service.get()).resolves.toMatchObject({ enabled: false, lastRunAt: null });
  });

  it("sends nothing while switched off", async () => {
    const { instance, reminders } = runner(false);
    await instance.tick(morning);
    expect(reminders.run).not.toHaveBeenCalled();
  });

  it("sends and records the run when switched on", async () => {
    const { instance, settings } = runner(true);
    await instance.tick(morning);
    expect(settings.recordRun).toHaveBeenCalledWith(morning, 2, 0);
  });
});
