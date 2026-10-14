import { normalizeName, type CatalogEntry } from "@/schema/catalog";

export type Matcher = (sourceName: string) => CatalogEntry | null;

/**
 * Looks a source name up against catalog names and aliases, reviewed or not (SPEC §5.3
 * step 1). Only validation decides whether an unreviewed entry may be used.
 */
export function createMatcher(catalog: CatalogEntry[]): Matcher {
  const byKey = new Map<string, CatalogEntry>();
  for (const entry of catalog) {
    for (const key of [entry.name, ...entry.aliases]) byKey.set(key, entry);
  }
  return (sourceName) => byKey.get(normalizeName(sourceName)) ?? null;
}
