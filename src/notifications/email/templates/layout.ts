export interface EmailTemplate {
  subject: string;
  html: string;
}

/**
 * The admin-configurable slice of BrandingSettings (see
 * src/modules/administration/branding/branding.service.ts) that this email
 * layer needs. Every caller gets this by injecting BrandingService and
 * awaiting `.get()` before building a template - see auth.service.ts and
 * notifications.consumer.ts. `logoUrl` is the raw stored value (e.g.
 * "/Logos/geapp.png" or "/branding/logo/xxx.png"), resolved to an absolute
 * URL inside renderLayout - email clients fetch images over plain HTTP from
 * the sender's own server rather than bundling them, so a relative path
 * won't resolve the way it does in the browser-rendered dashboard.
 */
export interface EmailBrand {
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
  countryName?: string;
  officialName?: string;
}

/**
 * Email-safe mirror of the FIXED design tokens in
 * m300-frontend/src/styles/theme.css - the ones BrandProvider never
 * overrides (status colours, surfaces, link colour, type/radius scale).
 * Primary/secondary colour and the logo are NOT here - those come from
 * EmailBrand, per-send, because an admin can change them in
 * Administration > Customization at any time. Email clients can't read CSS
 * custom properties (Outlook strips <style> blocks entirely), so these are
 * copied and frozen rather than shared at build time.
 */
const token = {
  surface: "#ffffff",
  surfacePage: "#f2f3f5",
  surfaceSunken: "#f5f6f8",
  borderDefault: "#eaecf0",
  textDefault: "#101828",
  textMuted: "#667085",
  link: "#0b5cad",
  radiusCard: "12px",
  radiusControl: "8px",
  statusPositiveFg: "#00764a",
  statusPositiveBg: "#e6f4ed",
  statusWarningFg: "#8f5605",
  statusWarningBg: "#fbf0d5",
  statusNegativeFg: "#a8201a",
  statusNegativeBg: "#fbe9e6",
  statusNeutralFg: "#4a5462",
  statusNeutralBg: "#eef0f3",
} as const;

// Figtree, not the dashboard's own Google Sans - Google Sans is self-hosted
// by the dashboard (not on a public font CDN), so it can't be reliably
// loaded in an email client. Figtree IS on Google Fonts' public CDN, so it's
// linked directly in <head> below; the system-UI fallback chain still
// covers clients (Outlook chief among them) that strip external stylesheets
// outright.
const fontFamily =
  "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const frontendBase = process.env.FRONTEND_URL ?? "http://localhost:5173";
const backendBase = process.env.BACKEND_URL ?? "http://localhost:3000";

/**
 * `BrandingSettings.logoUrl` points at two different origins depending on
 * how it got set: the shipped default ("/Logos/geapp.png") is a frontend
 * static asset, but an admin-uploaded logo ("/branding/logo/xxx.png", set by
 * BrandingService.uploadLogo) is served by THIS backend's own
 * `GET /branding/logo/:filename` route - frontend and backend are separate
 * origins in this deployment (Vercel + its own VPS), so picking the wrong
 * one 404s. The frontend has this exact same "which origin" problem for its
 * own <img> tags (sidebar.tsx, public-header.tsx) - it happens to get away
 * with it there because a same-origin dev proxy is more forgiving than a
 * cold HTTP fetch from an email client, but email has no such proxy.
 */
function resolveLogoUrl(logoUrl: string): string {
  const base = logoUrl.startsWith("/branding/logo/") ? backendBase : frontendBase;
  return `${base}${logoUrl}`;
}

// Same partner credit shown in the landing page's own footer (public-footer.tsx):
// SEforALL and GEAPP as delivery partners on the left, EMRC credited alone as
// platform builder on the right. These are fixed - unlike the primary colour
// and logo, they aren't part of BrandingSettings and don't change per admin.
// SEforALL's mark is multi-colour by default (only inverted to white in-app
// via a CSS filter for its navy footer - not something an email can rely on),
// so it's used as-is here since this footer stays light. GEAPP's file is the
// opposite problem - solid white with a transparent background, invisible
// without a dark backdrop - so it gets a small chip in the brand's primary
// colour, the same fix the header gives the coat of arms in reverse.
const seforallUrl = `${frontendBase}/seforall.svg`;
const geappUrl = `${frontendBase}/reports/compact-progress/logo-geapp.png`;
const emrcUrl = `${frontendBase}/emrc.png`;

/** Escapes user-controlled strings before they're interpolated into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The one place that controls what every email looks like. Matches the
 * dashboard's theme - whatever an admin has set in Administration >
 * Customization, not just the CDMU navy default - so a notification and the
 * product it's from read as the same thing. Upgrading the visual design
 * later is a change to this file only, not a hunt through every template.
 *
 * `preheader` is the short preview text inbox lists show next to the
 * subject - keep it under ~90 characters.
 */
