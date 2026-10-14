import type { CatalogEntry } from "@/schema/catalog";
import type { ReviewedLine, ReviewedRecipe } from "@/schema/reviewed";

// Small builders for recipes and catalog entries in tests. Defaults are a valid,
// approved themealdb recipe and a reviewed, non-staple catalog entry.

export const entry = (name: string, unit: CatalogEntry["unit"], extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  name,
  unit,
  isStaple: false,
  aliases: [],
  reviewed: true,
  note: null,
  ...extra,
});

export const line = (ingredient: string | null, quantity: number | null): ReviewedLine => ({
  sourceName: ingredient ?? "mystery",
  sourceMeasure: "1",
  ingredient,
  quantity,
  method: ingredient ? "rule" : null,
  note: null,
});

export const recipe = (sourceId: string, lines: ReviewedLine[], extra: Partial<ReviewedRecipe> = {}): ReviewedRecipe => ({
  source: "themealdb",
  sourceId,
  title: `Recipe ${sourceId}`,
  imageUrl: null,
  instructions: "Cook it.",
  servings: null,
  tags: [],
  status: "approved",
  dropReason: null,
  lines,
  ...extra,
});
