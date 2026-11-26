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
import { ProgramsController } from "@/modules/programs/programs.controller";
import { ProgramsService } from "@/modules/programs/programs.service";
import { BottlenecksController } from "@/modules/bottlenecks/bottlenecks.controller";
import { BottlenecksService } from "@/modules/bottlenecks/bottlenecks.service";
import { ReportsController } from "@/modules/reports/reports.controller";
import { ReportsService } from "@/modules/reports/reports.service";
import { CompactWorksheetTemplateService } from "@/modules/reports/compact-worksheet-template.service";
import { AuthController } from "@/modules/auth/auth.controller";
import { AuthService } from "@/modules/auth/auth.service";
import { WebhooksController } from "@/notifications/webhooks/webhooks.controller";
import { WebhooksService } from "@/notifications/webhooks/webhooks.service";

// Real controllers, DTO validation, JWT verification and global guards;
// mutation services are stubbed so no app records can be touched.
describe("HTTP security audit (isolated app, no database)", () => {
  let app: INestApplication;
  const jwt = new JwtService({ secret: "audit-only-secret-not-used-by-any-deployment" });
  const users: Record<string, object> = {
    reader: {
      id: "reader",
      role: "READ_ONLY_USER",
      roles: [],
      status: "ACTIVE",
      institutionId: "institution-a",
      tokenVersion: 0,
    },
    manager: {
      id: "manager",
      role: "DASHBOARD_MANAGER",
      roles: [],
      status: "ACTIVE",
      institutionId: null,
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
    suspended: {
      id: "suspended",
      role: "SYSTEM_ADMINISTRATOR",
      roles: [],
      status: "SUSPENDED",
      institutionId: null,
      tokenVersion: 0,
    },
  };
  const writes = {
    deleteProject: jest.fn().mockResolvedValue({ deleted: true }),
    createProgramme: jest.fn().mockResolvedValue({ id: "audit-programme" }),
    updateStatus: jest.fn().mockResolvedValue({ updated: true }),
    delete: jest.fn().mockResolvedValue(undefined),
    deleteSaved: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue({ id: "subscription" }),
  };
  const token = (id = "reader", extra: object = {}) => jwt.sign({ sub: id, tokenVersion: 0, ...extra });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ name: "default", ttl: 60000, limit: 100 }])],
      controllers: [
        ProgramsController,
        BottlenecksController,
        ReportsController,
        AuthController,
        WebhooksController,
      ],
      providers: [
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_SECRET: "audit-only-secret-not-used-by-any-deployment" }),
        },
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn(async ({ where }) => users[where.id] ?? null) } },
        },
        { provide: ProgramsService, useValue: writes },
        { provide: BottlenecksService, useValue: writes },
        { provide: ReportsService, useValue: writes },
        { provide: CompactWorksheetTemplateService, useValue: writes },
        { provide: AuthService, useValue: { identify: jest.fn(async ({ email }) => ({ email })) } },
        { provide: WebhooksService, useValue: writes },
        JwtStrategy,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => app?.close());

  it.each([
    ["missing JWT", undefined],
    ["malformed JWT", "invalid"],
    [
      "wrong signing key",
      new JwtService({ secret: "wrong-signing-key" }).sign({ sub: "reader", tokenVersion: 0 }),
    ],
    ["expired JWT", token("reader", { exp: 1 })],
    ["revoked JWT version", token("reader", { tokenVersion: 99 })],
    ["inactive user", token("suspended")],
    ["deleted user", token("missing-user")],
  ])("CONTROL rejects %s before a project mutation", async (_label, credential) => {
    const call = request(app.getHttpServer()).delete("/programs/projects/other-institution-project");
    if (credential) call.set("Authorization", `Bearer ${credential}`);
    await call.expect(401);
  });

  it("CONTROL prevents a reader from deleting a bottleneck", async () => {
    await request(app.getHttpServer())
      .delete("/bottlenecks/issue-a")
      .set("Authorization", `Bearer ${token()}`)
      .expect(403);
    expect(writes.delete).not.toHaveBeenCalled();
  });

  it("[F01 fixed] a read-only user cannot delete a priority project", async () => {
    await request(app.getHttpServer())
      .delete("/programs/projects/other-institution-project")
      .set("Authorization", `Bearer ${token()}`)
      .expect(403);
    expect(writes.deleteProject).not.toHaveBeenCalled();
  });

  it("[F01 fixed] a read-only user cannot create a programme", async () => {
    await request(app.getHttpServer())
      .post("/programs")
      .set("Authorization", `Bearer ${token()}`)
      .send({
        name: "Audit programme",
        leadInstitution: "Other institution",
        pillar: "last-mile-access",
        objectives: "Security audit fixture",
        status: "on-track",
        endDate: "2030-01-01",
      })
      .expect(403);
    expect(writes.createProgramme).not.toHaveBeenCalled();
  });

  it("[F01 fixed] a read-only user cannot resolve another issue", async () => {
    await request(app.getHttpServer())
      .patch("/bottlenecks/other-institution-issue")
      .set("Authorization", `Bearer ${token()}`)
      .send({ status: "resolved" })
      .expect(403);
    expect(writes.updateStatus).not.toHaveBeenCalled();
  });

  it("[F03 fixed] a reader cannot delete a saved report", async () => {
    await request(app.getHttpServer())
      .delete("/reports/saved/another-users-report")
      .set("Authorization", `Bearer ${token()}`)
      .expect(403);
    expect(writes.deleteSaved).not.toHaveBeenCalled();
  });

  it("CONTROL rejects mass-assignment fields in DTOs", async () => {
    await request(app.getHttpServer())
      .patch("/bottlenecks/issue-a")
      .set("Authorization", `Bearer ${token("manager")}`)
      .send({ status: "resolved", role: "SYSTEM_ADMINISTRATOR" })
      .expect(400);
  });

  it("[F01/F03 fixed] dashboard managers retain project, issue and shared report management", async () => {
    await request(app.getHttpServer())
      .delete("/programs/projects/project-a")
      .set("Authorization", `Bearer ${token("manager")}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch("/bottlenecks/issue-a")
      .set("Authorization", `Bearer ${token("manager")}`)
      .send({ status: "resolved" })
      .expect(200);
    await request(app.getHttpServer())
      .delete("/reports/saved/report-a")
      .set("Authorization", `Bearer ${token("manager")}`)
      .expect(204);
  });

  it("[F07 fixed] readers cannot create, list or remove webhook subscriptions", async () => {
    await request(app.getHttpServer())
      .post("/webhooks")
      .set("Authorization", `Bearer ${token()}`)
      .send({ url: "https://receiver.example.test", events: ["submission.*"] })
      .expect(403);
    await request(app.getHttpServer()).get("/webhooks").set("Authorization", `Bearer ${token()}`).expect(403);
    await request(app.getHttpServer())
      .delete("/webhooks/subscription")
      .set("Authorization", `Bearer ${token()}`)
      .expect(403);
    expect(writes.create).not.toHaveBeenCalled();
  });

  it("[F07 fixed] administrators can create approved subscriptions but not arbitrary patterns", async () => {
    await request(app.getHttpServer())
      .post("/webhooks")
      .set("Authorization", `Bearer ${token("admin")}`)
      .send({ url: "https://receiver.example.test", events: ["auth.*"] })
      .expect(400);
    await request(app.getHttpServer())
      .post("/webhooks")
      .set("Authorization", `Bearer ${token("admin")}`)
      .send({ url: "https://receiver.example.test", events: ["submission.*"] })
      .expect(201);
  });

  it("CONTROL throttles identify at its route-specific limit", async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post("/auth/identify")
        .send({ email: "audit@example.com" })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post("/auth/identify")
      .send({ email: "audit@example.com" })
      .expect(429);
  });
});
