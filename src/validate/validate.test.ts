import { describe, expect, it } from "vitest";
import type { ReviewedLine, ReviewedRecipe } from "@/schema/reviewed";
import type { SourceRecipe } from "@/schema/sourceRecipe";
import { entry, line, recipe } from "../../test/builders";
import { validateApproved, type RawLookup } from "./validate";

const catalog = [entry("onion", "whole"), entry("chicken breast", "g"), entry("leek", "whole", { reviewed: false })];

/** An approved recipe and the raw record it came from, consistent with each other. */
function approvedWithRaw(lines: ReviewedLine[], extra: Partial<ReviewedRecipe> = {}) {
  const approved = recipe("1", lines, extra);
  const raw: SourceRecipe = {
    sourceId: "1",
    title: approved.title,
    instructions: approved.instructions,
    imageUrl: null,
    servings: null,
    tags: [],
    lines: approved.lines.map((l) => ({ name: l.sourceName, measure: l.sourceMeasure })),
  };
  return { approved, raw, lookup: ((id) => (id === "1" ? raw : null)) as RawLookup };
}

const check = (r: ReviewedRecipe, lookup: RawLookup) => validateApproved("themealdb", [r], catalog, lookup);

describe("validateApproved", () => {
  it("accepts a valid approved recipe", () => {
    const { approved, lookup } = approvedWithRaw([line("onion", 0.5), line("chicken breast", 400)]);
    expect(check(approved, lookup)).toEqual([]);
  });

  it("ignores pending and dropped recipes", () => {
    const { lookup } = approvedWithRaw([]);
    const bad = [line(null, null)];
    const recipes = [recipe("1", bad, { status: "pending" }), recipe("2", bad, { status: "dropped", dropReason: "vague" })];
    expect(validateApproved("themealdb", recipes, catalog, lookup)).toEqual([]);
  });

  it.each([
    ["a missing quantity", line("onion", null), 'line 1 "onion": no quantity'],
    ["a missing ingredient", line(null, 1), 'line 1 "mystery" has no ingredient'],
    ["more than 2 decimals", line("onion", 0.333), 'line 1 "onion": quantity 0.333 has more than 2 decimals'],
    ["a zero quantity", line("onion", 0), 'line 1 "onion": quantity 0 must be greater than 0'],
    ["a quantity too large for numeric(8,2)", line("chicken breast", 1_000_000), 'line 1 "chicken breast": quantity 1000000 is larger than 999999.99'],
    ["an unknown ingredient", line("tofu", 200), 'line 1 "tofu": ingredient "tofu" is not in the catalog'],
    ["an unreviewed ingredient", line("leek", 1), `line 1 "leek": ingredient "leek" hasn't been reviewed in the catalog`],
  ])("rejects %s", (_, bad, message) => {
    const { approved, lookup } = approvedWithRaw([bad]);
    expect(check(approved, lookup)).toEqual([`1 "Recipe 1": ${message}`]);
  });

  it("accepts two decimals despite floating point (0.1 + 0.2)", () => {
    const { approved, lookup } = approvedWithRaw([line("onion", 0.1 + 0.2)]);
    expect(check(approved, lookup)).toEqual([]);
  });

  it("rejects an ingredient that appears twice", () => {
    const { approved, lookup } = approvedWithRaw([line("onion", 1), { ...line("onion", 1), sourceName: "red onion" }]);
    expect(check(approved, lookup)).toEqual(['1 "Recipe 1": ingredient "onion" appears more than once']);
  });

  it("rejects instructions, a title, or line text that differ from the raw cache", () => {
    const { approved, lookup } = approvedWithRaw([line("onion", 1)]);
    const edited = {
      ...approved,
      title: "Tidied title",
      instructions: approved.instructions.trim() + ".",
      lines: [{ ...approved.lines[0]!, sourceMeasure: "1 (one)" }],
    };
    expect(check(edited, lookup)).toEqual([
      '1 "Tidied title": title differs from the raw cache',
      '1 "Tidied title": instructions differ from the raw cache (only the step numbering may change)',
      '1 "Tidied title": line 1: source name or measure differs from the raw cache',
    ]);
  });

  it("accepts instructions as numbered steps that keep every word, and rejects steps that change one", () => {
    const { approved, lookup } = approvedWithRaw([line("onion", 1)], { instructions: "step 1\r\nChop.\r\n\r\nstep 2\r\nFry. " });
    expect(check({ ...approved, instructions: "1. Chop.\n2. Fry." }, lookup)).toEqual([]);
    expect(check({ ...approved, instructions: "1. Chop.\n2. Fry well." }, lookup)).toEqual([
      '1 "Recipe 1": instructions differ from the raw cache (only the step numbering may change)',
    ]);
  });

  it("rejects a recipe whose lines were removed", () => {
    const { approved, lookup } = approvedWithRaw([line("onion", 1), line("chicken breast", 200)]);
    expect(check({ ...approved, lines: approved.lines.slice(0, 1) }, lookup)).toEqual([
      '1 "Recipe 1": has 1 lines, the raw cache has 2 (lines can\'t be added or removed)',
    ]);
  });

  it("rejects a recipe that isn't in the raw cache, or is from another source", () => {
    const { approved } = approvedWithRaw([line("onion", 1)]);
    expect(validateApproved("themealdb", [{ ...approved, source: "other" }], catalog, () => null)).toEqual([
      '1 "Recipe 1": source is "other", not "themealdb"',
      '1 "Recipe 1": not in the raw cache',
    ]);
  });

  it("reports every problem, across recipes", () => {
    const { approved, lookup } = approvedWithRaw([line("onion", null), line("tofu", 1)]);
    expect(check(approved, lookup)).toHaveLength(2);
  });
});
