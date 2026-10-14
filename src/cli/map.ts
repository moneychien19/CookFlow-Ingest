import { existsSync } from "node:fs";
import { createMatcher } from "@/catalog/match";
import { readCatalog, readRecipes, writeRecipes } from "@/io/dataFiles";
import { writeJsonFile } from "@/io/json";
import { CATALOG_PATH, recipesPath, reportPath } from "@/io/paths";
import { runMap } from "@/map/runMap";
import { RawCache } from "@/sources/rawCache";
import { sources } from "@/sources/registry";
import { parseCliArgs } from "./args";
import { runCli } from "./run";

await runCli(() => {
  const { source } = parseCliArgs("map", process.argv.slice(2));
  const adapter = sources.get(source);
  const path = recipesPath(source);
  const existing = existsSync(path) ? readRecipes(path) : [];
  const match = createMatcher(readCatalog(CATALOG_PATH));

  const { recipes, unmapped, counts } = runMap(adapter, new RawCache(adapter), existing, match);
  writeRecipes(path, recipes);
  const report = reportPath(source, "unmapped.json");
  writeJsonFile(report, unmapped);

  const { mapped, kept, dropped, pending, lines, rule, nominal } = counts;
  console.log(`Mapped ${mapped} recipes; kept ${kept} approved or reviewer-dropped as they were.`);
  console.log(`${path}: ${recipes.length} recipes, ${pending} pending, ${dropped} dropped.`);
  console.log(
    `Pending lines: ${lines} (${rule} by rule, ${nominal} nominal staples, ${lines - rule - nominal - counts.unmapped} by Claude or a reviewer, ${counts.unmapped} unmapped).`,
  );
  console.log(`Unmapped lines: ${report}`);
});
