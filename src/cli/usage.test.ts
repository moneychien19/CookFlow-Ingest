import { describe, expect, it } from "vitest";
import { usage } from "./usage";

describe("usage", () => {
  it("names the npm script and the source argument", () => {
    expect(usage("fetch")).toBe("Usage: npm run ingest:fetch -- <source> [--limit <n>]");
  });

  it("documents --dry-run for load", () => {
    expect(usage("load")).toContain("--dry-run");
  });
});
