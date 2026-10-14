import type { LoadPlan } from "./plan";

const list = (items: string[]) => items.map((item) => `  - ${item}`);
const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;

/** What a load writes, printed before writing and by --dry-run (SPEC §5.7). */
export function formatPlan(plan: LoadPlan): string {
  const recipe = (r: LoadPlan["recipesToInsert"][number]) => `${r.sourceId} ${r.title} (${lines(r.lines.length)})`;
  return [
    `Ingredients to insert: ${plan.ingredientsToInsert.length}`,
    ...list(plan.ingredientsToInsert.map((i) => `${i.name} [${i.unit}${i.isStaple ? ", staple" : ""}]`)),
    `Recipes to insert: ${plan.recipesToInsert.length}`,
    ...list(plan.recipesToInsert.map(recipe)),
    `Recipes to update: ${plan.recipesToUpdate.length}`,
    ...list(plan.recipesToUpdate.map(recipe)),
    `Recipe ingredient lines to write: ${plan.lineCount}`,
  ].join("\n");
}
