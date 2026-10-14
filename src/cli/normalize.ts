import { parseCliArgs } from "./args";
import { runCli } from "./run";
import { notImplemented } from "./usage";

await runCli(() => {
  parseCliArgs("normalize", process.argv.slice(2));
  notImplemented("normalize");
});
