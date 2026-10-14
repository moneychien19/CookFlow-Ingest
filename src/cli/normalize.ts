import { createStructuredCall } from "@/claude/client";
import { UsageTally } from "@/claude/usage";
import { readProposals, writeProposals } from "@/catalog/proposals";
import { readCatalog, readRecipes, writeCatalog, writeRecipes } from "@/io/dataFiles";
import { CATALOG_PATH, PROPOSALS_PATH, recipesPath } from "@/io/paths";
import { normalizeRecipes } from "@/normalize/normalize";
import { sources } from "@/sources/registry";
import { parseCliArgs } from "./args";
import { runCli } from "./run";

await runCli(async () => {
  const { source, limit, maxRequests } = parseCliArgs("normalize", process.argv.slice(2));
  sources.get(source);
  const path = recipesPath(source);
  const tally = new UsageTally();

  const result = await normalizeRecipes(
    { recipes: readRecipes(path), catalog: readCatalog(CATALOG_PATH), proposals: readProposals(PROPOSALS_PATH) },
    {
      call: createStructuredCall(),
      tally,
      log: console.log,
      limit,
      maxRequests,
      save: ({ recipes, catalog, proposals }) => {
        writeRecipes(path, recipes);
        writeCatalog(CATALOG_PATH, catalog);
        writeProposals(PROPOSALS_PATH, proposals);
      },
    },
  );

  const { recipes, existing, cantMap, rejected } = result.counts;
  console.log(
    `\n${recipes} recipes sent: ${existing} lines mapped to catalog ingredients, ${result.counts.new} to new draft ingredients, ${cantMap} can't map, ${rejected} answers rejected (asked again next run).`,
  );
  console.log(tally.summary());
});
