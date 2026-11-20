import { IsOptional, IsString } from "class-validator";

// sourceReference is required by the real contract, but enforced
// imperatively in the service (400 with the mock's exact message) rather
// than here - matches the pattern BrandingService.uploadLogo() already
// uses for its own required `file` field.
export class UploadSubmissionDto {
  @IsOptional()
  @IsString()
  sourceReference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  institutionId?: string;
}
