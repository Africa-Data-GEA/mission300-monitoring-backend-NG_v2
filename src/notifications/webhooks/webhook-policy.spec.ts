import { createHmac } from "node:crypto";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "@/prisma/prisma.service";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { WebhooksService } from "./webhooks.service";
import { postWebhook } from "./webhook-transport";
import { assertWebhookAdministrator, assertWebhookPatterns, publicWebhookPayload } from "./webhook-policy";

jest.mock("./ssrf-guard", () => ({
  assertPublicWebhookUrl: jest.fn().mockResolvedValue(undefined),
  WebhookUrlBlockedError: class extends Error {},
}));
jest.mock("./webhook-transport", () => ({ postWebhook: jest.fn() }));
const sendWebhook = jest.mocked(postWebhook);

const admin = {
  id: "admin",
  role: "SYSTEM_ADMINISTRATOR",
  roles: [],
  status: "ACTIVE",
  institutionId: null,
} as const;
const user = (role: AuthenticatedUser["role"]): AuthenticatedUser => ({
  id: "user",
  role,
  institutionId: "institution-a",
});

describe("Webhook integration permissions and payloads", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    sendWebhook.mockReset();
  });

  it.each([
    "READ_ONLY_USER",
    "INSTITUTIONAL_DATA_PROVIDER",
    "DATA_REVIEWER",
    "VALIDATOR",
    "OVERSIGHT_USER",
    "DASHBOARD_MANAGER",
  ] as const)("rejects %s in the service before storing or reading subscriptions", async (role) => {
    const create = jest.fn();
    const findMany = jest.fn();
    const service = new WebhooksService({
      webhookSubscription: { create, findMany },
    } as unknown as PrismaService);
    await expect(
      service.create(user(role), { url: "https://receiver.example.test", events: ["submission.*"] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => service.listForUser(user(role))).toThrow(ForbiddenException);
    await expect(service.remove(user(role), "subscription")).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("uses the effective role list and permits an administrator secondary role", () => {
    expect(() =>
      assertWebhookAdministrator({
        ...user("READ_ONLY_USER"),
        roles: ["READ_ONLY_USER", "SYSTEM_ADMINISTRATOR"],
      }),
    ).not.toThrow();
    expect(() => assertWebhookAdministrator({ ...admin, roles: ["READ_ONLY_USER"] })).toThrow(
      ForbiddenException,
    );
  });

  it.each(
    [[], ["*"], ["auth.*"], ["submission.unknown"], Array(9).fill("submission.*")].map((patterns) => ({
      patterns,
    })),
  )("rejects unapproved event patterns %j", ({ patterns }) => {
    expect(() => assertWebhookPatterns(patterns)).toThrow(BadRequestException);
  });

  it("omits credentials and future fields from approved events and suppresses unknown events", () => {
    expect(
      publicWebhookPayload("user.invited", {
        userId: "user",
        email: "user@example.test",
        password: "secret",
        token: "secret",
        resetUrl: "private",
        institution: { secret: true },
      }),
    ).toEqual({ userId: "user", email: "user@example.test" });
    expect(publicWebhookPayload("auth.password_reset", { token: "secret" })).toBeNull();
    expect(publicWebhookPayload("report.ready", null)).toBeNull();
  });

  it("does not deliver for a suspended or demoted subscription owner", async () => {
    const subscription = {
      id: "subscription",
      url: "https://receiver.example.test",
      secret: "fixture",
      events: ["submission.*"],
    };
    const findMany = jest.fn().mockResolvedValue([
      { ...subscription, owner: { ...admin, status: "SUSPENDED" } },
      { ...subscription, owner: { ...admin, roles: ["READ_ONLY_USER"] } },
    ]);
    const service = new WebhooksService({ webhookSubscription: { findMany } } as unknown as PrismaService);
    await service.dispatch("submission.uploaded", { submissionId: "record", institutionId: "institution-a" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          owner: expect.objectContaining({ status: "ACTIVE" }),
        }),
      }),
    );
    expect(sendWebhook).not.toHaveBeenCalled();
  });

  it("signs and records only the approved fields for an active administrator", async () => {
    sendWebhook.mockResolvedValue(200);
    const create = jest.fn().mockResolvedValue({});
    const service = new WebhooksService({
      webhookSubscription: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "subscription",
            url: "https://receiver.example.test",
            secret: "fixture",
            events: ["submission.*"],
            owner: admin,
          },
        ]),
      },
      webhookDelivery: { create },
    } as unknown as PrismaService);
    await service.dispatch("submission.uploaded", {
      submissionId: "record",
      institutionId: "institution-a",
      token: "secret",
    });
    expect(sendWebhook).toHaveBeenCalledTimes(1);
    const [, body, signature] = sendWebhook.mock.calls[0]!;
    expect(JSON.parse(body).payload).toEqual({
      submissionId: "record",
      institutionId: "institution-a",
    });
    expect(signature).toBe(createHmac("sha256", "fixture").update(body).digest("hex"));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: { submissionId: "record", institutionId: "institution-a" },
        }),
      }),
    );
  });
});
