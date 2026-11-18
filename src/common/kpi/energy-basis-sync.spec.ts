import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("energy basis copies", () => {
  it("keeps the app copy identical to the scripts copy", () => {
    const read = (path: string) => readFileSync(join(__dirname, path), "utf8").replace(/\r\n/g, "\n");
    expect(read("energy-basis.ts")).toBe(read("../../../prisma/lib/energy-basis.ts"));
  });
});
