ALTER TABLE "users" ADD COLUMN "reviewsAllInstitutions" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users"
SET "reviewsAllInstitutions" = true
WHERE "institutionId" IS NULL
  AND ("role" IN ('DATA_REVIEWER', 'VALIDATOR') OR "roles" && ARRAY['DATA_REVIEWER', 'VALIDATOR']::"RoleName"[])
  AND NOT ('INSTITUTIONAL_DATA_PROVIDER' = "role" OR "roles" && ARRAY['INSTITUTIONAL_DATA_PROVIDER']::"RoleName"[])
  AND NOT ('SYSTEM_ADMINISTRATOR' = "role" OR "roles" && ARRAY['SYSTEM_ADMINISTRATOR']::"RoleName"[]);
