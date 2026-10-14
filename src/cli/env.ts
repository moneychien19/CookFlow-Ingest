import { existsSync } from "node:fs";
import { CliError } from "@/errors";

/** Reads a required variable from the shell or .env.local (shell wins). */
export function requireEnv(name: string): string {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const value = process.env[name];
  if (!value) throw new CliError(`${name} is not set. Add it to .env.local (see .env.example).`);
  return value;
}
