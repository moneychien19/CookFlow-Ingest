import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRecipes, writeRecipes } from "./dataFiles";
import { DataFileError } from "./json";

const EXAMPLE = join(import.meta.dirname, "../../test/fixtures/recipes.example.json");
const tmp = () => mkdtempSync(join(tmpdir(), "ingest-json-"));

describe("recipes file I/O", () => {
  it("round-trips byte for byte", () => {
    const out = join(tmp(), "recipes.json");
    writeRecipes(out, readRecipes(EXAMPLE));
    expect(readFileSync(out, "utf8")).toBe(readFileSync(EXAMPLE, "utf8"));
  });

  it("sorts recipes by sourceId numerically", () => {
    const [recipe] = readRecipes(EXAMPLE);
    const out = join(tmp(), "recipes.json");
    writeRecipes(out, ["100", "9", "52772"].map((sourceId) => ({ ...recipe!, sourceId })));
    expect(readRecipes(out).map((r) => r.sourceId)).toEqual(["9", "100", "52772"]);
  });

  it("names the file and the failing field", () => {
    const path = join(tmp(), "recipes.json");
    const [recipe] = JSON.parse(readFileSync(EXAMPLE, "utf8"));
    writeFileSync(path, JSON.stringify([{ ...recipe, status: "done" }]));
    expect(() => readRecipes(path)).toThrow(DataFileError);
    expect(() => readRecipes(path)).toThrow(new RegExp(`${path}:[\\s\\S]*\\[0\\]\\.status`));
  });

  it("reports invalid JSON with the file name", () => {
    const path = join(tmp(), "recipes.json");
    writeFileSync(path, "[{");
    expect(() => readRecipes(path)).toThrow(`${path}: invalid JSON`);
  });

  it("refuses to write invalid data", () => {
    const [recipe] = readRecipes(EXAMPLE);
    const out = join(tmp(), "recipes.json");
    expect(() => writeRecipes(out, [{ ...recipe!, title: "" }])).toThrow(/refusing to write/);
  });
});
