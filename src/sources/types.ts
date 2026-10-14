import type { z } from "zod";
import type { SourceRecipe } from "@/schema/sourceRecipe";

/** One record as the source returned it, before validation. `id` names its cache file. */
export type FetchedRecord = { id: string; raw: unknown };

export type FetchContext = {
  /** Lets an adapter skip requests for records that are already cached. */
  isCached(id: string): boolean;
};

/**
 * Everything specific to one recipe source (SPEC §4). The adapter only talks to the
 * source and converts its records; validation, caching, and the limit are shared code.
 */
export interface SourceAdapter<Raw> {
  /** Written to recipes.source; also the folder name under data/. */
  name: string;
  /** Validates fetched records and cached files. */
  rawSchema: z.ZodType<Raw>;
  /** Yields records in the source's own order and pacing. The caller may stop early. */
  fetch(ctx: FetchContext): AsyncIterable<FetchedRecord>;
  /** Pure. Keeps the source's strings verbatim (SPEC §3 rule 1). */
  toSourceRecipe(raw: Raw): SourceRecipe;
}
