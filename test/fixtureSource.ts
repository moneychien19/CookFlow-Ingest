import { z } from "zod";
import type { FetchedRecord, SourceAdapter } from "@/sources/types";

// A fake source for tests. Its record shape is unlike TheMealDB's on purpose, so shared
// code that assumes TheMealDB's field names fails here.
export const fixtureRaw = z.strictObject({
  key: z.string(),
  heading: z.string(),
  method: z.string(),
  parts: z.array(z.strictObject({ what: z.string(), howMuch: z.string() })),
});
export type FixtureRaw = z.infer<typeof fixtureRaw>;

export const fixtureRecord = (key: string, extra: Partial<FixtureRaw> = {}): FixtureRaw => ({
  key,
  heading: `Fixture ${key}`,
  method: "Mix.\r\nServe. ",
  parts: [{ what: " Onion ", howMuch: "1" }],
  ...extra,
});

/** A fixture source serving `records`. `requested` lists the ids the runner actually pulled. */
export function fixtureSource(records: unknown[]): SourceAdapter<FixtureRaw> & { requested: string[] } {
  const requested: string[] = [];
  return {
    name: "fixture",
    rawSchema: fixtureRaw,
    requested,
    async *fetch(): AsyncIterable<FetchedRecord> {
      for (const raw of records) {
        const id = String((raw as { key?: unknown }).key);
        requested.push(id);
        yield { id, raw };
      }
    },
    toSourceRecipe: (raw) => ({
      sourceId: raw.key,
      title: raw.heading,
      instructions: raw.method,
      imageUrl: null,
      servings: null,
      tags: [],
      lines: raw.parts.map((p) => ({ name: p.what, measure: p.howMuch })),
    }),
  };
}
