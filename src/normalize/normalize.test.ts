import { describe, expect, it } from "vitest";
import type { StructuredCall } from "@/claude/client";
import { UsageTally } from "@/claude/usage";
import type { ReviewedLine, ReviewedRecipe } from "@/schema/reviewed";
import { entry, line, recipe } from "../../test/builders";
import { normalizeRecipes, type NormalizeState } from "./normalize";
import type { LineReply } from "./prompt";

const usage = { model: "claude-opus-5-5", inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
type Asked = { id: number; name: string; measure: string; ingredient: string | null };
type Answer = Omit<LineReply, "id"> | null;

/** A fake Claude: answers each line that has an id with `answer(line)`. Records every request. */
function fakeClaude(answer: (line: Asked) => Answer) {
  const requests: { system: string; user: string; asked: Asked[] }[] = [];
  const call = (async ({ system, user }: { system: string; user: string }) => {
    const asked = user
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as Partial<Asked>)
      .filter((l): l is Asked => typeof l.id === "number");
    requests.push({ system, user, asked });
    const lines = asked.flatMap((l) => {
      const a = answer(l);
      return a ? [{ id: l.id, ...a }] : [];
    });
    return { output: { lines }, usage };
  }) as StructuredCall;
  return { call, requests };
}

const existing = (ingredient: string, quantity: number, note = "estimated"): Answer => ({ result: "existing", ingredient, unit: null, isStaple: null, quantity, note });
const unmapped = (sourceName: string, sourceMeasure: string, ingredient: string | null = null): ReviewedLine => ({
  sourceName,
  sourceMeasure,
  ingredient,
  quantity: null,
  method: null,
  note: "some rule reason",
});

const catalog = [entry("potato", "whole"), entry("ginger", "g"), entry("salt", "g", { isStaple: true })];
const pending = (sourceId: string, lines: ReviewedLine[]) => recipe(sourceId, lines, { status: "pending" });
const state = (recipes: ReviewedRecipe[]): NormalizeState => ({ recipes, catalog, proposals: [] });

async function run(start: NormalizeState, answer: (line: Asked) => Answer, options: { limit?: number; maxRequests?: number } = {}) {
  const claude = fakeClaude(answer);
  const saves: NormalizeState[] = [];
  const logs: string[] = [];
  const result = await normalizeRecipes(start, { call: claude.call, tally: new UsageTally(), save: (s) => saves.push(s), log: (l) => logs.push(l), ...options });
  return { result, requests: claude.requests, saves, logs };
}

