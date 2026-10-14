import type { CatalogEntry, Unit } from "@/schema/catalog";
import type { Proposal } from "./proposals";

export type BuildResult = { catalog: CatalogEntry[]; warnings: string[] };

/**
 * Turns proposals into catalog entries: one draft entry (`reviewed: false`) per canonical
 * name, with the source names as aliases. Reviewed entries in `existing` are kept exactly
 * as they are, and every unreviewed entry is rebuilt from the proposals, so rerunning
 * never undoes review work. Disagreements between proposals become a `note`.
 */
export function buildCatalog(proposals: Proposal[], existing: CatalogEntry[]): BuildResult {
  const warnings: string[] = [];
  const reviewed = existing.filter((e) => e.reviewed);
  const reviewedByKey = new Map(reviewed.flatMap((e) => [e.name, ...e.aliases].map((k) => [k, e] as const)));

  const groups = new Map<string, Proposal[]>();
  for (const p of proposals) {
    if (p.canonicalName === null || p.unit === null || reviewedByKey.has(p.sourceName)) continue;
    const owner = reviewedByKey.get(p.canonicalName);
    if (owner) {
      warnings.push(`"${p.sourceName}" belongs to reviewed entry "${owner.name}"; add it as an alias by hand if that's right.`);
      continue;
    }
    groups.set(p.canonicalName, [...(groups.get(p.canonicalName) ?? []), p]);
  }

  const drafts: CatalogEntry[] = [];
  for (const [name, members] of groups) {
    const notes: string[] = [];
    const unit = majority(members.map((m) => m.unit as Unit), (counts) => notes.push(`Units proposed: ${counts}.`));
    const isStaple = majority(members.map((m) => m.isStaple), (counts) => notes.push(`Staple proposed: ${counts}.`));
    const aliases: string[] = [];
    for (const m of members) {
      if (m.note) notes.push(`"${m.sourceName}": ${m.note}`);
      if (m.sourceName === name) continue;
      // Another entry is named exactly this; the name wins, so this alias can't be kept.
      if (groups.has(m.sourceName)) {
        notes.push(`"${m.sourceName}" was proposed as this ingredient, but it is also an ingredient name.`);
        continue;
      }
      aliases.push(m.sourceName);
    }
    drafts.push({ name, unit, isStaple, aliases: aliases.sort(), reviewed: false, note: notes.length > 0 ? notes.join(" ") : null });
  }

  return { catalog: [...reviewed, ...drafts], warnings };
}

/** The most common value (first seen wins a tie). Reports the counts when values disagree. */
function majority<T>(values: T[], onDisagreement: (counts: string) => void): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (counts.size > 1) onDisagreement([...counts].map(([v, n]) => `${String(v)} (${n})`).join(", "));
  let best = values[0] as T;
  for (const [v, n] of counts) if (n > (counts.get(best) ?? 0)) best = v;
  return best;
}
