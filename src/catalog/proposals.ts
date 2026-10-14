import { existsSync } from "node:fs";
import { z } from "zod";
import { readJson, writeJsonFile } from "@/io/json";
import { ingredientName, unit } from "@/schema/catalog";

/**
 * Claude's proposal for one source ingredient name: which canonical ingredient it is,
 * that ingredient's unit, and whether it's a staple. `canonicalName: null` means "not an
 * ingredient to track" (e.g. a mixture like "egg wash"). Saved so no name is asked twice.
 */
export const proposal = z.strictObject({
  /** Normalized source name (lowercase, trimmed); becomes an alias. */
  sourceName: z.string().min(1),
  canonicalName: ingredientName.nullable(),
  unit: unit.nullable(),
  isStaple: z.boolean(),
  note: z.string().nullable(),
});
export const proposalsFile = z.array(proposal);
export type Proposal = z.infer<typeof proposal>;

export function readProposals(path: string): Proposal[] {
  return existsSync(path) ? readJson(path, proposalsFile) : [];
}

export function writeProposals(path: string, proposals: Proposal[]): void {
  const sorted = proposals.toSorted((a, b) => a.sourceName.localeCompare(b.sourceName, "en"));
  writeJsonFile(path, proposalsFile.parse(sorted));
}
