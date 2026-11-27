import { join } from "node:path";
import PDFDocument from "pdfkit";
import { PLATFORM_NAME } from "@/common/platform-name";
import type { BriefData, BriefTone } from "@/modules/reports/executive-brief";
import { EXECUTIVE_BRIEF_LOGO } from "@/modules/reports/executive-brief-logo";

export interface BriefPdfInput {
  title: string;
  reportingPeriod: string;
  generatedAt: string;
  limitations: string;
  brief: BriefData;
}

type Doc = InstanceType<typeof PDFDocument>;

interface Cell {
  text: string;
  color?: string;
  weight?: Weight;
}

interface Column {
  title: string;
  width: number;
  align?: "left" | "right";
}

type Weight = "regular" | "medium" | "bold";

const FONT_FILES: Record<Weight, string> = {
  regular: "google-sans-400.ttf",
  medium: "google-sans-500.ttf",
  bold: "google-sans-700.ttf",
};

const MARGIN = 32;
const HEADER_HEIGHT = 66;
const FOOTER_HEIGHT = 34;
const SECTION_GAP = 11;
const HEADING_HEIGHT = 16;
const COLUMN_HEADER_HEIGHT = 13;
const CELL_GAP = 8;
const BODY_SIZE = 7.8;
const CELL_PADDING = 3;
const MAX_CELL_LINES = 2;

const NAVY = "#00253C";
const BLUE = "#005380";
const TEXT = "#1B2A36";
const MUTED = "#5B6B78";
const RULE = "#E4E9ED";
const GOOD = "#1E8E5A";
const BAD = "#C0392B";
const AMBER = "#B97500";
const ORANGE = "#C75F10";
const GREY = "#6B7A86";

const REPLACEMENTS: [RegExp, string][] = [[/₦\s?/g, "NGN "]];

export function sanitizeBriefText(value: string): string {
  let text = value.split(String.fromCharCode(160)).join(" ");
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
  return text.replace(/[^\x20-\x7E¡-ÿ–—‘’“”…→≤≥−]/g, "?");
}

const SEVERITY_STYLE: Record<string, { label: string; color: string }> = {
  critical: { label: "Critical", color: BAD },
  high: { label: "High", color: ORANGE },
  medium: { label: "Medium", color: AMBER },
  low: { label: "Low", color: GREY },
};

const ACTION_STYLE: Record<string, { label: string; color: string }> = {
  "in-progress-on-track": { label: "On track", color: BLUE },
  completed: { label: "Completed", color: GOOD },
};

const TONE_COLOR: Record<BriefTone, string> = { good: GOOD, bad: BAD, neutral: GREY };

