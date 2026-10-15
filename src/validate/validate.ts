import type { CatalogEntry } from "@/schema/catalog";
import type { ReviewedRecipe } from "@/schema/reviewed";
import type { SourceRecipe } from "@/schema/sourceRecipe";
import { keepsEveryWord } from "@/steps/words";

/** The recipe as the source gave it, from the raw cache, or null if it isn't cached. */
export type RawLookup = (sourceId: string) => SourceRecipe | null;

const MAX_QUANTITY = 999999.99;

/**
 * Checks every approved recipe against SPEC §3 rules 1–6 and §5.6 before anything is
 * loaded. Returns every problem found, each naming its recipe; an empty list means valid.
 */
export function validateApproved(
  source: string,
  recipes: ReviewedRecipe[],
  catalog: CatalogEntry[],
  rawRecipe: RawLookup,
): string[] {
  const catalogByName = new Map(catalog.map((e) => [e.name, e]));
  const errors: string[] = [];
  for (const recipe of recipes.filter((r) => r.status === "approved")) {
    const fail = (problem: string) => errors.push(`${recipe.sourceId} "${recipe.title}": ${problem}`);
    if (recipe.source !== source) fail(`source is "${recipe.source}", not "${source}"`);
    checkVerbatim(recipe, rawRecipe(recipe.sourceId), fail);

    const seen = new Set<string>();
    recipe.lines.forEach((line, i) => {
      const at = `line ${i + 1} "${line.sourceName}"`;
      if (line.ingredient === null) {
        fail(`${at} has no ingredient`);
      } else {
        const entry = catalogByName.get(line.ingredient);
        if (!entry) fail(`${at}: ingredient "${line.ingredient}" is not in the catalog`);
        else if (!entry.reviewed) fail(`${at}: ingredient "${line.ingredient}" hasn't been reviewed in the catalog`);
        if (seen.has(line.ingredient)) fail(`ingredient "${line.ingredient}" appears more than once`);
        seen.add(line.ingredient);
      }
      const problem = quantityProblem(line.quantity);
      if (problem) fail(`${at}: ${problem}`);
    });
  }
  return errors;
}

/**
 * SPEC §3 rule 1: title and each line's name and measure exactly as the source gave them;
 * instructions either exactly, or as numbered steps that keep every word.
 */
function checkVerbatim(recipe: ReviewedRecipe, raw: SourceRecipe | null, fail: (problem: string) => void): void {
  if (!raw) return fail("not in the raw cache");
  if (recipe.title !== raw.title) fail("title differs from the raw cache");
  if (!keepsEveryWord(raw.instructions, recipe.instructions)) {
    fail("instructions differ from the raw cache (only the step numbering may change)");
  }
  if (recipe.lines.length !== raw.lines.length) {
    return fail(`has ${recipe.lines.length} lines, the raw cache has ${raw.lines.length} (lines can't be added or removed)`);
  }
  recipe.lines.forEach((line, i) => {
    const original = raw.lines[i];
    if (line.sourceName !== original?.name || line.sourceMeasure !== original.measure) {
      fail(`line ${i + 1}: source name or measure differs from the raw cache`);
    }
  });
}

/** SPEC §3 rule 3: fits numeric(8,2) without rounding. */
function quantityProblem(quantity: number | null): string | null {
  if (quantity === null) return "no quantity";
  if (!(quantity > 0)) return `quantity ${quantity} must be greater than 0`;
  if (quantity > MAX_QUANTITY) return `quantity ${quantity} is larger than ${MAX_QUANTITY}`;
  if (Math.abs(quantity * 100 - Math.round(quantity * 100)) > 1e-9) return `quantity ${quantity} has more than 2 decimals`;
  return null;
}
