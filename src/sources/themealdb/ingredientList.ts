import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CliError } from "@/errors";
import { writeJsonFile } from "@/io/json";
import { DATA_DIR } from "@/io/paths";
import type { SourceName } from "@/catalog/prompt";
import { BASE_URL, httpGetJson, type GetJson } from "./fetch";

export const INGREDIENT_LIST_PATH = join(DATA_DIR, "themealdb", "ingredients.raw.json");

const ingredientListResponse = z.object({
  meals: z.array(z.looseObject({ strIngredient: z.string(), strType: z.string().nullish() })),
});

/**
 * TheMealDB's ingredient list (list.php?i=list): the names its recipes use, with a
 * category for about half of them. Cached as returned, so the bootstrap is reproducible.
 */
export async function readIngredientList(path = INGREDIENT_LIST_PATH, getJson: GetJson = httpGetJson): Promise<SourceName[]> {
  let raw: unknown;
  if (existsSync(path)) {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } else {
    raw = await getJson(`${BASE_URL}list.php?i=list`);
    writeJsonFile(path, raw);
  }
  const result = ingredientListResponse.safeParse(raw);
  if (!result.success) throw new CliError(`Unexpected ingredient list in ${path}:\n${z.prettifyError(result.error)}`);
  return result.data.meals.map((m) => ({ name: m.strIngredient, category: m.strType || null }));
}
