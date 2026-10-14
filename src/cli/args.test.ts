import { describe, expect, it } from "vitest";
import { parseCliArgs, UsageError } from "./args";

describe("parseCliArgs", () => {
  it("parses the source and applies defaults", () => {
    expect(parseCliArgs("fetch", ["themealdb"])).toEqual({ source: "themealdb", limit: 100 });
    expect(parseCliArgs("load", ["themealdb"])).toEqual({ source: "themealdb", dryRun: false });
    expect(parseCliArgs("map", ["themealdb"])).toEqual({ source: "themealdb" });
  });

  it("parses stage options", () => {
    expect(parseCliArgs("fetch", ["themealdb", "--limit", "5"])).toEqual({ source: "themealdb", limit: 5 });
    expect(parseCliArgs("load", ["--dry-run", "themealdb"])).toEqual({ source: "themealdb", dryRun: true });
  });

  it.each([
    ["no source", "map", []],
    ["two sources", "map", ["a", "b"]],
    ["an option from another stage", "map", ["themealdb", "--dry-run"]],
    ["a non-integer limit", "fetch", ["themealdb", "--limit", "1.5"]],
    ["a zero limit", "fetch", ["themealdb", "--limit", "0"]],
    ["a malformed source name", "map", ["TheMealDB"]],
  ] as const)("rejects %s with the usage line", (_, stage, argv) => {
    expect(() => parseCliArgs(stage, [...argv])).toThrow(UsageError);
    expect(() => parseCliArgs(stage, [...argv])).toThrow(/Usage: npm run ingest:/);
  });
});
