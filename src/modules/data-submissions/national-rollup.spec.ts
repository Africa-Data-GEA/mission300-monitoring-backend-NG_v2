import {
  inputFor,
  nationalForQuarter,
  periodsIn,
  quarterOf,
  type ApprovedValue,
  type RollupInput,
} from "@/modules/data-submissions/national-rollup";
import { rollupNationalKpis } from "@/modules/data-submissions/national-rollup.db";

jest.setTimeout(30000);

const value = (institutionId: string, input: RollupInput, period: string, amount: number, decidedAt = 1): ApprovedValue => ({
  institutionId,
  input,
  period,
  value: amount,
  decidedAt,
});

const Q4_2025_METERED = [
  ["ibadan", 1267503],
  ["ikeja", 1130213],
  ["abuja", 1044014],
  ["enugu", 847109],
  ["port-harcourt", 678446],
  ["benin", 564500],
  ["eko", 550764],
  ["kano", 282319],
  ["jos", 257258],
  ["kaduna", 187050],
  ["yola", 157408],
] as const;

const national = (values: ApprovedValue[], quarter: string, code: string) =>
  nationalForQuarter(values, quarter).find((result) => result.code === code);

describe("the national total is the sum of every DisCo, not the last one approved", () => {
  const rows = Q4_2025_METERED.map(([disco, count], index) => value(disco, "metered", "Q4 2025", count, index));

  it("gives 6,966,584 for Q4 2025 metered customers, the NERC-confirmed figure", () => {
    expect(national(rows, "q4-2025", "M300-P3-001")?.value).toBe(6966584);
  });

  it("does not depend on the order the DisCos were approved in", () => {
    expect(national([...rows].reverse(), "q4-2025", "M300-P3-001")?.value).toBe(6966584);
    const yolaLast = [...rows].sort((a, b) => (a.institutionId === "yola" ? 1 : b.institutionId === "yola" ? -1 : 0));
    expect(national(yolaLast, "q4-2025", "M300-P3-001")?.value).not.toBe(157408);
  });

  it("uses a DisCo's newest approved value when it was resubmitted", () => {
    const corrected = [...rows, value("yola", "metered", "Q4 2025", 200000, 99)];
    expect(national(corrected, "q4-2025", "M300-P3-001")?.value).toBe(6966584 - 157408 + 200000);
  });

  it("ignores values from other quarters", () => {
    const mixed = [...rows, value("yola", "metered", "Q3 2025", 1)];
    expect(national(mixed, "q4-2025", "M300-P3-001")?.value).toBe(6966584);
  });
});

describe("customer figures", () => {
  const values = [
    value("a", "metered", "Q4 2025", 600),
    value("b", "metered", "Q4 2025", 400),
    value("a", "unmetered", "Q4 2025", 300),
    value("b", "unmetered", "Q4 2025", 700),
  ];

  it("adds unmetered customers across DisCos", () => {
    expect(national(values, "q4-2025", "M300-P3-002")?.value).toBe(1000);
  });

  it("works the metering rate from national totals", () => {
    expect(national(values, "q4-2025", "M300-P3-004")?.value).toBeCloseTo(50, 10);
  });

  it("leaves the metering rate out when unmetered customers are missing", () => {
    const onlyMetered = values.filter((entry) => entry.input === "metered");
    expect(national(onlyMetered, "q4-2025", "M300-P3-004")).toBeUndefined();
    expect(national(onlyMetered, "q4-2025", "M300-P3-001")?.value).toBe(1000);
  });
});

