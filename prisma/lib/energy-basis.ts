export type EnergyBasis = "VOLUME" | "VALUE";

export interface EnergyFigures {
  basis: EnergyBasis;
  received: number;
  billed: number;
}

export interface EnergyRecordLike {
  period: string;
  energyBasis: string;
  energyReceivedMwh: unknown;
  energyBilledMwh: unknown;
  energyReceivedValueNgn: unknown;
  energyBilledValueNgn: unknown;
}

const DEFAULT_VALUE_BASIS_FROM = "2025-07";

function monthIndex(year: number, month: number): number {
  return year * 12 + month;
}

export function valueBasisStart(setting: string | undefined = process.env.NERC_ENERGY_VALUE_FROM): number {
  const match = /^(\d{4})-(\d{1,2})$/.exec((setting ?? DEFAULT_VALUE_BASIS_FROM).trim());
  const fallback = /^(\d{4})-(\d{2})$/.exec(DEFAULT_VALUE_BASIS_FROM) as RegExpExecArray;
  const [, year, month] = match ?? fallback;
  return monthIndex(Number(year), Number(month));
}

export function energyBasisForMonth(year: number, month: number, start: number = valueBasisStart()): EnergyBasis {
  return monthIndex(year, month) >= start ? "VALUE" : "VOLUME";
}

function periodRank(period: string): number {
  const match = /^q([1-4])-(\d{4})$/.exec(period);
  return match ? Number(match[2]) * 4 + Number(match[1]) : 0;
}

export function energyFiguresOf(record: EnergyRecordLike): EnergyFigures {
  if (record.energyBasis === "VALUE") {
    return {
      basis: "VALUE",
      received: Number(record.energyReceivedValueNgn),
      billed: Number(record.energyBilledValueNgn),
    };
  }
  return { basis: "VOLUME", received: Number(record.energyReceivedMwh), billed: Number(record.energyBilledMwh) };
}

export function aggregateEnergy(records: EnergyRecordLike[]): EnergyFigures {
  const latest = records.reduce<EnergyRecordLike | null>(
    (best, record) => (!best || periodRank(record.period) > periodRank(best.period) ? record : best),
    null,
  );
  const basis: EnergyBasis = latest?.energyBasis === "VALUE" ? "VALUE" : "VOLUME";
  return records
    .filter((record) => (record.energyBasis === "VALUE" ? "VALUE" : "VOLUME") === basis)
    .map(energyFiguresOf)
    .reduce<EnergyFigures>(
      (total, figures) => ({ basis, received: total.received + figures.received, billed: total.billed + figures.billed }),
      { basis, received: 0, billed: 0 },
    );
}

export function billingEfficiencyOf(figures: Pick<EnergyFigures, "received" | "billed">): number | null {
  return figures.received > 0 ? figures.billed / figures.received : null;
}
