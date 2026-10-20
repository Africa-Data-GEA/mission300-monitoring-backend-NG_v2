import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiTags, ApiBearerAuth, ApiConsumes } from "@nestjs/swagger";
import { BrandingService } from "@/modules/administration/branding/branding.service";
import { UpdateBrandColorsDto } from "@/modules/administration/branding/dto/update-brand-colors.dto";
import { UpdateBrandFontsDto } from "@/modules/administration/branding/dto/update-brand-fonts.dto";
import { Public } from "@/common/decorators/public.decorator";
import { Roles } from "@/common/decorators/roles.decorator";
import { AuditAction } from "@/common/decorators/audit-action.decorator";

const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// Path is "/branding", NOT "/administration/branding" - matches the real
// frontend contract exactly (src/features/branding/api.ts in
// m300-frontend), which never nests it under administration.
@ApiTags("branding")
@Controller("branding")
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  // Public: the public gateway and every logged-in view need this to theme
  // the page before (or without) a login.
  @Public()
  @Get()
  get() {
    return this.branding.get();
  }

  // Public: the logo itself must render on the unauthenticated login page,
  // so it can't sit behind the same bearer-token gate as /files/:id.
  @Public()
  @Get("logo/:filename")
  async getLogo(
    @Param("filename") filename: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, mimeType } = await this.branding.readLogo(filename);
    res.set({
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    return new StreamableFile(buffer);
  }

  // Only the top admin role can restyle the site for everyone.
  @ApiBearerAuth()
  @Roles("SYSTEM_ADMINISTRATOR")
  @Put()
  @AuditAction("branding.updated")
  updateColors(@Body() dto: UpdateBrandColorsDto) {
    return this.branding.updateColors(dto);
  }

  @ApiBearerAuth()
  @Roles("SYSTEM_ADMINISTRATOR")
  @Put("fonts")
  @AuditAction("branding.fonts_updated")
  updateFonts(@Body() dto: UpdateBrandFontsDto) {
    return this.branding.updateFonts(dto.fonts);
  }

  @ApiBearerAuth()
  @Roles("SYSTEM_ADMINISTRATOR")
  @Post("reset")
  @AuditAction("branding.reset")
  reset() {
    return this.branding.resetToDefault();
  }

  @ApiBearerAuth()
  @Roles("SYSTEM_ADMINISTRATOR")
  @Post("logo")
  @ApiConsumes("multipart/form-data")
  @AuditAction("branding.logo_updated")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_LOGO_SIZE_BYTES } }))
  uploadLogo(@UploadedFile() file: Express.Multer.File) {
    return this.branding.uploadLogo(file);
  }

  @ApiBearerAuth()
  @Roles("SYSTEM_ADMINISTRATOR")
  @Post("crest")
  @ApiConsumes("multipart/form-data")
  @AuditAction("branding.crest_updated")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_LOGO_SIZE_BYTES } }))
  uploadCrest(@UploadedFile() file: Express.Multer.File) {
    return this.branding.uploadCrest(file);
  }
}