function formatDate(iso: string | null): string {
  if (!iso) return "No due date";
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function write(
  doc: Doc,
  value: string,
  x: number,
  y: number,
  options: { size: number; color: string; weight?: Weight; width?: number; height?: number; align?: "left" | "right" },
) {
  doc.font(options.weight ?? "regular").fontSize(options.size).fillColor(options.color);
  doc.text(sanitizeBriefText(value), x, y, {
    width: options.width,
    height: options.height,
    align: options.align,
    ellipsis: options.height !== undefined,
    lineBreak: options.width !== undefined,
  });
}

function rule(doc: Doc, y: number, contentWidth: number, color = RULE) {
  doc.moveTo(MARGIN, y).lineTo(MARGIN + contentWidth, y).lineWidth(0.5).strokeColor(color).stroke();
}

function drawHeader(doc: Doc, input: BriefPdfInput, contentWidth: number, pageWidth: number) {
  doc.rect(0, 0, pageWidth, HEADER_HEIGHT).fill(NAVY);
  doc.image(EXECUTIVE_BRIEF_LOGO, MARGIN, 11, { height: 44 });

  const generated = new Date(input.generatedAt);
  const prepared = Number.isNaN(generated.getTime())
    ? ""
    : generated.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const right = { width: contentWidth, align: "right" as const };
  write(doc, "Executive brief", MARGIN, 11, { size: 17, color: "#FFFFFF", weight: "bold", ...right });
  const preparedFor = input.brief.preparedFor ? `Prepared for ${input.brief.preparedFor}` : PLATFORM_NAME;
  write(doc, preparedFor, MARGIN, 33, { size: 8, color: "#CFE0EC", ...right });
  write(doc, `Reporting period: ${input.reportingPeriod}   |   Prepared ${prepared}`, MARGIN, 44, {
    size: 8,
    color: "#CFE0EC",
    ...right,
  });
}

function drawGlance(doc: Doc, brief: BriefData, y: number, contentWidth: number): number {
  const { glance } = brief;
  const figures = [
    { value: `${glance.indicatorsReported}/${glance.indicatorsTotal}`, label: "Indicators reported" },
    { value: String(glance.improvingIndicators), label: "Indicators improving" },
    { value: String(glance.projectsAtRisk), label: "Projects at risk" },
    { value: String(glance.criticalBottlenecks), label: "Critical bottlenecks" },
    { value: `${glance.completedActions}/${glance.totalActions}`, label: "Actions completed" },
    { value: String(glance.delayedActions), label: "Actions delayed or at risk" },
  ];
  const width = contentWidth / figures.length;
  figures.forEach((figure, index) => {
    const x = MARGIN + index * width;
    write(doc, figure.value, x, y, { size: 16, color: NAVY, weight: "bold" });
    write(doc, figure.label, x, y + 20, { size: 7, color: MUTED, width: width - 6, height: 10 });
  });
  const height = 33;
  rule(doc, y + height, contentWidth);
  return height;
}

function cellHeight(doc: Doc, cell: Cell, width: number): number {
  doc.font(cell.weight ?? "regular").fontSize(BODY_SIZE);
  const line = doc.currentLineHeight(true);
  const full = doc.heightOfString(sanitizeBriefText(cell.text), { width });
  return Math.min(full, line * MAX_CELL_LINES);
}

function drawTable(
  doc: Doc,
  table: { title: string; columns: Column[]; rows: Cell[][]; empty: string },
  y: number,
  contentWidth: number,
  bottom: number,
): number {
  if (y + HEADING_HEIGHT + COLUMN_HEADER_HEIGHT + 14 > bottom) return y;
  write(doc, table.title, MARGIN, y, { size: 10, color: BLUE, weight: "bold" });
  let top = y + HEADING_HEIGHT;

  if (table.rows.length === 0) {
    write(doc, table.empty, MARGIN, top, { size: BODY_SIZE, color: MUTED, width: contentWidth });
    return top + 14 + SECTION_GAP;
  }

  const gaps = CELL_GAP * (table.columns.length - 1);
  const widths = table.columns.map((column) => column.width * (contentWidth - gaps));
  const left = widths.map((_, index) => MARGIN + widths.slice(0, index).reduce((sum, width) => sum + width + CELL_GAP, 0));

  table.columns.forEach((column, index) => {
    write(doc, column.title, left[index], top, {
      size: 6.8,
      color: MUTED,
      weight: "medium",
      width: widths[index],
      height: 10,
      align: column.align,
    });
  });
  top += COLUMN_HEADER_HEIGHT;
  rule(doc, top - 2, contentWidth, "#C5D0D8");

  for (const [rowIndex, row] of table.rows.entries()) {
    const height = Math.max(...row.map((cell, index) => cellHeight(doc, cell, widths[index])));
    const hasMore = rowIndex < table.rows.length - 1;
    if (top + height + CELL_PADDING * 2 + (hasMore ? 10 : 0) > bottom) {
      const left = table.rows.length - rowIndex;
      write(doc, `${left} more not shown on this page`, MARGIN, top + 1, { size: 6.8, color: MUTED });
      return top + 10 + SECTION_GAP;
    }
    row.forEach((cell, index) => {
      write(doc, cell.text, left[index], top + CELL_PADDING - 1, {
        size: BODY_SIZE,
        color: cell.color ?? TEXT,
        weight: cell.weight,
        width: widths[index],
        height: height + 0.5,
        align: table.columns[index].align,
      });
    });
    top += height + CELL_PADDING * 2;
    if (hasMore) rule(doc, top - 1, contentWidth);
  }
  return top + SECTION_GAP;
}

function indicatorTable(brief: BriefData) {
  return {
    title: brief.preparedFor ? "Indicators you report" : "Headline indicators",
    empty: brief.preparedFor ? "No reported indicators are linked to this agency." : "No headline indicators are selected.",
    columns: [
      { title: "Indicator", width: 0.37 },
      { title: "Latest", width: 0.19, align: "right" as const },
      { title: "Period", width: 0.12, align: "right" as const },
      { title: "Change", width: 0.16, align: "right" as const },
      { title: "Target", width: 0.16, align: "right" as const },
    ],
    rows: brief.indicators.map((indicator): Cell[] => [
      { text: indicator.name, weight: "medium" },
      indicator.value === null ? { text: "Not yet reported", color: GREY } : { text: indicator.value, weight: "bold", color: NAVY },
      { text: indicator.period ?? "-", color: MUTED },
      { text: indicator.change ?? "-", color: TONE_COLOR[indicator.tone] },
      { text: indicator.target ?? "-", color: MUTED },
    ]),
  };
}

function actionTable(brief: BriefData) {
  return {
    title: brief.preparedFor ? "Actions you lead: completed and on track" : "Priority actions: completed and on track",
    empty: brief.preparedFor ? "No completed or on-track actions list this agency as lead." : "No priority actions are completed or on track.",
    columns: [
      { title: "Action", width: 0.6 },
      { title: "Lead institution", width: 0.18 },
      { title: "Due", width: 0.11 },
      { title: "Status", width: 0.11, align: "right" as const },
    ],
    rows: brief.actions.map((item): Cell[] => {
      const style = ACTION_STYLE[item.status] ?? { label: item.status, color: GREY };
      return [
        { text: item.action },
        { text: item.lead || "-", color: MUTED },
        { text: formatDate(item.due), color: MUTED },
        { text: style.label, color: style.color, weight: "bold" },
      ];
    }),
  };
}

function pillarTable(brief: BriefData) {
  return {
    title: "Progress by pillar",
    empty: "No pillars are selected.",
    columns: [
      { title: "Pillar", width: 0.4 },
      { title: "Projects", width: 0.12, align: "right" as const },
      { title: "On track or complete", width: 0.18, align: "right" as const },
      { title: "At risk or delayed", width: 0.16, align: "right" as const },
      { title: "Open bottlenecks", width: 0.14, align: "right" as const },
    ],
    rows: brief.pillars.map((pillar): Cell[] => [
      { text: pillar.name, weight: "medium" },
      { text: String(pillar.projects) },
      { text: String(pillar.onTrack), color: pillar.onTrack > 0 ? GOOD : MUTED },
      { text: String(pillar.atRisk), color: pillar.atRisk > 0 ? BAD : MUTED },
      { text: String(pillar.bottlenecks), color: pillar.bottlenecks > 0 ? BAD : MUTED },
    ]),
  };
}

function bottleneckTable(brief: BriefData) {
  return {
    title: "Bottlenecks requiring action",
    empty: "No open bottlenecks are recorded.",
    columns: [
      { title: "Issue", width: 0.58 },
      { title: "Pillar", width: 0.22 },
      { title: "Severity", width: 0.1 },
      { title: "Days open", width: 0.1, align: "right" as const },
    ],
    rows: brief.bottlenecks.map((item): Cell[] => {
      const style = SEVERITY_STYLE[item.severity] ?? { label: item.severity, color: GREY };
      return [
        { text: item.issue },
        { text: item.pillar, color: MUTED },
        { text: style.label, color: style.color, weight: "bold" },
        { text: String(item.ageDays), color: MUTED },
      ];
    }),
  };
}

function drawFooter(doc: Doc, input: BriefPdfInput, contentWidth: number, pageHeight: number) {
  const top = pageHeight - FOOTER_HEIGHT;
  rule(doc, top, contentWidth);
  write(doc, input.limitations, MARGIN, top + 6, { size: 6.5, color: MUTED, width: contentWidth - 160, height: 20 });
  write(doc, PLATFORM_NAME, MARGIN, top + 6, { size: 6.5, color: BLUE, weight: "bold", width: contentWidth, align: "right" });
}

export function renderExecutiveBriefPdf(input: BriefPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 0, left: MARGIN, right: MARGIN, bottom: 0 },
    info: { Title: sanitizeBriefText(input.title), Author: PLATFORM_NAME },
  });
  for (const [weight, file] of Object.entries(FONT_FILES)) {
    doc.registerFont(weight, join(process.cwd(), "assets", "fonts", file));
  }
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageHeight = doc.page.height;
  const contentWidth = doc.page.width - MARGIN * 2;
  const bottom = pageHeight - FOOTER_HEIGHT - 4;
  const { brief } = input;

  drawHeader(doc, input, contentWidth, doc.page.width);
  let y = HEADER_HEIGHT + 11;
  y += drawGlance(doc, brief, y, contentWidth) + SECTION_GAP;

  for (const table of [indicatorTable(brief), actionTable(brief), pillarTable(brief), bottleneckTable(brief)]) {
    y = drawTable(doc, table, y, contentWidth, bottom);
  }

  drawFooter(doc, input, contentWidth, pageHeight);
  doc.end();
  return done;
}
