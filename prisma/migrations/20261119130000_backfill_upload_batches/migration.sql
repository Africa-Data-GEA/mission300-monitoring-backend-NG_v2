UPDATE "submissions"
SET "batchId" = 'file-' || md5("sourceFileUrl")
WHERE "batchId" IS NULL
  AND "sourceFileUrl" IS NOT NULL
  AND "sourceFileUrl" IN (
    SELECT "sourceFileUrl"
    FROM "submissions"
    WHERE "sourceFileUrl" IS NOT NULL
    GROUP BY "sourceFileUrl"
    HAVING COUNT(*) > 1
  );
