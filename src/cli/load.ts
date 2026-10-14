import { createDb, describeTarget } from "@/db/client";
import { readCatalog, readRecipes } from "@/io/dataFiles";
import { CATALOG_PATH, recipesPath } from "@/io/paths";
import { formatPlan } from "@/load/format";
import { loadSource } from "@/load/load";
import { parseCliArgs } from "./args";
import { requireEnv } from "./env";
import { runCli } from "./run";

await runCli(async () => {
  const { source, dryRun } = parseCliArgs("load", process.argv.slice(2));
  const recipes = readRecipes(recipesPath(source));
  const catalog = readCatalog(CATALOG_PATH);
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
