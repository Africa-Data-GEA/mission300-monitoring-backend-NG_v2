import * as PrismaClient from "@prisma/client";
import { parseKebabEnum, toKebabCase, toScreamingSnakeCase } from "@/common/utils/enum-casing";

type EnumCase = {
  enumName: string;
  value: string;
  values: string[];
};

const enumCases: EnumCase[] = Object.entries(PrismaClient).flatMap(([enumName, candidate]) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];

  const values = Object.values(candidate);
  if (
    values.length === 0 ||
    !values.every((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value))
  ) {
    return [];
  }

  const stringValues = values as string[];
  return stringValues.map((value) => ({ enumName, value, values: stringValues }));
});

describe("Prisma enum wire-format contracts", () => {
  it("discovers the expected generated Prisma enum surface", () => {
    expect(enumCases).toHaveLength(144);
  });

  it.each(enumCases)("round-trips $enumName.$value through kebab-case", ({ enumName, value, values }) => {
    const wireValue = toKebabCase(value);

    expect(wireValue).toBe(value.toLowerCase().replace(/_/g, "-"));
    expect(toScreamingSnakeCase(wireValue)).toBe(value);
    expect(parseKebabEnum(wireValue, values, enumName)).toBe(value);
  });

  it("rejects a value outside the supplied enum", () => {
    expect(() => parseKebabEnum("not-a-real-value", ["ACTIVE", "INACTIVE"], "status")).toThrow(
      "status must be one of: active, inactive",
    );
  });
});
