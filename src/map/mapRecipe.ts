import type { Matcher } from "@/catalog/match";
import type { ReviewedLine, ReviewedRecipe } from "@/schema/reviewed";
import type { SourceLine, SourceRecipe } from "@/schema/sourceRecipe";
import { convertMeasure } from "./measure";

export const NOMINAL_NOTE = "nominal staple quantity";
const DUPLICATE_PREFIX = "duplicate ingredient ";

/** True for a drop that `map` made itself (SPEC §5.4), which it re-checks on every run. */
export const isMapDrop = (recipe: ReviewedRecipe) =>
  recipe.status === "dropped" && (recipe.dropReason?.startsWith(DUPLICATE_PREFIX) ?? false);

/**
 * Maps one recipe with the rules (SPEC §5.3). Lines from `previous` that Claude proposed
 * or a reviewer fixed are kept as they are; every other line is mapped again, so catalog
 * changes reach pending recipes. A line whose name matches but whose measure doesn't
 * convert keeps the ingredient, with quantity null and the reason in `note`.
 */
export function mapRecipe(source: string, recipe: SourceRecipe, match: Matcher, previous?: ReviewedRecipe): ReviewedRecipe {
  const lines = recipe.lines.map((line, i) => keptLine(previous?.lines[i], line) ?? mapLine(line, match));
  return {
    source,
    sourceId: recipe.sourceId,
    title: recipe.title,
    imageUrl: recipe.imageUrl,
    instructions: recipe.instructions,
    servings: recipe.servings,
    tags: recipe.tags,
    ...statusFor(lines),
    lines,
  };
}

/** Pending, or dropped when two lines map to the same ingredient (SPEC §5.4). */
export function statusFor(lines: ReviewedLine[]): Pick<ReviewedRecipe, "status" | "dropReason"> {
  const duplicate = firstDuplicate(lines.flatMap((l) => (l.ingredient ? [l.ingredient] : [])));
  return duplicate ? { status: "dropped", dropReason: `${DUPLICATE_PREFIX}"${duplicate}"` } : { status: "pending", dropReason: null };
}

function keptLine(previous: ReviewedLine | undefined, line: SourceLine): ReviewedLine | null {
  if (!previous || (previous.method !== "claude" && previous.method !== "manual")) return null;
  // The raw cache never changes, so this only fails if the file was edited by hand.
  return previous.sourceName === line.name && previous.sourceMeasure === line.measure ? previous : null;
}

function mapLine({ name, measure }: SourceLine, match: Matcher): ReviewedLine {
  const base = { sourceName: name, sourceMeasure: measure };
  const entry = match(name);
  if (!entry) return { ...base, ingredient: null, quantity: null, method: null, note: "no catalog entry for this name" };
  const result = convertMeasure(measure, entry);
  if (!result.ok) return { ...base, ingredient: entry.name, quantity: null, method: null, note: result.reason };
  return { ...base, ingredient: entry.name, quantity: result.quantity, method: "rule", note: result.nominal ? NOMINAL_NOTE : null };
}

function firstDuplicate(names: string[]): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return null;
}
