import { BadRequestException } from "@nestjs/common";
import { KpiExplorerService } from "@/modules/kpi-explorer/kpi-explorer.service";

jest.setTimeout(60000);

function build(registered: string[]) {
  const kpiCreate = jest.fn();
  const prisma = {
    kpiDefinition: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: kpiCreate,
    },
    pillar: { findUnique: jest.fn().mockResolvedValue({ id: "p1" }) },
    institution: {
      findFirst: jest.fn(async ({ where }: { where: { name: { equals: string } } }) =>
        registered.find((name) => name.toLowerCase() === where.name.equals.toLowerCase()) ? { id: "i1" } : null,
      ),
    },
  };
  const service = new KpiExplorerService(prisma as never);
  return { service, kpiCreate };
}

const dto = (sourceInstitution: string) =>
  ({
    id: "M300-ZZ-001",
    name: "Probe",
    pillar: "generation-and-network",
    category: "Outcome",
    unit: "%",
    definition: "d",
    formula: "f",
    frequency: "Annual",
    sourceInstitution,
    sourceDataset: "s",
    readiness: "SUPPORTING",
  }) as never;

describe("a KPI's responsible institution must be a registered one (STK-002)", () => {
  it("refuses a misspelled institution and creates nothing", async () => {
    const { service, kpiCreate } = build(["Transmission Company of Nigeria"]);
    await expect(service.create(dto("Transmision Company of Nigeria"))).rejects.toBeInstanceOf(BadRequestException);
    expect(kpiCreate).not.toHaveBeenCalled();
  });

  it("refuses an empty institution", async () => {
    const { service } = build(["Transmission Company of Nigeria"]);
    await expect(service.create(dto("   "))).rejects.toThrow(/not a registered institution/);
  });

  it("names the value it could not find", async () => {
    const { service } = build([]);
    await expect(service.create(dto("Nowhere Ltd"))).rejects.toThrow('"Nowhere Ltd" is not a registered institution');
  });
});
