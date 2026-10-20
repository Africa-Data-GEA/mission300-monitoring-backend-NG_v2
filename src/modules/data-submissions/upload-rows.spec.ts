import { BadRequestException } from "@nestjs/common";
import ExcelJS from "exceljs";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { DataSubmissionsService } from "@/modules/data-submissions/data-submissions.service";

jest.setTimeout(60000);

const FIELD_LABELS = ["Operational Mini-Grids", "Active MSME Mini-Grid Connections"];

const OBLIGATION = {
  id: "obl-q3",
  institutionId: "inst-rea",
  reportingPeriod: "Q3 2026",
  dataset: {
    id: "rea-minigrid-shs-output",
    frequency: "Quarterly",
    submissionMode: "PER_INSTITUTION",
    fields: FIELD_LABELS.map((label, index) => ({
      id: `f${index + 1}`,
      label,
      type: "NUMBER",
      required: true,
      unit: null,
      kpiDefinitionId: `k${index + 1}`,
    })),
  },
};

const provider = {
  id: "u-provider",
  role: "INSTITUTIONAL_DATA_PROVIDER",
  roles: [],
  institutionId: "inst-rea",
} as unknown as AuthenticatedUser;

async function workbookFile(rows: (string | number)[][]): Promise<Express.Multer.File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Submission");
  ws.addRow(["Period (e.g. Q3 2026)", ...FIELD_LABELS]);
  rows.forEach((row) => ws.addRow(row));
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, originalname: "rows.xlsx", mimetype: "application/octet-stream", size: buffer.length } as Express.Multer.File;
}

function build() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    submission: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "new-sub", version: 1 }),
    },
  };
  const prisma = {
    obligation: {
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id === "obl-q3") return OBLIGATION;
        const key = where.institutionId_datasetId_reportingPeriod as { reportingPeriod: string } | undefined;
        return key?.reportingPeriod === "Q3 2026" ? OBLIGATION : null;
      }),
    },
    submission: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const storage = { save: jest.fn().mockResolvedValue({ key: "k", originalName: "rows.xlsx" }) };
  const rabbit = { publish: jest.fn() };
  const security = { get: jest.fn().mockResolvedValue({ allowSelfReview: true }) };
  const service = new DataSubmissionsService(prisma as never, storage as never, rabbit as never, security as never);
  return { service, storage, tx };
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).message;
  }
  throw new Error("the upload was accepted but should have been rejected");
}

describe("uploading a file with several rows", () => {
  it("rejects the tracker's file instead of silently dropping the rows it cannot use", async () => {
    const { service, storage, tx } = build();
    const file = await workbookFile([
      ["Q1 2026", -5, -5],
      ["Q2 2026", "no data", "no data"],
      ["Q3 2026", 150, 150],
    ]);

    const message = await rejectionMessage(service.uploadSubmission(provider, "obl-q3", file, { sourceReference: "ref" }));

    expect(message).toContain("nothing was submitted");
    expect(message).toContain("Row 2 (Q1 2026): there is no reporting obligation for this period");
    expect(message).toContain("Row 3 (Q2 2026): there is no reporting obligation for this period");
    expect(message).not.toContain("Operational Mini-Grids cannot be negative");
    expect(message).not.toContain("Operational Mini-Grids must be a number");
    expect(storage.save).not.toHaveBeenCalled();
    expect(tx.submission.create).not.toHaveBeenCalled();
  });

  it("does not let one good row carry bad rows through to review", async () => {
    const { service, tx } = build();
    const file = await workbookFile([
      ["Q1 2026", "no data", "no data"],
      ["Q3 2026", 1200, 40],
    ]);
    await rejectionMessage(service.uploadSubmission(provider, "obl-q3", file, { sourceReference: "ref" }));
    expect(tx.submission.create).not.toHaveBeenCalled();
  });

  it("reports only the period for a row whose period has no obligation, not its values too", async () => {
    const { service } = build();
    const file = await workbookFile([
      ["Q2 2026", "abc", -5],
      ["Q3 2026", 10, 5],
    ]);
    const message = await rejectionMessage(service.uploadSubmission(provider, "obl-q3", file, { sourceReference: "ref" }));
    expect(message).toContain("1 problem found");
    expect(message).toContain("Row 2 (Q2 2026): there is no reporting obligation for this period");
    expect(message).not.toContain("must be a number");
    expect(message).not.toContain("cannot be negative");
  });

  it("rejects a row with no period", async () => {
    const { service } = build();
    const file = await workbookFile([
      ["", 10, 5],
      ["Q3 2026", 10, 5],
    ]);
    const message = await rejectionMessage(service.uploadSubmission(provider, "obl-q3", file, { sourceReference: "ref" }));
    expect(message).toContain("Row 2: the Period is blank.");
  });

  it("reports every problem at once with the spreadsheet row numbers", async () => {
    const { service } = build();
    const file = await workbookFile([
      ["Q3 2026", "x", "y"],
      ["Q4 2026", 1, 1],
    ]);
    const message = await rejectionMessage(service.uploadSubmission(provider, "obl-q3", file, { sourceReference: "ref" }));
    expect(message).toContain("Row 2 (Q3 2026): Operational Mini-Grids must be a number.");
    expect(message).toContain("Row 2 (Q3 2026): Active MSME Mini-Grid Connections must be a number.");
    expect(message).toContain("Row 3 (Q4 2026): there is no reporting obligation");
    expect(message).toContain("3 problems found");
    expect(message.indexOf("Row 2 (Q3 2026): Operational")).toBeLessThan(message.indexOf("Row 3 (Q4 2026)"));
  });

  it("sends the rejected values back as structured details, in row order", async () => {
    const { service } = build();
    const file = await workbookFile([
      ["Q4 2026", 1, 1],
      ["Q3 2026", -554, "abc"],
    ]);
    let body: { problems: unknown[]; message: string } | undefined;
    try {
      await service.uploadSubmission(provider, "obl-q3", file, { sourceReference: "ref" });
    } catch (error) {
      body = (error as BadRequestException).getResponse() as { problems: unknown[]; message: string };
    }
    expect(body?.message).toContain("nothing was submitted");
    expect(body?.problems).toEqual([
      { row: 2, period: "Q4 2026", field: "Period", value: "Q4 2026", problem: expect.stringContaining("no reporting obligation") },
      { row: 3, period: "Q3 2026", field: "Operational Mini-Grids", value: "-554", problem: "Operational Mini-Grids cannot be negative." },
      { row: 3, period: "Q3 2026", field: "Active MSME Mini-Grid Connections", value: "abc", problem: "Active MSME Mini-Grid Connections must be a number." },
    ]);
  });

  it("still accepts a clean file for the matching period", async () => {
    const { service, storage, tx } = build();
    const file = await workbookFile([["Q3 2026", 554, 26525]]);
    const result = await service.uploadSubmission(provider, "obl-q3", file, { sourceReference: "ref" });
    expect(tx.submission.create).toHaveBeenCalledTimes(1);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(result.nextUrl).toBe("/data-submissions/submissions");
  });
});
