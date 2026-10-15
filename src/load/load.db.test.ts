import { and, asc, eq, isNotNull, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { ingredients, isCatalog, recipeIngredients, recipes } from "@/db/schema";
import type { ReviewedRecipe } from "@/schema/reviewed";
import { entry, line, recipe } from "../../test/builders";
import { loadSource } from "./load";

// Runs against a real Postgres (a throwaway Neon branch), only when TEST_DATABASE_URL is set.
// Every row these tests create uses a "test-" source, a "test " ingredient name, or a "test-"
// user id, and is deleted before each test, so the branch can be reused.
const url = process.env.TEST_DATABASE_URL;

const SOURCE = "test-load";
const OTHER_SOURCE = "test-other";
const catalog = [
  entry("test onion", "whole"),
  entry("test chicken", "g"),
  entry("test salt", "count", { isStaple: true }),
  entry("test unused", "bunch"),
];
const approved = (sourceId: string, lines: ReturnType<typeof line>[], extra: Partial<ReviewedRecipe> = {}) =>
  recipe(sourceId, lines, { source: SOURCE, ...extra });

describe.skipIf(!url)("loadSource (real Postgres)", () => {
  // Connect in beforeAll, not here: the describe body still runs when the suite is skipped.
  let db: Db;
  beforeAll(() => {
    db = createDb(url ?? "");
  });
  afterAll(() => db.$client.end());

  beforeEach(async () => {
    await db.delete(recipes).where(like(recipes.source, "test-%"));
    await db.delete(ingredients).where(like(ingredients.name, "test %"));
    // Deleting a user deletes the ingredients they own (on delete cascade).
    await db.execute(sql`delete from users where id like 'test-%'`);
  });

  const load = (recipeList: ReviewedRecipe[], source = SOURCE) =>
    loadSource(db, { source, recipes: recipeList, catalog }, { dryRun: false });

  /** Every test row in the catalog and recipes, without serial ids, so two loads can be compared. */
  async function dump() {
    const ingredientRows = await db
      .select({ name: ingredients.name, unit: ingredients.unit, isStaple: ingredients.isStaple })
      .from(ingredients)
      .where(and(isCatalog, like(ingredients.name, "test %")))
      .orderBy(asc(ingredients.name));
    const recipeRows = await db
      .select()
      .from(recipes)
      .where(like(recipes.source, "test-%"))
      .orderBy(asc(recipes.source), asc(recipes.sourceId));
    const lineRows = await db
      .select({
        source: recipes.source,
        recipe: recipes.sourceId,
        ingredient: ingredients.name,
        quantity: recipeIngredients.quantity,
        sourceName: recipeIngredients.sourceName,
        sourceMeasure: recipeIngredients.sourceMeasure,
      })
      .from(recipeIngredients)
      .innerJoin(recipes, eq(recipes.id, recipeIngredients.recipeId))
      .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
      .where(like(recipes.source, "test-%"))
      .orderBy(asc(recipes.source), asc(recipes.sourceId), asc(ingredients.name));
    return { ingredients: ingredientRows, recipes: recipeRows, lines: lineRows };
  }

  it("leaves the same rows when run twice", async () => {
    const file = [
      approved("1", [line("test onion", 0.5), line("test salt", 1)]),
      approved("2", [line("test chicken", 400)]),
    ];
    await load(file);
    const first = await dump();
    await load(file);
    expect(await dump()).toEqual(first);
    expect(first.recipes).toHaveLength(2);
    expect(first.lines).toHaveLength(3);
  });

  it("stores source text exactly as given", async () => {
    const lines = [{ ...line("test onion", 1), sourceName: " Red Onion ", sourceMeasure: "1 chopped\t" }];
    await load([approved("1", lines, { instructions: "Chop.\r\n\r\nCook at 75°C. " })]);
    const { recipes: [saved], lines: [savedLine] } = await dump();
    expect(saved?.instructions).toBe("Chop.\r\n\r\nCook at 75°C. ");
    expect(savedLine).toMatchObject({ sourceName: " Red Onion ", sourceMeasure: "1 chopped\t", quantity: 1 });
  });

  it("updates a loaded recipe and replaces its lines", async () => {
    await load([approved("1", [line("test onion", 1), line("test salt", 1)])]);
    const id = (await dump()).recipes[0]?.id;
    await load([approved("1", [line("test chicken", 250)], { title: "Renamed" })]);
    const after = await dump();
    expect(after.recipes).toMatchObject([{ id, title: "Renamed" }]);
    expect(after.lines).toMatchObject([{ ingredient: "test chicken", quantity: 250 }]);
  });

  it("fails on a unit conflict with an existing ingredient, writing nothing", async () => {
    await db.insert(ingredients).values({ name: "test chicken", unit: "pack", isStaple: false });
    const file = [approved("1", [line("test onion", 1)]), approved("2", [line("test chicken", 400)])];
    await expect(load(file)).rejects.toThrow('ingredient "test chicken": database unit is "pack", catalog unit is "g"');
    expect(await dump()).toEqual({
      ingredients: [{ name: "test chicken", unit: "pack", isStaple: false }],
      recipes: [],
      lines: [],
    });
  });

  it("ignores and keeps an ingredient a cook added with the same name", async () => {
    await db.execute(sql`insert into users (id, name) values ('test-cook', 'Test cook')`);
    const own = { name: "test chicken", unit: "pack" as const, isStaple: false, ownerId: "test-cook" };
    await db.insert(ingredients).values(own);

    await load([approved("1", [line("test chicken", 400)])]);
    const after = await dump();
    expect(after.ingredients).toEqual([{ name: "test chicken", unit: "g", isStaple: false }]);
    expect(after.lines).toMatchObject([{ ingredient: "test chicken", quantity: 400 }]);
    const owned = await db
      .select({ name: ingredients.name, unit: ingredients.unit, isStaple: ingredients.isStaple, ownerId: ingredients.ownerId })
      .from(ingredients)
      .where(isNotNull(ingredients.ownerId));
    expect(owned.filter((i) => i.ownerId === "test-cook")).toEqual([own]);
  });

  it("rolls everything back when a write fails partway", async () => {
    // numeric(8,2) can't hold this, so the line insert fails after the recipes and
    // ingredients were written. (Validation rejects it earlier in a real run.)
    const file = [approved("1", [line("test onion", 1)]), approved("2", [line("test chicken", 10_000_000)])];
    await expect(load(file)).rejects.toThrow();
    expect(await dump()).toEqual({ ingredients: [], recipes: [], lines: [] });
  });

  it("doesn't insert a catalog ingredient that no approved recipe uses", async () => {
    await load([approved("1", [line("test onion", 1)]), approved("2", [line("test chicken", 1)], { status: "pending" })]);
    expect((await dump()).ingredients.map((i) => i.name)).toEqual(["test onion"]);
  });

  it("leaves other sources and recipes not in the file untouched", async () => {
    await load([recipe("1", [line("test onion", 2)], { source: OTHER_SOURCE })], OTHER_SOURCE);
    await load([approved("old", [line("test onion", 3)])]);
    const before = await dump();

    await load([approved("1", [line("test onion", 1)])]);
    const after = await dump();

    const notInFile = (r: { source: string }, sourceId: string) => r.source === OTHER_SOURCE || sourceId === "old";
    const untouched = (d: typeof before) => ({
      recipes: d.recipes.filter((r) => notInFile(r, r.sourceId)),
      lines: d.lines.filter((l) => notInFile(l, l.recipe)),
    });
    expect(untouched(after)).toEqual(untouched(before));
    expect(after.recipes).toHaveLength(3);
  });

  it("writes nothing on a dry run", async () => {
    const plan = await loadSource(
      db,
      { source: SOURCE, recipes: [approved("1", [line("test onion", 1)])], catalog },
      { dryRun: true },
    );
    expect(plan.recipesToInsert).toHaveLength(1);
    expect(await dump()).toEqual({ ingredients: [], recipes: [], lines: [] });
  });
});
