UPDATE "submissions" SET "batchId" = 'single-' || "id" WHERE "batchId" IS NULL;
