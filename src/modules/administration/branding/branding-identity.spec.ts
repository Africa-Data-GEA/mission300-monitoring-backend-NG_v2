import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { BrandingService } from "@/modules/administration/branding/branding.service";
import { UpdateBrandColorsDto } from "@/modules/administration/branding/dto/update-brand-colors.dto";
import { renderLayout } from "@/notifications/email/templates/layout";

jest.setTimeout(30000);

const colours = { primaryColor: "#004972", secondaryColor: "#ffca05", textColor: "#101828", sidebarColor: "#004972" };
const problemsOf = async (plain: object) => {
  const errors = await validate(plainToInstance(UpdateBrandColorsDto, { countryName: "Ghana", ...colours, ...plain }));
  return errors.flatMap((error) => [...Object.values(error.constraints ?? {}), ...(error.children ?? []).flatMap((child) => Object.values(child.constraints ?? {}))]);
};

describe("the identity settings an administrator can save", () => {
  it("accepts a complete, valid identity", async () => {
    expect(
      await problemsOf({
        officialName: "Republic of Ghana",
        agencyName: "Ministry of Energy",
        timezone: "Africa/Accra",
        currency: { code: "GHS", symbol: "GH₵", locale: "en-GH" },
      }),
    ).toEqual([]);
  });

  it("still accepts the old request with only a country and colours", async () => {
    expect(await problemsOf({})).toEqual([]);
  });

  it("refuses a timezone that does not exist", async () => {
    expect(await problemsOf({ timezone: "Mars/Olympus" })).toContain("Enter a valid timezone, e.g. Africa/Lagos");
  });

  it("refuses a currency code that is not three letters", async () => {
    expect(await problemsOf({ currency: { code: "GH", symbol: "₵", locale: "en-GH" } })).toContain("Use a 3-letter ISO currency code, e.g. NGN");
  });

  it("refuses a currency symbol that is too long", async () => {
    expect(await problemsOf({ currency: { code: "GHS", symbol: "GHANA", locale: "en-GH" } })).toContain("The symbol can be at most 4 characters");
  });

  it("refuses a locale that is not a locale", async () => {
    expect(await problemsOf({ currency: { code: "GHS", symbol: "₵", locale: "not a locale!" } })).toContain("Enter a valid locale, e.g. en-NG");
  });

  it("refuses an empty official name", async () => {
    expect((await problemsOf({ officialName: "" })).length).toBeGreaterThan(0);
  });
});

describe("saving the identity", () => {
  function build() {
    const upsert = jest.fn(async ({ update }: { update: object }) => ({ id: "default", ...update }));
    return { service: new BrandingService({ brandingSettings: { upsert } } as never, {} as never), upsert };
  }

  it("stores the identity and the currency together", async () => {
    const { service, upsert } = build();
    await service.updateColors({
      countryName: "Ghana",
      ...colours,
      officialName: "Republic of Ghana",
      currency: { code: "GHS", symbol: "GH₵", locale: "en-GH" },
    } as never);
    expect(upsert.mock.calls[0][0].update).toMatchObject({
      countryName: "Ghana",
      officialName: "Republic of Ghana",
      currency: { code: "GHS", symbol: "GH₵", locale: "en-GH" },
    });
  });

  it("leaves the currency alone when none is sent", async () => {
    const { service, upsert } = build();
    await service.updateColors({ countryName: "Ghana", ...colours } as never);
    expect(upsert.mock.calls[0][0].update).not.toHaveProperty("currency");
  });

  it("refuses a crest upload with no file", async () => {
    const { service } = build();
    await expect(service.uploadCrest(undefined)).rejects.toThrow(/Select a crest/);
  });
});

describe("emails carry the saved country", () => {
  const brand = { primaryColor: "#004972", secondaryColor: "#ffca05", logoUrl: "", countryName: "Ghana", officialName: "Republic of Ghana" };

  it("names the saved country in the header and footer, and the official name on the crest", () => {
    const html = renderLayout("Hello", "<p>Body</p>", brand);
    expect(html).toContain("Ghana Energy Compact Dashboard");
    expect(html).toContain("Republic of Ghana coat of arms");
    expect(html).not.toContain("Nigeria");
  });

  it("falls back to Nigeria when no country was passed", () => {
    expect(renderLayout("Hello", "<p>Body</p>", { primaryColor: "#004972", secondaryColor: "#ffca05", logoUrl: "" })).toContain("Nigeria Energy Compact Dashboard");
  });
});
