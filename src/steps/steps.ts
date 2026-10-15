import type { StructuredCall } from "@/claude/client";
import type { UsageTally } from "@/claude/usage";
import type { ReviewedRecipe } from "@/schema/reviewed";
import { stepsReply, SYSTEM_PROMPT, userMessage } from "./prompt";
import { formatSteps, isNumberedSteps, wordProblem } from "./words";

export type StepsOptions = {
  call: StructuredCall;
  tally: UsageTally;
  /** The source's instructions from the raw cache, or null if the recipe isn't cached. */
  original: (sourceId: string) => string | null;
  /** Called after every recipe, so progress is saved as it goes. */
  save: (recipes: ReviewedRecipe[]) => void;
  log?: (line: string) => void;
  /** Only these source ids. */
  only?: string[];
  limit?: number;
  maxRequests?: number;
};
export type StepsCounts = { recipes: number; formatted: number; rejected: number };

/**
 * Rewrites the instructions of pending and approved recipes as numbered steps, with Claude
 * choosing where steps start (SPEC §5.6). An answer that doesn't keep every word of the
 * raw cache's instructions is thrown away and the recipe keeps its text until the next run.
 */
export async function formatInstructions(
  start: ReviewedRecipe[],
  { call, tally, original, save, log = () => {}, only, limit = Infinity, maxRequests = Infinity }: StepsOptions,
): Promise<{ recipes: ReviewedRecipe[]; counts: StepsCounts }> {
  let recipes = [...start];
  const counts: StepsCounts = { recipes: 0, formatted: 0, rejected: 0 };

  const todo = recipes
    .filter((r) => r.status !== "dropped" && !isNumberedSteps(r.instructions) && (!only || only.includes(r.sourceId)))
    .slice(0, limit);
  for (const [n, recipe] of todo.entries()) {
    if (tally.requests >= maxRequests) {
      log(`Stopped at --max-requests ${maxRequests}; ${todo.length - n} recipes left for the next run.`);
      break;
    }
    const text = original(recipe.sourceId);
    if (text === null) {
      log(`${recipe.sourceId} ${recipe.title}: not in the raw cache, skipped.`);
      continue;
    }
    const { output, usage } = await call({ system: SYSTEM_PROMPT, user: userMessage(recipe.title, text), schema: stepsReply });
    tally.add(usage);
    counts.recipes++;

    const steps = output.steps.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s !== "");
    const formatted = formatSteps(steps);
    const problem = steps.length === 0 ? "no steps" : wordProblem(text, formatted);
    if (problem) {
      counts.rejected++;
      log(`${recipe.sourceId} ${recipe.title}: rejected, ${problem} (asked again next run).`);
      continue;
    }
    recipes = recipes.map((r) => (r.sourceId === recipe.sourceId ? { ...r, instructions: formatted } : r));
    counts.formatted++;
    save(recipes);
    log(`${recipe.sourceId} ${recipe.title}: ${steps.length} steps.`);
  }
  return { recipes, counts };
}
