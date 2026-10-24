import { Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsISO8601, IsOptional, IsString, MinLength } from "class-validator";
import { ReformActionStatus } from "@prisma/client";
import { parseKebabEnum } from "@/common/utils/enum-casing";

export class CreateReformActionDto {
  @IsString()
  pillar!: string;

  @IsString()
  @MinLength(3, { message: "Name the commitment or indicator" })
  commitment!: string;

  @IsString()
  @MinLength(5, { message: "Describe the reform action" })
  action!: string;

  @IsOptional()
  @IsBoolean()
  isPriority?: boolean;

  @IsOptional()
  @IsString()
  programmeId?: string | null;

  @IsOptional()
  @IsString()
  leadInstitution?: string;

  @IsOptional()
  @IsISO8601()
  referenceDueDate?: string | null;

  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" ? parseKebabEnum(value, Object.values(ReformActionStatus), "status") : value,
  )
  @IsEnum(ReformActionStatus)
  status?: ReformActionStatus;

  @IsOptional()
  @IsString()
  comment?: string;
}
