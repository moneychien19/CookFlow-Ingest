import { z } from "zod";
import { CliError } from "@/errors";
import type { FetchedRecord } from "@/sources/types";
import { searchResponse } from "./raw";

export const BASE_URL = "https://www.themealdb.com/api/json/v1/1/";
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
/** CookFlow plans meals around the fridge, so these are never fetched (SPEC §5.1). */
export const SKIPPED_CATEGORIES = new Set(["Dessert"]);

export type GetJson = (url: string) => Promise<unknown>;
export type FetchOptions = { getJson?: GetJson; delayMs?: number };

/**
 * Walks search.php?f=<letter> from a to z, one request at a time with a pause between
 * them. search.php already returns whole meals, so lookup.php is never needed. Meals in
 * SKIPPED_CATEGORIES aren't yielded, so they don't count toward --limit or get cached.
 */
export async function* fetchMeals({ getJson = httpGetJson, delayMs = 500 }: FetchOptions = {}): AsyncIterable<FetchedRecord> {
  for (const [i, letter] of [...LETTERS].entries()) {
    if (i > 0 && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const url = `${BASE_URL}search.php?f=${letter}`;
    const result = searchResponse.safeParse(await getJson(url));
    if (!result.success) throw new CliError(`Unexpected response from ${url}:\n${z.prettifyError(result.error)}`);
    for (const meal of result.data.meals ?? []) {
      if (meal.strCategory && SKIPPED_CATEGORIES.has(meal.strCategory)) continue;
      yield { id: meal.idMeal, raw: meal };
    }
  }
}

export async function httpGetJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new CliError(`Request failed: ${url} (${(err as Error).message}). Rerun to resume; cached meals are kept.`);
  }
  if (!response.ok) throw new CliError(`Request failed: ${url} (HTTP ${response.status}). Rerun to resume; cached meals are kept.`);
  return response.json();
}
