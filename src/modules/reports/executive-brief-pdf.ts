import PDFDocument from "pdfkit";
import { PLATFORM_NAME } from "@/common/platform-name";
import type { BriefData, BriefIndicator, BriefTone } from "@/modules/reports/executive-brief";
import { EXECUTIVE_BRIEF_LOGO } from "@/modules/reports/executive-brief-logo";

export interface BriefPdfInput {
  title: string;
  reportingPeriod: string;
  generatedAt: string;
  limitations: string;
  brief: BriefData;
}

type Doc = InstanceType<typeof PDFDocument>;

const MARGIN = 34;
const HEADER_HEIGHT = 84;
const FOOTER_HEIGHT = 40;
const TILE_HEIGHT = 50;
const CARD_HEIGHT = 68;
const GRID_GAP = 8;
const PILLAR_ROW = 17;
const ITEM_HEIGHT = 42;
const ITEM_GAP = 4;
const SECTION_GAP = 12;
const HEADING_HEIGHT = 18;

const NAVY = "#00253C";
const BLUE = "#005380";
const GOLD = "#FFB400";
const TEXT = "#1B2A36";
const MUTED = "#5B6B78";
const RULE = "#DCE3E8";
const SURFACE = "#F3F6F8";
const TRACK = "#E3E9EE";
const GOOD = "#1E8E5A";
const BAD = "#C0392B";
const AMBER = "#D98A00";
const ORANGE = "#E0701B";
const GREY = "#6B7A86";

const REPLACEMENTS: [RegExp, string][] = [
  [/−/g, "-"],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/→/g, "->"],
  [/≥/g, ">="],
  [/≤/g, "<="],
  [/[–—]/g, "-"],
];

export function sanitizeBriefText(value: string): string {
  let text = value.split(String.fromCharCode(160)).join(" ");
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
  return text.replace(/[^\x20-\x7E¡-ÿ]/g, "?");
}

const SEVERITY_STYLE: Record<string, { label: string; color: string }> = {
  critical: { label: "CRITICAL", color: BAD },
  high: { label: "HIGH", color: ORANGE },
  medium: { label: "MEDIUM", color: AMBER },
  low: { label: "LOW", color: GREY },
};

const ACTION_STYLE: Record<string, { label: string; color: string }> = {
  delayed: { label: "DELAYED", color: BAD },
  "in-progress-at-risk": { label: "AT RISK", color: ORANGE },
  "in-progress-minor-delays": { label: "MINOR DELAYS", color: AMBER },
  "in-progress-on-track": { label: "ON TRACK", color: GOOD },
  "not-yet-due": { label: "NOT YET DUE", color: GREY },
};

const TONE_COLOR: Record<BriefTone, string> = { good: GOOD, bad: BAD, neutral: GREY };

