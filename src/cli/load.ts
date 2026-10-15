import { createDb, describeTarget, type Db } from "@/db/client";
import { diffSchemas, readSchema } from "@/db/introspect";
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
  const { source, dryRun, prod } = parseCliArgs("load", process.argv.slice(2));
  const adapter = sources.get(source);
  const cache = new RawCache(adapter);
  const recipes = readRecipes(recipesPath(source));
  const catalog = readCatalog(CATALOG_PATH);

  // Validate before touching the database (SPEC §5.6).
  const errors = validateApproved(source, recipes, catalog, (id) => (cache.has(id) ? adapter.toSourceRecipe(cache.read(id)) : null));
  if (errors.length > 0) {
    throw new CliError(`${errors.length} ${errors.length === 1 ? "problem" : "problems"} in approved recipes, nothing loaded:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }

  const devUrl = requireEnv("DATABASE_URL");
  const url = prod ? requireEnv("PROD_DATABASE_URL") : devUrl;
  console.log(`Target database: ${describeTarget(url)}${prod ? " (production)" : ""}`);
  const db = createDb(url);
  try {
    if (prod) await checkSameSchema(devUrl, url, db);
    await loadSource(db, { source, recipes, catalog }, { dryRun, onPlan: (plan) => console.log(formatPlan(plan)) });
  } finally {
    await db.$client.end();
  }
  console.log(dryRun ? "Dry run: nothing written." : "Loaded in one transaction.");
});

/**
 * Production must have exactly the dev branch's schema (tables, columns, constraints, indexes,
 * applied migrations), since everything was checked against dev first. Any difference stops the load.
 */
async function checkSameSchema(devUrl: string, prodUrl: string, prod: Db): Promise<void> {
  if (describeTarget(devUrl) === describeTarget(prodUrl)) {
    throw new CliError("PROD_DATABASE_URL and DATABASE_URL are the same database; DATABASE_URL should be the dev branch.");
  }
  const dev = createDb(devUrl);
  let devLines: string[];
  try {
    devLines = await readSchema(dev.$client);
  } finally {
    await dev.$client.end();
  }
  const prodLines = await readSchema(prod.$client);
  const differences = diffSchemas({ name: "dev", lines: devLines }, { name: "production", lines: prodLines });
  if (differences.length > 0) {
    throw new CliError(
      `Production schema differs from dev (${describeTarget(devUrl)}), nothing loaded:\n${differences.map((d) => `  - ${d}`).join("\n")}`,
    );
  }
  console.log(`Schema: production matches dev (${prodLines.length} objects, ${prodLines.filter((l) => l.startsWith("migration ")).length} migrations).`);
}
