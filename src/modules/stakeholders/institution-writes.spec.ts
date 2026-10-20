import { ConflictException, NotFoundException } from "@nestjs/common";
import { StakeholdersService } from "@/modules/stakeholders/stakeholders.service";

jest.setTimeout(60000);

const EXISTING = [
  { id: "seed-institution-niso-tcn", name: "NISO / TCN", type: "Federal Agency" },
  { id: "seed-institution-rea", name: "Rural Electrification Agency (REA)", type: "Federal Agency" },
];

function build(counts: Record<string, number> = {}) {
  const tx = {
    institution: { update: jest.fn(async ({ data }: { data: object }) => ({ id: "seed-institution-rea", ...data })) },
    kpiDefinition: { updateMany: jest.fn() },
    bottleneck: { updateMany: jest.fn() },
    escalation: { updateMany: jest.fn() },
    programme: {
      updateMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([{ id: "p1", supportingInstitutions: ["Rural Electrification Agency (REA)", "NERC"] }]),
      update: jest.fn(),
    },
    project: { updateMany: jest.fn() },
    milestone: { updateMany: jest.fn() },
    scopeAssignment: { updateMany: jest.fn() },
  };
  const institution = {
    findMany: jest.fn().mockResolvedValue(EXISTING),
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
      const found = EXISTING.find((entry) => entry.id === where.id);
      return found ? { ...found, _count: { users: 0, submissions: 0, dataCustodians: 0, ownedDatasets: 0, obligations: 0, kpiSources: 0, ledProgrammes: 0, ...counts } } : null;
    }),
    create: jest.fn(async ({ data }: { data: object }) => ({ id: "new", ...data })),
    delete: jest.fn(),
  };
  const prisma = { institution, $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };
  return { service: new StakeholdersService(prisma as never), institution, tx };
}

describe("adding an institution", () => {
  it("creates a new one", async () => {
    const { service, institution } = build();
    await service.createInstitution({ name: " Nigerian Bureau Co ", type: "Federal Agency" });
    expect(institution.create).toHaveBeenCalledWith({ data: { name: "Nigerian Bureau Co", type: "Federal Agency" } });
  });

  it.each(["niso / tcn", "NISO/TCN"])("refuses %s as a duplicate of NISO / TCN", async (name) => {
    const { service, institution } = build();
    await expect(service.createInstitution({ name, type: "Federal Agency" })).rejects.toBeInstanceOf(ConflictException);
    expect(institution.create).not.toHaveBeenCalled();
  });

  it("refuses a spelling the alias list resolves to an existing institution", async () => {
    const { service } = build();
    await expect(service.createInstitution({ name: "Rural Electrification Agency", type: "Federal Agency" })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe("editing an institution", () => {
  it("keeps the stored type when the form sends the simplified version of it", async () => {
    const { service, tx } = build();
    await service.updateInstitution("seed-institution-rea", { name: "Rural Electrification Agency (REA)", type: "agency" });
    expect(tx.institution.update.mock.calls[0][0].data).toEqual({});
  });

  it("changes the type when it really changes", async () => {
    const { service, tx } = build();
    await service.updateInstitution("seed-institution-rea", { type: "regulator" });
    expect(tx.institution.update.mock.calls[0][0].data).toEqual({ type: "regulator" });
  });

  it("renames every stored copy of the name in the same transaction", async () => {
    const { service, tx } = build();
    const from = "Rural Electrification Agency (REA)";
    await service.updateInstitution("seed-institution-rea", { name: "Rural Electrification Agency of Nigeria" });
    const to = "Rural Electrification Agency of Nigeria";
    const exact = { equals: from, mode: "insensitive" };
    expect(tx.kpiDefinition.updateMany).toHaveBeenCalledWith({ where: { sourceInstitution: exact }, data: { sourceInstitution: to } });
    expect(tx.bottleneck.updateMany).toHaveBeenCalledWith({ where: { institution: exact }, data: { institution: to } });
    expect(tx.programme.updateMany).toHaveBeenCalledWith({ where: { leadInstitution: exact }, data: { leadInstitution: to } });
    expect(tx.project.updateMany).toHaveBeenCalledWith({ where: { owner: exact }, data: { owner: to } });
    expect(tx.milestone.updateMany).toHaveBeenCalled();
    expect(tx.escalation.updateMany).toHaveBeenCalled();
    expect(tx.scopeAssignment.updateMany).toHaveBeenCalledWith({ where: { level: "INSTITUTION", scope: exact }, data: { scope: to } });
    expect(tx.programme.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { supportingInstitutions: [to, "NERC"] } });
  });

  it("does not touch stored names when only the type changes", async () => {
    const { service, tx } = build();
    await service.updateInstitution("seed-institution-rea", { type: "regulator" });
    expect(tx.kpiDefinition.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a rename onto another institution's name", async () => {
    const { service, tx } = build();
    await expect(service.updateInstitution("seed-institution-rea", { name: "NISO/TCN" })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.institution.update).not.toHaveBeenCalled();
  });

  it("reports an unknown institution", async () => {
    const { service } = build();
    await expect(service.updateInstitution("nope", { name: "Anything Else" })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("removing an institution", () => {
  it("removes one nothing refers to", async () => {
    const { service, institution } = build();
    await service.deleteInstitution("seed-institution-rea");
    expect(institution.delete).toHaveBeenCalledWith({ where: { id: "seed-institution-rea" } });
  });

  it.each(["users", "submissions", "obligations", "ownedDatasets", "kpiSources", "ledProgrammes"])(
    "refuses while it still has %s",
    async (relation) => {
      const { service, institution } = build({ [relation]: 2 });
      await expect(service.deleteInstitution("seed-institution-rea")).rejects.toBeInstanceOf(ConflictException);
      expect(institution.delete).not.toHaveBeenCalled();
    },
  );
});