describe("ratios come from national totals, not an average of DisCo ratios", () => {
  it("works collection efficiency as total collected over total billed", () => {
    const values = [
      value("small", "revenueBilledMillion", "January 2026", 100),
      value("small", "revenueCollectedMillion", "January 2026", 90),
      value("large", "revenueBilledMillion", "January 2026", 900),
      value("large", "revenueCollectedMillion", "January 2026", 450),
    ];
    const result = national(values, "q1-2026", "M300-P3-008");
    expect(result?.value).toBeCloseTo(54, 10);
    expect(result?.value).not.toBeCloseTo(70, 5);
  });

  it("works ATC&C as one minus billing efficiency times collection efficiency", () => {
    const values = [
      value("a", "energyReceivedGwh", "March 2026", 1000),
      value("a", "energyBilledGwh", "March 2026", 800),
      value("a", "revenueBilledMillion", "March 2026", 100),
      value("a", "revenueCollectedMillion", "March 2026", 80),
    ];
    expect(national(values, "q1-2026", "M300-P3-006")?.value).toBeCloseTo(36, 10);
  });

  it("leaves ATC&C out until energy received has been approved", () => {
    const values = [
      value("a", "energyBilledGwh", "March 2026", 800),
      value("a", "revenueBilledMillion", "March 2026", 100),
      value("a", "revenueCollectedMillion", "March 2026", 80),
    ];
    expect(national(values, "q1-2026", "M300-P3-006")).toBeUndefined();
  });

  it("works remittance from market operator and NBET together", () => {
    const values = [
      value("a", "moInvoiceBillion", "February 2026", 10),
      value("a", "nbetInvoiceBillion", "February 2026", 30),
      value("a", "moRemittanceBillion", "February 2026", 9),
      value("a", "nbetRemittanceBillion", "February 2026", 21),
    ];
    expect(national(values, "q1-2026", "M300-P3-009")?.value).toBeCloseTo(75, 10);
  });
});

describe("money and partial quarters", () => {
  it("adds monthly revenue over the quarter and converts million to billion", () => {
    const values = [
      value("a", "revenueCollectedMillion", "April 2026", 1500),
      value("b", "revenueCollectedMillion", "April 2026", 500),
      value("a", "revenueCollectedMillion", "May 2026", 2000),
    ];
    expect(national(values, "q2-2026", "M300-P3-007")?.value).toBe(4);
  });

  it("notes the months covered when the quarter is incomplete", () => {
    const values = [value("a", "revenueCollectedMillion", "April 2026", 1000), value("a", "revenueCollectedMillion", "May 2026", 1000)];
    expect(national(values, "q2-2026", "M300-P3-007")?.coverageNote).toBe("Apr–May");
  });

  it("has no note for a full quarter", () => {
    const values = ["April 2026", "May 2026", "June 2026"].map((month) => value("a", "revenueCollectedMillion", month, 1000));
    expect(national(values, "q2-2026", "M300-P3-007")?.coverageNote).toBeNull();
  });

  it("only counts months present for every input of a ratio", () => {
    const values = [
      value("a", "revenueBilledMillion", "April 2026", 100),
      value("a", "revenueBilledMillion", "May 2026", 100),
      value("a", "revenueCollectedMillion", "April 2026", 80),
    ];
    expect(national(values, "q2-2026", "M300-P3-008")?.coverageNote).toBe("Apr");
  });

  it("has no note for customer counts, which are quarter-end figures", () => {
    expect(national([value("a", "metered", "Q2 2026", 10)], "q2-2026", "M300-P3-001")?.coverageNote).toBeNull();
  });
});

describe("period helpers", () => {
  it("places months and quarters in the right quarter", () => {
    expect(quarterOf("August 2026")).toEqual({ quarter: "q3-2026", month: "August" });
    expect(quarterOf("Q4 2025")).toEqual({ quarter: "q4-2025", month: null });
    expect(quarterOf("2026")).toBeNull();
    expect(quarterOf("Smarch 2026")).toBeNull();
  });

  it("lists the periods that belong to a quarter", () => {
    expect(periodsIn("q3-2026")).toEqual(["Q3 2026", "July 2026", "August 2026", "September 2026"]);
    expect(periodsIn("nonsense")).toEqual([]);
  });

  it("maps a dataset field to the input it supplies", () => {
    expect(inputFor("nerc-disco-metering", "M300-P3-001")).toBe("metered");
    expect(inputFor("nerc-disco-metering", "M300-P3-002")).toBe("unmetered");
    expect(inputFor("nerc-disco-energy-billed", "M300-P3-006")).toBe("energyBilledGwh");
    expect(inputFor("nerc-disco-allowed-tariffs", "M300-P3-012")).toBeNull();
    expect(inputFor("rea-minigrid-shs-output", "M300-P2-026")).toBeNull();
  });
});

