import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createStructuredCall } from "@/claude/client";
import { UsageTally } from "@/claude/usage";
import { buildCatalog } from "@/catalog/group";
import { proposeMissing } from "@/catalog/propose";
import { readProposals, writeProposals } from "@/catalog/proposals";
import { UsageError } from "@/cli/args";
import { runCli } from "@/cli/run";
import { readCatalog, writeCatalog } from "@/io/dataFiles";
import { CATALOG_PATH, PROPOSALS_PATH } from "@/io/paths";
import { readIngredientList } from "./ingredientList";

const USAGE = "Usage: npm run catalog:bootstrap -- [--limit <names>] [--max-requests <n>]";
const options = z.strictObject({
  limit: z.coerce.number().int().positive().optional(),
  maxRequests: z.coerce.number().int().positive().default(25),
});

/**
 * Drafts data/ingredients.json from TheMealDB's ingredient list (plan T5b). Claude
 * proposes a canonical name, unit, and staple flag per source name; proposals are saved
 * as they arrive, so a rerun only asks for names that don't have one yet.
 */
await runCli(async () => {
  let args: z.output<typeof options>;
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { limit: { type: "string" }, "max-requests": { type: "string" } },
      strict: true,
    });
    args = options.parse({ limit: values.limit, maxRequests: values["max-requests"] });
  } catch (err) {
    throw new UsageError(`${err instanceof z.ZodError ? z.prettifyError(err) : (err as Error).message}\n${USAGE}`);
  }

  const names = await readIngredientList();
  const existing = existsSync(CATALOG_PATH) ? readCatalog(CATALOG_PATH) : [];
  const tally = new UsageTally();
  const before = readProposals(PROPOSALS_PATH);
  const proposals = await proposeMissing(names, before, {
    call: createStructuredCall(),
    tally,
    save: (all) => writeProposals(PROPOSALS_PATH, all),
    log: console.log,
    limit: args.limit,
    maxRequests: args.maxRequests,
    knownCanonicalNames: existing.filter((e) => e.reviewed).map((e) => e.name),
  });

  const { catalog, warnings } = buildCatalog(proposals, existing);
  writeCatalog(CATALOG_PATH, catalog);
  for (const w of warnings) console.log(`Warning: ${w}`);
  const drafts = catalog.filter((e) => !e.reviewed);
  console.log(
    `\n${proposals.length - before.length} new proposals (${proposals.length} of ${names.length} source names done).`,
    `\n${CATALOG_PATH}: ${catalog.length} entries, ${drafts.length} unreviewed, ${drafts.filter((e) => e.note).length} with a note.`,
  );
  console.log(tally.summary());
});
