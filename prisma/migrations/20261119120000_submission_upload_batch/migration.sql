ALTER TABLE "submissions" ADD COLUMN "batchId" TEXT;
CREATE INDEX "submissions_batchId_idx" ON "submissions"("batchId");
