import { createDb, describeTarget } from "@/db/client";
import { CliError } from "@/errors";
import { readCatalog, readRecipes } from "@/io/dataFiles";
import { CATALOG_PATH, recipesPath } from "@/io/paths";
import { formatPlan } from "@/load/format";
import { planLoad, usedIngredientNames } from "@/load/plan";
import { readSnapshot } from "@/load/snapshot";
import { parseCliArgs } from "./args";
import { requireEnv } from "./env";
import { runCli } from "./run";

await runCli(async () => {
  const { source, dryRun } = parseCliArgs("load", process.argv.slice(2));
  if (!dryRun) throw new CliError("Writing to the database isn't implemented yet. Use --dry-run.");

  const recipes = readRecipes(recipesPath(source));
  const catalog = readCatalog(CATALOG_PATH);
  const url = requireEnv("DATABASE_URL");
  console.log(`Target database: ${describeTarget(url)}`);

  const db = createDb(url);
  let snapshot;
  try {
    const sourceIds = recipes.filter((r) => r.status === "approved").map((r) => r.sourceId);
    snapshot = await readSnapshot(db, source, usedIngredientNames(recipes), sourceIds);
  } finally {
    await db.$client.end();
  }

  const result = planLoad(source, recipes, catalog, snapshot);
  if (!result.ok) throw new CliError(`Load refused:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`);
  console.log(formatPlan(result.plan));
  console.log("Dry run: nothing written.");
});
