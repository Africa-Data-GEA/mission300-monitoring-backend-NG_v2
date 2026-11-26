import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  COMPACT_WORKSHEET_TEMPLATE_PATH,
  CompactWorksheetTemplateService,
} from "@/modules/reports/compact-worksheet-template.service";

describe("CompactWorksheetTemplateService", () => {
  let root: string;
  let service: CompactWorksheetTemplateService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "worksheet-"));
    service = new CompactWorksheetTemplateService({ get: () => root } as unknown as ConfigService);
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it("returns the template kept in storage", async () => {
    const path = join(root, COMPACT_WORKSHEET_TEMPLATE_PATH);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "workbook");

    await expect(service.read()).resolves.toEqual(Buffer.from("workbook"));
  });

  it("says plainly when the template has not been added", async () => {
    await expect(service.read()).rejects.toThrow(NotFoundException);
  });
});
