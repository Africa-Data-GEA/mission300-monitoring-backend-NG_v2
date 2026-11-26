import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const COMPACT_WORKSHEET_TEMPLATE_PATH = join("templates", "compact-progress-worksheet.xlsx");

@Injectable()
export class CompactWorksheetTemplateService {
  constructor(private readonly config: ConfigService) {}

  async read(): Promise<Buffer> {
    const root = this.config.get<string>("STORAGE_LOCAL_PATH", "./storage");
    try {
      return await readFile(join(root, COMPACT_WORKSHEET_TEMPLATE_PATH));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      throw new NotFoundException(
        "The Compact Progress Report worksheet template has not been added to the server yet.",
      );
    }
  }
}
