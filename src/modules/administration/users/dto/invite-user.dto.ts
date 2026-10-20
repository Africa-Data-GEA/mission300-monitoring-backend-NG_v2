import { Transform } from "class-transformer";
import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from "class-validator";
import { RoleName, ScopeLevel } from "@prisma/client";
import { parseKebabEnum } from "@/common/utils/enum-casing";

// Defense-in-depth: nothing downstream currently renders these fields
// unescaped (React's default JSX escaping, and email templates' explicit
// escapeHtml() both handle it correctly today - see WEB-010 in the audit
// report), but these are plain names/labels with no legitimate reason to
// contain markup, so reject it outright rather than relying solely on every
// future render site remembering to escape.
const NO_HTML_MARKUP = /^[^<>]*$/;
const NO_HTML_MARKUP_MESSAGE = "must not contain '<' or '>'";

// Matches inviteUserRequestSchema exactly (m300-frontend/src/api/schemas/
// administration.ts) - note "name" (not fullName), "institution" as a
// free-text name (not institutionId), and the added "designation"/
// "accessScope"/"invitationMessage" fields the old DTO never had.
export class InviteUserDto {
  @IsString()
  @MinLength(2, { message: "Enter the user name" })
  @Matches(NO_HTML_MARKUP, { message: `Name ${NO_HTML_MARKUP_MESSAGE}` })
  name!: string;

  @IsEmail({}, { message: "Enter a valid email address" })
  email!: string;

  @ValidateIf((dto: InviteUserDto) => dto.reviewsAllInstitutions !== true)
  @IsString()
  @MinLength(1, { message: "Select an institution" })
  @Matches(NO_HTML_MARKUP, { message: `Institution ${NO_HTML_MARKUP_MESSAGE}` })
  institution?: string;

  @IsOptional()
  @IsBoolean()
  reviewsAllInstitutions?: boolean;

  @IsString()
  @MinLength(2, { message: "Enter the designation" })
  @Matches(NO_HTML_MARKUP, { message: `Designation ${NO_HTML_MARKUP_MESSAGE}` })
  designation!: string;

  // Role/accessScope arrive as lower-kebab-case (systemRoleSchema/
  // scopeLevelSchema) - transformed to the Prisma enum's own casing before
  // validation, same pattern used for query params in overview.service.ts.
  // @IsEnum is required here too, not just @Transform: with
  // whitelist/forbidNonWhitelisted (see main.ts), class-validator only
  // recognizes a property as "known" if it has its own validator
  // decorator - @Transform alone left these two silently stripped and
  // then rejected as unknown properties.
  @Transform(({ value }) =>
    typeof value === "string" ? parseKebabEnum(value, Object.values(RoleName), "role") : value,
  )
  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((role) => typeof role === "string" ? parseKebabEnum(role, Object.values(RoleName), "roles") : role)
      : value,
  )
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(RoleName, { each: true })
  roles?: RoleName[];

  @Transform(({ value }) =>
    typeof value === "string" ? parseKebabEnum(value, Object.values(ScopeLevel), "accessScope") : value,
  )
  @IsEnum(ScopeLevel)
  accessScope!: ScopeLevel;

  // Accepted for contract parity - not currently acted on (no email template
  // includes it, no field stores it), same as the mock, which also accepts
  // and ignores it.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  invitationMessage?: string;
}
