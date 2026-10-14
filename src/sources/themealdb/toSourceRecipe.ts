import type { SourceLine, SourceRecipe } from "@/schema/sourceRecipe";
import { pair, PAIR_NUMBERS, type MealRaw } from "./raw";

/** CookFlow's dietary filter reads only "vegetarian" (SPEC §5.1). */
const VEGETARIAN_CATEGORIES = new Set(["Vegetarian", "Vegan"]);

/** TheMealDB meal → SourceRecipe (SPEC §5.1). Strings are kept verbatim; nothing is trimmed. */
export function toSourceRecipe(meal: MealRaw): SourceRecipe {
  const lines: SourceLine[] = [];
  for (const n of PAIR_NUMBERS) {
    const { ingredient, measure } = pair(meal, n);
    if (ingredient === null || ingredient.trim() === "") continue;
    // source_measure is NOT NULL; TheMealDB sends "" or " " for "no measure", rarely null.
    lines.push({ name: ingredient, measure: measure ?? "" });
  }

  return {
    sourceId: meal.idMeal,
    title: meal.strMeal,
    instructions: meal.strInstructions,
    imageUrl: meal.strMealThumb || null,
    servings: null,
    tags: tagsOf(meal),
    lines,
  };
}

/** strCategory and the comma-separated strTags, lowercased, plus "vegetarian" for Vegetarian/Vegan. */
function tagsOf(meal: MealRaw): string[] {
  const tags = [meal.strCategory ?? "", ...(meal.strTags ?? "").split(",")].map((t) => t.trim().toLowerCase());
  if (meal.strCategory && VEGETARIAN_CATEGORIES.has(meal.strCategory)) tags.push("vegetarian");
  return [...new Set(tags.filter((t) => t !== ""))];
}
