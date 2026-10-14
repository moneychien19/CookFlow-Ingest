import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// DB tests (*.db.test.ts) run only against TEST_DATABASE_URL, from the shell or
// .env.local. Nothing else from .env.local reaches tests, so they can't touch DATABASE_URL
// or call Claude with ANTHROPIC_API_KEY.
const localEnv = existsSync(".env.local") ? parseEnv(readFileSync(".env.local", "utf8")) : {};
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? localEnv.TEST_DATABASE_URL;

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    env: testDatabaseUrl ? { TEST_DATABASE_URL: testDatabaseUrl } : {},
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
