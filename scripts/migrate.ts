import "dotenv/config";
import { Pool } from "pg";

/**
 * Applies ./drizzle migrations.
 *   pnpm db:migrate          → DATABASE_URL over TCP (pg)
 *   pnpm db:migrate --test   → TEST_DATABASE_URL
 *   pnpm db:migrate --http   → DATABASE_URL over HTTPS using Neon's serverless driver
 *                              (for environments where port 5432 is blocked)
 */
async function main() {
  const useTest = process.argv.includes("--test");
  const useHttp = process.argv.includes("--http");
  const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (or TEST_DATABASE_URL with --test) is required");
  console.log(`Applying migrations from ./drizzle (${useHttp ? "neon-http" : "pg"}) ...`);
  if (useHttp) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const { migrate } = await import("drizzle-orm/neon-http/migrator");
    const db = drizzle(neon(url));
    await migrate(db, { migrationsFolder: "./drizzle" });
  } else {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    await pool.end();
  }
  console.log("Migrations applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
