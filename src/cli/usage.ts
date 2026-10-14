/** The `npm run ingest:<stage>` commands (SPEC §4). */
const STAGES = {
  fetch: "npm run ingest:fetch -- <source> [--limit <n>]",
  map: "npm run ingest:map -- <source>",
  normalize: "npm run ingest:normalize -- <source> [--limit <recipes>] [--max-requests <n>]",
  load: "npm run ingest:load -- <source> [--dry-run]",
} as const;

export type Stage = keyof typeof STAGES;

export function usage(stage: Stage): string {
  return `Usage: ${STAGES[stage]}`;
}

/** Placeholder for stages that aren't built yet: prints usage and exits 1. */
export function notImplemented(stage: Stage): never {
  console.error(`ingest:${stage} isn't implemented yet.\n${usage(stage)}`);
  process.exit(1);
}
