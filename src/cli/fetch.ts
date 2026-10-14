import { parseCliArgs } from "./args";
import { runCli } from "./run";
import { notImplemented } from "./usage";

await runCli(() => {
  parseCliArgs("fetch", process.argv.slice(2));
  notImplemented("fetch");
});
