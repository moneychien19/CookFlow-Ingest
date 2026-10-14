import { z } from "zod";

/** Matches the CHECK on CookFlow's `ingredients.unit` (migration 0001_gram_units). */
export const UNITS = ["whole", "pack", "bunch", "clove", "count", "g", "ml"] as const;
export const unit = z.enum(UNITS);
export type Unit = z.infer<typeof unit>;

/** Canonical ingredient name, same rule as CookFlow's seed: lowercase and trimmed, e.g. "chicken breast". */
export const ingredientName = z
  .string()
  .regex(/^[a-z][a-z -]*[a-z]$/, 'lowercase letters, spaces, and hyphens, e.g. "chicken breast"');

/** A lowercased, trimmed source name that means this ingredient, e.g. "red onion" → onion. */
const alias = z
  .string()
  .min(1)
  .refine((s) => s === s.trim().toLowerCase(), "lowercase and trimmed");

/** One entry in data/ingredients.json (SPEC §5.2). */
export const catalogEntry = z.strictObject({
  name: ingredientName,
  unit,
  isStaple: z.boolean(),
  aliases: z.array(alias),
  /** Only reviewed entries can be used by approved recipes or loaded. */
  reviewed: z.boolean(),
  note: z.string().nullable(),
});

export const catalogFile = z.array(catalogEntry);

export type CatalogEntry = z.infer<typeof catalogEntry>;
