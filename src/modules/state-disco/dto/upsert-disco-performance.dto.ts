import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";
import { ValidationStatus } from "@prisma/client";
import { parseKebabEnum } from "@/common/utils/enum-casing";

// No real frontend contract dictates this shape - the mock's own DisCo
// comparison data is static fixture content with no create/update handler
// anywhere (confirmed by reading mocks/handlers/state-disco.ts directly),
// since NERC-reported DisCo performance has no existing submission
// pipeline yet. This is this backend's own admin-entry surface for that
// data, matching the "System Administrator sets values directly" pattern
// already used for a KPI's baseline/target.
export class UpsertDiscoPerformanceDto {
  @IsString()
  @MinLength(1, { message: "State the reporting period, e.g. Q3 2025" })
  period!: string;

  @IsInt()
  @Min(0)
  activeCustomers!: number;

  @IsInt()
  @Min(0)
  meteredCustomers!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  energyReceivedMwh?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  energyBilledMwh?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  energyReceivedValueNgn?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  energyBilledValueNgn?: number;

  @IsNumber()
  @Min(0)
  revenueBilledNgn!: number;

  @IsNumber()
  @Min(0)
  revenueCollectedNgn!: number;

  @IsNumber()
  @Min(0)
  remittanceObligationNgn!: number;

  @IsNumber()
  @Min(0)
  remittanceActualNgn!: number;

  // Optional - a regulator-approved MYTO benchmark entered separately from
  // whoever holds the actual tariff order figures, not derivable from this
  // record's own energy/revenue fields.
  @IsOptional()
  @IsNumber()
  @Min(0)
  allowedLossRatePercent?: number;

  @IsNumber()
  @Min(0)
  atccLossRatePercent!: number;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string"
      ? parseKebabEnum(value, Object.values(ValidationStatus), "validationStatus")
      : value,
  )
  @IsEnum(ValidationStatus)
  validationStatus?: ValidationStatus;
}
