import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { LearningLogArea, LearningLogStatus } from "@prisma/client";
import { parseKebabEnum } from "@/common/utils/enum-casing";

// Same fields as CreateLearningLogEntryDto, all optional - a partial update
// (e.g. moving a "proposed" entry to "decided" once a review cycle
// concludes) shouldn't require resubmitting the whole entry.
export class UpdateLearningLogEntryDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: "Give the entry a title" })
  title?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" ? parseKebabEnum(value, Object.values(LearningLogArea), "area") : value,
  )
  @IsEnum(LearningLogArea)
  area?: LearningLogArea;

  @IsOptional()
  @IsString()
  @MinLength(10, { message: "Describe what was decided or proposed" })
  decision?: string;

  @IsOptional()
  @IsString()
  @MinLength(10, { message: "Describe why" })
  rationale?: string;

  @IsOptional()
  @IsString()
  @MinLength(10, { message: "Describe what happened" })
  context?: string;

  @IsOptional()
  @IsString()
  @MinLength(10, { message: "Describe what was learned" })
  lesson?: string;

  @IsOptional()
  @IsString()
  recommendation?: string;

  @IsOptional()
  @IsString()
  evidence?: string;

  @IsOptional()
  @IsString()
  relatedRecord?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: "Name the review cycle" })
  reviewCycle?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" ? parseKebabEnum(value, Object.values(LearningLogStatus), "status") : value,
  )
  @IsEnum(LearningLogStatus)
  status?: LearningLogStatus;
}
