CREATE TYPE "EnergyBasis" AS ENUM ('VOLUME', 'VALUE');

ALTER TABLE "disco_performance_records"
  ADD COLUMN "energyBasis" "EnergyBasis" NOT NULL DEFAULT 'VOLUME',
  ADD COLUMN "energyReceivedValueNgn" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "energyBilledValueNgn" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ALTER COLUMN "energyReceivedMwh" SET DEFAULT 0,
  ALTER COLUMN "energyBilledMwh" SET DEFAULT 0;
