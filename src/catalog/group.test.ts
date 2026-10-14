import { describe, expect, it } from "vitest";
import { catalogFile } from "@/schema/catalog";
import { entry } from "../../test/builders";
import { buildCatalog } from "./group";
import type { Proposal } from "./proposals";

const p = (sourceName: string, canonicalName: string | null, extra: Partial<Proposal> = {}): Proposal => ({
  sourceName,
  canonicalName,
  unit: canonicalName ? "whole" : null,
  isStaple: false,
  note: null,
  ...extra,
});

describe("buildCatalog", () => {
  it("groups source names by canonical name, as unreviewed drafts with aliases", () => {
    const { catalog } = buildCatalog([p("onion", "onion"), p("red onion", "onion"), p("onions", "onion"), p("leek", "leek")], []);
    expect(catalog).toEqual([
      { name: "onion", unit: "whole", isStaple: false, aliases: ["onions", "red onion"], reviewed: false, note: null },
      { name: "leek", unit: "whole", isStaple: false, aliases: [], reviewed: false, note: null },
    ]);
  });

  it("leaves out names Claude said aren't ingredients", () => {
    expect(buildCatalog([p("egg wash", null, { note: "a mixture" })], []).catalog).toEqual([]);
  });

  it("takes the majority unit and staple flag, noting the disagreement", () => {
    const { catalog } = buildCatalog(
      [p("olive oil", "olive oil", { unit: "ml", isStaple: true }), p("extra virgin olive oil", "olive oil", { unit: "ml" }), p("evoo", "olive oil", { unit: "ml", isStaple: true }), p("olive oil spray", "olive oil", { unit: "count", isStaple: true })],
      [],
    );
    expect(catalog[0]).toMatchObject({ unit: "ml", isStaple: true });
    expect(catalog[0]?.note).toBe("Units proposed: ml (3), count (1). Staple proposed: true (3), false (1).");
  });

  it("carries Claude's notes, naming the source name", () => {
    const { catalog } = buildCatalog([p("scallions", "green onion", { unit: "bunch", note: "Same as spring onion." })], []);
    expect(catalog[0]?.note).toBe('"scallions": Same as spring onion.');
  });

  it("drops an alias that is also another entry's name, and notes it", () => {
    const { catalog } = buildCatalog([p("chicken", "chicken breast", { unit: "g" }), p("chicken thighs", "chicken", { unit: "g" })], []);
    expect(catalog.find((e) => e.name === "chicken breast")).toMatchObject({ aliases: [], note: expect.stringContaining('"chicken"') });
    expect(catalogFile.safeParse(catalog).success).toBe(true);
  });

  it("keeps reviewed entries as they are and rebuilds unreviewed ones", () => {
    const reviewed = entry("onion", "whole", { aliases: ["red onion"], note: "checked" });
    const stale = entry("leek", "bunch", { reviewed: false });
    const { catalog, warnings } = buildCatalog([p("red onion", "onion"), p("leek", "leek"), p("spring onion", "onion")], [reviewed, stale]);
    expect(catalog).toEqual([reviewed, { name: "leek", unit: "whole", isStaple: false, aliases: [], reviewed: false, note: null }]);
    expect(warnings).toEqual(['"spring onion" belongs to reviewed entry "onion"; add it as an alias by hand if that\'s right.']);
  });
});
