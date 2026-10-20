import { IsOptional, IsString, MinLength } from "class-validator";

export class CreateInstitutionDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  type!: string;
}

export class UpdateInstitutionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  type?: string;
}
