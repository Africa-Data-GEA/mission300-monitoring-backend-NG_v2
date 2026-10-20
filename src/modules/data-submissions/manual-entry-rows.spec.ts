import { BadRequestException } from "@nestjs/common";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { DataSubmissionsService } from "@/modules/data-submissions/data-submissions.service";

jest.setTimeout(60000);

const FIELDS = [
  { id: "f1", label: "Metered Customers", type: "NUMBER", required: true, unit: null, kpiDefinitionId: "k1" },
  { id: "f2", label: "Unmetered Customers", type: "NUMBER", required: true, unit: null, kpiDefinitionId: "k2" },
];

const PER_INSTITUTION = {
  id: "obl-q3",
  institutionId: "inst-rea",
  reportingPeriod: "Q3 2026",
  dataset: { id: "ds-rea", frequency: "Quarterly", submissionMode: "PER_INSTITUTION", fields: FIELDS },
};

const CONSOLIDATED = {
  id: "obl-nerc",
  institutionId: "inst-nerc",
  reportingPeriod: "Q3 2026",
  dataset: { id: "ds-metering", frequency: "Quarterly", submissionMode: "NERC_CONSOLIDATED", fields: FIELDS },
};

const providerOf = (institutionId: string) =>
  ({ id: "u", role: "INSTITUTIONAL_DATA_PROVIDER", roles: [], institutionId }) as unknown as AuthenticatedUser;

function build(obligation: typeof PER_INSTITUTION | typeof CONSOLIDATED) {
  const created: { data: Record<string, unknown> }[] = [];
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    submission: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args);
        return { id: `sub-${created.length}`, version: 1 };
      }),
    },
  };
  const periods = new Set(["Q3 2026", "Q4 2026"]);
  const prisma = {
    obligation: {
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id === obligation.id) return obligation;
        const key = where.institutionId_datasetId_reportingPeriod as { reportingPeriod: string } | undefined;
        return key && periods.has(key.reportingPeriod) ? { id: `obl-${key.reportingPeriod}`, institutionId: obligation.institutionId } : null;
      }),
      upsert: jest.fn(async ({ where }: { where: { institutionId_datasetId_reportingPeriod: { institutionId: string; reportingPeriod: string } } }) => ({
        id: `obl-${where.institutionId_datasetId_reportingPeriod.institutionId}-${where.institutionId_datasetId_reportingPeriod.reportingPeriod}`,
      })),
      findMany: jest.fn().mockResolvedValue([{ reportingPeriod: "Q3 2026", dueDate: new Date() }]),
    },
    institution: { findFirst: jest.fn(async ({ where }: { where: { name: { equals: string } } }) => ({ id: `inst-${where.name.equals}` })) },
    submission: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new DataSubmissionsService(
    prisma as never,
    {} as never,
    { publish: jest.fn() } as never,
    { get: jest.fn().mockResolvedValue({ allowSelfReview: true }) } as never,
  );
  return { service, created };
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BadRequestException) {
      const body = error.getResponse() as { message: string | string[] };
      return Array.isArray(body.message) ? body.message.join(" ") : body.message;
    }
    throw error;
  }
  return "";
}

describe("the form for an institution's own dataset", () => {
  it("still saves a single entry for the obligation's period", async () => {
    const { service, created } = build(PER_INSTITUTION);
    await service.saveManualEntry(providerOf("inst-rea"), "obl-q3", { values: { f1: "10", f2: "5" }, sourceReference: "x" } as never);
    expect(created).toHaveLength(1);
    expect(created[0].data).toMatchObject({ method: "MANUAL_ENTRY", institutionId: "inst-rea" });
  });

  it("saves several periods at once, one submission each", async () => {
    const { service, created } = build(PER_INSTITUTION);
    await service.saveManualEntry(providerOf("inst-rea"), "obl-q3", {
      rows: [
        { period: "Q3 2026", values: { f1: "10", f2: "5" } },
        { period: "Q4 2026", values: { f1: "12", f2: "6" } },
      ],
      sourceReference: "x",
    } as never);
    expect(created.map((entry) => entry.data.obligationId)).toEqual(["obl-q3", "obl-Q4 2026"]);
  });

  it("refuses a period that has no obligation and names the row", async () => {
    const { service, created } = build(PER_INSTITUTION);
    const message = await messageOf(
      service.saveManualEntry(providerOf("inst-rea"), "obl-q3", {
        rows: [{ period: "Q1 2030", values: { f1: "10", f2: "5" } }],
      } as never),
    );
    expect(message).toMatch(/Row 1 \(Q1 2030\).*no reporting obligation/);
    expect(created).toHaveLength(0);
  });

  it("reports bad values per row, like the upload does", async () => {
    const { service } = build(PER_INSTITUTION);
    const message = await messageOf(
      service.saveManualEntry(providerOf("inst-rea"), "obl-q3", {
        rows: [
          { values: { f1: "10", f2: "5" } },
          { values: { f1: "-3", f2: "5" } },
        ],
      } as never),
    );
    expect(message).toMatch(/Row 2/);
    expect(message).not.toMatch(/Row 1 /);
  });

  it("refuses an empty entry", async () => {
    const { service } = build(PER_INSTITUTION);
    await expect(service.saveManualEntry(providerOf("inst-rea"), "obl-q3", {} as never)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("the form for a NERC consolidated dataset", () => {
  it("creates one submission per DisCo, under that DisCo", async () => {
    const { service, created } = build(CONSOLIDATED);
    await service.saveManualEntry(providerOf("inst-nerc"), "obl-nerc", {
      rows: [
        { period: "Q3 2026", institution: "Ikeja Electric", values: { f1: "100", f2: "50" } },
        { period: "Q3 2026", institution: "Eko Electricity Distribution Company", values: { f1: "80", f2: "40" } },
      ],
      sourceReference: "NERC",
    } as never);
    expect(created.map((entry) => entry.data.institutionId)).toEqual(["inst-Ikeja Electric", "inst-Eko Electricity Distribution Company"]);
    expect(created.every((entry) => entry.data.method === "MANUAL_ENTRY")).toBe(true);
  });

  it("refuses a row with no DisCo, instead of recording it under NERC", async () => {
    const { service, created } = build(CONSOLIDATED);
    const message = await messageOf(
      service.saveManualEntry(providerOf("inst-nerc"), "obl-nerc", { rows: [{ period: "Q3 2026", values: { f1: "1", f2: "1" } }] } as never),
    );
    expect(message).toMatch(/Could not recognize these DisCo name/);
    expect(created).toHaveLength(0);
  });

  it("refuses a DisCo name it does not know", async () => {
    const { service } = build(CONSOLIDATED);
    const message = await messageOf(
      service.saveManualEntry(providerOf("inst-nerc"), "obl-nerc", { rows: [{ period: "Q3 2026", institution: "Nowhere Power", values: { f1: "1", f2: "1" } }] } as never),
    );
    expect(message).toMatch(/Nowhere Power/);
  });
});
