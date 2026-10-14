import { catalogFile, type CatalogEntry } from "@/schema/catalog";
import { recipesFile, type ReviewedRecipe } from "@/schema/reviewed";
import { readJson, writeJson } from "./json";

// Files are written in a fixed order so reruns produce clean git diffs.
const natural = new Intl.Collator("en", { numeric: true });

export const readRecipes = (path: string): ReviewedRecipe[] => readJson(path, recipesFile);

export function writeRecipes(path: string, recipes: ReviewedRecipe[]): void {
  writeJson(path, recipesFile, recipes.toSorted((a, b) => natural.compare(a.sourceId, b.sourceId)));
}

export const readCatalog = (path: string): CatalogEntry[] => readJson(path, catalogFile);

export function writeCatalog(path: string, catalog: CatalogEntry[]): void {
  writeJson(path, catalogFile, catalog.toSorted((a, b) => natural.compare(a.name, b.name)));
}
