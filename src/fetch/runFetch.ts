import type { RawCache } from "@/sources/rawCache";
import type { SourceAdapter } from "@/sources/types";

export type FetchResult = { written: string[]; skipped: number; total: number };

/**
 * Fetches until the cache holds `limit` records. Cached records are never refetched or
 * rewritten. A record that fails validation stops the run; records already written stay.
 */
export async function runFetch<Raw>(
  adapter: SourceAdapter<Raw>,
  cache: RawCache<Raw>,
  { limit }: { limit: number },
): Promise<FetchResult> {
  const written: string[] = [];
  let skipped = 0;
  let total = cache.ids().length;
  if (total >= limit) return { written, skipped, total };

  // Leaving the loop early (break or throw) ends the adapter's generator, so it stops requesting.
  for await (const { id, raw } of adapter.fetch({ isCached: (id) => cache.has(id) })) {
    if (cache.has(id)) {
      skipped++;
      continue;
    }
    cache.write(id, raw);
    written.push(id);
    total++;
    if (total >= limit) break;
  }
  return { written, skipped, total };
}