function formatDate(iso: string | null): string {
  if (!iso) return "No due date";
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return `Due ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
}

function write(
  doc: Doc,
  value: string,
  x: number,
  y: number,
  options: { size: number; color: string; bold?: boolean; width?: number; height?: number; align?: "left" | "right" | "center" },
) {
  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options.size).fillColor(options.color);
  doc.text(sanitizeBriefText(value), x, y, {
    width: options.width,
    height: options.height,
    align: options.align,
    ellipsis: options.height !== undefined,
    lineBreak: options.width !== undefined,
  });
}

function measure(doc: Doc, value: string, size: number, bold = false): number {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
  return doc.widthOfString(sanitizeBriefText(value));
}

function heading(doc: Doc, title: string, x: number, y: number) {
  doc.rect(x, y + 1, 4, 11).fill(GOLD);
  write(doc, title, x + 11, y, { size: 10.5, color: BLUE, bold: true });
}

function triangle(doc: Doc, cx: number, cy: number, up: boolean, color: string) {
  const points: [number, number][] = up
    ? [[cx, cy - 3.5], [cx - 3.8, cy + 3], [cx + 3.8, cy + 3]]
    : [[cx, cy + 3.5], [cx - 3.8, cy - 3], [cx + 3.8, cy - 3]];
  doc.polygon(...points).fill(color);
}

function drawHeader(doc: Doc, input: BriefPdfInput, contentWidth: number, pageWidth: number) {
  doc.rect(0, 0, pageWidth, HEADER_HEIGHT).fill(NAVY);
  doc.rect(0, HEADER_HEIGHT, pageWidth, 3).fill(GOLD);
  doc.image(EXECUTIVE_BRIEF_LOGO, MARGIN, 15, { height: 54 });

  const generated = new Date(input.generatedAt);
  const prepared = Number.isNaN(generated.getTime())
    ? ""
    : generated.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  write(doc, "EXECUTIVE BRIEF", MARGIN, 20, { size: 20, color: "#FFFFFF", bold: true, width: contentWidth, align: "right" });
  write(doc, PLATFORM_NAME, MARGIN, 45, { size: 8.5, color: "#CFE0EC", width: contentWidth, align: "right" });
  write(doc, `Reporting period: ${input.reportingPeriod}   |   Prepared ${prepared}`, MARGIN, 58, {
    size: 8.5,
    color: "#CFE0EC",
    width: contentWidth,
    align: "right",
  });
}

function drawGlance(doc: Doc, brief: BriefData, y: number, contentWidth: number) {
  const { glance } = brief;
  const tiles: { value: string; label: string; color: string }[] = [
    {
      value: `${glance.indicatorsReported}/${glance.indicatorsTotal}`,
      label: "Headline indicators reported",
      color: glance.indicatorsReported === glance.indicatorsTotal ? GOOD : AMBER,
    },
    { value: String(glance.projectsAtRisk), label: "Projects at risk, delayed or blocked", color: glance.projectsAtRisk > 0 ? AMBER : GOOD },
    { value: String(glance.criticalBottlenecks), label: "Open critical or high bottlenecks", color: glance.criticalBottlenecks > 0 ? BAD : GOOD },
    { value: String(glance.delayedActions), label: "Priority actions delayed or at risk", color: glance.delayedActions > 0 ? BAD : GOOD },
  ];
  const width = (contentWidth - GRID_GAP * 3) / 4;
  tiles.forEach((tile, index) => {
    const x = MARGIN + index * (width + GRID_GAP);
    doc.roundedRect(x, y, width, TILE_HEIGHT, 4).fill(SURFACE);
    doc.roundedRect(x, y, 4, TILE_HEIGHT, 2).fill(tile.color);
    write(doc, tile.value, x + 14, y + 6, { size: 20, color: NAVY, bold: true });
    write(doc, tile.label, x + 14, y + 31, { size: 7.5, color: MUTED, width: width - 22, height: 18 });
  });
}

function drawIndicatorCard(doc: Doc, indicator: BriefIndicator, x: number, y: number, width: number) {
  doc.roundedRect(x, y, width, CARD_HEIGHT, 4).fillAndStroke("#FFFFFF", RULE);
  write(doc, indicator.name, x + 10, y + 7, { size: 7.5, color: MUTED, bold: true, width: width - 20, height: 18 });

  if (indicator.value === null) {
    write(doc, "Not yet reported", x + 10, y + 29, { size: 9.5, color: GREY });
    return;
  }
  write(doc, indicator.value, x + 10, y + 25, { size: 15, color: NAVY, bold: true, width: width - 20, height: 18 });
  if (indicator.target) {
    write(doc, `Target ${indicator.target}`, x + 10, y + 44, { size: 7, color: MUTED, width: width - 20, height: 9 });
  }

  const baseline = y + CARD_HEIGHT - 14;
  if (indicator.change && indicator.change !== "No change") {
    const up = indicator.change.startsWith("+");
    const color = TONE_COLOR[indicator.tone];
    triangle(doc, x + 14, baseline + 4, up, color);
    write(doc, indicator.change, x + 22, baseline, { size: 7.5, color, bold: true });
  } else if (indicator.change) {
    write(doc, "No change", x + 10, baseline, { size: 7.5, color: GREY });
  }
  if (indicator.period) {
    write(doc, indicator.period, x + 10, baseline + 0.5, { size: 7, color: MUTED, width: width - 20, align: "right" });
  }
}

function drawIndicators(doc: Doc, brief: BriefData, y: number, contentWidth: number): number {
  const items = brief.indicators.slice(0, 9);
  const width = (contentWidth - GRID_GAP * 2) / 3;
  items.forEach((indicator, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    drawIndicatorCard(doc, indicator, MARGIN + column * (width + GRID_GAP), y + row * (CARD_HEIGHT + GRID_GAP), width);
  });
  const rows = Math.ceil(items.length / 3);
  return rows === 0 ? 0 : rows * CARD_HEIGHT + (rows - 1) * GRID_GAP;
}

function drawPillars(doc: Doc, brief: BriefData, y: number, contentWidth: number): number {
  const rows = brief.pillars.slice(0, 8);
  const barX = MARGIN + 160;
  const barWidth = 190;
  rows.forEach((pillar, index) => {
    const top = y + index * PILLAR_ROW;
    if (index > 0) doc.moveTo(MARGIN, top).lineTo(MARGIN + contentWidth, top).lineWidth(0.4).strokeColor(RULE).stroke();
    write(doc, pillar.name, MARGIN + 2, top + 4.5, { size: 8, color: TEXT, bold: true, width: 150, height: 10 });

    if (pillar.projects === 0) {
      write(doc, "No projects registered", barX, top + 4.5, { size: 7.5, color: GREY });
    } else {
      doc.roundedRect(barX, top + 5, barWidth, 7, 3.5).fill(TRACK);
      const good = (pillar.onTrack / pillar.projects) * barWidth;
      const bad = (pillar.atRisk / pillar.projects) * barWidth;
      if (good > 0) doc.roundedRect(barX, top + 5, Math.max(good, 3), 7, 3.5).fill(GOOD);
      if (bad > 0) doc.roundedRect(barX + barWidth - Math.max(bad, 3), top + 5, Math.max(bad, 3), 7, 3.5).fill(BAD);
      write(doc, `${pillar.onTrack} of ${pillar.projects} on track`, barX + barWidth + 8, top + 4.5, { size: 7.5, color: MUTED });
    }

    const bottleneckText = `${pillar.bottlenecks} open ${pillar.bottlenecks === 1 ? "bottleneck" : "bottlenecks"}`;
    write(doc, bottleneckText, MARGIN, top + 4.5, {
      size: 7.5,
      color: pillar.bottlenecks > 0 ? BAD : MUTED,
      bold: pillar.bottlenecks > 0,
      width: contentWidth - 2,
      align: "right",
    });
  });
  return rows.length * PILLAR_ROW;
}

function drawBadge(doc: Doc, label: string, color: string, x: number, y: number): number {
  const width = measure(doc, label, 6.5, true) + 10;
  doc.roundedRect(x, y, width, 11, 5.5).fill(color);
  write(doc, label, x + 5, y + 2.6, { size: 6.5, color: "#FFFFFF", bold: true });
  return width;
}

function drawItem(
  doc: Doc,
  item: { badge: string; badgeColor: string; meta: string; body: string },
  x: number,
  y: number,
  width: number,
) {
  doc.roundedRect(x, y, width, ITEM_HEIGHT, 4).fillAndStroke("#FFFFFF", RULE);
  doc.roundedRect(x, y, 3.5, ITEM_HEIGHT, 1.5).fill(item.badgeColor);
  drawBadge(doc, item.badge, item.badgeColor, x + 11, y + 6);
  write(doc, item.meta, x + 11, y + 8, { size: 7, color: MUTED, width: width - 22, align: "right" });
  write(doc, item.body, x + 11, y + 21, { size: 7.5, color: TEXT, bold: true, width: width - 22, height: 19 });
}

function drawEmptyItem(doc: Doc, message: string, x: number, y: number, width: number) {
  doc.roundedRect(x, y, width, ITEM_HEIGHT, 4).fillAndStroke(SURFACE, RULE);
  doc.roundedRect(x, y, 3.5, ITEM_HEIGHT, 1.5).fill(GOOD);
  write(doc, message, x + 12, y + 14, { size: 8, color: MUTED, width: width - 24 });
}

function drawFooter(doc: Doc, input: BriefPdfInput, contentWidth: number, pageHeight: number) {
  const top = pageHeight - FOOTER_HEIGHT;
  doc.moveTo(MARGIN, top).lineTo(MARGIN + contentWidth, top).lineWidth(0.6).strokeColor(RULE).stroke();
  write(doc, input.limitations, MARGIN, top + 6, { size: 6.5, color: MUTED, width: contentWidth - 150, height: 20 });
  write(doc, PLATFORM_NAME, MARGIN, top + 6, { size: 6.5, color: BLUE, bold: true, width: contentWidth, align: "right" });
}

export function renderExecutiveBriefPdf(input: BriefPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 0, left: MARGIN, right: MARGIN, bottom: 0 },
    info: { Title: sanitizeBriefText(input.title), Author: PLATFORM_NAME },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const contentWidth = pageWidth - MARGIN * 2;
  const { brief } = input;

  drawHeader(doc, input, contentWidth, pageWidth);
  let y = HEADER_HEIGHT + 3 + 14;

  drawGlance(doc, brief, y, contentWidth);
  y += TILE_HEIGHT + SECTION_GAP;

  heading(doc, "Headline indicators", MARGIN, y);
  y += HEADING_HEIGHT;
  y += drawIndicators(doc, brief, y, contentWidth) + SECTION_GAP;

  heading(doc, "Progress by pillar", MARGIN, y);
  y += HEADING_HEIGHT;
  y += drawPillars(doc, brief, y, contentWidth) + SECTION_GAP;

  const columnWidth = (contentWidth - 14) / 2;
  const rightX = MARGIN + columnWidth + 14;
  heading(doc, "Bottlenecks requiring action", MARGIN, y);
  heading(doc, "Priority actions", rightX, y);
  y += HEADING_HEIGHT;

  const available = pageHeight - FOOTER_HEIGHT - 8 - y;
  const maxItems = Math.max(1, Math.min(5, Math.floor((available + ITEM_GAP) / (ITEM_HEIGHT + ITEM_GAP))));

  if (brief.bottlenecks.length === 0) {
    drawEmptyItem(doc, "No open bottlenecks are recorded.", MARGIN, y, columnWidth);
  } else {
    brief.bottlenecks.slice(0, maxItems).forEach((item, index) => {
      const style = SEVERITY_STYLE[item.severity] ?? { label: item.severity.toUpperCase(), color: GREY };
      drawItem(
        doc,
        {
          badge: style.label,
          badgeColor: style.color,
          meta: `${item.pillar}  |  ${item.ageDays} ${item.ageDays === 1 ? "day" : "days"} open`,
          body: item.issue,
        },
        MARGIN,
        y + index * (ITEM_HEIGHT + ITEM_GAP),
        columnWidth,
      );
    });
  }

  if (brief.actions.length === 0) {
    drawEmptyItem(doc, "No reform actions are outstanding.", rightX, y, columnWidth);
  } else {
    brief.actions.slice(0, maxItems).forEach((item, index) => {
      const style = ACTION_STYLE[item.status] ?? { label: item.status.toUpperCase(), color: GREY };
      drawItem(
        doc,
        {
          badge: style.label,
          badgeColor: style.color,
          meta: item.lead ? `${item.lead}  |  ${formatDate(item.due)}` : formatDate(item.due),
          body: item.action,
        },
        rightX,
        y + index * (ITEM_HEIGHT + ITEM_GAP),
        columnWidth,
      );
    });
  }

  drawFooter(doc, input, contentWidth, pageHeight);
  doc.end();
  return done;
}
