import {
  aggregateEnergy,
  billingEfficiencyOf,
  energyBasisForMonth,
  energyFiguresOf,
  valueBasisStart,
  type EnergyRecordLike,
} from "./energy-basis";

const volume = (period: string, received: number, billed: number): EnergyRecordLike => ({
  period,
  energyBasis: "VOLUME",
  energyReceivedMwh: received,
  energyBilledMwh: billed,
  energyReceivedValueNgn: 0,
  energyBilledValueNgn: 0,
});

const value = (period: string, received: number, billed: number): EnergyRecordLike => ({
  period,
  energyBasis: "VALUE",
  energyReceivedMwh: 0,
  energyBilledMwh: 0,
  energyReceivedValueNgn: received,
  energyBilledValueNgn: billed,
});

describe("energy basis", () => {
  it("switches to value from July 2025 by default", () => {
    expect(energyBasisForMonth(2025, 6)).toBe("VOLUME");
    expect(energyBasisForMonth(2025, 7)).toBe("VALUE");
    expect(energyBasisForMonth(2027, 1)).toBe("VALUE");
  });

  it("takes the switch month from the setting", () => {
    expect(energyBasisForMonth(2025, 9, valueBasisStart("2025-10"))).toBe("VOLUME");
    expect(energyBasisForMonth(2025, 10, valueBasisStart("2025-10"))).toBe("VALUE");
  });

  it("falls back to the default for a malformed setting", () => {
    expect(valueBasisStart("soon")).toBe(valueBasisStart("2025-07"));
  });

  it("reads the figures that match the record's basis", () => {
    expect(energyFiguresOf(volume("q1-2025", 100, 80))).toEqual({ basis: "VOLUME", received: 100, billed: 80 });
    expect(energyFiguresOf(value("q3-2025", 50, 40))).toEqual({ basis: "VALUE", received: 50, billed: 40 });
  });

  it("computes billing efficiency on either basis and none without a received figure", () => {
    expect(billingEfficiencyOf({ received: 200, billed: 150 })).toBe(0.75);
    expect(billingEfficiencyOf({ received: 0, billed: 0 })).toBeNull();
  });

  it("aggregates only records on the basis of the latest period", () => {
    const total = aggregateEnergy([
      volume("q2-2025", 1000, 800),
      value("q3-2025", 50, 40),
      value("q3-2025", 30, 24),
    ]);
    expect(total).toEqual({ basis: "VALUE", received: 80, billed: 64 });
  });

  it("aggregates volume records when the latest period is volume", () => {
    const total = aggregateEnergy([volume("q1-2025", 100, 80), volume("q2-2025", 200, 150)]);
    expect(total).toEqual({ basis: "VOLUME", received: 300, billed: 230 });
  });

  it("returns an empty volume total for no records", () => {
    expect(aggregateEnergy([])).toEqual({ basis: "VOLUME", received: 0, billed: 0 });
  });
});
