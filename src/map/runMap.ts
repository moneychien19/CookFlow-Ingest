import type { Matcher } from "@/catalog/match";
import { CliError } from "@/errors";
import type { ReviewedRecipe } from "@/schema/reviewed";
import type { RawCache } from "@/sources/rawCache";
import type { SourceAdapter } from "@/sources/types";
import { isMapDrop, mapRecipe, NOMINAL_NOTE } from "./mapRecipe";

export type UnmappedLine = { sourceId: string; title: string; sourceName: string; sourceMeasure: string; ingredient: string | null; reason: string };

export type MapResult = {
  recipes: ReviewedRecipe[];
  /** Lines without a quantity in pending recipes: what normalize and the reviewer work on. */
  unmapped: UnmappedLine[];
  counts: { mapped: number; kept: number; dropped: number; pending: number; lines: number; rule: number; nominal: number; unmapped: number };
};

/**
 * Maps every cached record of a source and merges the result into the existing reviewed
 * file: approved recipes and a reviewer's drops are kept as they are; new, pending, and
 * map-dropped recipes are mapped again. Recipes no longer in the cache are kept.
 */
export function runMap<Raw>(
  adapter: SourceAdapter<Raw>,
  cache: RawCache<Raw>,
  existing: ReviewedRecipe[],
  match: Matcher,
): MapResult {
  const bySourceId = new Map(existing.map((r) => [r.sourceId, r]));
  const counts = { mapped: 0, kept: 0, dropped: 0, pending: 0, lines: 0, rule: 0, nominal: 0, unmapped: 0 };

  for (const id of cache.ids()) {
    const sourceRecipe = adapter.toSourceRecipe(cache.read(id));
    if (sourceRecipe.sourceId !== id) throw new CliError(`${cache.dir}/${id}.json has sourceId "${sourceRecipe.sourceId}"`);
    const previous = bySourceId.get(id);
    if (previous && (previous.status === "approved" || (previous.status === "dropped" && !isMapDrop(previous)))) {
      counts.kept++;
      continue;
    }
    bySourceId.set(id, mapRecipe(adapter.name, sourceRecipe, match, previous));
    counts.mapped++;
  }

  const recipes = [...bySourceId.values()];
  const unmapped: UnmappedLine[] = [];
  for (const recipe of recipes) {
    if (recipe.status === "dropped") counts.dropped++;
    if (recipe.status !== "pending") continue;
    counts.pending++;
    for (const line of recipe.lines) {
      counts.lines++;
      if (line.quantity === null) {
        counts.unmapped++;
        unmapped.push({
          sourceId: recipe.sourceId,
          title: recipe.title,
          sourceName: line.sourceName,
          sourceMeasure: line.sourceMeasure,
          ingredient: line.ingredient,
          reason: line.note ?? "",
        });
      } else if (line.method === "rule") {
        if (line.note === NOMINAL_NOTE) counts.nominal++;
        else counts.rule++;
      }
    }
  }
  return { recipes, unmapped, counts };
}
