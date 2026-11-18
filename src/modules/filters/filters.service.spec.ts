import type { PrismaService } from "@/prisma/prisma.service";
import { FiltersService } from "./filters.service";

function build(periods: string[]) {
  const prisma = {
    pillar: { findMany: jest.fn().mockResolvedValue([]) },
    project: { findMany: jest.fn().mockResolvedValue([]) },
    bottleneck: { findMany: jest.fn().mockResolvedValue([]) },
    kpiValue: { findMany: jest.fn().mockResolvedValue(periods.map((period) => ({ period }))) },
  };
  return new FiltersService(prisma as unknown as PrismaService);
}

describe("FiltersService reporting periods", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-11-18T10:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not offer years that have not started, such as forecast years", async () => {
    const service = build(["2025", "2026", "2027", "2030", "2045", "q3-2026", "q1-2027"]);
    const { reportingPeriods } = await service.getFilters();
    expect(reportingPeriods.map((option) => option.value)).toEqual(["2026", "q3-2026", "2025", "custom"]);
  });

  it("keeps the current year and the quarter in progress", async () => {
    const service = build(["2026", "q4-2026"]);
    const { reportingPeriods } = await service.getFilters();
    expect(reportingPeriods.map((option) => option.value)).toEqual(["2026", "q4-2026", "custom"]);
  });
});
