import { describe, expect, it } from "vitest";
import type { StructuredCall } from "@/claude/client";
import { UsageTally } from "@/claude/usage";
import type { proposalBatch } from "./prompt";
import { proposeMissing } from "./propose";
import type { Proposal } from "./proposals";
import type { z } from "zod";

type Reply = z.output<typeof proposalBatch>["proposals"][number];
type Answer = Omit<Reply, "id">;
const usage = { model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };
const ok = (canonicalName: string | null): Answer => ({ canonicalName, unit: canonicalName ? "whole" : null, isStaple: false, note: null });

/** Reads the {id, name, category} list out of a request, like Claude would. */
function askedIn(user: string): { id: number; name: string }[] {
  return JSON.parse(user.slice(user.indexOf("Source names to map:\n") + "Source names to map:\n".length));
}

/**
 * A fake Claude that answers each name with `answer(name)` under the name's id, or with
 * full replies (ids included) when `answer` returns an array. Records the names asked.
 */
function fakeClaude(answer: (name: string, id: number) => Answer | Reply[] | null = (name) => ok(name)) {
  const requests: string[][] = [];
  const call = (async ({ user }: { user: string }) => {
    const asked = askedIn(user);
    requests.push(asked.map((n) => n.name));
    const proposals = asked.flatMap(({ id, name }) => {
      const a = answer(name, id);
      return a === null ? [] : Array.isArray(a) ? a : [{ id, ...a }];
    });
    return { output: { proposals }, usage };
  }) as StructuredCall;
  return { call, requests };
}

const names = (...list: string[]) => list.map((name) => ({ name, category: null }));

describe("proposeMissing", () => {
  it("normalizes, dedupes, and sorts names, then asks in batches", async () => {
    const claude = fakeClaude();
    const result = await proposeMissing(names("Onion", "basil", " onion ", "Bay Leaf", "Apple"), [], {
      call: claude.call,
      tally: new UsageTally(),
      save: () => {},
      batchSize: 2,
    });
    expect(claude.requests).toEqual([["apple", "basil"], ["bay leaf", "onion"]]);
    expect(result.map((p) => p.sourceName)).toEqual(["apple", "basil", "bay leaf", "onion"]);
  });

  it("never asks again for a name that already has a proposal", async () => {
    const claude = fakeClaude();
    const existing: Proposal[] = [{ sourceName: "onion", canonicalName: "onion", unit: "whole", isStaple: false, note: null }];
    await proposeMissing(names("Onion", "Leek"), existing, { call: claude.call, tally: new UsageTally(), save: () => {} });
    expect(claude.requests).toEqual([["leek"]]);
  });

  it("saves after every batch and respects --limit and --max-requests", async () => {
    const claude = fakeClaude();
    const saved: number[] = [];
    const tally = new UsageTally();
    const logs: string[] = [];
    await proposeMissing(names("apple", "bean", "carrot", "date", "egg", "fig"), [], {
      call: claude.call,
      tally,
      save: (all) => saved.push(all.length),
      log: (l) => logs.push(l),
      batchSize: 2,
      limit: 5,
      maxRequests: 2,
    });
    expect(claude.requests).toEqual([["apple", "bean"], ["carrot", "date"]]);
    expect(saved).toEqual([2, 4]);
    expect(tally.requests).toBe(2);
    expect(logs).toContain("Stopped at --max-requests 2; 1 names left for the next run.");
  });

  it("drops replies that break the rules, so those names are asked again next run", async () => {
    const claude = fakeClaude((name, id) => {
      const replies: Record<string, Answer | Reply[] | null> = {
        gruyère: { ...ok("gruyère"), unit: "g" },
        nounit: { ...ok("nounit"), unit: null },
        missing: null,
        twice: [
          { id, ...ok("twice") },
          { id, ...ok("other") },
        ],
        stray: [{ id: 99, ...ok("stray") }],
        "egg wash": { ...ok(null), note: "a mixture" },
      };
      return replies[name] ?? null;
    });
    const logs: string[] = [];
    const result = await proposeMissing(names("Gruyère", "nounit", "missing", "twice", "stray", "Egg Wash"), [], {
      call: claude.call,
      tally: new UsageTally(),
      save: () => {},
      log: (l) => logs.push(l),
    });
    expect(result.map((p) => [p.sourceName, p.canonicalName])).toEqual([
      ["egg wash", null],
      ["twice", "twice"],
    ]);
    expect(logs.filter((l) => l.startsWith("  "))).toEqual([
      '  dropped "gruyère": invalid canonical name "gruyère"',
      '  dropped "nounit": no unit',
      // Names are sorted before numbering: egg wash 0, gruyère 1, missing 2, nounit 3, stray 4, twice 5.
      "  dropped a reply for id 99: not one of the ids asked (or a duplicate)",
      "  dropped a reply for id 5: not one of the ids asked (or a duplicate)",
      '  no proposal for "missing"',
      '  no proposal for "stray"',
    ]);
  });

  it("keeps the source name as sent, whatever name Claude would have echoed", async () => {
    // The bug this replaced: Claude copied "beef cutlet [Meat]" back as the name and the reply was dropped.
    const claude = fakeClaude(() => ({ ...ok("beef"), unit: "g" }));
    const result = await proposeMissing([{ name: "Beef Cutlet", category: "Meat" }, { name: "Västerbottensost Cheese", category: "Cheese" }], [], {
      call: claude.call,
      tally: new UsageTally(),
      save: () => {},
    });
    expect(result.map((p) => p.sourceName)).toEqual(["beef cutlet", "västerbottensost cheese"]);
  });

  it("sends each name with its id and category as JSON", async () => {
    const seen: string[] = [];
    const call = (async ({ user }: { user: string }) => {
      seen.push(user);
      return { output: { proposals: [] }, usage };
    }) as StructuredCall;
    await proposeMissing([{ name: "Beef Cutlet", category: "Meat" }, { name: "Basil", category: null }], [], { call, tally: new UsageTally(), save: () => {} });
    expect(askedIn(seen[0] ?? "")).toEqual([
      { id: 0, name: "basil", category: null },
      { id: 1, name: "beef cutlet", category: "Meat" },
    ]);
  });

  it("tells Claude which canonical names already exist", async () => {
    const seen: string[] = [];
    const call = (async ({ user }: { user: string }) => {
      seen.push(user);
      return { output: { proposals: [] }, usage };
    }) as StructuredCall;
    await proposeMissing(names("x"), [{ sourceName: "y", canonicalName: "onion", unit: "whole", isStaple: false, note: null }], {
      call,
      tally: new UsageTally(),
      save: () => {},
      knownCanonicalNames: ["garlic"],
    });
    expect(seen[0]).toContain("Canonical names already chosen:\ngarlic\nonion\n");
  });
});

describe("UsageTally", () => {
  it("prices Opus 5.5 usage, including cache reads and writes", () => {
    const tally = new UsageTally();
    tally.add({ model: "claude-opus-5-5", inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 100_000 });
    // 4 + 0.1*4*1.25 + 0.2 + 0.1*20
    expect(tally.dollars).toBeCloseTo(6.7);
  });
});
