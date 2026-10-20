import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, MinLength, ValidateIf } from "class-validator";
import { LearningLogArea, LearningLogStatus, LearningLogType } from "@prisma/client";
import { parseKebabEnum } from "@/common/utils/enum-casing";

const isDecision = (dto: CreateLearningLogEntryDto) => (dto.entryType ?? LearningLogType.DECISION) === LearningLogType.DECISION;
const isLearning = (dto: CreateLearningLogEntryDto) => dto.entryType === LearningLogType.LEARNING;

export class CreateLearningLogEntryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" ? parseKebabEnum(value, Object.values(LearningLogType), "entryType") : value,
  )
  @IsEnum(LearningLogType)
  entryType?: LearningLogType;

  @IsString()
  @MinLength(3, { message: "Give the entry a title" })
  title!: string;

  @Transform(({ value }) =>
    typeof value === "string" ? parseKebabEnum(value, Object.values(LearningLogArea), "area") : value,
  )
  @IsEnum(LearningLogArea)
  area!: LearningLogArea;

  @ValidateIf(isDecision)
  @IsString()
  @MinLength(10, { message: "Describe what was decided or proposed" })
  decision?: string;

  @ValidateIf(isDecision)
  @IsString()
  @MinLength(10, { message: "Describe why" })
  rationale?: string;

  @ValidateIf(isLearning)
  @IsString()
  @MinLength(10, { message: "Describe what happened" })
  context?: string;

  @ValidateIf(isLearning)
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

  @IsString()
  @MinLength(1, { message: "Name the review cycle" })
  reviewCycle!: string;

  @Transform(({ value }) =>
    typeof value === "string" ? parseKebabEnum(value, Object.values(LearningLogStatus), "status") : value,
  )
  @IsEnum(LearningLogStatus)
  status!: LearningLogStatus;
}
