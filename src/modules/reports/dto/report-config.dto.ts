import { Transform } from "class-transformer";
import { ArrayMinSize, IsArray, IsEnum, IsIn, IsOptional, IsString } from "class-validator";
import { ReportFormat, ReportType } from "@prisma/client";
import { parseKebabEnum } from "@/common/utils/enum-casing";

// Matches reportConfigSchema exactly (m300-frontend/src/api/schemas/
// reports.ts). `periods`/`pillars` are real multi-select arrays (stakeholder
// feedback asked for both to allow multiple selections) - min 1 each, not
// optional. Every other filter is a single string, "all" meaning
// unfiltered - matching every other module's convention.
export class ReportConfigDto {
  @Transform(({ value }) =>
    typeof value === "string" ? parseKebabEnum(value, Object.values(ReportType), "reportType") : value,
  )
  @IsEnum(ReportType)
  reportType!: ReportType;

  @IsArray()
  @ArrayMinSize(1, { message: "Select at least one reporting period" })
  @IsString({ each: true })
  periods!: string[];

  @IsArray()
  @ArrayMinSize(1, { message: "Select at least one pillar" })
  @IsString({ each: true })
  pillars!: string[];

  @IsString()
  kpiCategory!: string;

  @IsString()
  state!: string;

  @IsString()
  distributionCompany!: string;

  @IsString()
  programmeOrAgency!: string;

  @IsString()
  validationStatus!: string;

  @IsString()
  readinessTier!: string;

  @Transform(({ value }) =>
    typeof value === "string" ? parseKebabEnum(value, Object.values(ReportFormat), "format") : value,
  )
  @IsEnum(ReportFormat)
  format!: ReportFormat;

  @IsOptional()
  @IsString()
  institutionId?: string;

  @IsOptional()
  @IsIn(["portrait", "landscape"])
  orientation?: "portrait" | "landscape";

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedSections?: string[];
}
