import { CliError } from "@/errors";

/** Runs a CLI stage. A `CliError` prints its message (no stack trace) and exits 1. */
export async function runCli(main: () => void | Promise<void>): Promise<void> {
  try {
    await main();
  } catch (err) {
    if (err instanceof CliError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
