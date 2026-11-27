import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

export class ReportScheduleDto {
  @IsString()
  @MinLength(1, { message: "Give the schedule a name" })
  @MaxLength(120)
  name!: string;

  @IsIn(["weekly", "monthly"])
  cadence!: "weekly" | "monthly";

  @ValidateIf((schedule: ReportScheduleDto) => schedule.cadence === "weekly")
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  @ValidateIf((schedule: ReportScheduleDto) => schedule.cadence === "monthly")
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth?: number;

  @IsInt()
  @Min(0)
  @Max(23)
  hourLagos!: number;

  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : entry)) : value,
  )
  @IsArray()
  @ArrayMinSize(1, { message: "Add at least one recipient" })
  @ArrayMaxSize(25, { message: "A schedule can have at most 25 recipients" })
  @IsEmail({}, { each: true, message: "Every recipient must be a valid email address" })
  recipients!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pillars?: string[];

  @IsOptional()
  @IsString()
  institutionId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SendReportScheduleDto {
  @IsOptional()
  @IsBoolean()
  test?: boolean;
}
