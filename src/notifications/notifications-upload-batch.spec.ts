import type { PrismaService } from "@/prisma/prisma.service";
import type { RabbitmqService } from "@/events/rabbitmq.service";
import type { EmailService } from "@/notifications/email/email.service";
import type { WebhooksService } from "@/notifications/webhooks/webhooks.service";
import type { AuthService } from "@/modules/auth/auth.service";
import type { BrandingService } from "@/modules/administration/branding/branding.service";
import type { NotificationsFeedService } from "@/notifications/feed/notifications-feed.service";
import { NotificationsConsumer } from "./notifications.consumer";

type UploadPayload = { submissionId: string; batchSize?: number; batchIndex?: number };

function build() {
  const prisma = {
    submission: {
      findUnique: jest.fn().mockResolvedValue({
        id: "s1",
        institutionId: "inst-abuja",
        institution: { name: "Abuja Electricity Distribution Company" },
        submittedBy: { id: "u-nerc", email: "nerc@example.org", fullName: "NERC Provider" },
        obligation: { reportingPeriod: "October 2026", dataset: { name: "DisCo Revenue Billed" } },
      }),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: "r1", email: "reviewer1@example.org" },
        { id: "r2", email: "reviewer2@example.org" },
      ]),
    },
  };
  const email = { send: jest.fn().mockResolvedValue({ sent: true }) };
  const feed = { create: jest.fn().mockResolvedValue(undefined), createMany: jest.fn().mockResolvedValue(undefined) };
  const branding = {
    get: jest.fn().mockResolvedValue({ primaryColor: "#005380", secondaryColor: "#FFB400", logoUrl: "", countryName: "Nigeria", officialName: "Nigeria" }),
  };
  const consumer = new NotificationsConsumer(
    {} as RabbitmqService,
    prisma as unknown as PrismaService,
    email as unknown as EmailService,
    {} as WebhooksService,
    {} as AuthService,
    branding as unknown as BrandingService,
    feed as unknown as NotificationsFeedService,
  );
  const notify = (payload: UploadPayload) =>
    (consumer as unknown as { notifySubmissionUploaded: (payload: UploadPayload) => Promise<void> }).notifySubmissionUploaded(payload);
  return { prisma, email, feed, notify };
}

describe("upload notifications", () => {
  it("notifies per submission when an upload created only one", async () => {
    const { email, feed, notify } = build();
    await notify({ submissionId: "s1" });
    expect(email.send).toHaveBeenCalledTimes(3);
    expect(feed.createMany).toHaveBeenCalledWith(
      ["r1", "r2"],
      "Submission awaiting review",
      "Abuja Electricity Distribution Company submitted DisCo Revenue Billed (October 2026).",
      "/data-submissions/validation/s1",
    );
  });

  it("sends nothing for the later submissions of a multi-row upload", async () => {
    const { prisma, email, feed, notify } = build();
    await notify({ submissionId: "s2", batchSize: 12, batchIndex: 5 });
    expect(prisma.submission.findUnique).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
    expect(feed.create).not.toHaveBeenCalled();
    expect(feed.createMany).not.toHaveBeenCalled();
  });

  it("sends one summary for the whole upload, pointing reviewers at the queue", async () => {
    const { email, feed, notify } = build();
    await notify({ submissionId: "s1", batchSize: 12, batchIndex: 0 });
    expect(email.send).toHaveBeenCalledTimes(3);
    expect(feed.create).toHaveBeenCalledWith(
      "u-nerc",
      "Submission received",
      "DisCo Revenue Billed (12 submissions in this upload) was submitted for review.",
      "/data-submissions/submissions",
    );
    expect(feed.createMany).toHaveBeenCalledWith(
      ["r1", "r2"],
      "Submission awaiting review",
      "NERC Provider submitted DisCo Revenue Billed (12 submissions in this upload).",
      "/data-submissions/validation",
    );
  });
});
