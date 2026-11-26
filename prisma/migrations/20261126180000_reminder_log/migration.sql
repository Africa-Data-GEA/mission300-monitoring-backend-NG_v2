CREATE TABLE "reminder_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reminder_logs_userId_key_key" ON "reminder_logs"("userId", "key");

CREATE INDEX "reminder_logs_userId_sentAt_idx" ON "reminder_logs"("userId", "sentAt");

ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
