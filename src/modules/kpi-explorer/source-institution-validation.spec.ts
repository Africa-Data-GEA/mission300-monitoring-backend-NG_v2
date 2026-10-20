import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { KpiExplorerService } from "@/modules/kpi-explorer/kpi-explorer.service";
import type { CreateKpiDto } from "@/modules/kpi-explorer/dto/create-kpi.dto";
import type { UpdateKpiMetadataDto } from "@/modules/kpi-explorer/dto/update-kpi-metadata.dto";

describe("KPI source institution validation", () => {
  const institution = { findFirst: jest.fn() };
  const kpiDefinition = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prisma = {
    institution,
    kpiDefinition,
    pillar: { findUnique: jest.fn().mockResolvedValue({ id: "pillar-1" }) },
    $transaction: jest.fn(),
  };
  const service = new KpiExplorerService(prisma as never);

  const createDto = { id: "NEW-001", pillar: "generation-network", sourceInstitution: "Made Up Agency" } as CreateKpiDto;
  const updateDto = { pillar: "generation-network", sourceInstitution: "Made Up Agency" } as UpdateKpiMetadataDto;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pillar.findUnique.mockResolvedValue({ id: "pillar-1" });
  });

  it("rejects creating a KPI whose source institution is not registered", async () => {
    kpiDefinition.findUnique.mockResolvedValue(null);
    institution.findFirst.mockResolvedValue(null);

    await expect(service.create(createDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(kpiDefinition.create).not.toHaveBeenCalled();
  });

  it("rejects a blank source institution", async () => {
    kpiDefinition.findUnique.mockResolvedValue(null);

    await expect(service.create({ ...createDto, sourceInstitution: "   " })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(institution.findFirst).not.toHaveBeenCalled();
    expect(kpiDefinition.create).not.toHaveBeenCalled();
  });

  it("rejects changing a KPI to an unregistered source institution", async () => {
    kpiDefinition.findUnique.mockResolvedValue({ id: "kpi-1", sourceInstitution: "NERC" });
    institution.findFirst.mockResolvedValue(null);

    await expect(service.updateMetadata("KPI-1", updateDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not re-check a source institution that is unchanged", async () => {
    kpiDefinition.findUnique.mockResolvedValue({ id: "kpi-1", sourceInstitution: "NISO / TCN" });
    prisma.$transaction.mockRejectedValue(new Error("reached the write"));

    await expect(
      service.updateMetadata("KPI-1", { ...updateDto, sourceInstitution: "NISO / TCN" }),
    ).rejects.toThrow("reached the write");
    expect(institution.findFirst).not.toHaveBeenCalled();
  });
});
