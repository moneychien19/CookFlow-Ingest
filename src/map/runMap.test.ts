import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMatcher } from "@/catalog/match";
import { runFetch } from "@/fetch/runFetch";
import type { CatalogEntry } from "@/schema/catalog";
import type { ReviewedRecipe } from "@/schema/reviewed";
import { RawCache } from "@/sources/rawCache";
import { entry } from "../../test/builders";
import { fixtureRecord, fixtureSource, type FixtureRaw } from "../../test/fixtureSource";
import { runMap } from "./runMap";

const catalog = [
  entry("onion", "whole", { aliases: ["red onion"] }),
  entry("chicken breast", "g", { aliases: ["chicken breasts"] }),
  entry("salt", "g", { isStaple: true, aliases: ["sea salt"] }),
];

/** Caches `records` with the fixture source, then maps them against `existing`. */
async function map(records: FixtureRaw[], existing: ReviewedRecipe[] = [], cat: CatalogEntry[] = catalog) {
  const source = fixtureSource(records);
  const cache = new RawCache(source, mkdtempSync(join(tmpdir(), "ingest-map-")));
  await runFetch(source, cache, { limit: 100 });
  return runMap(source, cache, existing, createMatcher(cat));
}

const parts = (...pairs: [string, string][]) => pairs.map(([what, howMuch]) => ({ what, howMuch }));

describe("runMap", () => {
  it("maps each line by rule, and explains the lines it can't map", async () => {
    const record = fixtureRecord("1", {
      parts: parts(["Red Onion", "1 chopped"], ["Chicken Breasts", "2"], ["Salt", "pinch"], ["Saffron", "1 pinch"]),
    });
    const { recipes, unmapped } = await map([record]);
    expect(recipes).toEqual([
      {
        source: "fixture",
        sourceId: "1",
        title: "Fixture 1",
        imageUrl: null,
        instructions: "Mix.\r\nServe. ",
        servings: null,
        tags: [],
        status: "pending",
        dropReason: null,
        lines: [
          { sourceName: "Red Onion", sourceMeasure: "1 chopped", ingredient: "onion", quantity: 1, method: "rule", note: null },
          { sourceName: "Chicken Breasts", sourceMeasure: "2", ingredient: "chicken breast", quantity: null, method: null, note: "a count for an ingredient measured in g" },
          { sourceName: "Salt", sourceMeasure: "pinch", ingredient: "salt", quantity: 1, method: "rule", note: "nominal staple quantity" },
          { sourceName: "Saffron", sourceMeasure: "1 pinch", ingredient: null, quantity: null, method: null, note: "no catalog entry for this name" },
        ],
      },
    ]);
    expect(unmapped).toEqual([
      { sourceId: "1", title: "Fixture 1", sourceName: "Chicken Breasts", sourceMeasure: "2", ingredient: "chicken breast", reason: "a count for an ingredient measured in g" },
      { sourceId: "1", title: "Fixture 1", sourceName: "Saffron", sourceMeasure: "1 pinch", ingredient: null, reason: "no catalog entry for this name" },
    ]);
  });

  it("drops a recipe where two lines map to the same ingredient", async () => {
    const { recipes } = await map([fixtureRecord("1", { parts: parts(["Salt", "1 tsp"], ["Sea Salt", "pinch"]) })]);
    expect(recipes[0]).toMatchObject({ status: "dropped", dropReason: 'duplicate ingredient "salt"' });
  });

  it("re-checks its own drops, so a catalog fix brings the recipe back", async () => {
    const record = fixtureRecord("1", { parts: parts(["Salt", "1 tsp"], ["Sea Salt", "pinch"]) });
    const first = await map([record]);
    const split = [...catalog.filter((e) => e.name !== "salt"), entry("salt", "g", { isStaple: true }), entry("sea salt", "g", { isStaple: true })];
    const second = await map([record], first.recipes, split);
    expect(second.recipes[0]).toMatchObject({ status: "pending", dropReason: null });
  });

  it("keeps approved recipes and a reviewer's drops exactly as they are", async () => {
    const record = fixtureRecord("1", { parts: parts(["Onion", "1"]) });
    const first = await map([record]);
    const approved = { ...first.recipes[0]!, status: "approved" as const, title: "Edited by hand" };
    const dropped = { ...first.recipes[0]!, sourceId: "2", status: "dropped" as const, dropReason: "too vague" };
    const result = await map([record, fixtureRecord("2")], [approved, dropped], []);
    expect(result.recipes).toEqual([approved, dropped]);
    expect(result.counts).toMatchObject({ mapped: 0, kept: 2 });
  });

  it("remaps pending recipes against the current catalog but keeps Claude's and the reviewer's lines", async () => {
    const record = fixtureRecord("1", { parts: parts(["Onion", "1"], ["Leek", "2"], ["Chicken Breasts", "2"]) });
    const first = await map([record]);
    const [onion, leek, chicken] = first.recipes[0]!.lines;
    const edited: ReviewedRecipe = {
      ...first.recipes[0]!,
      lines: [
        onion!,
        { ...leek!, ingredient: "leek", quantity: 2, method: "manual", note: "added by reviewer" },
        { ...chicken!, quantity: 400, method: "claude", note: "about 200 g per breast" },
      ],
    };
    const renamed = [entry("red onion", "whole", { aliases: ["onion"] }), ...catalog.filter((e) => e.name !== "onion")];
    const { recipes } = await map([record], [edited], renamed);
    expect(recipes[0]!.lines.map((l) => [l.ingredient, l.quantity, l.method])).toEqual([
      ["red onion", 1, "rule"],
      ["leek", 2, "manual"],
      ["chicken breast", 400, "claude"],
    ]);
  });

  it("keeps recipes that are no longer in the cache", async () => {
    const gone = { ...(await map([fixtureRecord("9")])).recipes[0]!, status: "approved" as const };
    const { recipes } = await map([fixtureRecord("1")], [gone]);
    expect(recipes.map((r) => r.sourceId).sort()).toEqual(["1", "9"]);
  });

  it("counts pending lines by how they were mapped", async () => {
    const record = fixtureRecord("1", { parts: parts(["Onion", "1"], ["Salt", "to taste"], ["Saffron", "1 pinch"]) });
    expect((await map([record])).counts).toEqual({ mapped: 1, kept: 0, dropped: 0, pending: 1, lines: 3, rule: 1, nominal: 1, unmapped: 1 });
  });
});
