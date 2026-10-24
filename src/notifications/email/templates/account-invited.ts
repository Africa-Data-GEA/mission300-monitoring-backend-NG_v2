import { PLATFORM_NAME } from "@/common/platform-name";
import {
  renderLayout,
  renderButton,
  escapeHtml,
  type EmailBrand,
  type EmailTemplate,
} from "@/notifications/email/templates/layout";

export function accountInvitedEmail(
  params: { fullName: string; setPasswordUrl: string },
  brand: EmailBrand,
): EmailTemplate {
  const subject = `You've been invited to the ${PLATFORM_NAME}`;
  const html = renderLayout(
    subject,
    `<p style="margin: 0 0 16px;">Hi ${escapeHtml(params.fullName)},</p>
     <p style="margin: 0 0 16px;">An account has been created for you on the ${PLATFORM_NAME}. Set a password to get started.</p>
     ${renderButton("Set your password", params.setPasswordUrl, brand)}
     <p style="font-size: 12px; color: #667085; margin: 0;">This link expires in 24 hours.</p>`,
    brand,
    subject,
  );
  return { subject, html };
}
