import { describe, expect, it } from "vitest";
import { z } from "zod";
import { catalogEntry, catalogFile } from "./catalog";
import { recipesFile, reviewedRecipe } from "./reviewed";
import { sourceRecipe } from "./sourceRecipe";
import example from "../../test/fixtures/recipes.example.json";

const recipe = example[0]!;
const errorOf = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return z.prettifyError(result.error!);
};

describe("reviewed recipe file", () => {
  it("parses the SPEC §5.6 example", () => {
    expect(recipesFile.parse(example)).toEqual(example);
  });

  it("rejects an unknown status", () => {
    expect(errorOf(reviewedRecipe, { ...recipe, status: "done" })).toMatch(/status/);
  });

  it("rejects a missing field", () => {
    const withoutTitle: Partial<typeof recipe> = { ...recipe };
    delete withoutTitle.title;
    expect(errorOf(reviewedRecipe, withoutTitle)).toMatch(/title/);
  });

  it("rejects a misspelled field instead of silently dropping it", () => {
    expect(errorOf(reviewedRecipe, { ...recipe, staus: "approved" })).toMatch(/staus/);
  });

  it("rejects an unknown line method", () => {
    const lines = [{ ...recipe.lines[0]!, method: "guess" }];
    expect(errorOf(reviewedRecipe, { ...recipe, lines })).toMatch(/lines\[0\]\.method/);
  });
});

describe("catalog entry", () => {
  const onion = { name: "onion", unit: "whole", isStaple: false, aliases: ["red onion"], reviewed: true, note: null };

  it("parses a valid entry", () => {
    expect(catalogEntry.parse(onion)).toEqual(onion);
  });

  it("rejects a unit outside CookFlow's CHECK", () => {
    expect(errorOf(catalogEntry, { ...onion, unit: "kg" })).toMatch(/unit/);
  });

  it("rejects names and aliases that aren't lowercase and trimmed", () => {
    expect(errorOf(catalogEntry, { ...onion, name: "Onion" })).toMatch(/name/);
    expect(errorOf(catalogEntry, { ...onion, aliases: [" red onion"] })).toMatch(/aliases\[0\]/);
  });
});

describe("catalog file", () => {
  const entryOf = (name: string, aliases: string[]) => ({ name, unit: "whole", isStaple: false, aliases, reviewed: false, note: null });

  it("accepts names and aliases that each point at one entry", () => {
    expect(catalogFile.safeParse([entryOf("onion", ["red onion"]), entryOf("leek", [])]).success).toBe(true);
  });

  it("rejects an alias shared by two entries", () => {
    const error = errorOf(catalogFile, [entryOf("onion", ["spring onion"]), entryOf("green onion", ["spring onion"])]);
    expect(error).toMatch(/"spring onion" already belongs to "onion"[\s\S]*\[1\]\.aliases\[0\]/);
  });

  it("rejects an alias that is another entry's name", () => {
    expect(errorOf(catalogFile, [entryOf("onion", []), entryOf("red onion", ["onion"])])).toMatch(/\[1\]\.aliases\[0\]/);
  });

  it("rejects the same name twice", () => {
    expect(errorOf(catalogFile, [entryOf("onion", []), entryOf("onion", [])])).toMatch(/\[1\]\.name/);
  });
});

describe("source recipe", () => {
  const base = {
    sourceId: "1",
    title: "Toast",
    instructions: "Toast the bread.",
    imageUrl: null,
    servings: null,
    tags: [],
    lines: [{ name: " Bread ", measure: "" }],
  };

  it("keeps strings verbatim", () => {
    expect(sourceRecipe.parse(base).lines[0]).toEqual({ name: " Bread ", measure: "" });
  });

  it("rejects a blank ingredient name", () => {
    expect(errorOf(sourceRecipe, { ...base, lines: [{ name: "  ", measure: "1" }] })).toMatch(/blank ingredient name/);
  });
});
