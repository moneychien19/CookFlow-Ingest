import type { Db, Tx } from "@/db/client";
import { CliError } from "@/errors";
import type { CatalogEntry } from "@/schema/catalog";
import type { ReviewedRecipe } from "@/schema/reviewed";
import { applyLoad } from "./apply";
import { planLoad, usedIngredientNames, type LoadPlan } from "./plan";
import { readSnapshot } from "./snapshot";

export type LoadInput = { source: string; recipes: ReviewedRecipe[]; catalog: CatalogEntry[] };
export type LoadOptions = {
  dryRun: boolean;
  /** Called with the plan before anything is written (SPEC §5.7: print the counts first). */
  onPlan?: (plan: LoadPlan) => void;
};

/**
 * Loads a source's approved recipes. Planning and writing share one transaction, so the
 * database can't change between the checks and the writes, and any failure rolls the
 * whole load back. With `dryRun`, it only plans.
 */
export async function loadSource(db: Db, input: LoadInput, { dryRun, onPlan }: LoadOptions): Promise<LoadPlan> {
  if (dryRun) {
    const plan = await planFrom(db, input);
    onPlan?.(plan);
    return plan;
  }
  return db.transaction(async (tx) => {
    const plan = await planFrom(tx, input);
    onPlan?.(plan);
    await applyLoad(tx, plan);
    return plan;
  });
}

async function planFrom(db: Db | Tx, { source, recipes, catalog }: LoadInput): Promise<LoadPlan> {
  const sourceIds = recipes.filter((r) => r.status === "approved").map((r) => r.sourceId);
  const snapshot = await readSnapshot(db, source, usedIngredientNames(recipes), sourceIds);
  const result = planLoad(source, recipes, catalog, snapshot);
  if (!result.ok) throw new CliError(`Load refused, nothing written:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`);
  return result.plan;
}
