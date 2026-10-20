import { BadRequestException } from "@nestjs/common";
import { UsersService } from "@/modules/administration/users/users.service";

jest.setTimeout(60000);

const savedUser = (overrides: object = {}) => ({
  id: "u1",
  fullName: "Reviewer",
  email: "r@example.gov.ng",
  designation: "Officer",
  institution: null,
  role: "DATA_REVIEWER",
  roles: ["DATA_REVIEWER"],
  status: "ACTIVE",
  reviewsAllInstitutions: false,
  lastLogin: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

function build(existing: object | null = null) {
  const create = jest.fn(async ({ data }: { data: object }) => savedUser(data));
  const update = jest.fn(async ({ data }: { data: object }) => savedUser(data));
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(existing), create, update },
    institution: {
      findFirst: jest.fn().mockResolvedValue({ id: "inst-rea", name: "Rural Electrification Agency (REA)" }),
      create: jest.fn(),
    },
  };
  const rabbit = { publish: jest.fn() };
  return { service: new UsersService(prisma as never, rabbit as never), create, update, prisma };
}

const invite = (extra: object) => ({ name: "Reviewer", email: "r@example.gov.ng", designation: "Officer", roles: ["DATA_REVIEWER"], ...extra }) as never;

describe("inviting a reviewer", () => {
  it("stores an institution reviewer with their institution and no wide scope", async () => {
    const { service, create } = build();
    await service.invite(invite({ institution: "Rural Electrification Agency (REA)" }));
    expect(create.mock.calls[0][0].data).toMatchObject({ institutionId: "inst-rea", reviewsAllInstitutions: false });
  });

  it("stores a platform-wide reviewer with no institution", async () => {
    const { service, create } = build();
    await service.invite(invite({ reviewsAllInstitutions: true }));
    expect(create.mock.calls[0][0].data).toMatchObject({ institutionId: null, reviewsAllInstitutions: true });
  });

  it("refuses a reviewer with no institution and no wide scope", async () => {
    const { service, create } = build();
    await expect(service.invite(invite({ institution: "" }))).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses both together", async () => {
    const { service } = build();
    await expect(service.invite(invite({ institution: "REA", reviewsAllInstitutions: true }))).rejects.toThrow(/not both/);
  });

  it("refuses wide scope for a data provider", async () => {
    const { service } = build();
    await expect(
      service.invite(invite({ roles: ["INSTITUTIONAL_DATA_PROVIDER"], reviewsAllInstitutions: true })),
    ).rejects.toThrow(/Only a Data Reviewer/);
  });
});

describe("changing a reviewer's institution or roles", () => {
  const reviewer = { id: "u1", role: "DATA_REVIEWER", roles: ["DATA_REVIEWER"], institutionId: null, reviewsAllInstitutions: true };

  it("clears the wide scope when an institution is assigned", async () => {
    const { service, update } = build(reviewer);
    await service.updateInstitution("u1", "Rural Electrification Agency (REA)");
    expect(update.mock.calls[0][0].data).toEqual({ institutionId: "inst-rea", reviewsAllInstitutions: false });
  });

  it("will not turn a platform-wide reviewer into a provider without choosing an institution", async () => {
    const { service } = build(reviewer);
    await expect(service.updateRoles("u1", ["INSTITUTIONAL_DATA_PROVIDER"] as never)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("editing a user's roles and institution together", () => {
  const user = { id: "u1", role: "DATA_REVIEWER", roles: ["DATA_REVIEWER"], institutionId: null, reviewsAllInstitutions: true };

  it("turns a platform-wide reviewer into a provider in one step", async () => {
    const { service, update } = build(user);
    await service.updateAccess("u1", { roles: ["INSTITUTIONAL_DATA_PROVIDER"] as never, institution: "Rural Electrification Agency (REA)" });
    expect(update.mock.calls[0][0].data).toMatchObject({
      role: "INSTITUTIONAL_DATA_PROVIDER",
      roles: ["INSTITUTIONAL_DATA_PROVIDER"],
      institutionId: "inst-rea",
      reviewsAllInstitutions: false,
    });
  });

  it("turns a provider into a platform-wide reviewer in one step", async () => {
    const { service, update } = build({ ...user, role: "INSTITUTIONAL_DATA_PROVIDER", roles: ["INSTITUTIONAL_DATA_PROVIDER"], institutionId: "inst-rea", reviewsAllInstitutions: false });
    await service.updateAccess("u1", { roles: ["DATA_REVIEWER"] as never, reviewsAllInstitutions: true });
    expect(update.mock.calls[0][0].data).toMatchObject({ institutionId: null, reviewsAllInstitutions: true });
  });

  it("refuses a final state that is not allowed, saving nothing", async () => {
    const { service, update } = build(user);
    await expect(service.updateAccess("u1", { roles: ["INSTITUTIONAL_DATA_PROVIDER"] as never })).rejects.toThrow(/data provider needs an institution/);
    await expect(service.updateAccess("u1", { roles: ["DATA_REVIEWER"] as never })).rejects.toThrow(/needs an institution/);
    expect(update).not.toHaveBeenCalled();
  });

  it("reports an unknown user", async () => {
    const { service } = build(null);
    await expect(service.updateAccess("nope", { roles: ["DATA_REVIEWER"] as never, reviewsAllInstitutions: true })).rejects.toThrow(/not found/);
  });
});

describe("editing a user's name, email and designation", () => {
  const user = { id: "u1", email: "old@example.gov.ng", role: "DATA_REVIEWER", roles: ["DATA_REVIEWER"], institutionId: null, reviewsAllInstitutions: true };

  it("saves the profile fields along with access", async () => {
    const { service, update } = build(user);
    await service.updateAccess("u1", {
      name: " New Name ",
      designation: "Lead Reviewer",
      roles: ["DATA_REVIEWER"] as never,
      reviewsAllInstitutions: true,
    });
    expect(update.mock.calls[0][0].data).toMatchObject({ fullName: "New Name", designation: "Lead Reviewer" });
  });

  it("changes the email and signs the user out so the old one stops working", async () => {
    const { service, update, prisma } = build(user);
    (prisma.user as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue(null);
    await service.updateAccess("u1", { email: "new@example.gov.ng", roles: ["DATA_REVIEWER"] as never, reviewsAllInstitutions: true });
    const data = update.mock.calls[0][0].data as { email: string; tokenVersion: unknown };
    expect(data.email).toBe("new@example.gov.ng");
    expect(data.tokenVersion).toEqual({ increment: 1 });
  });

  it("refuses an email another account already uses", async () => {
    const { service, update, prisma } = build(user);
    (prisma.user as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue({ id: "other" });
    await expect(
      service.updateAccess("u1", { email: "taken@example.gov.ng", roles: ["DATA_REVIEWER"] as never, reviewsAllInstitutions: true }),
    ).rejects.toThrow(/already exists/);
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves the email alone when only its capitalisation changes", async () => {
    const { service, update } = build(user);
    await service.updateAccess("u1", { email: "OLD@example.gov.ng", roles: ["DATA_REVIEWER"] as never, reviewsAllInstitutions: true });
    expect(update.mock.calls[0][0].data).not.toHaveProperty("email");
  });
});
