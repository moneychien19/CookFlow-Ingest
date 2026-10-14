import { parseCliArgs } from "./args";
import { runCli } from "./run";
import { notImplemented } from "./usage";

await runCli(() => {
  parseCliArgs("load", process.argv.slice(2));
  notImplemented("load");
});
