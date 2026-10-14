import { DataFileError } from "@/io/json";
import { UsageError } from "./args";

/** Runs a CLI stage. Expected errors print their message (no stack trace) and exit 1. */
export async function runCli(main: () => void | Promise<void>): Promise<void> {
  try {
    await main();
  } catch (err) {
    if (err instanceof UsageError || err instanceof DataFileError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
