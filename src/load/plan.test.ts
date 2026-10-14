import { describe, expect, it } from "vitest";
import { formatPlan } from "./format";
import { planLoad, usedIngredientNames, type DbSnapshot } from "./plan";
import { entry, line, recipe } from "../../test/builders";

const catalog = [entry("onion", "whole"), entry("chicken breast", "g"), entry("salt", "count", { isStaple: true })];
const emptyDb: DbSnapshot = { ingredients: [], existingSourceIds: [] };

describe("planLoad", () => {
  it("inserts only the catalog ingredients that approved recipes use", () => {
    const recipes = [
      recipe("1", [line("onion", 1)]),
      recipe("2", [line("chicken breast", 400)], { status: "pending" }),
    ];
    const result = planLoad("themealdb", recipes, catalog, emptyDb);
    expect(result.ok && result.plan.ingredientsToInsert).toEqual([{ name: "onion", unit: "whole", isStaple: false }]);
  });

  it("doesn't insert an ingredient the database already has with the same unit and staple flag", () => {
    const db: DbSnapshot = { ingredients: [{ name: "onion", unit: "whole", isStaple: false }], existingSourceIds: [] };
    const result = planLoad("themealdb", [recipe("1", [line("onion", 1)])], catalog, db);
    expect(result.ok && result.plan.ingredientsToInsert).toEqual([]);
  });

  it("splits recipes into new and existing by source_id", () => {
    const db: DbSnapshot = { ingredients: [], existingSourceIds: ["2"] };
    const recipes = [recipe("1", [line("onion", 1)]), recipe("2", [line("onion", 0.5)])];
    const result = planLoad("themealdb", recipes, catalog, db);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.plan.recipesToInsert.map((r) => r.sourceId)).toEqual(["1"]);
    expect(result.plan.recipesToUpdate.map((r) => r.sourceId)).toEqual(["2"]);
    expect(result.plan.lineCount).toBe(2);
  });

  it("ignores pending and dropped recipes", () => {
    const recipes = [
      recipe("1", [line(null, null)], { status: "pending" }),
      recipe("2", [line(null, null)], { status: "dropped", dropReason: "vague" }),
    ];
    const result = planLoad("themealdb", recipes, catalog, emptyDb);
    expect(result.ok && result.plan.recipesToInsert).toEqual([]);
  });

  it("refuses a unit or staple conflict with an existing ingredient", () => {
    const db: DbSnapshot = {
      ingredients: [
        { name: "chicken breast", unit: "pack", isStaple: false },
        { name: "salt", unit: "count", isStaple: false },
      ],
      existingSourceIds: [],
    };
    const result = planLoad("themealdb", [recipe("1", [line("chicken breast", 400), line("salt", 1)])], catalog, db);
    expect(result).toEqual({
      ok: false,
      errors: [
        'ingredient "chicken breast": database unit is "pack", catalog unit is "g"',
        'ingredient "salt": database is_staple is false, catalog says true',
      ],
    });
  });

  it("refuses unmapped lines, unknown ingredients, and unreviewed catalog entries", () => {
    const withDraft = [...catalog, entry("leek", "whole", { reviewed: false })];
    const recipes = [recipe("1", [line(null, null), line("tofu", 200), line("leek", 1)])];
    const result = planLoad("themealdb", recipes, withDraft, emptyDb);
    expect(result).toEqual({
      ok: false,
      errors: [
        'themealdb/1 "Recipe 1": line "mystery" has no ingredient or quantity',
        `ingredient "leek" hasn't been reviewed in the catalog`,
        'ingredient "tofu" is not in the catalog',
      ],
    });
  });

  it("refuses a recipe from another source", () => {
    const result = planLoad("themealdb", [recipe("1", [line("onion", 1)], { source: "other" })], catalog, emptyDb);
    expect(result.ok).toBe(false);
  });
});

describe("usedIngredientNames", () => {
  it("lists each name used by approved recipes once, sorted", () => {
    const recipes = [
      recipe("1", [line("onion", 1), line("salt", 1)]),
      recipe("2", [line("onion", 2), line(null, null)]),
      recipe("3", [line("chicken breast", 1)], { status: "pending" }),
    ];
    expect(usedIngredientNames(recipes)).toEqual(["onion", "salt"]);
  });
});

describe("formatPlan", () => {
  it("lists what will be inserted and updated", () => {
    const db: DbSnapshot = { ingredients: [], existingSourceIds: ["2"] };
    const recipes = [recipe("1", [line("salt", 1)]), recipe("2", [line("salt", 1), line("onion", 1)])];
    const result = planLoad("themealdb", recipes, catalog, db);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(formatPlan(result.plan)).toBe(
      [
        "Ingredients to insert: 2",
        "  - onion [whole]",
        "  - salt [count, staple]",
        "Recipes to insert: 1",
        "  - 1 Recipe 1 (1 line)",
        "Recipes to update: 1",
        "  - 2 Recipe 2 (2 lines)",
        "Recipe ingredient lines to write: 3",
      ].join("\n"),
    );
  });
});
