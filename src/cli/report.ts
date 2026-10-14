import { existsSync } from "node:fs";
import { readCatalog, readRecipes } from "@/io/dataFiles";
import { writeJsonFile } from "@/io/json";
import { CATALOG_PATH, recipesPath, reportPath } from "@/io/paths";
import { buildReport, formatReport } from "@/report/report";
import { RawCache } from "@/sources/rawCache";
import { sources } from "@/sources/registry";
import { parseCliArgs } from "./args";
import { runCli } from "./run";

await runCli(() => {
  const { source } = parseCliArgs("report", process.argv.slice(2));
  const adapter = sources.get(source);
  const path = recipesPath(source);
  const recipes = existsSync(path) ? readRecipes(path) : [];
  const report = buildReport(new RawCache(adapter).ids().length, recipes, readCatalog(CATALOG_PATH));

  console.log(formatReport(report));
  const queue = reportPath(source, "review-queue.json");
  writeJsonFile(queue, report.reviewQueue);
  console.log(`\nFull review queue: ${queue}`);
});
