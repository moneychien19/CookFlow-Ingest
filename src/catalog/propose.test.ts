import { describe, expect, it } from "vitest";
import type { StructuredCall } from "@/claude/client";
import { UsageTally } from "@/claude/usage";
import type { proposalBatch } from "./prompt";
import { proposeMissing } from "./propose";
import type { Proposal } from "./proposals";
import type { z } from "zod";

type Reply = z.output<typeof proposalBatch>["proposals"][number];
const usage = { model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** A fake Claude: answers each requested line with `answer(name)`, recording the requests. */
function fakeClaude(answer: (name: string) => Reply | Reply[] | null = (name) => ({ sourceName: name, canonicalName: name, unit: "whole", isStaple: false, note: null })) {
  const requests: string[][] = [];
  const call = (async ({ user }: { user: string }) => {
    const names = user.split("\n").slice(user.split("\n").indexOf("Source names to map (category in brackets when the site gives one):") + 1).map((l) => l.replace(/ \[.*\]$/, ""));
    requests.push(names);
    return { output: { proposals: names.flatMap((n) => answer(n) ?? []) }, usage };
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
    const claude = fakeClaude((name) => {
      const replies: Record<string, Reply | Reply[] | null> = {
        gruyère: { sourceName: name, canonicalName: "gruyère", unit: "g", isStaple: false, note: null },
        nounit: { sourceName: name, canonicalName: "nounit", unit: null, isStaple: false, note: null },
        missing: null,
        twice: [
          { sourceName: name, canonicalName: "twice", unit: "whole", isStaple: false, note: null },
          { sourceName: name, canonicalName: "other", unit: "whole", isStaple: false, note: null },
        ],
        "egg wash": { sourceName: name, canonicalName: null, unit: null, isStaple: false, note: "a mixture" },
      };
      return replies[name] ?? null;
    });
    const logs: string[] = [];
    const result = await proposeMissing(names("Gruyère", "nounit", "missing", "twice", "Egg Wash"), [], {
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
      '  dropped "twice": not one of the names asked (or a duplicate)',
      '  no proposal for "missing"',
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
