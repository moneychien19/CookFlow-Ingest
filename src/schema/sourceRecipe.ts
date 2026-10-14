import { z } from "zod";

/**
 * What every source adapter's `toSourceRecipe` returns (SPEC §4). Strings are verbatim:
 * the schema never trims or rewrites them (SPEC §3 rule 1).
 */
export const sourceLine = z.strictObject({
  name: z.string().refine((s) => s.trim() !== "", "blank ingredient name (the adapter should skip this pair)"),
  measure: z.string(),
});

export const sourceRecipe = z.strictObject({
  sourceId: z.string().min(1),
  title: z.string().min(1),
  instructions: z.string().min(1),
  imageUrl: z.url().nullable(),
  servings: z.int().positive().nullable(),
  tags: z.array(z.string().min(1)),
  lines: z.array(sourceLine).min(1),
});

export type SourceLine = z.infer<typeof sourceLine>;
export type SourceRecipe = z.infer<typeof sourceRecipe>;
