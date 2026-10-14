import type { StructuredCall } from "@/claude/client";
import type { UsageTally } from "@/claude/usage";
import { ingredientName, normalizeName } from "@/schema/catalog";
import { proposalBatch, SYSTEM_PROMPT, userMessage, type SourceName } from "./prompt";
import type { Proposal } from "./proposals";

export type ProposeOptions = {
  call: StructuredCall;
  tally: UsageTally;
  /** Called after every batch with all proposals so far, so progress is saved as it goes. */
  save: (proposals: Proposal[]) => void;
  log?: (line: string) => void;
  batchSize?: number;
  /** Most new names to propose in this run. */
  limit?: number;
  maxRequests?: number;
  /** Canonical names that already exist (e.g. reviewed catalog entries), to reuse. */
  knownCanonicalNames?: string[];
};

/**
 * Asks Claude for a proposal for every source name that doesn't have one yet, in
 * alphabetical batches. Proposals that break the catalog rules (bad name, missing unit,
 * a name that wasn't asked) are dropped and reported; those names are asked again next run.
 */
export async function proposeMissing(
  names: SourceName[],
  existing: Proposal[],
  { call, tally, save, log = () => {}, batchSize = 50, limit = Infinity, maxRequests = Infinity, knownCanonicalNames = [] }: ProposeOptions,
): Promise<Proposal[]> {
  const proposals = [...existing];
  const done = new Set(existing.map((p) => p.sourceName));
  const pending = uniqueByNormalized(names)
    .filter((n) => !done.has(n.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .slice(0, limit);

  for (let start = 0; start < pending.length; start += batchSize) {
    if (tally.requests >= maxRequests) {
      log(`Stopped at --max-requests ${maxRequests}; ${pending.length - start} names left for the next run.`);
      break;
    }
    const batch = pending.slice(start, start + batchSize);
    const known = new Set([...knownCanonicalNames, ...proposals.flatMap((p) => (p.canonicalName ? [p.canonicalName] : []))]);
    const { output, usage } = await call({
      system: SYSTEM_PROMPT,
      user: userMessage(batch, [...known].sort()),
      schema: proposalBatch,
    });
    tally.add(usage);

    const asked = new Set(batch.map((n) => n.name));
    let accepted = 0;
    for (const reply of output.proposals) {
      if (!asked.delete(reply.sourceName)) {
        log(`  dropped "${reply.sourceName}": not one of the names asked (or a duplicate)`);
        continue;
      }
      const problem = checkReply(reply);
      if (problem) {
        log(`  dropped "${reply.sourceName}": ${problem}`);
        continue;
      }
      proposals.push({ ...reply, note: reply.note || null });
      accepted++;
    }
    for (const missing of asked) log(`  no proposal for "${missing}"`);
    save(proposals);
    log(`Batch ${start / batchSize + 1}: ${accepted}/${batch.length} names proposed.`);
  }
  return proposals;
}

function checkReply(reply: Proposal): string | null {
  if (reply.canonicalName === null) return null;
  if (!ingredientName.safeParse(reply.canonicalName).success) return `invalid canonical name "${reply.canonicalName}"`;
  if (reply.unit === null) return "no unit";
  return null;
}

/** Normalizes names (they become aliases) and keeps the first of any that collide. */
function uniqueByNormalized(names: SourceName[]): SourceName[] {
  const byName = new Map<string, SourceName>();
  for (const n of names) {
    const name = normalizeName(n.name);
    if (name !== "" && !byName.has(name)) byName.set(name, { name, category: n.category });
  }
  return [...byName.values()];
}
