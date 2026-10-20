import { Type } from "class-transformer";
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from "class-validator";
import { BrandCurrencyDto } from "@/modules/administration/branding/dto/brand-currency.dto";

// Matches the frontend's own hexColorSchema exactly (6-digit hex, leading
// #) so a rejected value produces the same message shape it would from the
// mock backend - class-validator's built-in @IsHexColor() is looser (also
// accepts 3/8-digit forms), which the frontend never sends or expects.
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const HEX_COLOR_MESSAGE = "Must be a 6-digit hex colour, e.g. #008751";

@ValidatorConstraint({ name: "isTimeZone", async: false })
class IsTimeZoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "string") return false;
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return "Enter a valid timezone, e.g. Africa/Lagos";
  }
}

export class UpdateBrandColorsDto {
  @IsString()
  @IsNotEmpty()
  countryName!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  officialName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  agencyName?: string;

  @IsOptional()
  @Validate(IsTimeZoneConstraint)
  timezone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BrandCurrencyDto)
  currency?: BrandCurrencyDto;

  @Matches(HEX_COLOR_PATTERN, { message: HEX_COLOR_MESSAGE })
  primaryColor!: string;

  @Matches(HEX_COLOR_PATTERN, { message: HEX_COLOR_MESSAGE })
  secondaryColor!: string;

  @Matches(HEX_COLOR_PATTERN, { message: HEX_COLOR_MESSAGE })
  textColor!: string;

  @Matches(HEX_COLOR_PATTERN, { message: HEX_COLOR_MESSAGE })
  sidebarColor!: string;
}
