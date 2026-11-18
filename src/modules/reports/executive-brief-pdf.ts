import PDFDocument from "pdfkit";
import { PLATFORM_NAME } from "@/common/platform-name";

export interface BriefPdfSection {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface BriefPdfInput {
  title: string;
  reportingPeriod: string;
  generatedAt: string;
  limitations: string;
  sections: BriefPdfSection[];
}

const PAGE_MARGIN = 36;
const HEADER_HEIGHT = 74;
const FOOTER_HEIGHT = 30;
const CELL_PAD_X = 4;
const CELL_PAD_Y = 3;
const SECTION_GAP = 9;
const HEADING_GAP = 4;
const FONT_SIZES = [9, 8.5, 8, 7.5, 7, 6.5];

const NAVY = "#00253C";
const BLUE = "#005380";
const GOLD = "#FFB400";
const RULE = "#C9D3DB";
const ZEBRA = "#F3F6F8";
const TEXT = "#1B2A36";
const MUTED = "#5B6B78";

const COLUMN_SHARES: Record<string, number[]> = {
  "At a glance": [0.72, 0.28],
  "Headline indicators": [0.3, 0.19, 0.12, 0.18, 0.21],
  "Progress by pillar": [0.34, 0.14, 0.18, 0.18, 0.16],
  "Bottlenecks requiring action": [0.46, 0.12, 0.2, 0.1, 0.12],
  "Priority actions": [0.46, 0.22, 0.12, 0.2],
};

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

function titleCase(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cellText(section: BriefPdfSection, columnIndex: number, value: string): string {
  const column = section.columns[columnIndex];
  const looksLikeEnum = /^[a-z]+(-[a-z]+)*$/.test(value);
  const enumColumn = column === "Severity" || column === "Status";
  return sanitizeBriefText(enumColumn && looksLikeEnum ? titleCase(value) : value);
}

function columnWidths(section: BriefPdfSection, total: number): number[] {
  const shares = COLUMN_SHARES[section.title];
  const usable = shares && shares.length === section.columns.length ? shares : section.columns.map(() => 1 / section.columns.length);
  return usable.map((share) => share * total);
}

type Doc = InstanceType<typeof PDFDocument>;

function rowHeight(doc: Doc, cells: string[], widths: number[], size: number, allBold: boolean): number {
  const heights = cells.map((cell, index) => {
    doc.font(allBold || index === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    return doc.heightOfString(cell, { width: widths[index] - CELL_PAD_X * 2 });
  });
  return Math.max(...heights) + CELL_PAD_Y * 2;
}

function measure(doc: Doc, sections: BriefPdfSection[], size: number, totalWidth: number): number {
  let height = 0;
  for (const section of sections) {
    const widths = columnWidths(section, totalWidth);
    doc.font("Helvetica-Bold").fontSize(size + 2);
    height += doc.heightOfString(sanitizeBriefText(section.title), { width: totalWidth }) + HEADING_GAP;
    height += rowHeight(doc, section.columns.map(sanitizeBriefText), widths, size, true);
    for (const row of section.rows) {
      height += rowHeight(doc, row.map((cell, index) => cellText(section, index, cell)), widths, size, false);
    }
    height += SECTION_GAP;
  }
  return height;
}

function fitToPage(doc: Doc, input: BriefPdfSection[], available: number, totalWidth: number) {
  const sections = input.map((section) => ({ ...section, rows: [...section.rows] }));
  for (;;) {
    for (const size of FONT_SIZES) {
      if (measure(doc, sections, size, totalWidth) <= available) return { sections, size };
    }
    const longest = sections.reduce((best, section) => (section.rows.length > best.rows.length ? section : best), sections[0]);
    if (!longest || longest.rows.length <= 1) return { sections, size: FONT_SIZES[FONT_SIZES.length - 1] };
    longest.rows.pop();
  }
}

export function renderExecutiveBriefPdf(input: BriefPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 0, left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: 0 },
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
  const totalWidth = pageWidth - PAGE_MARGIN * 2;

  doc.rect(0, 0, pageWidth, HEADER_HEIGHT).fill(NAVY);
  doc.rect(0, HEADER_HEIGHT, pageWidth, 3).fill(GOLD);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(16).text(sanitizeBriefText(PLATFORM_NAME), PAGE_MARGIN, 16, { width: totalWidth, lineBreak: false });
  doc.font("Helvetica").fontSize(11).text("Executive brief", PAGE_MARGIN, 38, { width: totalWidth, lineBreak: false });
  const generated = new Date(input.generatedAt);
  const generatedLabel = Number.isNaN(generated.getTime())
    ? ""
    : generated.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  doc.fontSize(8.5).fillColor("#CFE0EC").text(
    sanitizeBriefText(`Reporting period: ${input.reportingPeriod}   |   Prepared ${generatedLabel}`),
    PAGE_MARGIN,
    55,
    { width: totalWidth, lineBreak: false },
  );

  const top = HEADER_HEIGHT + 3 + 12;
  const bottom = pageHeight - FOOTER_HEIGHT - 8;
  const { sections, size } = fitToPage(doc, input.sections, bottom - top, totalWidth);

  let y = top;
  for (const section of sections) {
    const widths = columnWidths(section, totalWidth);
    doc.fillColor(BLUE).font("Helvetica-Bold").fontSize(size + 2);
    const headingText = sanitizeBriefText(section.title);
    doc.text(headingText, PAGE_MARGIN, y, { width: totalWidth, lineBreak: false });
    y += doc.heightOfString(headingText, { width: totalWidth }) + HEADING_GAP;

    const headerCells = section.columns.map(sanitizeBriefText);
    const headerHeight = rowHeight(doc, headerCells, widths, size, true);
    doc.rect(PAGE_MARGIN, y, totalWidth, headerHeight).fill(NAVY);
    let x = PAGE_MARGIN;
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(size);
    headerCells.forEach((cell, index) => {
      doc.text(cell, x + CELL_PAD_X, y + CELL_PAD_Y, { width: widths[index] - CELL_PAD_X * 2 });
      x += widths[index];
    });
    y += headerHeight;

    section.rows.forEach((row, rowIndex) => {
      const cells = row.map((cell, index) => cellText(section, index, cell));
      const height = rowHeight(doc, cells, widths, size, false);
      if (rowIndex % 2 === 1) doc.rect(PAGE_MARGIN, y, totalWidth, height).fill(ZEBRA);
      doc.moveTo(PAGE_MARGIN, y + height).lineTo(PAGE_MARGIN + totalWidth, y + height).lineWidth(0.4).strokeColor(RULE).stroke();
      let cellX = PAGE_MARGIN;
      doc.fillColor(TEXT).font("Helvetica").fontSize(size);
      cells.forEach((cell, index) => {
        const critical = section.columns[index] === "Severity" && cell.toLowerCase() === "critical";
        doc.font(index === 0 || critical ? "Helvetica-Bold" : "Helvetica");
        doc.text(cell, cellX + CELL_PAD_X, y + CELL_PAD_Y, { width: widths[index] - CELL_PAD_X * 2 });
        cellX += widths[index];
      });
      y += height;
    });
    y += SECTION_GAP;
  }

  const footerTop = pageHeight - FOOTER_HEIGHT - 4;
  doc.moveTo(PAGE_MARGIN, footerTop).lineTo(PAGE_MARGIN + totalWidth, footerTop).lineWidth(0.6).strokeColor(RULE).stroke();
  doc.fillColor(MUTED).font("Helvetica").fontSize(6.5).text(sanitizeBriefText(input.limitations), PAGE_MARGIN, footerTop + 4, {
    width: totalWidth,
    height: FOOTER_HEIGHT - 6,
    ellipsis: true,
  });

  doc.end();
  return done;
}
