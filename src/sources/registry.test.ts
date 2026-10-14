import { describe, expect, it } from "vitest";
import { CliError } from "@/errors";
import { fixtureSource } from "../../test/fixtureSource";
import { createRegistry } from "./registry";

describe("source registry", () => {
  it("looks adapters up by name", () => {
    const fixture = fixtureSource([]);
    expect(createRegistry([fixture]).get("fixture")).toBe(fixture);
  });

  it("rejects an unknown source, listing the registered ones", () => {
    const registry = createRegistry([fixtureSource([]), { ...fixtureSource([]), name: "other" }]);
    expect(() => registry.get("nope")).toThrow(CliError);
    expect(() => registry.get("nope")).toThrow('Unknown source "nope". Registered sources: fixture, other');
  });

  it("rejects two adapters with the same name", () => {
    expect(() => createRegistry([fixtureSource([]), fixtureSource([])])).toThrow(/Duplicate source adapter "fixture"/);
  });
});
