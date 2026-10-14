import type { StructuredCall } from "@/claude/client";
import type { UsageTally } from "@/claude/usage";
import { buildCatalog } from "@/catalog/group";
import { createMatcher } from "@/catalog/match";
import type { Proposal } from "@/catalog/proposals";
import { ingredientName, normalizeName, type CatalogEntry } from "@/schema/catalog";
import type { ReviewedLine, ReviewedRecipe } from "@/schema/reviewed";
import { statusFor } from "@/map/mapRecipe";
import { lineReplies, systemPrompt, userMessage, type LineReply } from "./prompt";

const MAX_QUANTITY = 999999.99;

export type NormalizeState = { recipes: ReviewedRecipe[]; catalog: CatalogEntry[]; proposals: Proposal[] };
export type NormalizeOptions = {
  call: StructuredCall;
  tally: UsageTally;
  /** Called after every recipe, so progress is saved as it goes. */
  save: (state: NormalizeState) => void;
  log?: (line: string) => void;
  /** Most recipes to send in this run. */
  limit?: number;
  maxRequests?: number;
};
export type NormalizeCounts = { recipes: number; existing: number; new: number; cantMap: number; rejected: number };

/** A line normalize should send: no quantity yet, and not already answered by Claude or a reviewer. */
const needsClaude = (line: ReviewedLine) => line.quantity === null && line.method === null;

/**
 * Sends each pending recipe's unmapped lines to Claude (SPEC §5.5) and writes the answers
 * into the lines with `method: "claude"`. A proposed new ingredient joins the catalog as
 * an unreviewed draft (and the bootstrap proposals, so a catalog rebuild keeps it). Answers
 * that break the rules are dropped and the line is asked again next run.
 */
export async function normalizeRecipes(
  start: NormalizeState,
  { call, tally, save, log = () => {}, limit = Infinity, maxRequests = Infinity }: NormalizeOptions,
): Promise<NormalizeState & { counts: NormalizeCounts }> {
  const state: NormalizeState = { recipes: [...start.recipes], catalog: start.catalog, proposals: [...start.proposals] };
  const system = systemPrompt(start.catalog);
  const added: CatalogEntry[] = [];
  const counts: NormalizeCounts = { recipes: 0, existing: 0, new: 0, cantMap: 0, rejected: 0 };

  const todo = state.recipes.filter((r) => r.status === "pending" && r.lines.some(needsClaude)).slice(0, limit);
  for (const [n, recipe] of todo.entries()) {
    if (tally.requests >= maxRequests) {
      log(`Stopped at --max-requests ${maxRequests}; ${todo.length - n} recipes left for the next run.`);
      break;
    }
    const ask = new Set(recipe.lines.flatMap((l, i) => (needsClaude(l) ? [i] : [])));
    const { output, usage } = await call({ system, user: userMessage(recipe, ask, added), schema: lineReplies });
    tally.add(usage);
    counts.recipes++;

    const lines = [...recipe.lines];
    const unanswered = new Set(ask);
    for (const reply of output.lines) {
      const line = lines[reply.id];
      if (!unanswered.delete(reply.id) || !line) {
        log(`  ${recipe.sourceId}: dropped a reply for id ${reply.id} (not asked, or a duplicate)`);
        counts.rejected++;
        continue;
      }
      const outcome = apply(line, reply, state);
      if ("problem" in outcome) {
        log(`  ${recipe.sourceId} "${line.sourceName}": ${outcome.problem}`);
        counts.rejected++;
        continue;
      }
      lines[reply.id] = outcome.line;
      counts[reply.result === "cant_map" ? "cantMap" : reply.result]++;
      if (outcome.proposal) {
        state.proposals = [...state.proposals.filter((p) => p.sourceName !== outcome.proposal?.sourceName), outcome.proposal];
        state.catalog = buildCatalog(state.proposals, state.catalog).catalog;
        const entry = state.catalog.find((e) => e.name === outcome.proposal?.canonicalName);
        if (entry && !added.some((e) => e.name === entry.name)) added.push(entry);
      }
    }
    for (const id of unanswered) log(`  ${recipe.sourceId} "${recipe.lines[id]?.sourceName}": no answer`);

    const updated = { ...recipe, ...statusFor(lines), lines };
    state.recipes = state.recipes.map((r) => (r.sourceId === recipe.sourceId ? updated : r));
    save(state);
    log(`${recipe.sourceId} ${recipe.title}: ${ask.size - unanswered.size} of ${ask.size} lines answered${updated.status === "dropped" ? `, now ${updated.dropReason}` : ""}.`);
  }
  return { ...state, counts };
}

type Outcome = { line: ReviewedLine; proposal?: Proposal } | { problem: string };

function apply(line: ReviewedLine, reply: LineReply, state: NormalizeState): Outcome {
  const answered = (ingredient: string | null, quantity: number | null, note: string): ReviewedLine => ({
    ...line,
    ingredient,
    quantity,
    method: "claude",
    note,
  });
  if (reply.result === "cant_map") return { line: answered(line.ingredient, null, `can't map: ${reply.note}`) };

  const quantity = checkQuantity(reply.quantity);
  if (typeof quantity === "string") return { problem: quantity };

  if (reply.result === "existing") {
    const entry = reply.ingredient ? createMatcher(state.catalog)(reply.ingredient) : null;
    if (!entry) return { problem: `"${reply.ingredient}" is not in the catalog` };
    if (line.ingredient !== null && entry.name !== line.ingredient) {
      return { problem: `switched the ingredient from "${line.ingredient}" to "${entry.name}"` };
    }
    return { line: answered(entry.name, quantity, reply.note) };
  }

  // A new ingredient.
  if (line.ingredient !== null) return { problem: `proposed a new ingredient for a line that is already "${line.ingredient}"` };
  const name = ingredientName.safeParse(reply.ingredient);
  if (!name.success) return { problem: `invalid new ingredient name "${reply.ingredient}"` };
  if (reply.unit === null || reply.isStaple === null) return { problem: `new ingredient "${name.data}" has no unit or staple flag` };
  const existing = createMatcher(state.catalog)(name.data);
  if (existing && existing.unit !== reply.unit) {
    return { problem: `"${name.data}" is already in the catalog in ${existing.unit}, not ${reply.unit}` };
  }
  const proposal: Proposal = {
    sourceName: normalizeName(line.sourceName),
    canonicalName: existing?.name ?? name.data,
    unit: reply.unit,
    isStaple: reply.isStaple,
    note: `Proposed by normalize: ${reply.note}`,
  };
  return { line: answered(proposal.canonicalName, quantity, reply.note), proposal };
}

/** The quantity rounded to 2 decimals, or why it's unusable. */
function checkQuantity(quantity: number | null): number | string {
  if (quantity === null) return "no quantity";
  const rounded = Math.round(quantity * 100) / 100;
  if (!(rounded > 0)) return `quantity ${quantity} isn't greater than 0`;
  if (rounded > MAX_QUANTITY) return `quantity ${quantity} is too large`;
  return rounded;
}
