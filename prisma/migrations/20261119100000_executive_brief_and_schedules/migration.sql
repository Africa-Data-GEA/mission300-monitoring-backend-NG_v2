ALTER TYPE "ReportType" ADD VALUE 'EXECUTIVE_BRIEF';

CREATE TYPE "ReportScheduleCadence" AS ENUM ('WEEKLY', 'MONTHLY');

CREATE TYPE "ReportDeliveryStatus" AS ENUM ('SENT', 'PARTIAL', 'FAILED');

CREATE TABLE "report_schedules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "cadence" "ReportScheduleCadence" NOT NULL,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "hourLagos" INTEGER NOT NULL DEFAULT 8,
    "recipients" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_deliveries" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "savedReportId" TEXT,
    "status" "ReportDeliveryStatus" NOT NULL,
    "recipients" TEXT[],
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_schedules_isActive_nextRunAt_idx" ON "report_schedules"("isActive", "nextRunAt");

CREATE INDEX "report_deliveries_scheduleId_sentAt_idx" ON "report_deliveries"("scheduleId", "sentAt");

ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "report_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
