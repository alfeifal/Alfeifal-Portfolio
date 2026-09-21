import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { processRecurring } from "./finance";
import { generateNotifications } from "./notifications";
import { refreshNews, checkAlerts } from "./market";
import { snapshotPortfolio } from "./investing";
import { purgeExpiredSessions } from "@/server/auth/session";
import { purgeExpiredConversations } from "./conversations";
import { purgeRateLimits } from "@/server/security/rate-limit-shared";

/**
 * Scheduled maintenance, declared once.
 *
 * WHY A REGISTRY. Two schedulers now call the same endpoint at two different rhythms, and the thing
 * that must not happen is two copies of "what the nightly run does" drifting apart. So the jobs are
 * declared here, each carrying the cadence it actually needs, and the route simply runs the ones a
 * given scope selects. Adding a job is one entry; nothing in the route changes.
 *
 * WHY CADENCE IS A PROPERTY OF THE JOB. It is not a preference. Two of these read the world at the
 * instant they run — a price alert compares the current quote, and a transcript past its TTL is only
 * gone once something deletes it — so their usefulness is bounded by how often they are called. The
 * rest reconcile: they look at what is outstanding and catch up, so a missed run costs lateness, not
 * work. `processRecurring` walks `nextDate` forward until it passes today; `generateNotifications`
 * dedupes per key and date; `snapshotPortfolio` upserts one row per day. Calling any of those twice
 * in a row is a no-op, which matters because scheduled delivery is best effort: both GitHub Actions
 * ("some queued jobs may be dropped") and Vercel Cron ("can also occasionally invoke the same
 * scheduled run more than once") warn that runs are missed and duplicated.
 */
export type JobScope = "frequent" | "daily";

/** Both scopes together. The daily safety net runs this, so nothing depends on the frequent one existing. */
export const ALL_SCOPES: readonly JobScope[] = ["frequent", "daily"];

export const isJobScope = (v: unknown): v is JobScope => v === "frequent" || v === "daily";

interface GlobalJob {
  name: string;
  scope: JobScope;
  run: () => Promise<unknown>;
}
interface UserJob {
  name: string;
  scope: JobScope;
  run: (user: { id: string; timezone: string }) => Promise<unknown>;
}

/** Instance-wide work: runs once per invocation, not once per account. */
export const GLOBAL_JOBS: readonly GlobalJob[] = [
  // Point-in-time: the 24 h TTL on a conversation is only real if something enforces it. On a daily
  // purge a transcript lives up to 48 h, which is not the retention the app tells the user it keeps.
  { name: "purgedConversations", scope: "frequent", run: () => purgeExpiredConversations() },
  // `force: false` respects the provider's own 15-minute cache, so calling this every quarter of an
  // hour is mostly a no-op rather than 13 RSS fetches; the daily pass forces a real refresh.
  { name: "news", scope: "frequent", run: () => refreshNews(false) },
  { name: "newsForced", scope: "daily", run: () => refreshNews(true) },
  // Expired rows are already rejected at read time, so purging them is housekeeping, not correctness.
  { name: "purgedSessions", scope: "daily", run: async () => { await purgeExpiredSessions(); return "ok"; } },
  // The shared limiter writes a counter row per bucket per window; only the last two windows are ever
  // read, so the rest is dead weight on a 0.5 GB free tier.
  { name: "purgedRateLimits", scope: "daily", run: () => purgeRateLimits() },
];

/** Per-account work. Only accounts that can still sign in — see `activeUsers`. */
export const USER_JOBS: readonly UserJob[] = [
  // The only per-account job that samples: it compares the live quote against the threshold, so once
  // a day means it only ever sees one price, taken before the US market opens.
  { name: "alerts", scope: "frequent", run: (u) => checkAlerts(u.id) },
  { name: "recurring", scope: "daily", run: (u) => processRecurring(u.id, u.timezone) },
  { name: "notifications", scope: "daily", run: (u) => generateNotifications(u.id, u.timezone) },
  { name: "snapshot", scope: "daily", run: (u) => snapshotPortfolio(u.id, u.timezone).then(() => "ok") },
];

/**
 * A deactivated account keeps every row it owns, but nothing may keep *writing* to it behind its
 * back: no recurring transactions, no notifications, no alerts, no portfolio snapshots for somebody
 * with no way to look at any of it, let alone stop it. Reactivating resumes the schedule; it does
 * not backfill the days that were skipped, which is the honest behaviour.
 */
export function activeUsers() {
  return db.select({ id: users.id, timezone: users.timezone }).from(users).where(eq(users.isActive, true));
}

/**
 * Runs every job in the given scopes and reports what each one did.
 *
 * One job failing never stops the others, and never fails the run: a scheduler that sees a 500 has
 * no way to retry just the part that broke, and neither Vercel nor GitHub Actions retries at all.
 * The report says which job failed; the rest still happened.
 *
 * Failure text is the error's message only. It is written into the response body, which the
 * scheduler logs, so nothing from the environment may reach it.
 */
export async function runMaintenance(scopes: readonly JobScope[]) {
  const wanted = new Set(scopes);
  const failed = (e: unknown) => `failed: ${e instanceof Error ? e.message : "unknown error"}`;

  const report: Record<string, unknown> = { scopes: [...wanted] };
  for (const job of GLOBAL_JOBS) {
    if (wanted.has(job.scope)) report[job.name] = await job.run().catch(failed);
  }

  const jobs = USER_JOBS.filter((j) => wanted.has(j.scope));
  if (!jobs.length) return { ...report, users: 0 };

  const all = await activeUsers();
  report.users = all.length;
  for (const u of all) {
    const perUser: Record<string, unknown> = {};
    for (const job of jobs) perUser[job.name] = await job.run(u).catch(failed);
    report[u.id] = perUser;
  }
  return report;
}
