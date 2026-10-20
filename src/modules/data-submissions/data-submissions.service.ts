import { gapStateFor } from "@/modules/data-submissions/data-gap-state";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, ReviewDecisionType, SubmissionStatus } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service";
import { StorageService } from "@/storage/storage.service";
import { RabbitmqService } from "@/events/rabbitmq.service";
import { SecuritySettingsService } from "@/modules/administration/security/security-settings.service";
import {
  scopeInstitutionFilter,
  scopeSubmissionFilter,
  assertInstitutionMembership,
  assertSubmissionAccess,
} from "@/common/guards/institution-scope.guard";
import { paginate } from "@/modules/administration/overview/overview.mappers";
import { workflowStatus } from "@/modules/data-submissions/workflow-status";
import { quartersTouched, rollupNationalKpis, type RollupOutcome } from "@/modules/data-submissions/national-rollup.db";
import { publishItemValue, withdrawItemValues } from "@/modules/data-submissions/published-values";
import {
  alreadyWaitingMessage,
  heldBackNote,
  isSingleDiscoValueForNationalKpi,
  nextUrlAfterSubmit,
  receivedMessage,
  rollupNote,
  rowProblemsMessage,
  toProblemDetails,
  type RowProblem,
} from "@/modules/data-submissions/submit-flow";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import type { DataSubmissionsQueryDto } from "@/modules/data-submissions/dto/data-submissions-query.dto";
import type { ManualEntryDto } from "@/modules/data-submissions/dto/manual-entry.dto";
import type { RecordValidationDecisionDto } from "@/modules/data-submissions/dto/record-validation-decision.dto";
import {
  toDataGap,
  toDatasetView,
  toManualEntryDefinition,
  toObligationView,
  toOverdueItem,
  toSubmissionDetail,
  toSubmissionListItem,
  toUploadDefinition,
  toValidationQueueItem,
} from "@/modules/data-submissions/data-submissions.mappers";
import {
  buildSubmissionItems,
  generateTemplateBuffer,
  parseSubmissionFile,
  validateFieldValues,
} from "@/modules/data-submissions/dataset-template";
import { DISCO_CANONICAL_NAMES, resolveDiscoName } from "@/modules/data-submissions/disco-institutions";

const DEFAULT_PAGE_SIZE = 20;

const DATASET_INCLUDE = { pillar: true, ownerInstitution: true } as const;
const OBLIGATION_INCLUDE = {
  institution: true,
  dataset: { include: DATASET_INCLUDE },
  focalPerson: true,
} as const;
const SUBMISSION_INCLUDE = {
  institution: true,
  submittedBy: true,
  obligation: { include: { dataset: true } },
  reviewer: true,
  reviewDecisions: true,
} as const;
const SUBMISSION_DETAIL_INCLUDE = {
  institution: true,
  submittedBy: true,
  obligation: { include: { dataset: true } },
  reviewer: true,
  items: { include: { kpiDefinition: true } },
  reviewDecisions: { include: { reviewedBy: true } },
} as const;
const OBLIGATION_WITH_FIELDS_INCLUDE = {
  institution: true,
  dataset: { include: { fields: true } },
} as const;

// Maps the real contract's lower-kebab decision string to the internal
// Prisma types - both the ReviewDecision row's own enum and the
// Submission's resulting status.
const DECISION_TO_REVIEW_TYPE: Record<string, ReviewDecisionType> = {
  approved: "APPROVE",
  provisional: "PROVISIONALLY_APPROVE",
  returned: "RETURN_FOR_CORRECTION",
  rejected: "REJECT",
};
const DECISION_TO_STATUS: Record<string, SubmissionStatus> = {
  approved: "APPROVED",
  provisional: "PROVISIONALLY_APPROVED",
  returned: "RETURNED",
  rejected: "REJECTED",
};
const VALUE_PUBLISHING_DECISIONS = new Set(["approved", "provisional"]);
const WITHDRAWING_DECISIONS = new Set(["returned", "rejected"]);
const OPEN_FOR_DECISION: SubmissionStatus[] = ["PENDING", "PROVISIONALLY_APPROVED"];
const BLOCKING_STATUSES = OPEN_FOR_DECISION;