describe("rollupNationalKpis (database step)", () => {
  function build(opts: { waitingDatasets?: string[]; existing?: boolean } = {}) {
    const items = Q4_2025_METERED.map(([disco, count]) => ({
      value: count,
      period: "Q4 2025",
      kpiDefinition: { code: "M300-P3-001" },
      submission: { institutionId: disco, createdAt: new Date(1000), obligation: { datasetId: "nerc-disco-metering" } },
    }));
    const tx = {
      institution: { findUnique: jest.fn().mockResolvedValue({ id: "seed-institution-nerc" }) },
      submission: {
        count: jest.fn(async ({ where }: { where: { obligation: { datasetId: { in: string[] } } } }) =>
          where.obligation.datasetId.in.some((id) => opts.waitingDatasets?.includes(id)) ? 3 : 0,
        ),
        upsert: jest.fn(),
      },
      submissionItem: { findMany: jest.fn().mockResolvedValue(items), update: jest.fn(), upsert: jest.fn() },
      kpiDefinition: { findUnique: jest.fn(async ({ where }: { where: { code: string } }) => ({ id: `id-${where.code}` })) },
      kpiValue: {
        findFirst: jest.fn().mockResolvedValue(opts.existing ? { id: "kv-1", sourceSubmissionItemId: "item-1" } : null),
        update: jest.fn(),
        upsert: jest.fn(),
      },
    };
    return tx;
  }

  it("writes the national totals once nothing is waiting", async () => {
    const tx = build();
    const outcome = await rollupNationalKpis(tx as never, ["q4-2025"], "reviewer-1");
    expect(outcome.published).toEqual(expect.arrayContaining(["M300-P3-001 q4-2025"]));
    const created = tx.kpiValue.upsert.mock.calls.map(([args]) => args.create);
    expect(created.find((entry: { kpiDefinitionId: string }) => entry.kpiDefinitionId === "id-M300-P3-001")?.value).toBe(6966584);
  });

  it("updates an existing national value in place instead of adding a second one", async () => {
    const tx = build({ existing: true });
    await rollupNationalKpis(tx as never, ["q4-2025"], "reviewer-1");
    expect(tx.kpiValue.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "kv-1" }, data: expect.objectContaining({ value: 6966584 }) }),
    );
    expect(tx.submissionItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { value: 6966584 } }));
    expect(tx.kpiValue.upsert).not.toHaveBeenCalled();
  });

  it("holds a KPI back while DisCo rows that feed it are still awaiting review", async () => {
    const tx = build({ waitingDatasets: ["nerc-disco-metering"] });
    const outcome = await rollupNationalKpis(tx as never, ["q4-2025"], "reviewer-1");
    expect(outcome.published).toEqual([]);
    expect(outcome.waiting).toEqual(expect.arrayContaining(["M300-P3-001 q4-2025", "M300-P3-002 q4-2025"]));
    expect(tx.kpiValue.upsert).not.toHaveBeenCalled();
    expect(tx.kpiValue.update).not.toHaveBeenCalled();
  });

  it("does nothing when there is no quarter to work out", async () => {
    const tx = build();
    expect(await rollupNationalKpis(tx as never, [], "reviewer-1")).toEqual({ published: [], waiting: [] });
    expect(tx.institution.findUnique).not.toHaveBeenCalled();
  });
});
