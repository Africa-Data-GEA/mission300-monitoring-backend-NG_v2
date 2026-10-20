import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import { JwtStrategy } from "@/modules/auth/jwt.strategy";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { RolesGuard } from "@/common/guards/roles.guard";
import { PrismaService } from "@/prisma/prisma.service";
import { StakeholdersController } from "@/modules/stakeholders/stakeholders.controller";
import { StakeholdersService } from "@/modules/stakeholders/stakeholders.service";

const SECRET = "audit-only-secret-not-used-by-any-deployment";

describe("Accountability write endpoints (isolated app, no database)", () => {
  let app: INestApplication;
  const jwt = new JwtService({ secret: SECRET });

  const users: Record<string, object> = {
    reader: {
      id: "reader",
      role: "READ_ONLY_USER",
      roles: [],
      status: "ACTIVE",
      institutionId: "institution-a",
      tokenVersion: 0,
    },
    provider: {
      id: "provider",
      role: "INSTITUTIONAL_DATA_PROVIDER",
      roles: [],
      status: "ACTIVE",
      institutionId: "institution-a",
      tokenVersion: 0,
    },
    admin: {
      id: "admin",
      role: "SYSTEM_ADMINISTRATOR",
      roles: [],
      status: "ACTIVE",
      institutionId: null,
      tokenVersion: 0,
    },
  };

  const stakeholders = {
    createInstitution: jest.fn().mockResolvedValue({ institution: { id: "institution-b" }, message: "ok" }),
    updateInstitution: jest.fn().mockResolvedValue({ institution: { id: "institution-b" }, message: "ok" }),
    deleteInstitution: jest.fn().mockResolvedValue({ message: "ok" }),
    createDataCustodian: jest.fn().mockResolvedValue({ custodian: { id: "cust-1" }, message: "ok" }),
    updateDataCustodian: jest.fn().mockResolvedValue({ custodian: { id: "cust-1" }, message: "ok" }),
    deleteDataCustodian: jest.fn().mockResolvedValue({ message: "ok" }),
  };

  const token = (id: string) => jwt.sign({ sub: id, tokenVersion: 0 });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ name: "default", ttl: 60000, limit: 200 }])],
      controllers: [StakeholdersController],
      providers: [
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET: SECRET }) },
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn(async ({ where }) => users[where.id] ?? null) } },
        },
        { provide: StakeholdersService, useValue: stakeholders },
        JwtStrategy,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  const validCustodian = {
    institutionId: "institution-a",
    contactName: "Reported Name",
    contactEmail: "custodian@example.gov.ng",
    scope: "DisCo metering returns",
  };

  const validInstitution = { name: "Nigerian Bulk Electricity Trading", type: "Federal Agency" };

  it("prevents a read-only user from adding an institution", async () => {
    await request(app.getHttpServer())
      .post("/stakeholders/institutions")
      .set("Authorization", `Bearer ${token("reader")}`)
      .send(validInstitution)
      .expect(403);
    expect(stakeholders.createInstitution).not.toHaveBeenCalled();
  });

  it("lets an administrator add, edit, and remove an institution", async () => {
    const authorization = { Authorization: `Bearer ${token("admin")}` };
    await request(app.getHttpServer())
      .post("/stakeholders/institutions")
      .set(authorization)
      .send(validInstitution)
      .expect(201);
    await request(app.getHttpServer())
      .patch("/stakeholders/institutions/institution-b")
      .set(authorization)
      .send({ name: "NBET" })
      .expect(200);
    await request(app.getHttpServer())
      .delete("/stakeholders/institutions/institution-b")
      .set(authorization)
      .expect(200);

    expect(stakeholders.createInstitution).toHaveBeenCalledWith(validInstitution);
    expect(stakeholders.updateInstitution).toHaveBeenCalledWith("institution-b", { name: "NBET" });
    expect(stakeholders.deleteInstitution).toHaveBeenCalledWith("institution-b");
  });

  it("rejects an unauthenticated attempt to add a data custodian", async () => {
    await request(app.getHttpServer())
      .post("/stakeholders/data-custodians")
      .send(validCustodian)
      .expect(401);
    expect(stakeholders.createDataCustodian).not.toHaveBeenCalled();
  });

  it.each([
    ["a read-only user", "reader"],
    ["an institutional data provider", "provider"],
  ])("prevents %s from adding a data custodian", async (_label, userId) => {
    await request(app.getHttpServer())
      .post("/stakeholders/data-custodians")
      .set("Authorization", `Bearer ${token(userId)}`)
      .send(validCustodian)
      .expect(403);
    expect(stakeholders.createDataCustodian).not.toHaveBeenCalled();
  });

  it("lets an administrator add a data custodian", async () => {
    await request(app.getHttpServer())
      .post("/stakeholders/data-custodians")
      .set("Authorization", `Bearer ${token("admin")}`)
      .send(validCustodian)
      .expect(201);
    expect(stakeholders.createDataCustodian).toHaveBeenCalledWith(validCustodian);
  });

  it("rejects a custodian with a malformed contact email", async () => {
    await request(app.getHttpServer())
      .post("/stakeholders/data-custodians")
      .set("Authorization", `Bearer ${token("admin")}`)
      .send({ ...validCustodian, contactEmail: "not-an-email" })
      .expect(400);
    expect(stakeholders.createDataCustodian).not.toHaveBeenCalled();
  });

  it("rejects a custodian with no scope recorded", async () => {
    const { scope, ...withoutScope } = validCustodian;
    void scope;
    await request(app.getHttpServer())
      .post("/stakeholders/data-custodians")
      .set("Authorization", `Bearer ${token("admin")}`)
      .send(withoutScope)
      .expect(400);
    expect(stakeholders.createDataCustodian).not.toHaveBeenCalled();
  });

  it("prevents a read-only user from removing a data custodian", async () => {
    await request(app.getHttpServer())
      .delete("/stakeholders/data-custodians/cust-1")
      .set("Authorization", `Bearer ${token("reader")}`)
      .expect(403);
    expect(stakeholders.deleteDataCustodian).not.toHaveBeenCalled();
  });

  it("lets an administrator remove a data custodian", async () => {
    await request(app.getHttpServer())
      .delete("/stakeholders/data-custodians/cust-1")
      .set("Authorization", `Bearer ${token("admin")}`)
      .expect(200);
    expect(stakeholders.deleteDataCustodian).toHaveBeenCalledWith("cust-1");
  });
});
