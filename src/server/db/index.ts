import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as PgPool } from "pg";
import { Pool as NeonPool } from "@neondatabase/serverless";
import * as schema from "./schema";

declare global {
  var __personalOsPool: PgPool | NeonPool | undefined;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Refuses a remote database from a process that is not the deployed application.
 *
 * This exists because of a specific mistake that is easy to repeat. A throwaway script that sets
 * `process.env.NODE_ENV = "test"` and `DATABASE_URL` at the top of the file does *not* redirect a
 * statically imported `@/server/db`: ESM evaluates the imports first, so this module picks its
 * connection string from `.env` — production — before that assignment ever runs. The script looks
 * local, reports success, and writes to the live database. It happened in this repository.
 *
 * `NODE_ENV=production` is the deployment and passes. Anything else reaching a non-local host has
 * to say so, one command at a time, with `ALLOW_REMOTE_DB=1`. The message names only the hostname,
 * never the URL.
 */
function assertIntendedTarget(url: string) {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_REMOTE_DB === "1") return;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return; // not a shape this guard understands; the driver will complain about it soon enough
  }
  if (LOCAL_HOSTS.has(host) || host.endsWith(".local")) return;
  throw new Error(
    `Refusing to connect to "${host}": NODE_ENV is ${process.env.NODE_ENV ?? "undefined"}, so this ` +
      "process is not the deployed application. Point DATABASE_URL at a local database, or set " +
      "ALLOW_REMOTE_DB=1 if reaching a remote one is genuinely what you mean to do.",
  );
}

function connectionString() {
  const url = process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  assertIntendedTarget(url);
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
