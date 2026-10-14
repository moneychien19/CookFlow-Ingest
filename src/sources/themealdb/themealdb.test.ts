import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runFetch } from "@/fetch/runFetch";
import { sourceRecipe } from "@/schema/sourceRecipe";
import { RawCache } from "@/sources/rawCache";
import { createTheMealDb } from ".";
import { BASE_URL } from "./fetch";
import { mealRaw, type MealRaw } from "./raw";
import { toSourceRecipe } from "./toSourceRecipe";

// Real meals from search.php, saved as returned.
const fixture = (id: string): MealRaw => {
  const json: unknown = JSON.parse(readFileSync(join(import.meta.dirname, `../../../test/fixtures/themealdb/${id}.json`), "utf8"));
  return mealRaw.parse(json);
};
const bhartha = fixture("52807"); // Vegetarian, strTags "Spicy,Bun,Calorific"
const brisket = fixture("52812"); // null ingredient pairs, "1 sprig " measure
const sloppyJoes = fixture("52995"); // seven lines with a " " measure

describe("toSourceRecipe", () => {
  it("maps the meal fields (SPEC §5.1) and passes the shared schema", () => {
    const recipe = toSourceRecipe(bhartha);
    expect(sourceRecipe.parse(recipe)).toEqual(recipe);
    expect(recipe).toMatchObject({
      sourceId: "52807",
      title: "Baingan Bharta",
      instructions: bhartha.strInstructions,
      imageUrl: bhartha.strMealThumb,
      servings: null,
    });
  });

  it("tags with the category and strTags, lowercased, without duplicating vegetarian", () => {
    expect(toSourceRecipe(bhartha).tags).toEqual(["vegetarian", "spicy", "bun", "calorific"]);
    expect(toSourceRecipe(brisket).tags).toEqual(["beef", "meat"]);
    expect(toSourceRecipe({ ...sloppyJoes, strTags: " Spicy , ,BBQ" }).tags).toEqual(["pork", "spicy", "bbq"]);
  });

  it("adds vegetarian for Vegan meals", () => {
    expect(toSourceRecipe({ ...bhartha, strCategory: "Vegan", strTags: null }).tags).toEqual(["vegan", "vegetarian"]);
  });

  it("skips null and blank ingredient pairs", () => {
    expect(toSourceRecipe(brisket).lines).toHaveLength(11);
    expect(toSourceRecipe(sloppyJoes).lines).toHaveLength(13);
  });

  it("keeps names and measures verbatim, including whitespace and empty measures", () => {
    const lines = toSourceRecipe({ ...sloppyJoes, strIngredient1: " Potatoes\t" }).lines;
    expect(lines[0]).toEqual({ name: " Potatoes\t", measure: "2" });
    expect(lines[6]).toEqual({ name: "Barbeque Sauce", measure: " " });
    expect(toSourceRecipe(brisket).lines[5]).toEqual({ name: "Rosemary", measure: "1 sprig " });
  });

  it("uses an empty measure when the API sends null for a kept ingredient", () => {
    expect(toSourceRecipe({ ...brisket, strMeasure1: null }).lines[0]).toEqual({ name: "Beef Brisket", measure: "" });
  });

  it("treats an empty thumbnail as no image", () => {
    expect(toSourceRecipe({ ...bhartha, strMealThumb: "" }).imageUrl).toBeNull();
  });
});

describe("fetch", () => {
  const tmp = () => mkdtempSync(join(tmpdir(), "ingest-themealdb-"));

  /** A fake search.php: `byLetter` maps a letter to its meals; other letters have none. */
  function fakeApi(byLetter: Record<string, unknown[]>) {
    const requested: string[] = [];
    const getJson = async (url: string) => {
      requested.push(url);
      const letter = new URL(url).searchParams.get("f") ?? "";
      return { meals: byLetter[letter] ?? null };
    };
    return { requested, getJson };
  }

  it("walks letters in order and caches each meal as returned", async () => {
    const api = fakeApi({ a: [bhartha], c: [brisket, sloppyJoes] });
    const adapter = createTheMealDb({ getJson: api.getJson, delayMs: 0 });
    const cache = new RawCache(adapter, tmp());
    const result = await runFetch(adapter, cache, { limit: 100 });
    expect(result.written).toEqual(["52807", "52812", "52995"]);
    expect(api.requested).toHaveLength(26);
    expect(api.requested[0]).toBe(`${BASE_URL}search.php?f=a`);
    expect(cache.read("52812")).toEqual(brisket);
  });

  it("stops requesting letters once the limit is reached", async () => {
    const api = fakeApi({ a: [bhartha], b: [brisket], c: [sloppyJoes] });
    const adapter = createTheMealDb({ getJson: api.getJson, delayMs: 0 });
    await runFetch(adapter, new RawCache(adapter, tmp()), { limit: 2 });
    expect(api.requested.map((u) => new URL(u).searchParams.get("f"))).toEqual(["a", "b"]);
  });

  it("skips desserts, so they don't count toward the limit", async () => {
    const dessert = { ...brisket, idMeal: "1", strCategory: "Dessert" };
    const api = fakeApi({ a: [dessert, bhartha], b: [sloppyJoes] });
    const adapter = createTheMealDb({ getJson: api.getJson, delayMs: 0 });
    const cache = new RawCache(adapter, tmp());
    expect((await runFetch(adapter, cache, { limit: 2 })).written).toEqual(["52807", "52995"]);
    expect(cache.has("1")).toBe(false);
  });

  it("fails on a malformed meal, naming its id", async () => {
    const api = fakeApi({ a: [{ ...bhartha, strInstructions: null }] });
    const adapter = createTheMealDb({ getJson: api.getJson, delayMs: 0 });
    await expect(runFetch(adapter, new RawCache(adapter, tmp()), { limit: 10 })).rejects.toThrow(
      /themealdb record 52807 doesn't match its schema[\s\S]*strInstructions/,
    );
  });

  it("fails on an unexpected response, naming the URL", async () => {
    const adapter = createTheMealDb({ getJson: async () => ({ error: "rate limited" }), delayMs: 0 });
    await expect(runFetch(adapter, new RawCache(adapter, tmp()), { limit: 10 })).rejects.toThrow(
      `Unexpected response from ${BASE_URL}search.php?f=a`,
    );
  });
});
