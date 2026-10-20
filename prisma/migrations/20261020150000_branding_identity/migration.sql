ALTER TABLE "branding_settings"
  ADD COLUMN "officialName" TEXT NOT NULL DEFAULT 'Federal Republic of Nigeria',
  ADD COLUMN "agencyName" TEXT NOT NULL DEFAULT 'Federal Ministry of Power',
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
  ADD COLUMN "crestUrl" TEXT NOT NULL DEFAULT '';
