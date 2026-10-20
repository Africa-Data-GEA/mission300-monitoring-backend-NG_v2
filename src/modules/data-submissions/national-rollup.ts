import { coverageNoteFor, MONTHS } from "@/common/kpi/period-coverage";

export type RollupInput =
  | "metered"
  | "unmetered"
  | "energyReceivedGwh"
  | "energyBilledGwh"
  | "revenueBilledMillion"
  | "revenueCollectedMillion"
  | "moInvoiceBillion"
  | "moRemittanceBillion"
  | "nbetInvoiceBillion"
  | "nbetRemittanceBillion";

type InputSource = { datasetId: string; kpiCode?: string };

const SOURCES: Record<RollupInput, InputSource> = {
  metered: { datasetId: "nerc-disco-metering", kpiCode: "M300-P3-001" },
  unmetered: { datasetId: "nerc-disco-metering", kpiCode: "M300-P3-002" },
  energyReceivedGwh: { datasetId: "nerc-disco-energy-received" },
  energyBilledGwh: { datasetId: "nerc-disco-energy-billed" },
  revenueBilledMillion: { datasetId: "nerc-disco-revenue-billed" },
  revenueCollectedMillion: { datasetId: "nerc-disco-revenue-collected" },
  moInvoiceBillion: { datasetId: "nerc-disco-mo-invoice" },
  moRemittanceBillion: { datasetId: "nerc-disco-mo-remittance" },
  nbetInvoiceBillion: { datasetId: "nerc-disco-nbet-invoice" },
  nbetRemittanceBillion: { datasetId: "nerc-disco-nbet-remittance" },
};

const STOCK_INPUTS: RollupInput[] = ["metered", "unmetered"];

export const ROLLUP_DATASET_IDS: string[] = [...new Set(Object.values(SOURCES).map((source) => source.datasetId))];

export function inputFor(datasetId: string, kpiCode: string): RollupInput | null {
  for (const [input, source] of Object.entries(SOURCES) as [RollupInput, InputSource][]) {
    if (source.datasetId !== datasetId) continue;
    if (source.kpiCode && source.kpiCode !== kpiCode) continue;
    return input;
  }
  return null;
}

export const NATIONAL_KPIS: { code: string; needs: RollupInput[] }[] = [
  { code: "M300-P3-001", needs: ["metered"] },
  { code: "M300-P3-002", needs: ["unmetered"] },
  { code: "M300-P3-004", needs: ["metered", "unmetered"] },
  { code: "M300-P3-007", needs: ["revenueCollectedMillion"] },
  { code: "M300-P3-008", needs: ["revenueBilledMillion", "revenueCollectedMillion"] },
  {
    code: "M300-P3-006",
    needs: ["energyReceivedGwh", "energyBilledGwh", "revenueBilledMillion", "revenueCollectedMillion"],
  },
  { code: "M300-P3-009", needs: ["moInvoiceBillion", "moRemittanceBillion", "nbetInvoiceBillion", "nbetRemittanceBillion"] },
];

export function datasetsFor(inputs: RollupInput[]): string[] {
  return [...new Set(inputs.map((input) => SOURCES[input].datasetId))];
}

export interface ApprovedValue {
  institutionId: string;
  input: RollupInput;
  period: string;
  value: number;
  decidedAt: number;
}

export function quarterOf(period: string): { quarter: string; month: string | null } | null {
  const monthly = /^([A-Za-z]+)\s+(\d{4})$/.exec(period.trim());
  if (monthly) {
    const index = MONTHS.indexOf(monthly[1] as (typeof MONTHS)[number]);
    if (index !== -1) return { quarter: `q${Math.floor(index / 3) + 1}-${monthly[2]}`, month: monthly[1] };
  }
  const quarterly = /^Q([1-4])\s+(\d{4})$/i.exec(period.trim());
  if (quarterly) return { quarter: `q${quarterly[1]}-${quarterly[2]}`, month: null };
  return null;
}

export function periodsIn(quarter: string): string[] {
  const match = /^q([1-4])-(\d{4})$/.exec(quarter);
  if (!match) return [];
  const first = (Number(match[1]) - 1) * 3;
  return [`Q${match[1]} ${match[2]}`, ...[0, 1, 2].map((offset) => `${MONTHS[first + offset]} ${match[2]}`)];
}

export interface NationalResult {
  code: string;
  value: number;
  coverageNote: string | null;
}

export function nationalForQuarter(values: ApprovedValue[], quarter: string): NationalResult[] {
  const latest = new Map<string, ApprovedValue>();
  for (const entry of values) {
    const parsed = quarterOf(entry.period);
    if (!parsed || parsed.quarter !== quarter) continue;
    const key = `${entry.institutionId}|${entry.input}|${entry.period}`;
    const current = latest.get(key);
    if (!current || entry.decidedAt > current.decidedAt) latest.set(key, entry);
  }

  const totals = new Map<RollupInput, number>();
  const months = new Map<RollupInput, Set<string>>();
  for (const entry of latest.values()) {
    totals.set(entry.input, (totals.get(entry.input) ?? 0) + entry.value);
    const month = quarterOf(entry.period)?.month;
    if (month) {
      const present = months.get(entry.input) ?? new Set<string>();
      present.add(month);
      months.set(entry.input, present);
    }
  }

  const sum = (input: RollupInput) => totals.get(input) ?? 0;
  const results: NationalResult[] = [];

  for (const kpi of NATIONAL_KPIS) {
    if (kpi.needs.some((input) => !totals.has(input))) continue;

    const flowInputs = kpi.needs.filter((input) => !STOCK_INPUTS.includes(input));
    const monthSets = flowInputs.map((input) => months.get(input) ?? new Set<string>());
    const monthsInAll =
      monthSets.length > 0
        ? monthSets.reduce((common, present) => new Set([...common].filter((month) => present.has(month))))
        : null;
    const coverageNote = monthsInAll ? coverageNoteFor(quarter, monthsInAll) : null;

    let value: number | null = null;
    switch (kpi.code) {
      case "M300-P3-001":
        value = sum("metered");
        break;
      case "M300-P3-002":
        value = sum("unmetered");
        break;
      case "M300-P3-004": {
        const active = sum("metered") + sum("unmetered");
        value = active > 0 ? (sum("metered") / active) * 100 : null;
        break;
      }
      case "M300-P3-007":
        value = sum("revenueCollectedMillion") / 1000;
        break;
      case "M300-P3-008":
        value = sum("revenueBilledMillion") > 0 ? (sum("revenueCollectedMillion") / sum("revenueBilledMillion")) * 100 : null;
        break;
      case "M300-P3-006":
        value =
          sum("energyReceivedGwh") > 0 && sum("revenueBilledMillion") > 0
            ? (1 -
                (sum("energyBilledGwh") / sum("energyReceivedGwh")) *
                  (sum("revenueCollectedMillion") / sum("revenueBilledMillion"))) *
              100
            : null;
        break;
      case "M300-P3-009": {
        const owed = sum("moInvoiceBillion") + sum("nbetInvoiceBillion");
        value = owed > 0 ? ((sum("moRemittanceBillion") + sum("nbetRemittanceBillion")) / owed) * 100 : null;
        break;
      }
    }
    if (value !== null && Number.isFinite(value)) results.push({ code: kpi.code, value, coverageNote });
  }
  return results;
}
