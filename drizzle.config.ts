import { defineConfig } from "drizzle-kit";
import "dotenv/config";
import { assertIntendedTarget } from "./src/server/db/target";

const LOCAL_FALLBACK = "postgres://postgres@localhost:5432/personal_os";

/**
 * Which database `drizzle-kit` talks to — deliberately NOT `DATABASE_URL`.
 *
 * It used to be `process.env.DATABASE_URL ?? <local>`, which means that in any checkout whose `.env`
 * points at Neon — every real one — `drizzle-kit push` and `drizzle-kit studio` were aimed at
 * production by default. `push` diffs the schema and applies the difference without writing a
 * migration, so one absent-minded command is an unreviewed production schema change. It has already
 * caused one accidental (harmless) attempt in this repository.
 *
 * So the default is inverted: local unless told otherwise, and "otherwise" has to be typed.
 *   DRIZZLE_DATABASE_URL=…        an explicit target, for when you mean a specific database
 *   ALLOW_REMOTE_DB=1             lets it fall back to DATABASE_URL, the same opt-in the app's guard uses
 *   neither                       TEST_DATABASE_URL, or the local default above
 *
 * `drizzle-kit generate` does not connect to anything, so it keeps working in every case.
 */
function target() {
  if (process.env.DRIZZLE_DATABASE_URL) return process.env.DRIZZLE_DATABASE_URL;
  if (process.env.ALLOW_REMOTE_DB === "1" && process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return process.env.TEST_DATABASE_URL || LOCAL_FALLBACK;
}

const url = target();
// Belt as well as braces: an explicitly set DRIZZLE_DATABASE_URL pointing somewhere remote still has
// to come with ALLOW_REMOTE_DB=1.
assertIntendedTarget(url, "point drizzle-kit at");

export default defineConfig({
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
