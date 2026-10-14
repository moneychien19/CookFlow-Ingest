import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { requireEnv } from "@/cli/env";
import { CliError } from "@/errors";
import type { CallUsage } from "./usage";

export const MODEL = "claude-opus-5-5";

export type StructuredRequest<S extends z.ZodType> = {
  /** Stable instructions; cached across the requests of a run. */
  system: string;
  user: string;
  schema: S;
  maxTokens?: number;
};
export type StructuredResult<T> = { output: T; usage: CallUsage };

/** One Claude call whose reply must match `schema`. Swappable in tests. */
export type StructuredCall = <S extends z.ZodType>(request: StructuredRequest<S>) => Promise<StructuredResult<z.output<S>>>;

/**
 * Calls Claude with structured output. A policy decline is retried server-side on
 * Anthropic's recommended fallback model (`fallbacks: "default"`); if the whole chain
 * declines, or the reply doesn't parse, the call throws.
 */
export function createStructuredCall(): StructuredCall {
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return async ({ system, user, schema, maxTokens = 16000 }) => {
    const message = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    });
    const usage: CallUsage = {
      model: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    if (message.stop_reason === "refusal") {
      throw new CliError(`Claude declined the request (${message.stop_details?.category ?? "no category"}).`);
    }
    if (message.stop_reason === "max_tokens") {
      throw new CliError(`Claude's reply hit max_tokens (${maxTokens}); send a smaller batch.`);
    }
    if (message.parsed_output == null) throw new CliError("Claude's reply didn't match the expected format.");
    return { output: message.parsed_output as z.output<typeof schema>, usage };
  };
}
