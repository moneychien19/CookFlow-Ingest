import { describe, expect, it } from "vitest";
import { entry } from "../../test/builders";
import { createMatcher } from "./match";

const onion = entry("onion", "whole", { aliases: ["red onion", "onions"] });
const leek = entry("leek", "whole", { reviewed: false });
const match = createMatcher([onion, leek, entry("chicken breast", "g")]);

describe("createMatcher", () => {
  it("matches a canonical name", () => {
    expect(match("chicken breast")?.name).toBe("chicken breast");
  });

  it("matches an alias", () => {
    expect(match("red onion")).toBe(onion);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(match("  Red Onion\t")).toBe(onion);
    expect(match("CHICKEN BREAST")?.name).toBe("chicken breast");
  });

  it("matches unreviewed entries too", () => {
    expect(match("Leek")).toBe(leek);
  });

  it("returns null for an unknown name, without guessing", () => {
    expect(match("red onions")).toBeNull();
    expect(match("onion rings")).toBeNull();
    expect(match("")).toBeNull();
  });
});
