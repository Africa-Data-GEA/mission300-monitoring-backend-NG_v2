import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

// Matches GET /api/learning-log's real query params exactly (learning-
// log.ts) - page/pageSize only, capped at 50 per the mock's own
// `Math.min(50, ...)`.
export class LearningLogQueryDto {
  @IsOptional()
  @IsString()
  entryType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}
