CREATE TABLE "reminder_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRunAt" TIMESTAMP(3),
    "lastSent" INTEGER NOT NULL DEFAULT 0,
    "lastFailed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reminder_settings_pkey" PRIMARY KEY ("id")
);
