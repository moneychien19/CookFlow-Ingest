import { describe, expect, it } from "vitest";
import { diffSchemas } from "./introspect";

describe("diffSchemas", () => {
  const base = ["column ingredients.name text not null", "migration aaa", "table ingredients"];

  it("finds nothing when the schemas match", () => {
    expect(diffSchemas({ name: "dev", lines: base }, { name: "production", lines: [...base] })).toEqual([]);
  });

  it("lists what only one side has, a changed line as one of each", () => {
    const prod = ["column ingredients.name text", "table ingredients"];
    expect(diffSchemas({ name: "dev", lines: base }, { name: "production", lines: prod })).toEqual([
      "only in dev: column ingredients.name text not null",
      "only in dev: migration aaa",
      "only in production: column ingredients.name text",
    ]);
  });
});