export function renderLayout(title: string, bodyHtml: string, brand: EmailBrand, preheader?: string): string {
  const logoUrl = resolveLogoUrl(brand.logoUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap" />
  </head>
  <body style="margin: 0; padding: 0; background-color: ${token.surfacePage};">
    ${
      preheader
        ? `<span style="display: none; font-size: 1px; color: ${token.surfacePage}; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden;">${escapeHtml(preheader)}</span>`
        : ""
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${token.surfacePage};">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 560px; background-color: ${token.surface}; border: 1px solid ${token.borderDefault}; border-radius: ${token.radiusCard}; overflow: hidden;">
            <tr>
              <td style="background-color: ${brand.primaryColor}; padding: 20px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background-color: #ffffff; border-radius: 6px; padding: 4px; vertical-align: middle;">
                      <img src="${logoUrl}" width="40" height="40" alt="${escapeHtml(brand.officialName ?? "Federal Republic of Nigeria")} coat of arms" style="display: block; width: 40px; height: 40px; border: 0;" />
                    </td>
                    <td style="width: 1px; background-color: rgba(255, 255, 255, 0.25); font-size: 0; line-height: 0;">&nbsp;</td>
                    <td style="vertical-align: middle; padding-left: 14px;">
                      <div style="font-family: ${fontFamily}; color: #ffffff; font-size: 18px; font-weight: 700; letter-spacing: -0.011em;">M300</div>
                      <div style="font-family: ${fontFamily}; color: rgba(255, 255, 255, 0.68); font-size: 12px; margin-top: 2px;">${escapeHtml(brand.countryName ?? "Nigeria")} Energy Compact Dashboard</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color: ${brand.secondaryColor}; height: 4px; line-height: 4px; font-size: 0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding: 32px; font-family: ${fontFamily}; color: ${token.textDefault}; font-size: 15px; line-height: 1.6;">
                <h1 style="margin: 0 0 16px; font-family: ${fontFamily}; font-size: 20px; line-height: 1.3; font-weight: 700; color: ${token.textDefault}; letter-spacing: -0.011em;">${escapeHtml(title)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="background-color: ${token.surfaceSunken}; border-top: 1px solid ${token.borderDefault}; padding: 20px 32px;">
                <p style="margin: 0 0 16px; font-family: ${fontFamily}; font-size: 12px; line-height: 1.5; color: ${token.textMuted};">
                  M300 ${escapeHtml(brand.countryName ?? "Nigeria")} Energy Compact Dashboard — automated notification, please do not reply.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="left" style="vertical-align: middle;">
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="vertical-align: middle;">
                            <img src="${seforallUrl}" alt="SEforALL" width="26" style="display: block; width: 26px; height: auto; border: 0;" />
                          </td>
                          <td style="width: 7px; font-size: 0; line-height: 0;">&nbsp;</td>
                          <td style="width: 1px; background-color: ${token.borderDefault}; font-size: 0; line-height: 0;">&nbsp;</td>
                          <td style="width: 7px; font-size: 0; line-height: 0;">&nbsp;</td>
                          <td style="vertical-align: middle;">
                            <table role="presentation" cellpadding="0" cellspacing="0" style="background-color: ${brand.primaryColor}; border-radius: 3px;">
                              <tr>
                                <td style="padding: 3px 4px;">
                                  <img src="${geappUrl}" alt="GEAPP" width="20" style="display: block; width: 20px; height: auto; border: 0;" />
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td align="right" style="vertical-align: middle;">
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="vertical-align: middle; padding-right: 5px;">
                            <img src="${emrcUrl}" alt="EMRC" width="16" style="display: block; width: 16px; height: auto; border: 0;" />
                          </td>
                          <td style="vertical-align: middle; font-family: ${fontFamily}; font-size: 9px; color: ${token.textMuted}; white-space: nowrap;">
                            developed by EMRC
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Shared CTA button - every "click here to do X" email uses this. */
export function renderButton(label: string, url: string, brand: EmailBrand): string {
  const safeUrl = escapeHtml(url);
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 8px 0 24px;">
      <tr>
        <td style="border-radius: ${token.radiusControl}; background-color: ${brand.primaryColor};">
          <a href="${safeUrl}"
             style="display: inline-block; padding: 12px 24px; font-family: ${fontFamily}; font-size: 14px;
                    font-weight: 600; color: #ffffff; text-decoration: none; border-radius: ${token.radiusControl};">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin: 0 0 8px; font-family: ${fontFamily}; font-size: 12px; color: ${token.textMuted};">
      Or copy this link:<br />
      <a href="${safeUrl}" style="color: ${token.link}; word-break: break-all;">${safeUrl}</a>
    </p>`;
}

export type BadgeTone = "positive" | "warning" | "negative" | "neutral";

const badgeTones: Record<BadgeTone, { fg: string; bg: string }> = {
  positive: { fg: token.statusPositiveFg, bg: token.statusPositiveBg },
  warning: { fg: token.statusWarningFg, bg: token.statusWarningBg },
  negative: { fg: token.statusNegativeFg, bg: token.statusNegativeBg },
  neutral: { fg: token.statusNeutralFg, bg: token.statusNeutralBg },
};

/**
 * Pill badge using the same status vocabulary as the dashboard's delivery-
 * status and confidence indicators (theme.css --color-status-*), so a
 * decision reads with the same visual weight in an email as it does on the
 * submissions table. Fixed regardless of brand colour - these map 1:1 to
 * ReviewDecisionType and aren't admin-customizable.
 */
export function renderStatusBadge(label: string, tone: BadgeTone): string {
  const { fg, bg } = badgeTones[tone];
  return `<span style="display: inline-block; padding: 4px 12px; border-radius: 9999px; background-color: ${bg}; color: ${fg}; font-family: ${fontFamily}; font-size: 12px; font-weight: 600;">${escapeHtml(label)}</span>`;
}
