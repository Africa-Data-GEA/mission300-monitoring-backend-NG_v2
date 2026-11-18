import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  sent: boolean;
  reason?: string;
}

/**
 * Thin Resend wrapper. RESEND_API_KEY is optional at boot (see
 * env.validation.ts) so local dev doesn't need a real key - without one,
 * this logs delivery metadata instead of throwing, so the rest of
 * the notification pipeline (webhooks, event wiring) can still be exercised.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = this.config.get<string>("EMAIL_FROM", "notifications@raven-emrc.com");

    if (!this.resend) {
      this.logger.warn("RESEND_API_KEY not set - email delivery is disabled");
    }
  }

  async send({ to, subject, html, attachments }: SendEmailInput): Promise<SendEmailResult> {
    if (!this.resend) {
      // Recovery/invitation URLs are credentials, including in development.
      this.logger.log("Email skipped: delivery provider is not configured");
      return { sent: false, reason: "Email delivery is not configured" };
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject,
      html,
      ...(attachments?.length ? { attachments } : {}),
    });
    if (error) {
      this.logger.error("Email provider rejected delivery");
      return { sent: false, reason: "The email provider rejected the message" };
    }
    return { sent: true };
  }
}
