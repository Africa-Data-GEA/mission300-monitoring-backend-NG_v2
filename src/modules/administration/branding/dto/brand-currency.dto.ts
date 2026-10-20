import { IsString, Length, MaxLength, MinLength, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from "class-validator";

@ValidatorConstraint({ name: "isLocale", async: false })
class IsLocaleConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "string") return false;
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return "Enter a valid locale, e.g. en-NG";
  }
}

export class BrandCurrencyDto {
  @IsString()
  @Length(3, 3, { message: "Use a 3-letter ISO currency code, e.g. NGN" })
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4, { message: "The symbol can be at most 4 characters" })
  symbol!: string;

  @Validate(IsLocaleConstraint)
  locale!: string;
}
