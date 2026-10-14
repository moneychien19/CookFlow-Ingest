import { z } from "zod";
import { ingredientName } from "./catalog";

export const STATUSES = ["pending", "approved", "dropped"] as const;
export const METHODS = ["rule", "claude", "manual"] as const;

/**
 * One ingredient line in data/<source>/recipes.json (SPEC §5.6). Quantity limits
 * (numeric(8,2)) are checked by validation on approved recipes, not here, so a
 * hand-edited file with a bad quantity still reads and every problem is reported at once.
 */
export const reviewedLine = z.strictObject({
  sourceName: z.string(),
  sourceMeasure: z.string(),
  ingredient: ingredientName.nullable(),
  quantity: z.number().nullable(),
  method: z.enum(METHODS).nullable(),
  note: z.string().nullable(),
});

export const reviewedRecipe = z.strictObject({
  source: z.string().min(1),
  sourceId: z.string().min(1),
  title: z.string().min(1),
  imageUrl: z.url().nullable(),
  instructions: z.string().min(1),
  servings: z.int().positive().nullable(),
  tags: z.array(z.string().min(1)),
  status: z.enum(STATUSES),
  dropReason: z.string().min(1).nullable(),
  lines: z.array(reviewedLine),
});

export const recipesFile = z.array(reviewedRecipe);

export type ReviewedLine = z.infer<typeof reviewedLine>;
export type ReviewedRecipe = z.infer<typeof reviewedRecipe>;
