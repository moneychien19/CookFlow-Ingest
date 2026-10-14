import type { CatalogEntry, Unit } from "@/schema/catalog";
import type { ReviewedRecipe } from "@/schema/reviewed";
import { isMapDrop, NOMINAL_NOTE } from "@/map/mapRecipe";

/** SPEC §6. */
export const TARGETS = { approved: 50, vegetarian: 10 };

export type ReviewQueueEntry = { name: string; unit: Unit; isStaple: boolean; recipes: number; note: string | null };

export type Report = {
  rawRecords: number;
  recipes: { total: number; pending: number; approved: number; dropped: number; vegetarianApproved: number };
  /** Pending recipes where every line has a quantity: ready for a look and `approved`. */
  pendingComplete: number;
  /** Drop reasons with counts; map's duplicate drops are grouped. */
  dropped: { reason: string; recipes: number }[];
  /** Lines of pending and approved recipes, by how they got (or didn't get) a quantity. */
  lines: { rule: number; nominal: number; claude: number; manual: number; cantMap: number; unmapped: number };
  /** Unreviewed catalog entries used by pending or approved recipes, most used first. */
  reviewQueue: ReviewQueueEntry[];
};

export function buildReport(rawRecords: number, recipes: ReviewedRecipe[], catalog: CatalogEntry[]): Report {
  const byStatus = (status: ReviewedRecipe["status"]) => recipes.filter((r) => r.status === status);
  const live = recipes.filter((r) => r.status !== "dropped");

  const dropReasons = new Map<string, number>();
  for (const r of byStatus("dropped")) {
    const reason = isMapDrop(r) ? "duplicate ingredient" : (r.dropReason ?? "(no reason)");
    dropReasons.set(reason, (dropReasons.get(reason) ?? 0) + 1);
  }

  const lines = { rule: 0, nominal: 0, claude: 0, manual: 0, cantMap: 0, unmapped: 0 };
  const usedBy = new Map<string, Set<string>>();
  for (const recipe of live) {
    for (const line of recipe.lines) {
      if (line.quantity === null) lines[line.method === "claude" ? "cantMap" : "unmapped"]++;
      else if (line.method === "rule") lines[line.note === NOMINAL_NOTE ? "nominal" : "rule"]++;
      else if (line.method === "claude" || line.method === "manual") lines[line.method]++;
      if (line.ingredient) usedBy.set(line.ingredient, (usedBy.get(line.ingredient) ?? new Set()).add(recipe.sourceId));
    }
  }

  const reviewQueue = catalog
    .filter((e) => !e.reviewed && usedBy.has(e.name))
    .map((e) => ({ name: e.name, unit: e.unit, isStaple: e.isStaple, recipes: usedBy.get(e.name)?.size ?? 0, note: e.note }))
    .sort((a, b) => b.recipes - a.recipes || a.name.localeCompare(b.name));

  return {
    rawRecords,
    recipes: {
      total: recipes.length,
      pending: byStatus("pending").length,
      approved: byStatus("approved").length,
      dropped: byStatus("dropped").length,
      vegetarianApproved: byStatus("approved").filter((r) => r.tags.includes("vegetarian")).length,
    },
    pendingComplete: byStatus("pending").filter((r) => r.lines.every((l) => l.quantity !== null)).length,
    dropped: [...dropReasons].map(([reason, n]) => ({ reason, recipes: n })).sort((a, b) => b.recipes - a.recipes),
    lines,
    reviewQueue,
  };
}

export function formatReport(report: Report, { queueLimit = 30 } = {}): string {
  const { recipes, lines, reviewQueue } = report;
  const progress = (n: number, target: number) => `${n}/${target}${n >= target ? " ✓" : ""}`;
  const shown = reviewQueue.slice(0, queueLimit);
  return [
    `Raw records cached: ${report.rawRecords}`,
    `Recipes: ${recipes.total} (${recipes.pending} pending, ${recipes.approved} approved, ${recipes.dropped} dropped)`,
    `  pending with every line mapped: ${report.pendingComplete}`,
    "",
    `Targets (SPEC §6): approved ${progress(recipes.approved, TARGETS.approved)}, vegetarian approved ${progress(recipes.vegetarianApproved, TARGETS.vegetarian)}`,
    "",
    "Dropped:",
    ...(report.dropped.length > 0 ? report.dropped.map((d) => `  ${d.recipes}  ${d.reason}`) : ["  none"]),
    "",
    "Lines in pending and approved recipes:",
    `  ${lines.rule} by rule, ${lines.nominal} nominal staples, ${lines.claude} by Claude, ${lines.manual} by a reviewer`,
    `  ${lines.unmapped} unmapped (run normalize), ${lines.cantMap} Claude couldn't map (fix by hand or drop the recipe)`,
    "",
    `Catalog review queue: ${reviewQueue.length} unreviewed ingredients used by pending or approved recipes`,
    ...shown.map((e) => `  ${String(e.recipes).padStart(3)}  ${e.name} [${e.unit}${e.isStaple ? ", staple" : ""}]${e.note ? "  (has a note)" : ""}`),
    ...(reviewQueue.length > shown.length ? [`  … ${reviewQueue.length - shown.length} more`] : []),
  ].join("\n");
}
