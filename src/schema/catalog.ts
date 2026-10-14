import { z } from "zod";

/** Matches the CHECK on CookFlow's `ingredients.unit` (migration 0001_gram_units). */
export const UNITS = ["whole", "pack", "bunch", "clove", "count", "g", "ml"] as const;
export const unit = z.enum(UNITS);
export type Unit = z.infer<typeof unit>;

/** Canonical ingredient name, same rule as CookFlow's seed: lowercase and trimmed, e.g. "chicken breast". */
export const ingredientName = z
  .string()
  .regex(/^[a-z][a-z -]*[a-z]$/, 'lowercase letters, spaces, and hyphens, e.g. "chicken breast"');

/** How a source name is compared with catalog names and aliases (SPEC §5.3 step 1). */
export const normalizeName = (sourceName: string): string => sourceName.trim().toLowerCase();

/** A normalized source name that means this ingredient, e.g. "red onion" → onion. */
const alias = z
  .string()
  .min(1)
  .refine((s) => s === normalizeName(s), "lowercase and trimmed");

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

/**
 * The whole catalog. Every name and alias points at exactly one entry, so matching a
 * source name can never be ambiguous.
 */
export const catalogFile = z.array(catalogEntry).superRefine((entries, ctx) => {
  const owner = new Map<string, number>();
  entries.forEach((entry, i) => {
    const keys = [
      { key: entry.name, path: [i, "name"] },
      ...entry.aliases.map((key, j) => ({ key, path: [i, "aliases", j] })),
    ];
    for (const { key, path } of keys) {
      const other = owner.get(key);
      if (other === undefined) owner.set(key, i);
      else if (other !== i) {
        ctx.addIssue({ code: "custom", path, message: `"${key}" already belongs to "${entries[other]?.name}" (entry ${other})` });
      }
    }
  });
});

export type CatalogEntry = z.infer<typeof catalogEntry>;