@Injectable()
export class DataSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly rabbitmq: RabbitmqService,
    private readonly securitySettings: SecuritySettingsService,
  ) {}

  async getFilters(user: AuthenticatedUser) {
    const ownInstitution = scopeInstitutionFilter(user).institutionId;
    const [institutions, datasets, obligationPeriods, reviewerUsers] = await Promise.all([
      this.prisma.institution.findMany({ where: ownInstitution ? { id: ownInstitution } : {}, orderBy: { name: "asc" } }),
      this.prisma.dataset.findMany({
        where: ownInstitution ? { ownerInstitutionId: ownInstitution } : {},
        orderBy: { name: "asc" },
      }),
      this.prisma.obligation.findMany({ select: { reportingPeriod: true }, distinct: ["reportingPeriod"] }),
      this.prisma.user.findMany({
        where: {
          OR: [
            { role: { in: ["DATA_REVIEWER", "VALIDATOR"] } },
            { roles: { hasSome: ["DATA_REVIEWER", "VALIDATOR"] } },
          ],
          status: "ACTIVE",
        },
        orderBy: { fullName: "asc" },
      }),
    ]);
    const reportingPeriods = [...new Set(obligationPeriods.map((o) => o.reportingPeriod))].sort();

    const withAll = (label: string, options: { value: string; label: string }[]) => [
      { value: "all", label: `All ${label}` },
      ...options,
    ];

    return {
      institutions: withAll(
        "institutions",
        institutions.map((i) => ({ value: i.id, label: i.name })),
      ),
      datasets: withAll(
        "datasets",
        datasets.map((d) => ({ value: d.id, label: d.name })),
      ),
      reportingPeriods: withAll(
        "periods",
        reportingPeriods.map((p) => ({ value: p, label: p })),
      ),
      // Submission/validation status options mirror workflow-status.ts's
      // known codes - the ones actually reachable from this module.
      submissionStatuses: withAll("statuses", [
        { value: "draft", label: "Draft" },
        { value: "pending-review", label: "Pending review" },
        { value: "returned", label: "Returned" },
        { value: "rejected", label: "Rejected" },
        { value: "provisional", label: "Provisionally approved" },
        { value: "approved", label: "Approved" },
      ]),
      validationStatuses: withAll("statuses", [
        { value: "pass", label: "Pass" },
        { value: "fail", label: "Fail" },
        { value: "pending", label: "Pending" },
      ]),
      reviewers: withAll(
        "reviewers",
        reviewerUsers.map((reviewer) => ({ value: reviewer.id, label: reviewer.fullName })),
      ),
      readinessTiers: withAll("tiers", [
        { value: "core", label: "Core" },
        { value: "supporting", label: "Supporting" },
        { value: "future", label: "Future" },
      ]),
      overdueStatuses: withAll("statuses", [
        { value: "overdue", label: "Overdue" },
        { value: "due-soon", label: "Due soon" },
      ]),
    };
  }

  async getDatasets() {
    const datasets = await this.prisma.dataset.findMany({
      where: { isActive: true },
      include: DATASET_INCLUDE,
      orderBy: { name: "asc" },
    });
    return datasets.map(toDatasetView);
  }

  async assignFocalPerson(obligationId: string, userId: string | null) {
    const obligation = await this.prisma.obligation.findUnique({
      where: { id: obligationId },
      include: OBLIGATION_INCLUDE,
    });
    if (!obligation) throw new NotFoundException("Unknown obligation.");

    if (userId) {
      const candidate = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, fullName: true, institutionId: true },
      });
      if (!candidate) throw new NotFoundException("Unknown user.");
      if (candidate.institutionId !== obligation.institutionId) {
        throw new BadRequestException(
          "A focal person must belong to the institution that owes this submission.",
        );
      }
    }

    const updated = await this.prisma.obligation.update({
      where: { id: obligationId },
      data: { focalPersonId: userId },
      include: OBLIGATION_INCLUDE,
    });

    const latestSubmission = await this.prisma.submission.findFirst({
      where: { obligationId },
      orderBy: { createdAt: "desc" },
    });

    return {
      obligation: toObligationView(updated, latestSubmission),
      message: userId
        ? `${updated.focalPerson?.fullName ?? "Focal person"} is now the focal person for ${updated.dataset.name}.`
        : `Focal person cleared for ${updated.dataset.name}.`,
    };
  }

  async getObligations(user: AuthenticatedUser, query: DataSubmissionsQueryDto) {
    await this.materializeBacklogObligations(user, query);

    const pageSize = Math.min(100, query.pageSize ?? DEFAULT_PAGE_SIZE);
    const search = query.search?.trim().toLowerCase() ?? "";

    // A fulfilled obligation (accepted submission) never appears here - it
    // lives in submission history instead. Confirmed against the mock's
    // own comment on this exact behavior.
    const obligations = await this.prisma.obligation.findMany({
      where: {
        OR: [{ acceptedSubmissionId: null }, { acceptedSubmission: { status: "PROVISIONALLY_APPROVED" } }],
        // scopeInstitutionFilter(user) MUST be spread last: for an
        // institution-scoped user it always sets institutionId, and object
        // spread lets a later key win - putting it after the client-supplied
        // query.institution filter means the caller's own institution scope
        // can never be overridden by that query param. See WEB-009.
        ...(query.institution && query.institution !== "all" ? { institutionId: query.institution } : {}),
        ...(query.dataset && query.dataset !== "all" ? { datasetId: query.dataset } : {}),
        ...(query.reportingPeriod && query.reportingPeriod !== "all"
          ? { reportingPeriod: query.reportingPeriod }
          : {}),
        ...scopeInstitutionFilter(user),
      },
      include: OBLIGATION_INCLUDE,
      orderBy: { dueDate: "asc" },
    });

    // One query for the latest submission per obligation, rather than N+1 -
    // ordered so the first match per obligationId (via a Map) is the newest.
    const obligationIds = obligations.map((o) => o.id);
    const latestSubmissions = await this.prisma.submission.findMany({
      where: { obligationId: { in: obligationIds } },
      orderBy: { createdAt: "desc" },
    });
    const latestByObligation = new Map<string, (typeof latestSubmissions)[number]>();
    for (const submission of latestSubmissions) {
      if (submission.obligationId && !latestByObligation.has(submission.obligationId)) {
        latestByObligation.set(submission.obligationId, submission);
      }
    }

    const views = obligations
      .map((o) => toObligationView(o, latestByObligation.get(o.id) ?? null))
      .filter(
        (view) =>
          !search ||
          [view.institution, view.dataset, view.focalPerson].join(" ").toLowerCase().includes(search),
      );

    const stats = buildObligationStats(views);
    const page = paginate(views, query.page ?? 1, pageSize);
    return { ...page, stats };
  }

  async getSubmissions(user: AuthenticatedUser, query: DataSubmissionsQueryDto) {
    const pageSize = Math.min(100, query.pageSize ?? DEFAULT_PAGE_SIZE);
    const search = query.search?.trim().toLowerCase() ?? "";

    const submissions = await this.prisma.submission.findMany({
      where: {
        // Historical KPI backfills (ingest-*.ts scripts) create a Submission
        // row purely to satisfy KpiValue's required sourceSubmissionItem FK -
        // they never went through the real obligation workflow and have no
        // obligation, period or focal person to show here, so they're
        // excluded from this operational view rather than rendering as
        // "Unlinked submission / Unknown period" noise.
        obligationId: { not: null },
        ...(query.institution && query.institution !== "all" ? { institutionId: query.institution } : {}),
        ...scopeSubmissionFilter(user),
      },
      include: SUBMISSION_INCLUDE,
      orderBy: { createdAt: "desc" },
    });

    const latestIds = new Set<string>();
    const seenObligations = new Set<string>();
    for (const submission of submissions) {
      if (!submission.obligationId || seenObligations.has(submission.obligationId)) continue;
      seenObligations.add(submission.obligationId);
      latestIds.add(submission.id);
    }

    const views = submissions
      .map((submission) => toSubmissionListItem(submission, latestIds.has(submission.id)))
      .filter((view) => !search || [view.institution, view.dataset].join(" ").toLowerCase().includes(search));

    return paginate(views, query.page ?? 1, pageSize);
  }

  async getOverdue(user: AuthenticatedUser, query: DataSubmissionsQueryDto) {
    const pageSize = Math.min(100, query.pageSize ?? DEFAULT_PAGE_SIZE);

    const overdue = await this.prisma.obligation.findMany({
      where: {
        acceptedSubmissionId: null,
        dueDate: { lt: new Date() },
        // scopeInstitutionFilter(user) last - see comment in getObligations().
        ...(query.institution && query.institution !== "all" ? { institutionId: query.institution } : {}),
        ...scopeInstitutionFilter(user),
      },
      include: OBLIGATION_INCLUDE,
      orderBy: { dueDate: "asc" },
    });

    const views = overdue.map(toOverdueItem);
    return paginate(views, query.page ?? 1, pageSize);
  }

  async getGaps(user: AuthenticatedUser, query: DataSubmissionsQueryDto) {
    const pageSize = Math.min(100, query.pageSize ?? DEFAULT_PAGE_SIZE);
    const search = query.search?.trim();
    const scoped = scopeInstitutionFilter(user).institutionId;
    const institutionId = scoped ?? (query.institution && query.institution !== "all" ? query.institution : undefined);
    const readiness = query.readinessTier?.toUpperCase();

    const kpis = await this.prisma.kpiDefinition.findMany({
      where: {
        isActive: true,
        values: { none: {} },
        ...(institutionId ? { sourceInstitutions: { some: { institutionId } } } : {}),
        ...(readiness && ["CORE", "SUPPORTING", "FUTURE"].includes(readiness)
          ? { readiness: readiness as "CORE" | "SUPPORTING" | "FUTURE" }
          : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { code: { contains: search, mode: "insensitive" } },
                { sourceInstitutions: { some: { institution: { name: { contains: search, mode: "insensitive" } } } } },
              ],
            }
          : {}),
      },
      include: {
        pillar: true,
        sourceInstitutions: { include: { institution: true } },
        datasetFields: { include: { dataset: true } },
      },
      orderBy: { name: "asc" },
    });

    const datasetIds = [...new Set(kpis.flatMap((kpi) => kpi.datasetFields.map((field) => field.datasetId)))];
    const [obligations, submissions] = datasetIds.length
      ? await Promise.all([
          this.prisma.obligation.findMany({
            where: { datasetId: { in: datasetIds }, ...scopeInstitutionFilter(user) },
            select: { id: true, datasetId: true, dueDate: true, acceptedSubmissionId: true },
          }),
          this.prisma.submission.findMany({
            where: { obligation: { datasetId: { in: datasetIds } }, ...scopeInstitutionFilter(user) },
            select: { obligationId: true, status: true, createdAt: true, obligation: { select: { datasetId: true } } },
          }),
        ])
      : [[], []];

    const now = new Date();
    const views = kpis.map((kpi) => {
      const ids = new Set(kpi.datasetFields.map((field) => field.datasetId));
      const state = gapStateFor(
        kpi.datasetFields[0]?.dataset.name ?? null,
        obligations.filter((obligation) => ids.has(obligation.datasetId)),
        submissions.filter((submission) => submission.obligation && ids.has(submission.obligation.datasetId)),
        now,
      );
      return toDataGap(kpi, state);
    });
    return paginate(views, query.page ?? 1, pageSize);
  }

  async getManualEntryDefinition(user: AuthenticatedUser, obligationId: string) {
    const obligation = await this.findObligationWithFields(obligationId);
    assertInstitutionMembership(user, obligation.institutionId);
    const consolidated = obligation.dataset.submissionMode === "NERC_CONSOLIDATED";
    const open = consolidated
      ? []
      : await this.prisma.obligation.findMany({
          where: {
            institutionId: obligation.institutionId,
            datasetId: obligation.dataset.id,
            acceptedSubmissionId: null,
          },
          select: { reportingPeriod: true, dueDate: true },
          orderBy: { dueDate: "asc" },
        });
    return toManualEntryDefinition(obligation, {
      periods: open.map((entry) => entry.reportingPeriod),
      institutions: consolidated ? [...DISCO_CANONICAL_NAMES] : [],
    });
  }

  async getUploadDefinition(user: AuthenticatedUser, obligationId: string) {
    const obligation = await this.findObligationWithFields(obligationId);
    assertInstitutionMembership(user, obligation.institutionId);
    return toUploadDefinition(obligation);
  }

  async saveManualEntry(user: AuthenticatedUser, obligationId: string, dto: ManualEntryDto) {
    const obligation = await this.findObligationWithFields(obligationId);
    assertInstitutionMembership(user, obligation.institutionId);

    const entered = dto.rows?.length
      ? dto.rows
      : dto.values
        ? [{ period: obligation.reportingPeriod, values: dto.values }]
        : [];
    if (entered.length === 0) throw new BadRequestException("Enter at least one row of values.");
    if (entered.length > 500) throw new BadRequestException("Enter no more than 500 rows at a time.");

    const rows = entered.map((row, index) => ({
      period: row.period?.trim() || obligation.reportingPeriod,
      values: row.values,
      institutionName: row.institution?.trim() || undefined,
      rowNumber: index + 1,
    }));

    return this.submitRows(user, obligation, rows, {
      method: "MANUAL_ENTRY",
      sourceReference: dto.sourceReference ?? "",
      notes: dto.notes,
    });
  }

  /**
   * Real contract requirement (docs/API.md): parsing, field validation and
   * value extraction are backend responsibility, not the frontend's - the
   * mock's own upload handler only fabricates a fixed response, this does
   * the real work. Rejects outright (400) on a validation failure rather
   * than accepting-with-issues, since there's nowhere to persist/display
   * per-submission issues until Phase 3 builds the validation detail view.
   */
  async uploadSubmission(
    user: AuthenticatedUser,
    obligationId: string,
    file: Express.Multer.File | undefined,
    dto: { sourceReference?: string; notes?: string },
  ) {
    const obligation = await this.findObligationWithFields(obligationId);
    assertInstitutionMembership(user, obligation.institutionId);

    if (!file) throw new BadRequestException("Select a completed template to upload.");
    const sourceReference = dto.sourceReference?.trim();
    if (!sourceReference) throw new BadRequestException("Provide the source reference for this submission.");

    let rows: { period: string; values: Record<string, string>; institutionName?: string; rowNumber: number }[];
    try {
      rows = await parseSubmissionFile(
        file.buffer,
        file.originalname,
        obligation.dataset,
        obligation.dataset.fields,
      );
    } catch {
      throw new BadRequestException("Could not read the uploaded file - use the provided template.");
    }
    if (rows.length === 0) {
      throw new BadRequestException("The uploaded file has no data rows to submit.");
    }

    return this.submitRows(user, obligation, rows, {
      method: "UPLOAD",
      sourceReference,
      notes: dto.notes,
      storeFile: () => this.storage.save("submissions", file),
    });
  }

  private async submitRows(
    user: AuthenticatedUser,
    obligation: Awaited<ReturnType<DataSubmissionsService["findObligationWithFields"]>>,
    rows: { period: string; values: Record<string, string>; institutionName?: string; rowNumber: number }[],
    options: {
      method: "UPLOAD" | "MANUAL_ENTRY";
      sourceReference: string;
      notes?: string;
      storeFile?: () => Promise<{ key: string; originalName: string }>;
    },
  ) {
    const consolidated = obligation.dataset.submissionMode === "NERC_CONSOLIDATED";
    const resolved: {
      period: string;
      values: Record<string, string>;
      rowNumber: number;
      obligationId: string;
      institutionId: string;
    }[] = [];
    const problems: RowProblem[] = [];
    const checkValues = (row: { rowNumber: number; period: string; values: Record<string, string> }) => {
      for (const issue of validateFieldValues(obligation.dataset.fields, row.values)) {
        problems.push({
          rowNumber: row.rowNumber,
          period: row.period,
          field: issue.label,
          value: row.values[issue.fieldId] ?? null,
          message: issue.message,
          text: `Row ${row.rowNumber} (${row.period || "no period"}): ${issue.message}`,
        });
      }
    };

    if (consolidated) {
      const unresolvedNames = new Set<string>();
      for (const row of rows) {
        if (!row.institutionName) unresolvedNames.add("(blank)");
        else if (!resolveDiscoName(row.institutionName)) unresolvedNames.add(row.institutionName);
      }
      if (unresolvedNames.size > 0) {
        throw new BadRequestException(
          `Could not recognize these DisCo name(s) in the Discos column: ${[...unresolvedNames].join(", ")}.`,
        );
      }
      if (rows.some((row) => !row.period)) {
        throw new BadRequestException(
          "Every row must have Year (and Month_Name, for monthly datasets) filled in.",
        );
      }

      for (const row of rows) {
        const canonicalName = resolveDiscoName(row.institutionName as string) as string;
        const institution = await this.prisma.institution.findFirst({
          where: { name: { equals: canonicalName, mode: "insensitive" } },
        });
        if (!institution) {
          throw new BadRequestException(`DisCo institution not found for "${canonicalName}".`);
        }
        const rowObligation = await this.prisma.obligation.upsert({
          where: {
            institutionId_datasetId_reportingPeriod: {
              institutionId: institution.id,
              datasetId: obligation.dataset.id,
              reportingPeriod: row.period,
            },
          },
          create: {
            institutionId: institution.id,
            datasetId: obligation.dataset.id,
            reportingPeriod: row.period,
            dueDate: dueDateForPeriod(obligation.dataset.frequency, row.period),
          },
          update: {},
        });
        resolved.push({ ...row, obligationId: rowObligation.id, institutionId: institution.id });
      }
    } else {
      for (const row of rows) {
        if (!row.period) {
          problems.push({
            rowNumber: row.rowNumber,
            period: "",
            field: "Period",
            value: null,
            message: "The Period is blank.",
            text: `Row ${row.rowNumber}: the Period is blank.`,
          });
          continue;
        }
        if (row.period === obligation.reportingPeriod) {
          resolved.push({ ...row, obligationId: obligation.id, institutionId: obligation.institutionId });
          continue;
        }
        const matching = await this.prisma.obligation.findUnique({
          where: {
            institutionId_datasetId_reportingPeriod: {
              institutionId: obligation.institutionId,
              datasetId: obligation.dataset.id,
              reportingPeriod: row.period,
            },
          },
        });
        if (!matching) {
          problems.push({
            rowNumber: row.rowNumber,
            period: row.period,
            field: "Period",
            value: row.period,
            message: "There is no reporting obligation for this period, so the row cannot be submitted.",
            text: `Row ${row.rowNumber} (${row.period}): there is no reporting obligation for this period, so the row cannot be submitted.`,
          });
          continue;
        }
        resolved.push({ ...row, obligationId: matching.id, institutionId: matching.institutionId });
      }
    }

    for (const row of resolved) checkValues(row);

    if (problems.length > 0) {
      problems.sort((a, b) => a.rowNumber - b.rowNumber);
      throw new BadRequestException({
        message: rowProblemsMessage(
          problems.map((problem) => problem.text),
          options.method === "MANUAL_ENTRY" ? "submit it again" : "upload it again",
        ),
        problems: toProblemDetails(problems),
      });
    }

    await this.assertNothingWaiting(resolved.map((row) => ({ obligationId: row.obligationId, period: row.period })));

    const stored = options.storeFile ? await options.storeFile() : null;

    const created: { submissionId: string; version: number }[] = [];
    let totalValues = 0;
    for (const row of resolved) {
      const reviewerId = await this.pickReviewer(user.id, consolidated ? (user.institutionId ?? row.institutionId) : row.institutionId);
      const items = buildSubmissionItems(obligation.dataset.fields, row.values, row.period);
      const submission = await this.createIfNothingWaiting(row.obligationId, row.period, {
        institutionId: row.institutionId,
        submittedById: user.id,
        method: options.method,
        status: "PENDING",
        obligationId: row.obligationId,
        sourceReference: options.sourceReference,
        notes: options.notes ?? "",
        sourceFileUrl: stored?.key,
        originalFileName: stored?.originalName,
        reviewerId,
        items: { create: items },
      });
      await this.rabbitmq.publish("submission.uploaded", { submissionId: submission.id });
      created.push({ submissionId: submission.id, version: submission.version });
      totalValues += items.length;
    }

    const primary = created.find((entry) => entry.submissionId) ?? created[0];

    return {
      submissionId: primary.submissionId,
      version: primary.version,
      status: workflowStatus("pending-review"),
      message: receivedMessage(rows.length, totalValues, created.length),
      nextUrl: nextUrlAfterSubmit(user, created.length === 1 ? primary.submissionId : null),
    };
  }

  async getTemplate(fileName: string): Promise<Buffer> {
    const dataset = await this.prisma.dataset.findFirst({
      where: { templateFileName: fileName },
      include: { fields: true },
    });
    if (!dataset) throw new NotFoundException("Template not found.");
    return generateTemplateBuffer(dataset, dataset.fields);
  }

  async getValidationQueue(user: AuthenticatedUser, query: DataSubmissionsQueryDto) {
    const pageSize = Math.min(100, query.pageSize ?? DEFAULT_PAGE_SIZE);
    const search = query.search?.trim().toLowerCase() ?? "";

    const submissions = await this.prisma.submission.findMany({
      where: {
        status: { in: OPEN_FOR_DECISION },
        // scopeInstitutionFilter(user) last - see comment in getObligations().
        ...(query.institution && query.institution !== "all" ? { institutionId: query.institution } : {}),
        ...(query.reviewer && query.reviewer !== "all" ? { reviewerId: query.reviewer } : {}),
        ...scopeSubmissionFilter(user),
      },
      include: SUBMISSION_INCLUDE,
      orderBy: { createdAt: "asc" }, // oldest-waiting first
    });

    const views = submissions
      .map(toValidationQueueItem)
      .filter(
        (view) =>
          !search || [view.institution, view.dataset, view.reviewer].join(" ").toLowerCase().includes(search),
      );

    return paginate(views, query.page ?? 1, pageSize);
  }

  async getSubmissionDetail(user: AuthenticatedUser, id: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id, ...scopeSubmissionFilter(user) },
      include: SUBMISSION_DETAIL_INCLUDE,
    });
    if (!submission) throw new NotFoundException("Submission not found.");

    const isReviewer = (user.roles?.length ? user.roles : [user.role]).some(
      (role) => role === "DATA_REVIEWER" || role === "VALIDATOR",
    );
    const isSelfReview = submission.submittedById === user.id;
    const { allowSelfReview } = await this.securitySettings.get();
    const canDecide = isReviewer && (!isSelfReview || allowSelfReview);

    return toSubmissionDetail(submission, { canDecide });
  }

  /**
   * The one place a review decision is written AND, if it's an approval,
   * the one place live KpiValues are derived from submitted data - both
   * in a single transaction, same invariant the old submissions module
   * already established. Also updates the obligation's
   * acceptedSubmissionId (docs/API.md: "should also update the
   * obligation's acceptedSubmissionId"), which the old module never had
   * to do because it predates the Obligation concept entirely.
   */
  async recordDecision(user: AuthenticatedUser, id: string, dto: RecordValidationDecisionDto) {
    const submission = await this.prisma.submission.findUnique({
      where: { id, ...scopeSubmissionFilter(user) },
      include: {
        items: { include: { kpiDefinition: true } },
        institution: true,
        submittedBy: { include: { institution: true } },
        obligation: { include: { dataset: true } },
      },
    });
    if (!submission) throw new NotFoundException("Submission not found.");
    assertSubmissionAccess(user, submission);
    if (submission.submittedById === user.id && !(await this.securitySettings.get()).allowSelfReview) {
      throw new ForbiddenException("Self-review is disabled by the system administrator.");
    }
    if (!OPEN_FOR_DECISION.includes(submission.status)) {
      throw new BadRequestException("This submission is not awaiting a decision.");
    }
    const wasProvisional = submission.status === "PROVISIONALLY_APPROVED";
    if (wasProvisional && dto.decision === "provisional") {
      throw new BadRequestException(
        "This submission is already provisionally approved. Confirm it as approved, or return or reject it.",
      );
    }
    const withdrawsValue = wasProvisional && WITHDRAWING_DECISIONS.has(dto.decision);

    const reviewType = DECISION_TO_REVIEW_TYPE[dto.decision];
    const targetStatus = DECISION_TO_STATUS[dto.decision];
    const publishesValue = VALUE_PUBLISHING_DECISIONS.has(dto.decision);
    const consolidated = submission.obligation?.dataset.submissionMode === "NERC_CONSOLIDATED";
    const submitterType = submission.submittedBy.institution?.type ?? "";
    const heldBack = new Set(
      submission.items
        .filter(
          (item) => consolidated || isSingleDiscoValueForNationalKpi(submitterType, item.kpiDefinition.aggregation),
        )
        .map((item) => item.id),
    );
    let rollup: RollupOutcome | null = null;

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.submission.updateMany({
        where: { id, status: submission.status, ...scopeSubmissionFilter(user) },
        data: { status: targetStatus },
      });
      if (count !== 1) {
        throw new BadRequestException("This submission was already decided.");
      }
      if (withdrawsValue) {
        await withdrawItemValues(tx, submission.items.map((item) => item.id));
        if (submission.obligationId) {
          await tx.obligation.updateMany({
            where: { id: submission.obligationId, acceptedSubmissionId: id },
            data: { acceptedSubmissionId: null },
          });
        }
      }
      await tx.reviewDecision.create({
        data: { submissionId: id, reviewedById: user.id, decision: reviewType, comment: dto.comments },
      });

      if (publishesValue) {
        const approvedAt = new Date();
        for (const item of submission.items) {
          if (heldBack.has(item.id)) continue;
          await publishItemValue(
            tx,
            {
              itemId: item.id,
              submissionId: id,
              kpiDefinitionId: item.kpiDefinitionId,
              canonicalKpiId: item.kpiDefinition.canonicalKpiId,
              period: item.period,
              value: item.value,
            },
            { institutionId: submission.institutionId, approvedAt, actorId: user.id },
          );
        }
        if (submission.obligationId) {
          await tx.obligation.update({
            where: { id: submission.obligationId },
            data: { acceptedSubmissionId: id },
          });
        }
      }

      if (consolidated) {
        rollup = await rollupNationalKpis(tx, quartersTouched(submission.items.map((item) => item.period)), user.id);
      }
    });

    await this.rabbitmq.publish("submission.decision_recorded", {
      submissionId: id,
      decision: reviewType,
      institutionId: submission.institutionId,
    });

    const published = publishesValue
      ? submission.items.filter((item) => !heldBack.has(item.id)).map((item) => ({
          kpiId: item.kpiDefinitionId,
          kpiName: item.kpiDefinition.name,
          reportingPeriod: item.period,
          value: Number(item.value),
        }))
      : [];
    const status = workflowStatus(dto.decision);
    const heldBackNames = submission.items.filter((item) => heldBack.has(item.id)).map((item) => item.kpiDefinition.name);
    const message =
      (published.length
        ? `Decision recorded: ${status.label}. Published to ${published.map((p) => p.kpiName).join(", ")}.`
        : `Decision recorded: ${status.label}.`) +
      (consolidated
        ? rollupNote((rollup as RollupOutcome | null)?.published ?? [], (rollup as RollupOutcome | null)?.waiting ?? [])
        : publishesValue && heldBackNames.length
          ? heldBackNote(heldBackNames)
          : "");

    return {
      submissionId: id,
      status,
      message,
      nextUrl: "/data-submissions/validation",
      published,
    };
  }

  /**
   * Bulk approve/reject/etc from the Submission history table. Reuses
   * recordDecision() per id rather than duplicating its transaction, so a
   * bulk decision is exactly N individual decisions - same guards
   * (self-review, already-decided), same KpiValue publishing. One
   * submission failing (e.g. someone else decided it a moment ago) does
   * not block the rest; each outcome is reported back individually so the
   * UI can show exactly what happened per row.
   */
  async bulkRecordDecision(user: AuthenticatedUser, ids: string[], dto: RecordValidationDecisionDto) {
    const succeeded: Awaited<ReturnType<typeof this.recordDecision>>[] = [];
    const failed: { submissionId: string; message: string }[] = [];

    for (const id of ids) {
      try {
        succeeded.push(await this.recordDecision(user, id, dto));
      } catch (error) {
        failed.push({
          submissionId: id,
          message: error instanceof Error ? error.message : "Decision failed.",
        });
      }
    }

    return {
      decision: dto.decision,
      approvedCount: succeeded.length,
      failedCount: failed.length,
      succeeded: succeeded.map((entry) => entry.submissionId),
      failed,
      message:
        failed.length === 0
          ? `${succeeded.length} submission${succeeded.length === 1 ? "" : "s"} decided.`
          : `${succeeded.length} decided, ${failed.length} failed: ${failed.map((f) => f.message).join(" ")}`,
    };
  }

  /**
   * Simple round-robin by current PENDING load - there's no explicit
   * "assign a reviewer" action anywhere in the real contract, so this
   * picks one at upload time rather than leaving every submission
   * unassigned. Returns null if no reviewer-capable account exists yet
   * (a fresh system before anyone with that role has been invited).
   */
  private async pickReviewer(submitterId: string, institutionId: string): Promise<string | null> {
    const { allowSelfReview } = await this.securitySettings.get();
    const reviewers = await this.prisma.user.findMany({
      where: {
        OR: [
          { role: { in: ["DATA_REVIEWER", "VALIDATOR"] } },
          { roles: { hasSome: ["DATA_REVIEWER", "VALIDATOR"] } },
        ],
        status: "ACTIVE",
        AND: [{ OR: [
          { institutionId },
          { role: { in: ["SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER", "OVERSIGHT_USER", "READ_ONLY_USER"] } },
          { roles: { hasSome: ["SYSTEM_ADMINISTRATOR", "DASHBOARD_MANAGER", "OVERSIGHT_USER", "READ_ONLY_USER"] } },
        ] }],
        ...(allowSelfReview ? {} : { id: { not: submitterId } }),
      },
      include: { _count: { select: { reviewingSubmissions: { where: { status: "PENDING" } } } } },
    });
    if (reviewers.length === 0) {
      const platformWide = await this.prisma.user.findMany({
        where: {
          reviewsAllInstitutions: true,
          status: "ACTIVE",
          ...(allowSelfReview ? {} : { id: { not: submitterId } }),
        },
        include: { _count: { select: { reviewingSubmissions: { where: { status: "PENDING" } } } } },
      });
      platformWide.sort((a, b) => a._count.reviewingSubmissions - b._count.reviewingSubmissions);
      return platformWide[0]?.id ?? null;
    }
    reviewers.sort((a, b) => a._count.reviewingSubmissions - b._count.reviewingSubmissions);
    return reviewers[0].id;
  }

  private assertInstitutionAccess(user: AuthenticatedUser, institutionId: string) {
    const filter = scopeInstitutionFilter(user);
    if (filter.institutionId && filter.institutionId !== institutionId) {
      throw new ForbiddenException("You cannot submit data for another institution's obligation.");
    }
  }

  /**
   * Self-healing backlog: the seed script only ever creates the single
   * most-recently-closed period's Obligation. If a filer goes quiet for
   * months, nothing ever represented those missed periods - there was no
   * row for them. On every read, for each (institution, dataset) pair the
   * caller can see, find the last period that actually got an accepted
   * submission and materialize every period between it and today's
   * most-recently-closed one as a real, uploadable Obligation. Datasets
   * with no accepted-submission baseline yet are left alone - there is
   * nothing to measure a gap against, so today's single seeded obligation
   * stands as-is rather than speculatively backfilling from dataset
   * creation time.
   */
  private async materializeBacklogObligations(user: AuthenticatedUser, query: DataSubmissionsQueryDto) {
    const scopeWhere = {
      ...(query.institution && query.institution !== "all" ? { institutionId: query.institution } : {}),
      ...(query.dataset && query.dataset !== "all" ? { datasetId: query.dataset } : {}),
      ...scopeInstitutionFilter(user),
    };

    const groups = await this.prisma.obligation.groupBy({
      by: ["institutionId", "datasetId"],
      where: scopeWhere,
    });
    if (groups.length === 0) return;

    const now = new Date();
    for (const group of groups) {
      const dataset = await this.prisma.dataset.findUnique({ where: { id: group.datasetId } });
      if (!dataset) continue;

      const lastAccepted = await this.prisma.obligation.findFirst({
        where: {
          institutionId: group.institutionId,
          datasetId: group.datasetId,
          acceptedSubmissionId: { not: null },
        },
        orderBy: { dueDate: "desc" },
      });
      if (!lastAccepted) continue;

      const frontierEnd = periodEndDate(dataset.frequency, mostRecentClosedPeriod(dataset.frequency, now));
      let cursor = nextPeriod(dataset.frequency, lastAccepted.reportingPeriod);
      let guard = 0;
      while (periodEndDate(dataset.frequency, cursor).getTime() <= frontierEnd.getTime() && guard < 60) {
        await this.prisma.obligation.upsert({
          where: {
            institutionId_datasetId_reportingPeriod: {
              institutionId: group.institutionId,
              datasetId: group.datasetId,
              reportingPeriod: cursor,
            },
          },
          create: {
            institutionId: group.institutionId,
            datasetId: group.datasetId,
            reportingPeriod: cursor,
            dueDate: dueDateForPeriod(dataset.frequency, cursor),
          },
          update: {},
        });
        cursor = nextPeriod(dataset.frequency, cursor);
        guard++;
      }
    }
  }

  private async assertNothingWaiting(targets: { obligationId: string; period: string }[]) {
    const waiting = await this.prisma.submission.findMany({
      where: { obligationId: { in: targets.map((target) => target.obligationId) }, status: { in: BLOCKING_STATUSES } },
      select: { obligationId: true, status: true },
    });
    if (waiting.length === 0) return;
    const blocked = new Set(waiting.map((entry) => entry.obligationId));
    const onlyProvisional = waiting.every((entry) => entry.status === "PROVISIONALLY_APPROVED");
    throw new ConflictException(
      alreadyWaitingMessage(
        targets.filter((target) => blocked.has(target.obligationId)).map((target) => target.period),
        onlyProvisional,
      ),
    );
  }

  private async createIfNothingWaiting(
    obligationId: string,
    period: string,
    data: Prisma.SubmissionUncheckedCreateInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${obligationId}))`;
      const waiting = await tx.submission.findFirst({
        where: { obligationId, status: { in: BLOCKING_STATUSES } },
        select: { id: true, status: true },
      });
      if (waiting) {
        throw new ConflictException(alreadyWaitingMessage([period], waiting.status === "PROVISIONALLY_APPROVED"));
      }
      const previous = await tx.submission.findFirst({
        where: { obligationId, nextVersion: null },
        orderBy: { version: "desc" },
        select: { id: true, version: true },
      });
      return tx.submission.create({
        data: previous ? { ...data, version: previous.version + 1, previousVersionId: previous.id } : data,
      });
    });
  }

  private async findObligationWithFields(obligationId: string) {
    const obligation = await this.prisma.obligation.findUnique({
      where: { id: obligationId },
      include: OBLIGATION_WITH_FIELDS_INCLUDE,
    });
    if (!obligation) throw new NotFoundException("The reporting obligation was not found.");
    return obligation;
  }
}

function buildObligationStats(views: ReturnType<typeof toObligationView>[]) {
  const byStatus = new Map<string, { code: string; label: string; tone: string; count: number }>();
  for (const view of views) {
    const existing = byStatus.get(view.status.code);
    if (existing) existing.count += 1;
    else byStatus.set(view.status.code, { ...view.status, count: 1 });
  }
  const overdueViews = views.filter((v) => v.status.code === "overdue");
  const averageDaysOverdue = overdueViews.length
    ? Math.round(
        overdueViews.reduce((sum, v) => sum + Math.abs(daysUntil(v.dueDate)), 0) / overdueViews.length,
      )
    : null;

  return {
    total: views.length,
    byStatus: [...byStatus.values()],
    overdueCount: overdueViews.length,
    averageDaysOverdue,
    openCount: views.filter((v) => v.status.code !== "provisional").length,
  };
}

function daysUntil(isoDate: string): number {
  return Math.round((new Date(isoDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Due date for an Obligation synthesized on the fly from a NERC_CONSOLIDATED
 * upload row, for a period that may not have been pre-seeded. Approximates
 * the seed script's own "15 days after period close" rule; since these
 * obligations are typically created and satisfied by the same upload, the
 * exact due date mostly matters for display, not enforcement.
 */
function dueDateForPeriod(frequency: string, period: string): Date {
  if (frequency === "Monthly") {
    const [monthName, yearText] = period.split(" ");
    const monthIndex = MONTH_NAMES.indexOf(monthName);
    const year = Number(yearText);
    if (monthIndex === -1 || Number.isNaN(year))
      throw new BadRequestException(`Unrecognized period "${period}".`);
    return new Date(Date.UTC(year, monthIndex + 1, 15));
  }
  if (frequency === "Quarterly") {
    const match = /^Q([1-4]) (\d{4})$/.exec(period);
    if (!match) throw new BadRequestException(`Unrecognized period "${period}".`);
    const quarter = Number(match[1]);
    const year = Number(match[2]);
    return new Date(Date.UTC(year, quarter * 3, 15));
  }
  const year = Number(period);
  if (Number.isNaN(year)) throw new BadRequestException(`Unrecognized period "${period}".`);
  return new Date(Date.UTC(year + 1, 0, 31));
}

/** Last calendar day of the given reporting period, for ordering/comparison. */
function periodEndDate(frequency: string, period: string): Date {
  if (frequency === "Monthly") {
    const [monthName, yearText] = period.split(" ");
    const monthIndex = MONTH_NAMES.indexOf(monthName);
    const year = Number(yearText);
    if (monthIndex === -1 || Number.isNaN(year))
      throw new BadRequestException(`Unrecognized period "${period}".`);
    return new Date(Date.UTC(year, monthIndex + 1, 0));
  }
  if (frequency === "Quarterly") {
    const match = /^Q([1-4]) (\d{4})$/.exec(period);
    if (!match) throw new BadRequestException(`Unrecognized period "${period}".`);
    const quarter = Number(match[1]);
    const year = Number(match[2]);
    return new Date(Date.UTC(year, quarter * 3, 0));
  }
  const year = Number(period);
  if (Number.isNaN(year)) throw new BadRequestException(`Unrecognized period "${period}".`);
  return new Date(Date.UTC(year, 11, 31));
}

/** The reporting period immediately following the given one, same cadence. */
function nextPeriod(frequency: string, period: string): string {
  const dayAfterEnd = new Date(periodEndDate(frequency, period).getTime() + 24 * 60 * 60 * 1000);
  if (frequency === "Monthly")
    return `${MONTH_NAMES[dayAfterEnd.getUTCMonth()]} ${dayAfterEnd.getUTCFullYear()}`;
  if (frequency === "Quarterly") {
    const quarter = Math.floor(dayAfterEnd.getUTCMonth() / 3) + 1;
    return `Q${quarter} ${dayAfterEnd.getUTCFullYear()}`;
  }
  return String(dayAfterEnd.getUTCFullYear());
}

/** The most recently *closed* reporting period as of `now`, same cadence
 * rule the seed script's currentPeriod() uses. */
function mostRecentClosedPeriod(frequency: string, now: Date): string {
  if (frequency === "Monthly") {
    const closed = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return `${MONTH_NAMES[closed.getUTCMonth()]} ${closed.getUTCFullYear()}`;
  }
  if (frequency === "Quarterly") {
    const closedQuarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3 - 3;
    const closed = new Date(Date.UTC(now.getUTCFullYear(), closedQuarterStartMonth, 1));
    const quarter = Math.floor(closed.getUTCMonth() / 3) + 1;
    return `Q${quarter} ${closed.getUTCFullYear()}`;
  }
  return String(now.getUTCFullYear() - 1);
}
