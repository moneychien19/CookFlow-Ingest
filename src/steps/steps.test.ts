import { describe, expect, it } from "vitest";
import type { StructuredCall } from "@/claude/client";
import { UsageTally } from "@/claude/usage";
import type { ReviewedRecipe } from "@/schema/reviewed";
import { recipe } from "../../test/builders";
import { formatInstructions, type StepsOptions } from "./steps";

const usage = { model: "claude-opus-5-5", inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
const ORIGINAL = "step 1\r\nChop the onion.\r\n\r\nstep 2\r\nFry it. ";

/** A fake Claude that answers every request with `steps(user message)`. Records each user message. */
function fakeClaude(steps: (user: string) => string[]) {
  const asked: string[] = [];
  const call = (async ({ user }: { user: string }) => {
    asked.push(user);
    return { output: { steps: steps(user) }, usage };
  }) as StructuredCall;
  return { call, asked };
}

async function run(recipes: ReviewedRecipe[], steps: (user: string) => string[], options: Partial<StepsOptions> = {}) {
  const claude = fakeClaude(steps);
  const saves: ReviewedRecipe[][] = [];
  const logs: string[] = [];
  const result = await formatInstructions(recipes, {
    call: claude.call,
    tally: new UsageTally(),
    original: () => ORIGINAL,
    save: (r) => saves.push(r),
    log: (l) => logs.push(l),
    ...options,
  });
  return { ...result, asked: claude.asked, saves, logs };
}

describe("formatInstructions", () => {
  it("stores numbered steps that keep every word of the raw cache's instructions", async () => {
    const { recipes, asked, saves, counts } = await run([recipe("1", [], { instructions: ORIGINAL })], () => [" Chop the\nonion. ", "Fry it."]);
    expect(asked[0]).toContain(ORIGINAL);
    expect(recipes[0]?.instructions).toBe("1. Chop the onion.\n2. Fry it.");
    expect(saves).toHaveLength(1);
    expect(counts).toEqual({ recipes: 1, formatted: 1, rejected: 0 });
  });

  it("keeps the original text when the steps change a word", async () => {
    const r = recipe("1", [], { instructions: ORIGINAL });
    const { recipes, logs, counts } = await run([r], () => ["Chop the onion.", "Fry it well."]);
    expect(recipes[0]).toEqual(r);
    expect(counts.rejected).toBe(1);
    expect(logs).toEqual(['1 Recipe 1: rejected, original word 9 "it." (in "step 2 Fry it.") is missing; the steps have "it" there (asked again next run).']);
  });

  it("only sends pending and approved recipes that aren't numbered steps yet", async () => {
    const recipes = [
      recipe("1", [], { status: "pending", title: "Pending" }),
      recipe("2", [], { title: "Approved" }),
      recipe("3", [], { status: "dropped", dropReason: "vague", title: "Dropped" }),
      recipe("4", [], { instructions: "1. Done.", title: "Done" }),
    ];
    const { asked } = await run(recipes, () => []);
    expect(asked.map((u) => u.split("\n")[0])).toEqual(["<title>Pending</title>", "<title>Approved</title>"]);
  });

  it("respects --only, --limit, and --max-requests", async () => {
    const recipes = ["1", "2", "3", "4"].map((id) => recipe(id, []));
    const only = await run(recipes, () => [], { only: ["2", "4"] });
    expect(only.asked.map((u) => u.split("\n")[0])).toEqual(["<title>Recipe 2</title>", "<title>Recipe 4</title>"]);
    const limited = await run(recipes, () => [], { limit: 3, maxRequests: 2 });
    expect(limited.asked).toHaveLength(2);
    expect(limited.logs).toContain("Stopped at --max-requests 2; 1 recipes left for the next run.");
  });

  it("skips a recipe that isn't in the raw cache", async () => {
    const { asked, logs } = await run([recipe("1", [])], () => [], { original: () => null });
    expect(asked).toEqual([]);
    expect(logs).toEqual(["1 Recipe 1: not in the raw cache, skipped."]);
  });
});
