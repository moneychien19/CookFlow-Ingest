import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CliError } from "@/errors";
import { readJson, writeJsonFile } from "@/io/json";
import { DATA_DIR } from "@/io/paths";
import type { SourceAdapter } from "./types";

const natural = new Intl.Collator("en", { numeric: true });
const safeId = /^[A-Za-z0-9_-]+$/;

/** data/<source>/raw/<id>.json: one file per record, exactly as the source returned it. */
export class RawCache<Raw> {
  readonly dir: string;

  constructor(
    private readonly adapter: SourceAdapter<Raw>,
    dataDir = DATA_DIR,
  ) {
    this.dir = join(dataDir, adapter.name, "raw");
  }

  ids(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length))
      .sort(natural.compare);
  }

  has(id: string): boolean {
    return existsSync(this.path(id));
  }

  read(id: string): Raw {
    return readJson(this.path(id), this.adapter.rawSchema);
  }

  /** Validates, then writes the record as given (not zod's parsed copy, which could reshape it). */
  write(id: string, raw: unknown): void {
    const result = this.adapter.rawSchema.safeParse(raw);
    if (!result.success) {
      throw new CliError(`${this.adapter.name} record ${id} doesn't match its schema:\n${z.prettifyError(result.error)}`);
    }
    writeJsonFile(this.path(id), raw);
  }

  private path(id: string): string {
    if (!safeId.test(id)) throw new CliError(`${this.adapter.name}: record id "${id}" can't be used as a file name`);
    return join(this.dir, `${id}.json`);
  }
}
