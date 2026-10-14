import { createDb, describeTarget } from "@/db/client";
import { CliError } from "@/errors";
import { readCatalog, readRecipes } from "@/io/dataFiles";
import { CATALOG_PATH, recipesPath } from "@/io/paths";
import { formatPlan } from "@/load/format";
import { loadSource } from "@/load/load";
import { RawCache } from "@/sources/rawCache";
import { sources } from "@/sources/registry";
import { validateApproved } from "@/validate/validate";
import { parseCliArgs } from "./args";
import { requireEnv } from "./env";
import { runCli } from "./run";

await runCli(async () => {
  const { source, dryRun } = parseCliArgs("load", process.argv.slice(2));
  const adapter = sources.get(source);
  const cache = new RawCache(adapter);
  const recipes = readRecipes(recipesPath(source));
  const catalog = readCatalog(CATALOG_PATH);

  // Validate before touching the database (SPEC §5.6).
  const errors = validateApproved(source, recipes, catalog, (id) => (cache.has(id) ? adapter.toSourceRecipe(cache.read(id)) : null));
  if (errors.length > 0) {
    throw new CliError(`${errors.length} ${errors.length === 1 ? "problem" : "problems"} in approved recipes, nothing loaded:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }

  const url = requireEnv("DATABASE_URL");
  console.log(`Target database: ${describeTarget(url)}`);
  const db = createDb(url);
  try {
    await loadSource(db, { source, recipes, catalog }, { dryRun, onPlan: (plan) => console.log(formatPlan(plan)) });
  } finally {
    await db.$client.end();
  }
  console.log(dryRun ? "Dry run: nothing written." : "Loaded in one transaction.");
});
