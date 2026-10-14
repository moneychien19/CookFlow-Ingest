import { join } from "node:path";

/** Where each stage reads and writes, relative to the repo root (SPEC §4). */
export const DATA_DIR = "data";
export const CATALOG_PATH = join(DATA_DIR, "ingredients.json");
/** Claude's per-name proposals behind the catalog draft (catalog:bootstrap). */
export const PROPOSALS_PATH = join(DATA_DIR, "catalog", "bootstrap-proposals.json");
export const recipesPath = (source: string) => join(DATA_DIR, source, "recipes.json");
