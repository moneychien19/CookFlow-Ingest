import { describe, expect, it } from "vitest";
import type { ReviewedLine } from "@/schema/reviewed";
import { entry, line, recipe } from "../../test/builders";
import { buildReport, formatReport } from "./report";

const by = (method: ReviewedLine["method"], ingredient: string | null, quantity: number | null, note: string | null = null): ReviewedLine => ({
  ...line(ingredient, quantity),
  method,
  note,
});

const catalog = [
  entry("onion", "whole"),
  entry("potato", "whole", { reviewed: false }),
  entry("salt", "g", { isStaple: true, reviewed: false }),
  entry("leek", "whole", { reviewed: false, note: "check unit" }),
  entry("unused", "g", { reviewed: false }),
];

const recipes = [
  recipe("1", [by("rule", "onion", 1), by("rule", "salt", 1, "nominal staple quantity"), by("claude", "potato", 4.5)], { tags: ["vegetarian"] }),
  recipe("2", [by("manual", "potato", 2), by("rule", "onion", 1)], { status: "pending" }),
  recipe("3", [by(null, "leek", null, "volume for an ingredient measured in whole"), by("claude", null, null, "can't map: unclear"), by("rule", "salt", 1, "nominal staple quantity")], { status: "pending" }),
  recipe("4", [by("rule", "onion", 1), by("rule", "onion", 2)], { status: "dropped", dropReason: 'duplicate ingredient "onion"' }),
  recipe("5", [by("rule", "onion", 1), by("rule", "onion", 2)], { status: "dropped", dropReason: 'duplicate ingredient "onion"' }),
  recipe("6", [by("rule", "unused", 1)], { status: "dropped", dropReason: "not a meal" }),
];

describe("buildReport", () => {
  const report = buildReport(10, recipes, catalog);

  it("counts recipes by status, vegetarian approvals, and complete pending recipes", () => {
    expect(report.rawRecords).toBe(10);
    expect(report.recipes).toEqual({ total: 6, pending: 2, approved: 1, dropped: 3, vegetarianApproved: 1 });
    expect(report.pendingComplete).toBe(1);
  });

  it("groups drop reasons, with map's duplicate drops together", () => {
    expect(report.dropped).toEqual([
      { reason: "duplicate ingredient", recipes: 2 },
      { reason: "not a meal", recipes: 1 },
    ]);
  });

  it("counts lines of pending and approved recipes by how they were mapped", () => {
    expect(report.lines).toEqual({ rule: 2, nominal: 2, claude: 1, manual: 1, cantMap: 1, unmapped: 1 });
  });

  it("queues unreviewed ingredients used by pending or approved recipes, most used first", () => {
    expect(report.reviewQueue).toEqual([
      { name: "potato", unit: "whole", isStaple: false, recipes: 2, note: null },
      { name: "salt", unit: "g", isStaple: true, recipes: 2, note: null },
      { name: "leek", unit: "whole", isStaple: false, recipes: 1, note: "check unit" },
    ]);
  });
});

describe("formatReport", () => {
  it("prints progress, drops, lines, and the top of the review queue", () => {
    expect(formatReport(buildReport(10, recipes, catalog), { queueLimit: 2 })).toBe(
      [
        "Raw records cached: 10",
        "Recipes: 6 (2 pending, 1 approved, 3 dropped)",
        "  pending with every line mapped: 1",
        "",
        "Targets (SPEC §6): approved 1/50, vegetarian approved 1/10",
        "",
        "Dropped:",
        "  2  duplicate ingredient",
        "  1  not a meal",
        "",
        "Lines in pending and approved recipes:",
        "  2 by rule, 2 nominal staples, 1 by Claude, 1 by a reviewer",
        "  1 unmapped (run normalize), 1 Claude couldn't map (fix by hand or drop the recipe)",
        "",
        "Catalog review queue: 3 unreviewed ingredients used by pending or approved recipes",
        "    2  potato [whole]",
        "    2  salt [g, staple]",
        "  … 1 more",
      ].join("\n"),
    );
  });

  it("marks a target as met", () => {
    const many = Array.from({ length: 50 }, (_, i) => recipe(String(i), [], { tags: i < 10 ? ["vegetarian"] : [] }));
    expect(formatReport(buildReport(50, many, []))).toContain("approved 50/50 ✓, vegetarian approved 10/10 ✓");
  });
});
