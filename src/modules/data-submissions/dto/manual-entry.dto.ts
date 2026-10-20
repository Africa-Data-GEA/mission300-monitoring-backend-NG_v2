import { Type } from "class-transformer";
import { IsArray, IsObject, IsOptional, IsString, ValidateNested } from "class-validator";

// Matches manualEntryRequestSchema exactly (m300-frontend/src/api/schemas/
// data-submissions/obligations.ts) - sourceReference/notes have no min(1)
// there (unlike the upload endpoint, which enforces sourceReference via
// imperative code, not the schema) - both stay optional here to match.
export class ManualEntryRowDto {
  @IsOptional()
  @IsString()
  period?: string;

  @IsOptional()
  @IsString()
  institution?: string;

  @IsObject()
  values!: Record<string, string>;
}

export class ManualEntryDto {
  @IsOptional()
  @IsObject()
  values?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualEntryRowDto)
  rows?: ManualEntryRowDto[];

  @IsOptional()
  @IsString()
  sourceReference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
