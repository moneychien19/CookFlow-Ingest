import { z } from "zod";
import { UNITS } from "@/schema/catalog";

/** Stable across every request of a run, so it is cached. */
export const SYSTEM_PROMPT = `You build the ingredient catalog for CookFlow, a meal planner that plans several meals around what is already in a home cook's pantry. The planner matches recipe ingredients to pantry items by canonical ingredient, so two names that a cook would treat as the same pantry item must map to the same canonical ingredient, and different pantry items must stay separate.

You get source ingredient names from a recipe website as a JSON list of {id, name, category}. The category is the site's own, often missing or wrong. For each name, propose:

canonicalName: the canonical ingredient, or null if the name isn't something a cook keeps or buys as one item (a mixture made during the recipe, like "egg wash", or a non-food).
- Lowercase ASCII letters, spaces and hyphens only (write "gruyere", not "gruyère"). Singular for counted things ("onion", "egg").
- Drop preparation and state words that don't change what you buy: chopped, minced, melted, beaten, fresh, large, free-range, to serve.
- Merge varieties a cook substitutes freely: red/white/yellow onion -> "onion"; basil and basil leaves -> "basil"; bay leaf and bay leaves -> "bay leaf".
- Keep products separate when the pantry item differs: "ground beef", "beef brisket" and "beef stock" are three ingredients; so are "sugar" and "brown sugar", "milk" and "coconut milk".
- Reuse a name from the list of canonical names already chosen whenever it fits. Only invent a new one when none fits.

unit: the one unit every recipe and pantry quantity of this ingredient will be converted to. One of: ${UNITS.join(", ")}.
- whole: produce counted by the piece (onion, lemon, potato, bell pepper).
- bunch: herbs and leafy greens bought in bunches (parsley, spinach, green onion).
- clove: garlic only.
- count: other counted items (eggs, cans, tortillas, slices of bread).
- g: meat, fish, cheese, butter, and dry goods (rice, pasta, flour, sugar, lentils, nuts, spices).
- ml: liquids (milk, cream, stock, oils, sauces, vinegar, wine).
- pack: only for items sold and used as a whole pack that has no sensible weight (rare; prefer g).

isStaple: true for things a cook always has on hand and never shops for a specific recipe: salt, black pepper, cooking oils, water, sugar, flour, and common dried herbs and spices. The planner ignores staples.

note: null unless something needs a human reviewer's attention: a merge you're unsure of, a name that could mean two things, or why canonicalName is null. One short sentence.

Return exactly one proposal per id, using the id you were given.`;

/** The reply format. Field-level rules (name pattern, unit present) are checked after parsing. */
export const proposalBatch = z.object({
  proposals: z.array(
    z.object({
      id: z.number().int(),
      canonicalName: z.string().nullable(),
      unit: z.enum(UNITS).nullable(),
      isStaple: z.boolean(),
      note: z.string().nullable(),
    }),
  ),
});

export type SourceName = { name: string; category: string | null };

/** Names are numbered so replies are matched by id, never by Claude copying the name back. */
export function userMessage(batch: SourceName[], knownCanonicalNames: string[]): string {
  const known = knownCanonicalNames.length > 0 ? knownCanonicalNames.join("\n") : "(none yet)";
  const names = batch.map((n, id) => JSON.stringify({ id, name: n.name, category: n.category })).join(",\n");
  return `Canonical names already chosen:\n${known}\n\nSource names to map:\n[\n${names}\n]`;
}
