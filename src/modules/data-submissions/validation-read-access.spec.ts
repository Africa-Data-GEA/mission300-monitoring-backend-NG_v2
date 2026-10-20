import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { type INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { JwtStrategy } from "@/modules/auth/jwt.strategy";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { RolesGuard } from "@/common/guards/roles.guard";
import { PrismaService } from "@/prisma/prisma.service";
import { DataSubmissionsController } from "@/modules/data-submissions/data-submissions.controller";
import { DataSubmissionsService } from "@/modules/data-submissions/data-submissions.service";

describe("HARD-001 validation read authorization", () => {
  let app: INestApplication;
  const secret = "validation-read-access-test-secret";
  const jwt = new JwtService({ secret });
  const makeUser = (id: string, role: string) => ({
    id,
    role,
    roles: [],
    status: "ACTIVE",
    institutionId: role === "INSTITUTIONAL_DATA_PROVIDER" ? "institution-a" : null,
    tokenVersion: 0,
  });
  const users: Record<string, object> = {
    provider: makeUser("provider", "INSTITUTIONAL_DATA_PROVIDER"),
    reader: makeUser("reader", "READ_ONLY_USER"),
    reviewer: makeUser("reviewer", "DATA_REVIEWER"),
    validator: makeUser("validator", "VALIDATOR"),
    admin: makeUser("admin", "SYSTEM_ADMINISTRATOR"),
  };
  const service = {
    getValidationQueue: jest.fn().mockResolvedValue({ items: [] }),
    getSubmissionDetail: jest.fn().mockResolvedValue({ id: "submission-a" }),
  };
  const token = (id: string) => jwt.sign({ sub: id, tokenVersion: 0 });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DataSubmissionsController],
      providers: [
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET: secret }) },
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn(async ({ where }) => users[where.id] ?? null) } },
        },
        { provide: DataSubmissionsService, useValue: service },
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  it.each(["provider", "reader"])("%s gets 403 on the validation queue and detail", async (who) => {
    await request(app.getHttpServer())
      .get("/data-submissions/validation")
      .set("Authorization", `Bearer ${token(who)}`)
      .expect(403);
    await request(app.getHttpServer())
      .get("/data-submissions/validation/submission-a")
      .set("Authorization", `Bearer ${token(who)}`)
      .expect(403);
    expect(service.getValidationQueue).not.toHaveBeenCalled();
    expect(service.getSubmissionDetail).not.toHaveBeenCalled();
  });

  it.each(["reviewer", "validator", "admin"])("%s can read the validation queue and detail", async (who) => {
    await request(app.getHttpServer())
      .get("/data-submissions/validation")
      .set("Authorization", `Bearer ${token(who)}`)
      .expect(200);
    await request(app.getHttpServer())
      .get("/data-submissions/validation/submission-a")
      .set("Authorization", `Bearer ${token(who)}`)
      .expect(200);
  });

  it("rejects unauthenticated reads", async () => {
    await request(app.getHttpServer()).get("/data-submissions/validation").expect(401);
  });
});
