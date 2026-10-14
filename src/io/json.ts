import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { CliError } from "@/errors";

/** A data file that can't be read or doesn't match its schema. The message names the file and field. */
export class DataFileError extends CliError {
  override name = "DataFileError";
}

export function readJson<S extends z.ZodType>(path: string, schema: S): z.output<S> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new DataFileError(`${path}: can't read file (${(err as Error).message})`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new DataFileError(`${path}: invalid JSON (${(err as Error).message})`);
  }
  const result = schema.safeParse(json);
  if (!result.success) throw new DataFileError(`${path}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/**
 * Validates `data`, then writes it as 2-space JSON with a trailing newline. Writes to a
 * temporary file and renames it, so a crash never leaves a half-written reviewed file.
 */
export function writeJson<S extends z.ZodType>(path: string, schema: S, data: z.input<S>): void {
  const result = schema.safeParse(data);
  if (!result.success) throw new DataFileError(`${path}: refusing to write invalid data\n${z.prettifyError(result.error)}`);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(result.data, null, 2)}\n`);
  renameSync(tmp, path);
}
