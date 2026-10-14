import { inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { ingredients, recipeIngredients, recipes } from "@/db/schema";
import type { LoadPlan } from "./plan";

/**
 * Writes a plan inside the caller's transaction: inserts the new ingredients, upserts
 * recipes on (source, source_id), and replaces each loaded recipe's ingredient lines.
 * Existing ingredients, other sources, and recipes not in the plan are never touched.
 */
export async function applyLoad(tx: Tx, plan: LoadPlan): Promise<void> {
  if (plan.ingredientsToInsert.length > 0) await tx.insert(ingredients).values(plan.ingredientsToInsert);

  const loadRecipes = [...plan.recipesToInsert, ...plan.recipesToUpdate];
  if (loadRecipes.length === 0) return;

  const names = [...new Set(loadRecipes.flatMap((r) => r.lines.map((l) => l.ingredient)))];
  const ingredientId = new Map(
    (await tx.select({ id: ingredients.id, name: ingredients.name }).from(ingredients).where(inArray(ingredients.name, names))).map(
      (i) => [i.name, i.id],
    ),
  );

  const saved = await tx
    .insert(recipes)
    .values(
      loadRecipes.map(({ source, sourceId, title, imageUrl, instructions, servings, tags }) => ({
        source,
        sourceId,
        title,
        imageUrl,
        instructions,
        servings,
        tags,
      })),
    )
    .onConflictDoUpdate({
      target: [recipes.source, recipes.sourceId],
      set: {
        title: sql`excluded.title`,
        imageUrl: sql`excluded.image_url`,
        instructions: sql`excluded.instructions`,
        servings: sql`excluded.servings`,
        tags: sql`excluded.tags`,
      },
    })
    .returning({ id: recipes.id, sourceId: recipes.sourceId });
  const recipeId = new Map(saved.map((r) => [r.sourceId, r.id]));

  await tx.delete(recipeIngredients).where(inArray(recipeIngredients.recipeId, [...recipeId.values()]));
  const lines = loadRecipes.flatMap((recipe) =>
    recipe.lines.map((line) => ({
      recipeId: lookup(recipeId, recipe.sourceId),
      ingredientId: lookup(ingredientId, line.ingredient),
      quantity: line.quantity,
      sourceName: line.sourceName,
      sourceMeasure: line.sourceMeasure,
    })),
  );
  if (lines.length > 0) await tx.insert(recipeIngredients).values(lines);
}

function lookup<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  // planLoad checked every reference, so a miss here is a programmer error.
  if (value === undefined) throw new Error(`Load reference not found: ${String(key)}`);
  return value;
}
