import "reflect-metadata";
import { StateDiscoService } from "@/modules/state-disco/state-disco.service";

type FakeRecord = {
  institutionId: string;
  period: string;
  activeCustomers: number;
  meteredCustomers: number;
  energyReceivedMwh: number;
  energyBilledMwh: number;
  revenueBilledNgn: number;
  revenueCollectedNgn: number;
  remittanceObligationNgn: number;
  remittanceActualNgn: number;
  atccLossRatePercent: number;
  allowedLossRatePercent: number | null;
  validationStatus: string;
  institution: { id: string; name: string };
};

const institution = { id: "disco-a", name: "Abuja Electricity Distribution Company" };

function record(period: string, overrides: Partial<FakeRecord> = {}): FakeRecord {
  return {
    institutionId: institution.id,
    period,
    activeCustomers: 1000,
    meteredCustomers: 500,
    energyReceivedMwh: 100,
    energyBilledMwh: 80,
    revenueBilledNgn: 200,
    revenueCollectedNgn: 150,
    remittanceObligationNgn: 100,
    remittanceActualNgn: 90,
    atccLossRatePercent: 40,
    allowedLossRatePercent: null,
    validationStatus: "VALIDATED",
    institution,
    ...overrides,
  };
}

function matches(row: FakeRecord, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key as keyof FakeRecord];
    if (condition && typeof condition === "object") {
      const c = condition as { gt?: number; in?: unknown[] };
      if (c.gt !== undefined) return Number(value) > c.gt;
      if (c.in !== undefined) return c.in.includes(value);
    }
    return value === condition;
  });
}

function makeService(records: FakeRecord[]) {
  const prisma = {
    discoPerformanceRecord: {
      findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        records.filter((row) => matches(row, where)),
      ),
    },
    institution: { findUnique: jest.fn(async () => institution) },
  };
  return new StateDiscoService(prisma as never);
}

const remittanceCard = async (service: StateDiscoService, reportingPeriod?: string) => {
  const overview = await service.getOverview({ reportingPeriod } as never);
  return overview.metrics.find((metric) => metric.id === "market-remittance")!;
};

describe("market-remittance card", () => {
  it("uses the latest quarter that has remittance data when the newest quarter has none", async () => {
    const service = makeService([
      record("q4-2025", { remittanceObligationNgn: 100, remittanceActualNgn: 80 }),
      record("q1-2026", { remittanceObligationNgn: 100, remittanceActualNgn: 95 }),
      record("q2-2026", { remittanceObligationNgn: 0, remittanceActualNgn: 0 }),
    ]);

    const card = await remittanceCard(service);

    expect(card.value).toBe("95.0%");
    expect(card.supportingLabel).toContain("(Q1 2026)");
    expect(card.trend.change).toBe(15);
  });

  it("shows no variance or trend when no quarter has remittance data", async () => {
    const service = makeService([record("q2-2026", { remittanceObligationNgn: 0, remittanceActualNgn: 0 })]);

    const card = await remittanceCard(service);

    expect(card.value).toBe("Not reported");
    expect(card.varianceLabel).not.toContain("pts");
    expect(card.trend.change).toBe(0);
    expect(card.trend.label).toBe("No remittance data to compare");
  });

  it("does not borrow another quarter when a specific period is selected", async () => {
    const service = makeService([
      record("q1-2026", { remittanceObligationNgn: 100, remittanceActualNgn: 95 }),
      record("q2-2026", { remittanceObligationNgn: 0, remittanceActualNgn: 0 }),
    ]);

    expect((await remittanceCard(service, "q2-2026")).value).toBe("Not reported");
    expect((await remittanceCard(service, "q1-2026")).value).toBe("95.0%");
  });
});

describe("performance trends", () => {
  it("returns one point per quarter in time order, with null where a metric has no data", async () => {
    const service = makeService([
      record("q2-2026", { remittanceObligationNgn: 0, remittanceActualNgn: 0 }),
      record("q4-2025", { activeCustomers: 0, meteredCustomers: 0 }),
      record("q1-2026"),
    ]);

    const trends = await service.getTrends({} as never);

    expect(trends.points.map((point) => point.label)).toEqual(["Q4 2025", "Q1 2026", "Q2 2026"]);
    expect(trends.points[0].meteringRate).toBeNull();
    expect(trends.points[1]).toMatchObject({
      meteringRate: 50,
      collectionEfficiency: 75,
      remittancePerformance: 90,
      atccLossRate: 40,
    });
    expect(trends.points[2].remittancePerformance).toBeNull();
  });
});
