/**
 * Which database a process is allowed to open, decided in one place.
 *
 * This started as a guard inside `src/server/db/index.ts` after a script of mine wrote to the
 * production database (SEC-008). That guard worked, and covered exactly one module: `scripts/migrate.ts`
 * builds its own `Pool`, `drizzle.config.ts` handed `DATABASE_URL` to `drizzle-kit` by default, and
 * neither went anywhere near it. A guard that one import can walk around is not a perimeter, so the
 * rule lives here now and every entry point that opens a connection calls it.
 *
 * The rule: `NODE_ENV=production` is the deployed application and passes. Any other process reaching a
 * non-local host has to say so with `ALLOW_REMOTE_DB=1`, one command at a time. That is the point —
 * touching production should be something you typed, not something you inherited from `.env`.
 *
 * Nothing here ever prints a URL. Messages name the hostname only, so a credential cannot reach a log,
 * a CI transcript, or a report.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The hostname, or null for a string this cannot parse as a URL. Never throws. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** A host on this machine, or a `.local` name on the same network. */
export function isLocalTarget(url: string): boolean {
  const host = hostOf(url);
  // A libpq socket URL (`?host=/tmp`) has no hostname at all, and a unix socket is as local as it gets.
  if (!host) return true;
  return LOCAL_HOSTS.has(host) || host.endsWith(".local");
}

/**
 * Throws unless this process is meant to be talking to `url`.
 *
 * `what` goes into the message, so the reader knows whether they were about to read, migrate or wipe:
 * "Refusing to apply migrations to …" is a different sentence from "Refusing to connect to …".
 */
export function assertIntendedTarget(url: string, what = "connect to"): void {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_REMOTE_DB === "1") return;
  if (isLocalTarget(url)) return;
  throw new Error(
    `Refusing to ${what} "${hostOf(url)}": NODE_ENV is ${process.env.NODE_ENV ?? "undefined"}, so this ` +
      "process is not the deployed application. Point the connection at a local database, or set " +
      "ALLOW_REMOTE_DB=1 if reaching a remote one is genuinely what you mean to do.",
  );
}

/**
 * The `ssl` option for a connection to `url`, or `undefined` for none.
 *
 * BUG-019: `DATABASE_SSL` describes the production URL, and every path that opened a connection
 * applied it to whatever target it happened to have. None of this project's local databases speaks
 * TLS — not the dev cluster, not the CI service container, not the socket under `/tmp` — so in any
 * checkout with `DATABASE_SSL=true` in `.env`, `pnpm db:migrate --test` died with "The server does not
 * support SSL connections", and so would `pnpm test`. The session-start hook had been passing
 * `DATABASE_SSL=false` to work around it, which hid the defect rather than fixing it.
 *
 * Remote behaviour is unchanged: TLS still only when `DATABASE_SSL=true`.
 */
export function sslFor(url: string): { rejectUnauthorized: boolean } | undefined {
  if (isLocalTarget(url)) return undefined;
  return process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
}
