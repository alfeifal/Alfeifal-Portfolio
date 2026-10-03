import "dotenv/config";
import { Pool } from "pg";
import { assertIntendedTarget, hostOf, sslFor } from "@/server/db/target";

/**
 * Applies ./drizzle migrations.
 *   pnpm db:migrate          → DATABASE_URL over TCP (pg)
 *   pnpm db:migrate --test   → TEST_DATABASE_URL
 *   pnpm db:migrate --http   → DATABASE_URL over HTTPS using Neon's serverless driver
 *                              (for environments where port 5432 is blocked)
 *
 * Applying migrations to a remote database needs `ALLOW_REMOTE_DB=1` in front of the command. This
 * script built its own `Pool` and so never met the guard in `src/server/db` (SEC-008); a plain
 * `pnpm db:migrate` in a checkout whose `.env` points at Neon used to migrate production. It now
 * names the host it is about to change before it changes anything.
 */
async function main() {
  const useTest = process.argv.includes("--test");
  const useHttp = process.argv.includes("--http");
  const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (or TEST_DATABASE_URL with --test) is required");
  assertIntendedTarget(url, "apply migrations to");
  console.log(`Applying migrations from ./drizzle (${useHttp ? "neon-http" : "pg"}) to ${hostOf(url) ?? "a local socket"} ...`);
  if (useHttp) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const { migrate } = await import("drizzle-orm/neon-http/migrator");
    const db = drizzle(neon(url));
    await migrate(db, { migrationsFolder: "./drizzle" });
  } else {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url, ssl: sslFor(url) });
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    await pool.end();
  }
  console.log("Migrations applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
