import {
  renderLayout,
  renderButton,
  escapeHtml,
  type EmailBrand,
  type EmailTemplate,
} from "@/notifications/email/templates/layout";

export const DIGEST_LINES_PER_SECTION = 10;

export interface ReminderDigestSection {
  title: string;
  lines: string[];
}

export function reminderDigestEmail(
  params: { name: string; total: number; sections: ReminderDigestSection[]; url: string },
  brand: EmailBrand,
): EmailTemplate {
  const subject = `Data reporting reminder: ${params.total} item${params.total === 1 ? "" : "s"} need${params.total === 1 ? "s" : ""} attention`;
  const sections = params.sections
    .map((section) => {
      const shown = section.lines.slice(0, DIGEST_LINES_PER_SECTION);
      const hidden = section.lines.length - shown.length;
      const items = shown.map((line) => `<li style="margin: 0 0 6px;">${escapeHtml(line)}</li>`).join("");
      const more = hidden > 0 ? `<p style="margin: 0 0 16px; color: #667085;">and ${hidden} more</p>` : "";
      return `<p style="margin: 0 0 8px; font-weight: 600;">${escapeHtml(section.title)}</p>
     <ul style="margin: 0 0 16px; padding-left: 20px;">${items}</ul>${more}`;
    })
    .join("");
  const html = renderLayout(
    subject,
    `<p style="margin: 0 0 16px;">Hello ${escapeHtml(params.name)}, here is today's summary.</p>
     ${sections}
     ${renderButton("Open the platform", params.url, brand)}`,
    brand,
    "Your daily data reporting reminder",
  );
  return { subject, html };
}
