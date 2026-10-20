import { IsOptional, IsString } from "class-validator";

export class PillarDashboardQueryDto {
  @IsOptional()
  @IsString()
  reportingPeriod?: string;

  @IsOptional()
  @IsString()
  institution?: string;
}
