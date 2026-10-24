CREATE TYPE "ReformActionStatus" AS ENUM ('NOT_YET_DUE', 'IN_PROGRESS_ON_TRACK', 'IN_PROGRESS_MINOR_DELAYS', 'IN_PROGRESS_AT_RISK', 'DELAYED', 'COMPLETED');

CREATE TABLE "reform_actions" (
    "id" TEXT NOT NULL,
    "pillarId" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "isPriority" BOOLEAN NOT NULL DEFAULT false,
    "programmeId" TEXT,
    "leadInstitution" TEXT NOT NULL DEFAULT '',
    "referenceDueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "ReformActionStatus" NOT NULL DEFAULT 'NOT_YET_DUE',
    "previousStatus" "ReformActionStatus",
    "comment" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reform_actions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reform_action_status_changes" (
    "id" TEXT NOT NULL,
    "reformActionId" TEXT NOT NULL,
    "fromStatus" "ReformActionStatus",
    "toStatus" "ReformActionStatus" NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reform_action_status_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reform_actions_pillarId_idx" ON "reform_actions"("pillarId");
CREATE INDEX "reform_actions_programmeId_idx" ON "reform_actions"("programmeId");
CREATE INDEX "reform_actions_status_idx" ON "reform_actions"("status");
CREATE INDEX "reform_action_status_changes_reformActionId_idx" ON "reform_action_status_changes"("reformActionId");

ALTER TABLE "reform_actions" ADD CONSTRAINT "reform_actions_pillarId_fkey" FOREIGN KEY ("pillarId") REFERENCES "pillars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reform_actions" ADD CONSTRAINT "reform_actions_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "programmes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reform_actions" ADD CONSTRAINT "reform_actions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reform_action_status_changes" ADD CONSTRAINT "reform_action_status_changes_reformActionId_fkey" FOREIGN KEY ("reformActionId") REFERENCES "reform_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reform_action_status_changes" ADD CONSTRAINT "reform_action_status_changes_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
