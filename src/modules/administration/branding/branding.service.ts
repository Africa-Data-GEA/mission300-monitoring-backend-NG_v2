import { basename, extname } from "node:path";
import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service";
import { StorageService } from "@/storage/storage.service";
import { validateUpload } from "@/files/upload-validation";
import type { UpdateBrandColorsDto } from "@/modules/administration/branding/dto/update-brand-colors.dto";
import type { BrandFontsDto } from "@/modules/administration/branding/dto/brand-fonts.dto";

const SETTINGS_ID = "default";
const LOGO_SUBDIR = "branding";

// Mirrors DEFAULT_BRAND_CONFIG in m300-frontend/src/mocks/data/branding.ts
// exactly - this is the shipped default the frontend itself ships with, not
// an arbitrary choice made here.
const DEFAULT_FONT = "Google Sans";
const DEFAULT_FONTS = {
  h1: DEFAULT_FONT,
  h2: DEFAULT_FONT,
  h3: DEFAULT_FONT,
  h4: DEFAULT_FONT,
  h5: DEFAULT_FONT,
  h6: DEFAULT_FONT,
  body: DEFAULT_FONT,
};
const DEFAULT_CURRENCY = { code: "NGN", symbol: "₦", locale: "en-NG" };
const DEFAULT_BRANDING = {
  id: SETTINGS_ID,
  countryName: "Nigeria",
  officialName: "Federal Republic of Nigeria",
  agencyName: "Federal Ministry of Power",
  timezone: "Africa/Lagos",
  crestUrl: "",
  primaryColor: "#004972",
  secondaryColor: "#ffca05",
  textColor: "#101828",
  sidebarColor: "#004972",
  // Empty means "no custom logo uploaded" - the frontend falls back to its
  // own built-in M300 mark (a light/dark-background-appropriate SVG, not a
  // single shared image) rather than this settings row asserting one.
  logoUrl: "",
  fonts: DEFAULT_FONTS as Prisma.InputJsonValue,
  currency: DEFAULT_CURRENCY as Prisma.InputJsonValue,
};

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  get() {
    return this.prisma.brandingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: DEFAULT_BRANDING,
      update: {},
    });
  }

  updateColors(dto: UpdateBrandColorsDto) {
    const { currency, ...rest } = dto;
    const data = { ...rest, ...(currency ? { currency: { ...currency } as Prisma.InputJsonValue } : {}) };
    return this.prisma.brandingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { ...DEFAULT_BRANDING, ...data },
      update: data,
    });
  }

  updateFonts(fonts: BrandFontsDto) {
    const fontsJson = { ...fonts } as Prisma.InputJsonValue;
    return this.prisma.brandingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { ...DEFAULT_BRANDING, fonts: fontsJson },
      update: { fonts: fontsJson },
    });
  }

  resetToDefault() {
    return this.prisma.brandingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: DEFAULT_BRANDING,
      update: DEFAULT_BRANDING,
    });
  }

  async uploadLogo(file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException("Select a logo image to upload.");
    }
    const verified = await validateUpload(file, true, 5 * 1024 * 1024);
    const stored = await this.storage.save(LOGO_SUBDIR, verified);
    // basename(), not the raw key, so this is safe regardless of the host
    // OS's path separator (storage.save() joins with node:path.join, which
    // differs between the Linux VPS and Windows dev boxes) - the logo
    // route below only ever needs the filename, not the subdir prefix.
    const logoUrl = `/branding/logo/${basename(stored.key)}`;

    return this.prisma.brandingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { ...DEFAULT_BRANDING, logoUrl },
      update: { logoUrl },
    });
  }

  async uploadCrest(file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException("Select a crest or flag image to upload.");
    }
    const verified = await validateUpload(file, true, 5 * 1024 * 1024);
    const stored = await this.storage.save(LOGO_SUBDIR, verified);
    const crestUrl = `/branding/logo/${basename(stored.key)}`;

    return this.prisma.brandingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { ...DEFAULT_BRANDING, crestUrl },
      update: { crestUrl },
    });
  }

  async readLogo(filename: string): Promise<{ buffer: Buffer; mimeType: string }> {
    // filename comes straight from the URL path - reject anything that
    // isn't a bare file name before it ever reaches storage.read(), which
    // already guards path traversal, but this is a second explicit barrier
    // since this route (unlike /files/:id) is public and unauthenticated.
    if (filename.includes("/") || filename.includes("\\") || filename !== basename(filename)) {
      throw new BadRequestException("Invalid logo filename.");
    }
    const buffer = await this.storage.read(`${LOGO_SUBDIR}/${filename}`);
    const verified = await validateUpload(
      {
        originalname: filename,
        mimetype: mimeTypeForExtension(extname(filename)),
        buffer,
        size: buffer.length,
      } as Express.Multer.File,
      true,
      5 * 1024 * 1024,
    );
    return { buffer, mimeType: verified.mimetype };
  }
}

function mimeTypeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}
