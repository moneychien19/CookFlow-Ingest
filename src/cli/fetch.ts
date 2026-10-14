import { runFetch } from "@/fetch/runFetch";
import { RawCache } from "@/sources/rawCache";
import { sources } from "@/sources/registry";
import { parseCliArgs } from "./args";
import { runCli } from "./run";

await runCli(async () => {
  const { source, limit } = parseCliArgs("fetch", process.argv.slice(2));
  const adapter = sources.get(source);
  const cache = new RawCache(adapter);
  const { written, skipped, total } = await runFetch(adapter, cache, { limit });
  console.log(`Fetched ${written.length} new records (${skipped} already cached). ${cache.dir} has ${total}.`);
});
