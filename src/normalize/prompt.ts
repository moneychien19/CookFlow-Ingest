import { z } from "zod";
import { UNITS, type CatalogEntry } from "@/schema/catalog";
import type { ReviewedRecipe } from "@/schema/reviewed";

/**
 * Built once per run from the catalog as it was at the start, so it stays byte-identical
 * (and cached) across the run's requests. Ingredients added during the run go in the
 * user message instead.
 */
export function systemPrompt(catalog: CatalogEntry[]): string {
  const entries = catalog
    .map((e) => `${e.name} (${e.unit}${e.isStaple ? ", staple" : ""})`)
    .sort()
    .join("\n");
  return `You map recipe ingredient lines for CookFlow, a meal planner that plans meals around what is already in a home cook's pantry. Every ingredient has one canonical unit, and every recipe quantity is stored in that unit, so the planner can subtract it from the pantry. Rules already mapped the easy lines; you get the lines they couldn't.

For each line, answer with one of:
- "existing": an ingredient from the catalog below, with the quantity in that ingredient's unit.
- "new": only when no catalog ingredient fits. Give the new ingredient's name (lowercase ASCII letters, spaces and hyphens; singular for counted things), its unit, whether it's a staple, and the quantity in that unit.
- "cant_map": when the line can't be turned into an amount of one pantry ingredient (e.g. "1 portion of the sauce above").

When a line already names its ingredient ("ingredient" is set), keep that ingredient and only work out the quantity in its unit, or answer "cant_map". Never switch it to another ingredient.

Units: ${UNITS.join(", ")}. whole = produce by the piece; bunch = herbs and leafy greens; clove = garlic; count = other counted items (eggs, cans, slices); g = grams; ml = millilitres.

Converting quantities:
- Use typical sizes and densities: a medium potato is about 200 g, a medium onion about 150 g, a large carrot about 100 g; 1 tbsp of chopped herbs is about 0.1 bunch; 1 tbsp of a thick paste is about 15 g; 1 tbsp of grated ginger is about 6 g; 1 cup of uncooked rice is about 190 g.
- For a vague amount of a non-staple ("to serve", "a handful", "for garnish"), estimate a typical amount for the dish and say so in the note.
- A range ("4-5 pound") takes the middle. A multiple ("2 x 400g tins") takes the total.
- Round to at most 2 decimals. Quantities must be greater than 0.

note: always one short sentence a human reviewer can check, e.g. "900 g at about 200 g per potato".

Catalog (name, unit, staple):
${entries}`;
}

/** The reply format; ingredient and quantity rules are checked after parsing. */
export const lineReplies = z.object({
  lines: z.array(
    z.object({
      id: z.number().int(),
      result: z.enum(["existing", "new", "cant_map"]),
      ingredient: z.string().nullable(),
      unit: z.enum(UNITS).nullable(),
      isStaple: z.boolean().nullable(),
      quantity: z.number().nullable(),
      note: z.string(),
    }),
  ),
});
export type LineReply = z.output<typeof lineReplies>["lines"][number];

/**
 * The whole recipe, so Claude sees context (the same ingredient used twice, the dish),
 * with an id on each line it should answer. Ingredients added earlier in this run are
 * listed, since they aren't in the cached catalog.
 */
export function userMessage(recipe: ReviewedRecipe, ask: Set<number>, addedThisRun: CatalogEntry[]): string {
  const lines = recipe.lines.map((line, id) =>
    JSON.stringify({
      ...(ask.has(id) ? { id } : {}),
      name: line.sourceName,
      measure: line.sourceMeasure,
      ingredient: line.ingredient,
      ...(ask.has(id) ? {} : { quantity: line.quantity }),
    }),
  );
  const added = addedThisRun.length > 0 ? `\n\nIngredients added to the catalog during this run:\n${addedThisRun.map((e) => `${e.name} (${e.unit}${e.isStaple ? ", staple" : ""})`).join("\n")}` : "";
  return `Recipe: ${recipe.title}\n\nLines (answer every line that has an id; the others are already mapped and are context):\n${lines.join("\n")}${added}`;
}
