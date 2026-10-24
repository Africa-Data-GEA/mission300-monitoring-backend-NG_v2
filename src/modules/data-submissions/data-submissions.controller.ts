import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiTags, ApiBearerAuth, ApiConsumes } from "@nestjs/swagger";
import { DataSubmissionsService } from "@/modules/data-submissions/data-submissions.service";
import { EntryDraftsService } from "@/modules/data-submissions/entry-drafts.service";
import { DataSubmissionsQueryDto } from "@/modules/data-submissions/dto/data-submissions-query.dto";
import { ManualEntryDto } from "@/modules/data-submissions/dto/manual-entry.dto";
import { UploadSubmissionDto } from "@/modules/data-submissions/dto/upload-submission.dto";
import { RecordValidationDecisionDto } from "@/modules/data-submissions/dto/record-validation-decision.dto";
import { AssignFocalPersonDto } from "@/modules/data-submissions/dto/assign-focal-person.dto";
import { BulkRecordValidationDecisionDto } from "@/modules/data-submissions/dto/bulk-record-validation-decision.dto";
import { CurrentUser, type AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { AuditAction } from "@/common/decorators/audit-action.decorator";
import { Roles } from "@/common/decorators/roles.decorator";

const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024; // matches uploadDefinitionSchema's maxFileSizeMb
const ALLOWED_UPLOAD_EXTENSIONS = [".xlsx", ".csv"];
const ALLOWED_UPLOAD_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/vnd.ms-excel",
  "application/csv",
];

// All 3 phases of the Data Submissions rebuild: the read-only foundation,
// manual-entry/upload creation + template generation, and the validation
// queue/detail/decision endpoints - see m300-frontend's
// src/features/data-submissions/api.ts for the complete real contract
// this was built to match.
@ApiTags("data-submissions")
@ApiBearerAuth()
@Controller("data-submissions")
export class DataSubmissionsController {
  constructor(
    private readonly dataSubmissions: DataSubmissionsService,
    private readonly drafts: EntryDraftsService,
  ) {}

  @Get("filters")
  getFilters(@CurrentUser() user: AuthenticatedUser) {
    return this.dataSubmissions.getFilters(user);
  }

  @Get("datasets")
  getDatasets() {
    return this.dataSubmissions.getDatasets();
  }

  @Get("obligations")
  getObligations(@CurrentUser() user: AuthenticatedUser, @Query() query: DataSubmissionsQueryDto) {
    return this.dataSubmissions.getObligations(user, query);
  }

  @Get("submissions")
  getSubmissions(@CurrentUser() user: AuthenticatedUser, @Query() query: DataSubmissionsQueryDto) {
    return this.dataSubmissions.getSubmissions(user, query);
  }

  @Get("overdue")
  getOverdue(@CurrentUser() user: AuthenticatedUser, @Query() query: DataSubmissionsQueryDto) {
    return this.dataSubmissions.getOverdue(user, query);
  }

  @Get("gaps")
  getGaps(@CurrentUser() user: AuthenticatedUser, @Query() query: DataSubmissionsQueryDto) {
    return this.dataSubmissions.getGaps(user, query);
  }

  @Patch("obligations/:id/focal-person")
  @Roles("SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER")
  @AuditAction("obligation.focal_person_assigned")
  assignFocalPerson(@Param("id") id: string, @Body() dto: AssignFocalPersonDto) {
    return this.dataSubmissions.assignFocalPerson(id, dto.userId ?? null);
  }

  @Get("obligations/:id/entry")
  getEntryDefinition(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.dataSubmissions.getManualEntryDefinition(user, id);
  }

  @Post("obligations/:id/entry")
  @Roles("SYSTEM_ADMINISTRATOR", "INSTITUTIONAL_DATA_PROVIDER")
  @AuditAction("submission.manual_entry_saved")
  async saveEntry(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: ManualEntryDto) {
    const result = await this.dataSubmissions.saveManualEntry(user, id, dto);
    await this.drafts.clearAfterSubmit(id);
    return result;
  }

  @Get("obligations/:id/entry/draft")
  getEntryDraft(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.drafts.get(user, id);
  }

  @Put("obligations/:id/entry/draft")
  @Roles("SYSTEM_ADMINISTRATOR", "INSTITUTIONAL_DATA_PROVIDER")
  @AuditAction("submission.draft_saved")
  saveEntryDraft(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: ManualEntryDto) {
    return this.drafts.save(user, id, dto);
  }

  @Delete("obligations/:id/entry/draft")
  @Roles("SYSTEM_ADMINISTRATOR", "INSTITUTIONAL_DATA_PROVIDER")
  @AuditAction("submission.draft_discarded")
  discardEntryDraft(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.drafts.discard(user, id);
  }

  @Get("obligations/:id/upload")
  getUploadDefinition(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.dataSubmissions.getUploadDefinition(user, id);
  }

  @Post("obligations/:id/upload")
  @Roles("SYSTEM_ADMINISTRATOR", "INSTITUTIONAL_DATA_PROVIDER")
  @ApiConsumes("multipart/form-data")
  @AuditAction("submission.uploaded")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        const extension = file.originalname.slice(file.originalname.lastIndexOf(".")).toLowerCase();
        if (
          !ALLOWED_UPLOAD_EXTENSIONS.includes(extension) ||
          !ALLOWED_UPLOAD_MIME_TYPES.includes(file.mimetype)
        ) {
          callback(new BadRequestException("Only .xlsx or .csv files are accepted."), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  uploadSubmission(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadSubmissionDto,
  ) {
    return this.dataSubmissions.uploadSubmission(user, id, file, dto);
  }

  @Get("templates/:fileName")
  async getTemplate(@Param("fileName") fileName: string, @Res({ passthrough: true }) res: Response) {
    const buffer = await this.dataSubmissions.getTemplate(fileName);
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });
    return new StreamableFile(buffer);
  }

  @Roles("DATA_REVIEWER", "VALIDATOR", "SYSTEM_ADMINISTRATOR")
  @Get("validation")
  getValidationQueue(@CurrentUser() user: AuthenticatedUser, @Query() query: DataSubmissionsQueryDto) {
    return this.dataSubmissions.getValidationQueue(user, query);
  }

  @Roles("DATA_REVIEWER", "VALIDATOR", "SYSTEM_ADMINISTRATOR")
  @Get("validation/:id")
  getSubmissionDetail(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.dataSubmissions.getSubmissionDetail(user, id);
  }

  // Same role gate as the old submissions module's decision endpoint
  // (src/modules/submissions/submissions.controller.ts) - deliberately
  // not including SYSTEM_ADMINISTRATOR, matching that existing precedent.
  @Roles("DATA_REVIEWER", "VALIDATOR")
  @Post("validation/:id/decisions")
  @AuditAction("submission.decision_recorded")
  recordDecision(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: RecordValidationDecisionDto,
  ) {
    return this.dataSubmissions.recordDecision(user, id, dto);
  }

  @Roles("DATA_REVIEWER", "VALIDATOR")
  @Post("validation/bulk-decisions")
  @AuditAction("submission.decision_recorded")
  bulkRecordDecision(@CurrentUser() user: AuthenticatedUser, @Body() dto: BulkRecordValidationDecisionDto) {
    return this.dataSubmissions.bulkRecordDecision(user, dto.submissionIds, dto);
  }
}
