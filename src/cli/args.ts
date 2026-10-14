import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { z } from "zod";
import { CliError } from "@/errors";
import { usage, type Stage } from "./usage";

export class UsageError extends CliError {
  override name = "UsageError";
}

// Whether a source is registered is checked against the adapter registry, not here.
const source = z.string().regex(/^[a-z][a-z0-9-]*$/, "lowercase letters, digits, and hyphens");

const STAGE_ARGS = {
  fetch: {
    options: { limit: { type: "string" } },
    schema: z.strictObject({ source, limit: z.coerce.number().int().positive().default(100) }),
  },
  map: { options: {}, schema: z.strictObject({ source }) },
  normalize: {
    options: { limit: { type: "string" }, "max-requests": { type: "string" } },
    schema: z.strictObject({
      source,
      limit: z.coerce.number().int().positive().optional(),
      maxRequests: z.coerce.number().int().positive().default(150),
    }),
  },
  report: { options: {}, schema: z.strictObject({ source }) },
  load: {
    options: { "dry-run": { type: "boolean" } },
    schema: z.strictObject({ source, dryRun: z.boolean().default(false) }),
  },
} as const;

export type CliArgs<T extends Stage> = z.output<(typeof STAGE_ARGS)[T]["schema"]>;

/** Parses `npm run ingest:<stage> -- <source> [options]`; throws `UsageError` with the usage line. */
export function parseCliArgs<T extends Stage>(stage: T, argv: string[]): CliArgs<T> {
  const { options, schema } = STAGE_ARGS[stage] as { options: ParseArgsOptionsConfig; schema: z.ZodType };
  const fail = (message: string): never => {
    throw new UsageError(`${message}\n${usage(stage)}`);
  };

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (err) {
    return fail((err as Error).message);
  }
  if (parsed.positionals.length !== 1) fail("expected exactly one <source>");

  // --dry-run → dryRun; options that weren't passed are left out so schema defaults apply.
  const values = Object.fromEntries(
    Object.entries(parsed.values).map(([key, value]) => [key.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()), value]),
  );
  const result = schema.safeParse({ source: parsed.positionals[0], ...values });
  if (!result.success) return fail(z.prettifyError(result.error));
  return result.data as CliArgs<T>;
}
