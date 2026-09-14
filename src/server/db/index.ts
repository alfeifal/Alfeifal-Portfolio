import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as PgPool } from "pg";
import { Pool as NeonPool } from "@neondatabase/serverless";
import * as schema from "./schema";

declare global {
  var __personalOsPool: PgPool | NeonPool | undefined;
}

function connectionString() {
  const url = process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

/**
 * DATABASE_DRIVER=pg   (default) node-postgres over TCP (port 5432).
 * DATABASE_DRIVER=neon Neon serverless driver over WebSocket/443 — same SQL, transactions supported;
 *                      use it where outbound 5432 is blocked (some sandboxes, edge runtimes).
 */
const useNeon = process.env.DATABASE_DRIVER === "neon";

/** Single shared pool (survives Next.js HMR thanks to the global). */
export const pool: PgPool | NeonPool =
  globalThis.__personalOsPool ??
  (useNeon
    ? new NeonPool({ connectionString: connectionString(), max: Number(process.env.DATABASE_POOL_MAX ?? 10) })
    : new PgPool({
        connectionString: connectionString(),
        max: Number(process.env.DATABASE_POOL_MAX ?? 10),
        ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      }));
if (process.env.NODE_ENV !== "production") globalThis.__personalOsPool = pool;

// Both drivers expose the same Drizzle query API; the node-postgres type is kept as the canonical one.
export const db: NodePgDatabase<typeof schema> = (useNeon ? drizzleNeon(pool as NeonPool, { schema }) : drizzlePg(pool as PgPool, { schema })) as NodePgDatabase<typeof schema>;
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
