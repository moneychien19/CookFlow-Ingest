import type { SourceAdapter } from "@/sources/types";
import { fetchMeals, type FetchOptions } from "./fetch";
import { mealRaw, type MealRaw } from "./raw";
import { toSourceRecipe } from "./toSourceRecipe";

export function createTheMealDb(options: FetchOptions = {}): SourceAdapter<MealRaw> {
  return {
    name: "themealdb",
    rawSchema: mealRaw,
    fetch: () => fetchMeals(options),
    toSourceRecipe,
  };
}

export const themealdb = createTheMealDb();
