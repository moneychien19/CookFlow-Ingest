import { CliError } from "@/errors";
import type { SourceAdapter } from "./types";

export type SourceRegistry = { names(): string[]; get(name: string): SourceAdapter<unknown> };

export function createRegistry(adapters: SourceAdapter<unknown>[]): SourceRegistry {
  const byName = new Map<string, SourceAdapter<unknown>>();
  for (const adapter of adapters) {
    if (byName.has(adapter.name)) throw new Error(`Duplicate source adapter "${adapter.name}"`);
    byName.set(adapter.name, adapter);
  }
  return {
    names: () => [...byName.keys()].sort(),
    get(name) {
      const adapter = byName.get(name);
      if (!adapter) {
        const known = byName.size > 0 ? [...byName.keys()].sort().join(", ") : "(none)";
        throw new CliError(`Unknown source "${name}". Registered sources: ${known}`);
      }
      return adapter;
    },
  };
}

/** Every source the CLIs know. Adding a source is one folder under src/sources/ and one line here. */
export const sources = createRegistry([]);
