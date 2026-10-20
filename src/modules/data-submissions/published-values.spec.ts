import { linkedItemId, publishItemValue, withdrawItemValues } from "@/modules/data-submissions/published-values";

jest.setTimeout(30000);

type Row = { id: string; kpiDefinitionId: string; institutionId: string; period: string; value: number; sourceSubmissionItemId: string };

function build(options: { rows?: Row[]; aliases?: string[] } = {}) {
  const rows: Row[] = options.rows ?? [];
  let counter = 0;
  const tx = {
    kpiValue: {
      findUnique: jest.fn(async ({ where }: { where: { sourceSubmissionItemId: string } }) =>
        rows.find((row) => row.sourceSubmissionItemId === where.sourceSubmissionItemId) ?? null,
      ),
      findFirst: jest.fn(async ({ where }: { where: { kpiDefinitionId: string; institutionId: string; period: string } }) =>
        rows.find((row) => row.kpiDefinitionId === where.kpiDefinitionId && row.institutionId === where.institutionId && row.period === where.period) ?? null,
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        Object.assign(rows.find((row) => row.id === where.id) as Row, data);
      }),
      create: jest.fn(async ({ data }: { data: Omit<Row, "id"> }) => {
        counter += 1;
        rows.push({ id: `new-${counter}`, ...data });
      }),
      deleteMany: jest.fn(),
    },
    kpiDefinition: { findMany: jest.fn().mockResolvedValue((options.aliases ?? []).map((id) => ({ id }))) },
    submission: { upsert: jest.fn() },
    submissionItem: { upsert: jest.fn() },
  };
  return { tx, rows };
}

const item = (over: object = {}) => ({
  itemId: "item-1",
  submissionId: "sub-1",
  kpiDefinitionId: "kpi-a",
  canonicalKpiId: null,
  period: "2025",
  value: 10,
  ...over,
});
const context = { institutionId: "inst-cdmu", approvedAt: new Date("2026-10-20T00:00:00Z"), actorId: "reviewer" };

describe("publishing an approved value", () => {
  it("creates a value when the period has none", async () => {
    const { tx, rows } = build();
    await publishItemValue(tx as never, item(), context);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kpiDefinitionId: "kpi-a", period: "2025", value: 10, sourceSubmissionItemId: "item-1" });
  });

  it("replaces a value already loaded for that period instead of adding a second one", async () => {
    const { tx, rows } = build({
      rows: [{ id: "old", kpiDefinitionId: "kpi-a", institutionId: "inst-cdmu", period: "2025", value: 5, sourceSubmissionItemId: "script-item" }],
    });
    await publishItemValue(tx as never, item(), context);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "old", value: 10, sourceSubmissionItemId: "item-1" });
  });

  it("updates in place when the same submission publishes again, for example on confirmation", async () => {
    const { tx, rows } = build({
      rows: [{ id: "mine", kpiDefinitionId: "kpi-a", institutionId: "inst-cdmu", period: "2025", value: 10, sourceSubmissionItemId: "item-1" }],
    });
    await publishItemValue(tx as never, item({ value: 12 }), context);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(12);
  });

  it("keeps another institution's value for the same period", async () => {
    const { tx, rows } = build({
      rows: [{ id: "other", kpiDefinitionId: "kpi-a", institutionId: "inst-other", period: "2025", value: 5, sourceSubmissionItemId: "x" }],
    });
    await publishItemValue(tx as never, item(), context);
    expect(rows).toHaveLength(2);
  });
});

describe("a KPI that records the same measurement as another", () => {
  it("copies the value to the canonical KPI it is linked to", async () => {
    const { tx, rows } = build();
    await publishItemValue(tx as never, item({ canonicalKpiId: "kpi-canonical" }), context);
    expect(rows.map((row) => row.kpiDefinitionId).sort()).toEqual(["kpi-a", "kpi-canonical"]);
    expect(rows.find((row) => row.kpiDefinitionId === "kpi-canonical")).toMatchObject({
      value: 10,
      sourceSubmissionItemId: linkedItemId("item-1", "kpi-canonical"),
    });
  });

  it("copies the value to every KPI that is an alias of it", async () => {
    const { tx, rows } = build({ aliases: ["alias-1", "alias-2"] });
    await publishItemValue(tx as never, item(), context);
    expect(rows.map((row) => row.kpiDefinitionId).sort()).toEqual(["alias-1", "alias-2", "kpi-a"]);
  });

  it("publishes nothing extra when the KPI has no link", async () => {
    const { tx, rows } = build();
    await publishItemValue(tx as never, item(), context);
    expect(rows).toHaveLength(1);
    expect(tx.submission.upsert).not.toHaveBeenCalled();
  });
});

describe("withdrawing published values", () => {
  it("removes the values and their linked copies", async () => {
    const { tx } = build();
    await withdrawItemValues(tx as never, ["item-1"]);
    expect(tx.kpiValue.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ sourceSubmissionItemId: { in: ["item-1"] } }, { sourceSubmissionItemId: { startsWith: "live-linked-item-item-1-" } }] },
    });
  });

  it("does nothing for no items", async () => {
    const { tx } = build();
    await withdrawItemValues(tx as never, []);
    expect(tx.kpiValue.deleteMany).not.toHaveBeenCalled();
  });
});
