import type { CatalogEntry, Unit } from "@/schema/catalog";
import type { ReviewedRecipe } from "@/schema/reviewed";

export type DbIngredient = { name: string; unit: Unit; isStaple: boolean };

/** What the load needs to know about the database, read before planning. */
export type DbSnapshot = {
  /** Existing ingredients among the names that approved recipes use. */
  ingredients: DbIngredient[];
  /** `source_id`s of this source's recipes that are already in the database. */
  existingSourceIds: string[];
};

export type LoadLine = { ingredient: string; quantity: number; sourceName: string; sourceMeasure: string };
export type LoadRecipe = Omit<ReviewedRecipe, "status" | "dropReason" | "lines"> & { lines: LoadLine[] };

export type LoadPlan = {
  source: string;
  /** Catalog entries that approved recipes use and the database doesn't have yet (SPEC §5.2). */
  ingredientsToInsert: DbIngredient[];
  recipesToInsert: LoadRecipe[];
  recipesToUpdate: LoadRecipe[];
  lineCount: number;
};

export type PlanResult = { ok: true; plan: LoadPlan } | { ok: false; errors: string[] };

const approvedOnly = (recipes: ReviewedRecipe[]) => recipes.filter((r) => r.status === "approved");

/** Canonical ingredient names used by approved recipes, for reading the snapshot. */
export function usedIngredientNames(recipes: ReviewedRecipe[]): string[] {
  const names = approvedOnly(recipes).flatMap((r) => r.lines.flatMap((l) => (l.ingredient ? [l.ingredient] : [])));
  return [...new Set(names)].sort();
}

/**
 * Decides what loading `source`'s approved recipes would write, without touching the
 * database. Fails if a line isn't mapped, uses an ingredient that isn't a reviewed
 * catalog entry, or uses an ingredient whose unit or staple flag in the database
 * differs from the catalog: existing ingredients are never modified (SPEC §5.2).
 * The full §5.6 checks (decimals, duplicates, verbatim text) are validation's job.
 */
export function planLoad(
  source: string,
  recipes: ReviewedRecipe[],
  catalog: CatalogEntry[],
  snapshot: DbSnapshot,
): PlanResult {
  const errors: string[] = [];
  const catalogByName = new Map(catalog.map((e) => [e.name, e]));
  const inDb = new Map(snapshot.ingredients.map((i) => [i.name, i]));
  const existing = new Set(snapshot.existingSourceIds);

  const loadRecipes: LoadRecipe[] = [];
  for (const recipe of approvedOnly(recipes)) {
    const where = `${recipe.source}/${recipe.sourceId} "${recipe.title}"`;
    if (recipe.source !== source) errors.push(`${where}: source is not "${source}"`);
    const lines: LoadLine[] = [];
    for (const line of recipe.lines) {
      const { ingredient, quantity, sourceName, sourceMeasure } = line;
      if (ingredient === null || quantity === null) {
        errors.push(`${where}: line "${sourceName}" has no ingredient or quantity`);
        continue;
      }
      lines.push({ ingredient, quantity, sourceName, sourceMeasure });
    }
    const { sourceId, title, imageUrl, instructions, servings, tags } = recipe;
    loadRecipes.push({ source: recipe.source, sourceId, title, imageUrl, instructions, servings, tags, lines });
  }

  const ingredientsToInsert: DbIngredient[] = [];
  for (const name of usedIngredientNames(recipes)) {
    const entry = catalogByName.get(name);
    if (!entry) {
      errors.push(`ingredient "${name}" is not in the catalog`);
      continue;
    }
    if (!entry.reviewed) errors.push(`ingredient "${name}" hasn't been reviewed in the catalog`);
    const current = inDb.get(name);
    if (!current) {
      ingredientsToInsert.push({ name, unit: entry.unit, isStaple: entry.isStaple });
      continue;
    }
    if (current.unit !== entry.unit) {
      errors.push(`ingredient "${name}": database unit is "${current.unit}", catalog unit is "${entry.unit}"`);
    }
    if (current.isStaple !== entry.isStaple) {
      errors.push(`ingredient "${name}": database is_staple is ${current.isStaple}, catalog says ${entry.isStaple}`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      source,
      ingredientsToInsert,
      recipesToInsert: loadRecipes.filter((r) => !existing.has(r.sourceId)),
      recipesToUpdate: loadRecipes.filter((r) => existing.has(r.sourceId)),
      lineCount: loadRecipes.reduce((n, r) => n + r.lines.length, 0),
    },
  };
}
