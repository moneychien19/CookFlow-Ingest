import { and, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { ingredients, isCatalog, recipes } from "@/db/schema";
import type { DbSnapshot } from "./plan";

/** Reads only what `planLoad` needs: the used catalog ingredients, and which recipes already exist. */
export async function readSnapshot(db: Db | Tx, source: string, names: string[], sourceIds: string[]): Promise<DbSnapshot> {
  const [existingIngredients, existingRecipes] = await Promise.all([
    names.length === 0
      ? []
      : db
          .select({ name: ingredients.name, unit: ingredients.unit, isStaple: ingredients.isStaple })
          .from(ingredients)
          .where(and(isCatalog, inArray(ingredients.name, names))),
    sourceIds.length === 0
      ? []
      : db
          .select({ sourceId: recipes.sourceId })
          .from(recipes)
          .where(and(eq(recipes.source, source), inArray(recipes.sourceId, sourceIds))),
  ]);
  return { ingredients: existingIngredients, existingSourceIds: existingRecipes.map((r) => r.sourceId) };
}
