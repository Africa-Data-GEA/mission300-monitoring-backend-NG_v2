import {
  renderLayout,
  escapeHtml,
  type EmailBrand,
  type EmailTemplate,
} from "@/notifications/email/templates/layout";

export function executiveBriefEmail(
  params: { scheduleName: string; reportingPeriod: string; dashboardUrl: string },
  brand: EmailBrand,
): EmailTemplate {
  const subject = `${params.scheduleName}: Mission 300 executive brief`;
  const html = renderLayout(
    subject,
    `<p style="margin: 0 0 12px 0;">Please find attached the one-page Mission 300 executive brief for <strong>${escapeHtml(params.reportingPeriod)}</strong>.</p>` +
      `<p style="margin: 0;">It summarises the headline indicators, pillar progress, the bottlenecks that need action and the priority reform actions. The full detail is on the <a href="${escapeHtml(params.dashboardUrl)}">platform</a>.</p>`,
    brand,
    "Your Mission 300 executive brief is attached",
  );
  return { subject, html };
}
