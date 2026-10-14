import { z } from "zod";

/** strIngredient1..20 / strMeasure1..20. */
export const PAIR_NUMBERS = Array.from({ length: 20 }, (_, i) => i + 1);

const pairFields = Object.fromEntries(
  PAIR_NUMBERS.flatMap((n) => [
    [`strIngredient${n}`, z.string().nullish()],
    [`strMeasure${n}`, z.string().nullish()],
  ]),
);

/**
 * One meal from search.php or lookup.php. Loose: it checks the fields we read and keeps
 * the rest, so a new field in the API doesn't break fetching, and the cache keeps it.
 */
export const mealRaw = z.looseObject({
  idMeal: z.string().regex(/^\d+$/),
  strMeal: z.string().min(1),
  strCategory: z.string().nullable(),
  strInstructions: z.string().min(1),
  strMealThumb: z.string().nullable(),
  strTags: z.string().nullable(),
  ...pairFields,
});
export type MealRaw = z.infer<typeof mealRaw>;

/** strIngredient<n> and strMeasure<n> of a validated meal (string, null, or missing). */
export function pair(meal: MealRaw, n: number): { ingredient: string | null; measure: string | null } {
  const field = (key: string) => (meal[key] as string | null | undefined) ?? null;
  return { ingredient: field(`strIngredient${n}`), measure: field(`strMeasure${n}`) };
}

/** search.php's envelope. `meals` is null when a letter has no meals. Each meal is validated on its own. */
export const searchResponse = z.object({
  meals: z.array(z.looseObject({ idMeal: z.string(), strCategory: z.string().nullish() })).nullable(),
});
