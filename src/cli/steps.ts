import { createStructuredCall } from "@/claude/client";
import { UsageTally } from "@/claude/usage";
import { readRecipes, writeRecipes } from "@/io/dataFiles";
import { recipesPath } from "@/io/paths";
import { RawCache } from "@/sources/rawCache";
import { sources } from "@/sources/registry";
import { formatInstructions } from "@/steps/steps";
import { parseCliArgs } from "./args";
import { runCli } from "./run";

await runCli(async () => {
  const { source, only, limit, maxRequests } = parseCliArgs("steps", process.argv.slice(2));
  const adapter = sources.get(source);
  const cache = new RawCache(adapter);
  const path = recipesPath(source);
  const tally = new UsageTally();

  const { counts } = await formatInstructions(readRecipes(path), {
    call: createStructuredCall(),
    tally,
    original: (id) => (cache.has(id) ? adapter.toSourceRecipe(cache.read(id)).instructions : null),
    save: (recipes) => writeRecipes(path, recipes),
    log: console.log,
    only,
    limit,
    maxRequests,
  });

  console.log(`\n${counts.recipes} recipes sent: ${counts.formatted} now numbered steps, ${counts.rejected} rejected (asked again next run).`);
  console.log(tally.summary());
});
