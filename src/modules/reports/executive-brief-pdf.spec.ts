import { renderExecutiveBriefPdf, sanitizeBriefText, type BriefPdfInput } from "./executive-brief-pdf";

const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

function input(overrides: Partial<BriefPdfInput> = {}): BriefPdfInput {
  return {
    title: "Executive brief - Latest available",
    reportingPeriod: "Latest available",
    generatedAt: "2026-11-19T08:00:00.000Z",
    limitations: "Generated from the live database. Verify against the approved Compact Progress Report before external distribution.",
    sections: [
      { title: "At a glance", columns: ["Measure", "Status"], rows: [["Headline indicators reported", "8 of 8"]] },
      {
        title: "Headline indicators",
        columns: ["Indicator", "Latest", "Period", "Change", "Target"],
        rows: [["ATC&C Loss Rate", "34.5%", "Q4 2025", "−2.4 pts", "—"]],
      },
    ],
    ...overrides,
  };
}

describe("renderExecutiveBriefPdf", () => {
  it("produces a one-page PDF for a normal brief", async () => {
    const pdf = await renderExecutiveBriefPdf(input());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(1);
  });

  it("stays on one page even when there is far more content than fits", async () => {
    const longRows = Array.from({ length: 80 }, (_, index) => [
      `Bottleneck number ${index} with a long description that needs to wrap across several lines in the narrow issue column of the table`,
      "high",
      "Last-mile access",
      String(index),
      "open",
    ]);
    const pdf = await renderExecutiveBriefPdf(
      input({
        sections: [
          ...input().sections,
          { title: "Bottlenecks requiring action", columns: ["Issue", "Severity", "Pillar", "Age (days)", "Status"], rows: longRows },
        ],
      }),
    );
    expect(pageCount(pdf)).toBe(1);
  });

  it("copes with an empty section", async () => {
    const pdf = await renderExecutiveBriefPdf(
      input({ sections: [{ title: "Priority actions", columns: ["Action", "Lead institution", "Due", "Status"], rows: [] }] }),
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
