import { Transform } from "class-transformer";
import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, Matches, MinLength } from "class-validator";
import { RoleName } from "@prisma/client";
import { parseKebabEnum } from "@/common/utils/enum-casing";

const NO_HTML_MARKUP = /^[^<>]*$/;

export class UpdateUserAccessDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: "Enter the user name" })
  @Matches(NO_HTML_MARKUP, { message: "Name must not contain '<' or '>'" })
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: "Enter a valid email address" })
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: "Enter the designation" })
  @Matches(NO_HTML_MARKUP, { message: "Designation must not contain '<' or '>'" })
  designation?: string;

  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((role) => typeof role === "string" ? parseKebabEnum(role, Object.values(RoleName), "roles") : role)
      : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(RoleName, { each: true })
  roles!: RoleName[];

  @IsOptional()
  @IsString()
  institution?: string;

  @IsOptional()
  @IsBoolean()
  reviewsAllInstitutions?: boolean;
}