describe("normalizeRecipes", () => {
  it("converts a matched line's quantity and maps an unmatched line to a catalog ingredient", async () => {
    const r = pending("1", [line("salt", 1), unmapped("Potatoes", "900g", "potato"), unmapped("Fresh Ginger", "1 tbsp")]);
    const { result, requests } = await run(state([r]), (l) =>
      l.name === "Potatoes" ? existing("potato", 4.5, "900 g at about 200 g each") : existing("ginger", 6, "1 tbsp grated is about 6 g"),
    );
    expect(requests[0]?.asked.map((a) => a.name)).toEqual(["Potatoes", "Fresh Ginger"]);
    expect(result.recipes[0]?.lines.slice(1)).toEqual([
      { sourceName: "Potatoes", sourceMeasure: "900g", ingredient: "potato", quantity: 4.5, method: "claude", note: "900 g at about 200 g each" },
      { sourceName: "Fresh Ginger", sourceMeasure: "1 tbsp", ingredient: "ginger", quantity: 6, method: "claude", note: "1 tbsp grated is about 6 g" },
    ]);
    expect(result.counts).toEqual({ recipes: 1, existing: 2, new: 0, cantMap: 0, rejected: 0 });
  });

  it("adds a proposed new ingredient to the catalog as an unreviewed draft, and tells later requests about it", async () => {
    const recipes = [pending("1", [unmapped("Gochugaru", "2 tbsp")]), pending("2", [unmapped("Korean Chili Flakes", "1 tbsp")])];
    const { result, requests } = await run(state(recipes), (l) =>
      l.name === "Gochugaru"
        ? { result: "new", ingredient: "gochugaru", unit: "g", isStaple: false, quantity: 16, note: "about 8 g per tbsp" }
        : existing("gochugaru", 8),
    );
    expect(result.catalog.find((e) => e.name === "gochugaru")).toEqual({
      name: "gochugaru",
      unit: "g",
      isStaple: false,
      aliases: [],
      reviewed: false,
      note: '"gochugaru": Proposed by normalize: about 8 g per tbsp',
    });
    expect(result.proposals).toEqual([
      { sourceName: "gochugaru", canonicalName: "gochugaru", unit: "g", isStaple: false, note: "Proposed by normalize: about 8 g per tbsp" },
    ]);
    expect(result.recipes.map((r) => r.lines[0]?.ingredient)).toEqual(["gochugaru", "gochugaru"]);
    expect(requests[1]?.user).toContain("Ingredients added to the catalog during this run:\ngochugaru (g)");
    // The cached system prompt doesn't change during a run.
    expect(requests[1]?.system).toBe(requests[0]?.system);
  });

  it("records can't-map answers, so they aren't asked again", async () => {
    const r = pending("1", [unmapped("Sauce from above", "all")]);
    const first = await run(state([r]), () => ({ result: "cant_map", ingredient: null, unit: null, isStaple: null, quantity: null, note: "refers to another part of the recipe" }));
    expect(first.result.recipes[0]?.lines[0]).toMatchObject({ quantity: null, method: "claude", note: "can't map: refers to another part of the recipe" });
    const second = await run({ ...first.result }, () => null);
    expect(second.requests).toEqual([]);
  });

  it.each([
    ["a switched ingredient", existing("ginger", 100), 'switched the ingredient from "potato" to "ginger"'],
    ["an unknown ingredient", existing("turnip", 1), '"turnip" is not in the catalog'],
    ["no quantity", { ...existing("potato", 1)!, quantity: null }, "no quantity"],
    ["a zero quantity", existing("potato", 0.001), "quantity 0.001 isn't greater than 0"],
    ["a new ingredient for a matched line", { result: "new", ingredient: "baby potato", unit: "whole", isStaple: false, quantity: 1, note: "" }, 'proposed a new ingredient for a line that is already "potato"'],
  ] as [string, Answer, string][])("rejects %s and leaves the line to ask again", async (_, answer, problem) => {
    const r = pending("1", [unmapped("Potatoes", "900g", "potato")]);
    const { result, logs } = await run(state([r]), () => answer);
    expect(result.recipes[0]?.lines[0]).toEqual(r.lines[0]);
    expect(logs).toContain(`  1 "Potatoes": ${problem}`);
    expect(result.counts.rejected).toBe(1);
  });

  it.each([
    ["an invalid name", { result: "new", ingredient: "Gochugaru!", unit: "g", isStaple: false, quantity: 1, note: "" }, 'invalid new ingredient name "Gochugaru!"'],
    ["no unit", { result: "new", ingredient: "gochugaru", unit: null, isStaple: false, quantity: 1, note: "" }, 'new ingredient "gochugaru" has no unit or staple flag'],
    ["a unit that conflicts with the catalog", { result: "new", ingredient: "ginger", unit: "whole", isStaple: false, quantity: 1, note: "" }, '"ginger" is already in the catalog in g, not whole'],
  ] as [string, Answer, string][])("rejects a new ingredient with %s", async (_, answer, problem) => {
    const { result, logs } = await run(state([pending("1", [unmapped("Gochugaru", "2 tbsp")])]), () => answer);
    expect(result.recipes[0]?.lines[0]?.method).toBeNull();
    expect(result.catalog).toEqual(catalog);
    expect(logs).toContain(`  1 "Gochugaru": ${problem}`);
  });

  it("only sends pending recipes, and only lines without a quantity that nobody answered yet", async () => {
    const recipes = [
      pending("1", [unmapped("A", "1"), { ...unmapped("B", "1"), method: "manual", note: "left for later" }]),
      recipe("2", [unmapped("C", "1")], { status: "approved" }),
      recipe("3", [unmapped("D", "1")], { status: "dropped", dropReason: "vague" }),
      pending("4", [line("salt", 1)]),
    ];
    const { requests } = await run(state(recipes), () => null);
    expect(requests.map((r) => r.asked.map((a) => a.name))).toEqual([["A"]]);
  });

  it("saves after every recipe and respects --limit and --max-requests", async () => {
    const recipes = ["1", "2", "3", "4"].map((id) => pending(id, [unmapped("Potatoes", "900g", "potato")]));
    const limited = await run(state(recipes), () => existing("potato", 4.5), { limit: 3, maxRequests: 2 });
    expect(limited.requests).toHaveLength(2);
    expect(limited.saves).toHaveLength(2);
    expect(limited.logs).toContain("Stopped at --max-requests 2; 1 recipes left for the next run.");
  });

  it("drops the recipe when an answer makes an ingredient appear twice", async () => {
    const r = pending("1", [line("potato", 2), unmapped("Baby Potatoes", "300g")]);
    const { result } = await run(state([r]), () => existing("potato", 1.5));
    expect(result.recipes[0]).toMatchObject({ status: "dropped", dropReason: 'duplicate ingredient "potato"' });
  });
});
