import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { z } from "zod";
import * as schema from "./schema";

export type Db = NeonDatabase<typeof schema> & { $client: Pool };

export const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

/**
 * A database on Neon's WebSocket Pool (not the HTTP driver), because the load runs
 * in one interactive transaction. Callers should `await db.$client.end()` when done.
 */
export function createDb(url: string): Db {
  return drizzle({ client: new Pool({ connectionString: postgresUrl.parse(url) }), schema });
}

/** "host/database" for printing before a load. Never includes the user or password. */
export function describeTarget(url: string): string {
  const { hostname, pathname } = new URL(postgresUrl.parse(url));
  return `${hostname}${pathname}`;
}
