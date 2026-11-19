import type { BriefData } from "./executive-brief";
import { renderExecutiveBriefPdf, sanitizeBriefText, type BriefPdfInput } from "./executive-brief-pdf";

const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

function brief(overrides: Partial<BriefData> = {}): BriefData {
  return {
    glance: { indicatorsReported: 8, indicatorsTotal: 9, projectsAtRisk: 4, criticalBottlenecks: 2, delayedActions: 6 },
    indicators: [
      { name: "Electricity Access Rate", value: "63.7%", period: "2026", change: "+0.8 pts", tone: "good", target: null },
      { name: "ATC&C Loss Rate", value: "34.8%", period: "Q2 2026", change: "+0.6 pts", tone: "bad", target: null },
      { name: "Metering Rate", value: "59.7%", period: "Q2 2026", change: "No change", tone: "neutral", target: "100%" },
      { name: "Operational Mini-Grids", value: null, period: null, change: null, tone: "neutral", target: null },
    ],
    pillars: [
      { name: "Generation & network", projects: 33, onTrack: 29, atRisk: 4, bottlenecks: 2 },
      { name: "Clean cooking", projects: 0, onTrack: 0, atRisk: 0, bottlenecks: 0 },
    ],
    bottlenecks: [{ issue: "Right-of-way delays on the Abuja ring main", severity: "critical", pillar: "Generation & network", ageDays: 120, status: "open" }],
    actions: [{ action: "Deployment of SCADA systems", lead: "TCN", due: "2026-12-31", status: "delayed" }],
    ...overrides,
  };
}

function input(overrides: Partial<BriefPdfInput> = {}): BriefPdfInput {
  return {
    title: "Executive brief - Latest available",
    reportingPeriod: "Latest available",
    generatedAt: "2026-11-19T08:00:00.000Z",
    limitations: "Generated from the live database. Verify against the approved Compact Progress Report before external distribution.",
    brief: brief(),
    ...overrides,
  };
}

describe("renderExecutiveBriefPdf", () => {
  it("produces a one-page PDF for a normal brief", async () => {
    const pdf = await renderExecutiveBriefPdf(input());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(1);
  });

  it("stays on one page with the most content a brief can hold and very long text", async () => {
    const long = "A very long description that has to wrap across several lines in a narrow column and be cut off cleanly ".repeat(4);
    const full = brief({
      indicators: Array.from({ length: 12 }, (_, index) => ({
        name: `Indicator number ${index} with a long descriptive name that wraps`,
        value: "1,234,567 connections",
        period: "Q2 2026",
        change: "+123,456 connections",
        tone: "good" as const,
        target: "2,750,000 connections",
      })),
      pillars: Array.from({ length: 12 }, (_, index) => ({ name: `Pillar ${index} with a long name`, projects: 10, onTrack: 6, atRisk: 4, bottlenecks: 3 })),
      bottlenecks: Array.from({ length: 12 }, () => ({ issue: long, severity: "high", pillar: "Last-mile access with a long name", ageDays: 400, status: "open" })),
      actions: Array.from({ length: 12 }, () => ({ action: long, lead: "Federal Ministry of Power and partners", due: "2027-07-31", status: "in-progress-at-risk" })),
    });
    const pdf = await renderExecutiveBriefPdf(input({ brief: full }));
    expect(pageCount(pdf)).toBe(1);
  });

  it("copes with empty lists, an unreported indicator and a pillar with no projects", async () => {
    const pdf = await renderExecutiveBriefPdf(input({ brief: brief({ bottlenecks: [], actions: [], indicators: [] }) }));
    expect(pageCount(pdf)).toBe(1);
  });

  it("does not fail on a status it has not seen before", async () => {
    const pdf = await renderExecutiveBriefPdf(
      input({
        brief: brief({
          bottlenecks: [{ issue: "Something", severity: "unheard-of", pillar: "P", ageDays: 1, status: "open" }],
          actions: [{ action: "Something", lead: "", due: null, status: "brand-new-status" }],
        }),
      }),
    );
    expect(pageCount(pdf)).toBe(1);
  });
});

describe("sanitizeBriefText", () => {
  it("replaces characters the built-in PDF fonts cannot draw", () => {
    expect(sanitizeBriefText("−2.4 pts — ‘quoted’")).toBe("-2.4 pts - 'quoted'");
    expect(sanitizeBriefText("tariff ₦ 124")).toBe("tariff ? 124");
  });
});
