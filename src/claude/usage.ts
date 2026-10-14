/** $ per million tokens (Claude API, 2026-10). Cache writes (5-minute TTL) cost 1.25x input. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  // Possible server-side fallback models.
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
};

export type CallUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Running totals across the calls of one CLI run, printed at the end. */
export class UsageTally {
  requests = 0;
  inputTokens = 0;
  outputTokens = 0;
  cacheReadTokens = 0;
  cacheWriteTokens = 0;
  dollars = 0;
  readonly unpricedModels = new Set<string>();

  add(usage: CallUsage): void {
    this.requests++;
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.cacheReadTokens += usage.cacheReadTokens;
    this.cacheWriteTokens += usage.cacheWriteTokens;
    const price = PRICES[usage.model];
    if (!price) {
      this.unpricedModels.add(usage.model);
      return;
    }
    this.dollars +=
      (usage.inputTokens * price.input +
        usage.cacheWriteTokens * price.input * 1.25 +
        usage.cacheReadTokens * price.cacheRead +
        usage.outputTokens * price.output) /
      1_000_000;
  }

  summary(): string {
    const unpriced = this.unpricedModels.size > 0 ? ` (not counted: ${[...this.unpricedModels].join(", ")})` : "";
    return [
      `Claude requests: ${this.requests}`,
      `Tokens: ${this.inputTokens} input, ${this.cacheWriteTokens} cache write, ${this.cacheReadTokens} cache read, ${this.outputTokens} output`,
      `Estimated cost: $${this.dollars.toFixed(2)}${unpriced}`,
    ].join("\n");
  }
}
