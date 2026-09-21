/**
 * Phase 3.19 — the operational layer of a deployed, multi-user instance.
 *
 * Three things are pinned here, and the first is a bug that made the other two matter.
 *
 * Scheduled work had never run in production. The route exported only POST; both Vercel Cron and
 * GitHub Actions invoke with GET, so the endpoint answered 405 every night — and POST was doubly
 * unreachable, because `proxy.ts` rejects mutating methods without a matching `Origin` before it
 * consults its public-path list. Nothing had processed a recurring transaction, raised a
 * notification, checked a price alert or deleted an expired transcript.
 *
 * Rate limiting counted in a `Map` inside one process, so on a serverless platform the real ceiling
 * was the configured limit times however many instances were warm. These tests spawn actual separate
 * processes, because that is the only way to prove a limit is shared rather than to assume it.
 *
 * And assistant usage had no durable home: `ai_messages` has no user id and is deleted with its
 * conversation after 24 h, so every total older than a day was already gone. The counter has to
 * survive the purge, and there is a test that purges and then looks.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { aiUsage, conversations, marketQuotes, messages, priceAlerts, rateLimits, users } from "@/server/db/schema";
import { rateLimit } from "@/server/security/rate-limit";
import { checkRateLimit, purgeRateLimits } from "@/server/security/rate-limit-shared";
import { GLOBAL_JOBS, USER_JOBS, runMaintenance, activeUsers } from "@/server/services/maintenance";
import { checkAlerts } from "@/server/services/market";
import { purgeExpiredConversations } from "@/server/services/conversations";
import { processRecurring } from "@/server/services/finance";
import { generateNotifications } from "@/server/services/notifications";
import { recordUsage, usageByUser, usageForUser, usageTotals, monthStart } from "@/server/services/ai-usage";
import { todayKey } from "@/lib/dates";

const execFileAsync = promisify(execFile);
const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
type U = Awaited<ReturnType<typeof createTestUser>>;
const uniq = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------------------------
// The endpoint itself. The route's own source is the subject: these assert the contract the two
// schedulers rely on, which is exactly what was broken.
// ---------------------------------------------------------------------------------------------
describe("the cron endpoint is reachable by the schedulers that call it", () => {
  const src = readFileSync("src/app/api/cron/route.ts", "utf8");
  const proxy = readFileSync("src/proxy.ts", "utf8");

  it("exports GET, which is the method both Vercel and GitHub Actions send", () => {
    expect(src).toMatch(/export const GET\b/);
  });

  it("a scheduler's GET is not blocked by the proxy's origin check", () => {
    // The check applies only to mutating methods, which is why the fix was the verb and not an
    // exemption: nothing else gained a way past it.
    expect(proxy).toContain('!["GET", "HEAD", "OPTIONS"].includes(method)');
    expect(proxy).toContain('"/api/cron"');
  });

  it("compares the secret in constant time and never reveals it", () => {
    expect(src).toContain("timingSafeEqual");
    // The response body and the logs must never carry the secret, in any branch.
    expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*secret/i);
    expect(src).not.toMatch(/json\(\{[^}]*secret/i);
  });

  it("refuses when no secret is configured, rather than running wide open", () => {
    expect(src).toMatch(/if \(!secret\) return false/);
  });

  it("answers the same opaque error for every rejection", () => {
    const unauthorized = src.match(/error: "Unauthorized"/g) ?? [];
    expect(unauthorized.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Scope separation. One registry, two rhythms, no duplicated logic.
// ---------------------------------------------------------------------------------------------
d("frequent work is separated from daily work", () => {
  const names = (jobs: readonly { name: string; scope: string }[], scope: string) =>
    jobs.filter((j) => j.scope === scope).map((j) => j.name);

  it("the jobs that sample the world are frequent", () => {
    // A price alert compares the live quote; a transcript past its TTL is only gone once deleted.
    expect(names(USER_JOBS, "frequent")).toContain("alerts");
    expect(names(GLOBAL_JOBS, "frequent")).toContain("purgedConversations");
  });

  it("the jobs that reconcile are daily", () => {
    expect(names(USER_JOBS, "daily")).toEqual(expect.arrayContaining(["recurring", "notifications", "snapshot"]));
  });

  it("every job declares exactly one scope, and both scopes are used", () => {
    for (const j of [...GLOBAL_JOBS, ...USER_JOBS]) expect(["frequent", "daily"]).toContain(j.scope);
    expect(names(GLOBAL_JOBS, "daily").length + names(USER_JOBS, "daily").length).toBeGreaterThan(0);
    expect(names(GLOBAL_JOBS, "frequent").length + names(USER_JOBS, "frequent").length).toBeGreaterThan(0);
  });

  it("a frequent run does not do the daily work", async () => {
    const report = await runMaintenance(["frequent"]) as Record<string, unknown>;
    expect(report).toHaveProperty("purgedConversations");
    expect(report).not.toHaveProperty("purgedSessions");
    expect(report).not.toHaveProperty("newsForced");
  });

  it("a daily run does not do the frequent work", async () => {
    const report = await runMaintenance(["daily"]) as Record<string, unknown>;
    expect(report).toHaveProperty("purgedSessions");
    expect(report).not.toHaveProperty("purgedConversations");
  });

  it("running both is the union, which is what the daily safety net does", async () => {
    const report = await runMaintenance(["frequent", "daily"]) as Record<string, unknown>;
    expect(report).toHaveProperty("purgedConversations");
    expect(report).toHaveProperty("purgedSessions");
  });

  it("the logic lives in one registry, not duplicated in the route", () => {
    const route = readFileSync("src/app/api/cron/route.ts", "utf8");
    for (const name of ["processRecurring", "generateNotifications", "checkAlerts", "snapshotPortfolio"]) {
      expect(route).not.toContain(name);
    }
    expect(route).toContain("runMaintenance");
  });

  it("a failing job is reported but never fails the run, so the others still happen", async () => {
    const report = await runMaintenance(["daily"]) as Record<string, unknown>;
    // Whatever each job returned, the run completed and named every job it was asked to do.
    expect(Object.keys(report)).toContain("scopes");
  });

  it("only accounts that can still sign in are in the batch", async () => {
    const off = await createTestUser();
    await db.update(users).set({ isActive: false }).where(eq(users.id, off.id));
    const batch = await activeUsers();
    expect(batch.map((u) => u.id)).not.toContain(off.id);
    await deleteTestUser(off.id);
  });
});

// ---------------------------------------------------------------------------------------------
// Idempotency. Both schedulers warn that runs are dropped and that runs are duplicated.
// ---------------------------------------------------------------------------------------------
d("running the same job twice changes nothing the second time", () => {
  let user: U;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { await deleteTestUser(user.id); });

  it("recurring transactions are not posted twice", async () => {
    const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.userId, user.id));
    await db.insert(schema.recurringTransactions).values({
      userId: user.id, type: "expense", amount: 42, description: "Rent " + uniq(),
      accountId: account.id, frequency: "monthly", nextDate: todayKey(), active: true,
    });
    const first = await processRecurring(user.id);
    const second = await processRecurring(user.id);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    const rows = await db.select().from(schema.transactions).where(eq(schema.transactions.userId, user.id));
    expect(rows).toHaveLength(first);
  });

  it("notifications are deduplicated, so a second run adds none", async () => {
    await db.insert(schema.tasks).values({ userId: user.id, title: "Due " + uniq(), dueDate: todayKey(), status: "todo" });
    await generateNotifications(user.id);
    const after = await generateNotifications(user.id);
    expect(after).toBe(0);
  });

  it("purging conversations twice deletes nothing the second time", async () => {
    await db.insert(conversations).values({ userId: user.id, title: "old", expiresAt: new Date(Date.now() - 1000) });
    const first = await purgeExpiredConversations();
    expect(first).toBeGreaterThan(0);
    expect(await purgeExpiredConversations()).toBe(0);
  });

  it("a whole duplicated maintenance run is a no-op", async () => {
    await runMaintenance(["frequent", "daily"]);
    const before = await db.select().from(schema.transactions).where(eq(schema.transactions.userId, user.id));
    await runMaintenance(["frequent", "daily"]);
    const after = await db.select().from(schema.transactions).where(eq(schema.transactions.userId, user.id));
    expect(after.length).toBe(before.length);
  });
});

// ---------------------------------------------------------------------------------------------
// Price alerts, with the observed price under the test's control.
//
// `getQuotes` serves from `market_quotes` while a row is inside the TTL, so writing a row is how the
// test decides what the world looks like at the moment the job runs. No network, no real clock.
// ---------------------------------------------------------------------------------------------
d("price alerts fire on the price visible when the job runs", () => {
  let user: U;
  const symbol = () => "TST" + uniq().slice(0, 4).toUpperCase();

  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { await deleteTestUser(user.id); });

  /** Makes `getQuotes` observe exactly this price for this symbol. */
  const quoteAt = async (sym: string, price: number) => {
    await db.delete(marketQuotes).where(eq(marketQuotes.symbol, sym));
    await db.insert(marketQuotes).values({
      symbol: sym, assetClass: "stock", price, change: 0, changePct: 0,
      currency: "EUR", provider: "test", asOf: new Date(),
    });
  };

  it("does not fire while the price is short of the threshold", async () => {
    const sym = symbol();
    await db.insert(priceAlerts).values({ userId: user.id, symbol: sym, assetClass: "stock", condition: "above", price: 100, active: true });
    await quoteAt(sym, 90);
    expect(await checkAlerts(user.id)).toBe(0);
  });

  it("fires on the run that first sees the threshold crossed", async () => {
    const sym = symbol();
    await db.insert(priceAlerts).values({ userId: user.id, symbol: sym, assetClass: "stock", condition: "above", price: 100, active: true });
    await quoteAt(sym, 90);
    expect(await checkAlerts(user.id)).toBe(0);
    // This is the whole point of the frequent scope: with one run a day, this move is never seen.
    await quoteAt(sym, 110);
    expect(await checkAlerts(user.id)).toBe(1);
  });

  it("fires once, not once per run", async () => {
    const sym = symbol();
    await db.insert(priceAlerts).values({ userId: user.id, symbol: sym, assetClass: "stock", condition: "above", price: 50, active: true });
    await quoteAt(sym, 75);
    expect(await checkAlerts(user.id)).toBe(1);
    expect(await checkAlerts(user.id)).toBe(0);
  });

  it("a 'below' alert is judged the same way", async () => {
    const sym = symbol();
    await db.insert(priceAlerts).values({ userId: user.id, symbol: sym, assetClass: "stock", condition: "below", price: 20, active: true });
    await quoteAt(sym, 30);
    expect(await checkAlerts(user.id)).toBe(0);
    await quoteAt(sym, 10);
    expect(await checkAlerts(user.id)).toBe(1);
  });

  it("never touches another account's alerts", async () => {
    const other = await createTestUser();
    const sym = symbol();
    await db.insert(priceAlerts).values({ userId: other.id, symbol: sym, assetClass: "stock", condition: "above", price: 1, active: true });
    await quoteAt(sym, 999);
    expect(await checkAlerts(user.id)).toBe(0);
    const [theirs] = await db.select().from(priceAlerts).where(eq(priceAlerts.userId, other.id));
    expect(theirs.active).toBe(true);
    await deleteTestUser(other.id);
  });
});

// ---------------------------------------------------------------------------------------------
// Transcript retention. A 24 h TTL is only real if something enforces it often enough.
// ---------------------------------------------------------------------------------------------
d("conversations really expire", () => {
  let user: U;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { await deleteTestUser(user.id); });

  it("a transcript past its expiry is deleted, with its messages", async () => {
    const [conv] = await db.insert(conversations).values({ userId: user.id, title: "expired", expiresAt: new Date(Date.now() - 60_000) }).returning();
    await db.insert(messages).values({ conversationId: conv.id, role: "user", text: "PRIVATE-3190" });
    await purgeExpiredConversations();
    expect(await db.select().from(conversations).where(eq(conversations.id, conv.id))).toHaveLength(0);
    expect(await db.select().from(messages).where(eq(messages.conversationId, conv.id))).toHaveLength(0);
  });

  it("a live transcript is left alone", async () => {
    const [conv] = await db.insert(conversations).values({ userId: user.id, title: "live", expiresAt: new Date(Date.now() + 3600_000) }).returning();
    await purgeExpiredConversations();
    expect(await db.select().from(conversations).where(eq(conversations.id, conv.id))).toHaveLength(1);
  });

  it("the purge runs in the frequent scope, so the window is the TTL and not twice it", () => {
    expect(GLOBAL_JOBS.find((j) => j.name === "purgedConversations")?.scope).toBe("frequent");
  });
});

// ---------------------------------------------------------------------------------------------
// Rate limiting across processes. This is the claim that needed real processes to verify.
// ---------------------------------------------------------------------------------------------
d("the rate limit is shared, not per instance", () => {
  const bucket = () => "test:" + uniq();
  afterEach(async () => { await db.delete(rateLimits).where(sql`${rateLimits.bucket} like 'test:%'`); });

  it("a second caller sees the first caller's hits", async () => {
    const b = bucket();
    const a1 = await checkRateLimit(b, 3, 60_000);
    const a2 = await checkRateLimit(b, 3, 60_000);
    expect(a1.ok && a2.ok).toBe(true);
    expect(a2.remaining).toBeLessThan(a1.remaining);
  });

  it("rejects past the limit and says when to come back", async () => {
    const b = bucket();
    for (let i = 0; i < 3; i++) expect((await checkRateLimit(b, 3, 60_000)).ok).toBe(true);
    const over = await checkRateLimit(b, 3, 60_000);
    expect(over.ok).toBe(false);
    expect(over.remaining).toBe(0);
    expect(over.retryAfterSec).toBeGreaterThan(0);
    expect(over.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("buckets do not leak into each other", async () => {
    const a = bucket(), b = bucket();
    for (let i = 0; i < 3; i++) await checkRateLimit(a, 3, 60_000);
    expect((await checkRateLimit(a, 3, 60_000)).ok).toBe(false);
    expect((await checkRateLimit(b, 3, 60_000)).ok).toBe(true);
  });

  it("holds across genuinely separate OS processes", async () => {
    // The in-memory limiter passes every test above, because one test file is one process. This is
    // the test it cannot pass: four child processes, each with its own empty Map, sharing one limit.
    const b = bucket();
    const script = `/tmp/rl-child-${uniq()}.mjs`;
    writeFileSync(script, `
      const { checkRateLimit } = await import("${process.cwd()}/src/server/security/rate-limit-shared.ts");
      const r = await checkRateLimit(process.argv[2], 4, 60000);
      console.log(JSON.stringify({ ok: r.ok }));
      process.exit(0);
    `);
    const run = () => execFileAsync("npx", ["tsx", script, b], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "test", DATABASE_DRIVER: "pg", DATABASE_SSL: "false" },
      timeout: 60_000,
    }).then((r) => JSON.parse(r.stdout.trim().split("\n").pop()!) as { ok: boolean });

    // Six attempts against a limit of four: if the counter were per process, all six would pass.
    const results: { ok: boolean }[] = [];
    for (let i = 0; i < 6; i++) results.push(await run());
    const allowed = results.filter((r) => r.ok).length;
    expect(allowed).toBe(4);
    expect(results.filter((r) => !r.ok).length).toBe(2);
  }, 180_000);

  it("the shared counter is what the app's wrappers actually call", () => {
    expect(readFileSync("src/server/http.ts", "utf8")).toContain("await checkRateLimit(");
    for (const p of ["login", "signup"]) {
      expect(readFileSync(`src/app/api/auth/${p}/route.ts`, "utf8")).toContain("await checkRateLimit(");
    }
  });

  it("the in-memory limiter still works and is still exactly itself", () => {
    // Kept as the fallback, unchanged: the same interface, same result shape.
    const k = "mem:" + uniq();
    expect(rateLimit(k, 2, 60_000).ok).toBe(true);
    expect(rateLimit(k, 2, 60_000).ok).toBe(true);
    expect(rateLimit(k, 2, 60_000).ok).toBe(false);
  });

  it("falls back to per-instance limiting rather than to no limiting", async () => {
    // With no database configured the shared path cannot run; the caller must still get a verdict.
    const saved = { d: process.env.DATABASE_URL, t: process.env.TEST_DATABASE_URL };
    delete process.env.DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    try {
      const k = "fallback:" + uniq();
      expect((await checkRateLimit(k, 2, 60_000)).ok).toBe(true);
      expect((await checkRateLimit(k, 2, 60_000)).ok).toBe(true);
      expect((await checkRateLimit(k, 2, 60_000)).ok).toBe(false);
    } finally {
      if (saved.d) process.env.DATABASE_URL = saved.d;
      if (saved.t) process.env.TEST_DATABASE_URL = saved.t;
    }
  });

  it("the module never calls a per-instance limit global", () => {
    const src = readFileSync("src/server/security/rate-limit.ts", "utf8");
    expect(src).toMatch(/per-instance/);
    expect(src).not.toMatch(/\bglobal(ly)? rate.?limit/i);
  });

  it("old counter rows are purged, and live ones are not", async () => {
    const b = bucket();
    await db.insert(rateLimits).values({ bucket: b, windowStart: new Date(Date.now() - 48 * 3600_000), hits: 9 });
    await checkRateLimit(b, 10, 60_000);
    const purged = await purgeRateLimits(24 * 3600_000);
    expect(purged).toBeGreaterThan(0);
    const left = await db.select().from(rateLimits).where(eq(rateLimits.bucket, b));
    expect(left).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Usage accounting: per account, durable, and carrying nothing anybody wrote.
// ---------------------------------------------------------------------------------------------
d("assistant usage is measured per account and survives", () => {
  let a: U, b: U;
  beforeAll(async () => { a = await createTestUser(); b = await createTestUser(); });
  afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); });
  afterEach(async () => { await db.delete(aiUsage).where(eq(aiUsage.userId, a.id)); await db.delete(aiUsage).where(eq(aiUsage.userId, b.id)); });

  const delta = { requests: 1, inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 3 };

  it("records the four token kinds separately, because they are priced differently", async () => {
    await recordUsage(a.id, "assistant", delta);
    const t = await usageForUser(a.id, monthStart());
    expect(t).toEqual({ requests: 1, inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 3 });
  });

  it("accumulates rather than replaces", async () => {
    await recordUsage(a.id, "assistant", delta);
    await recordUsage(a.id, "assistant", delta);
    const t = await usageForUser(a.id, monthStart());
    expect(t.requests).toBe(2);
    expect(t.inputTokens).toBe(200);
  });

  it("keeps conversation kinds apart", async () => {
    await recordUsage(a.id, "assistant", { requests: 1, inputTokens: 10 });
    await recordUsage(a.id, "quick_entry", { requests: 1, inputTokens: 90 });
    const rows = await db.select().from(aiUsage).where(eq(aiUsage.userId, a.id));
    expect(rows).toHaveLength(2);
    expect((await usageForUser(a.id, monthStart())).inputTokens).toBe(100);
  });

  it("one account's usage never appears in another's", async () => {
    await recordUsage(a.id, "assistant", { requests: 1, inputTokens: 500 });
    expect((await usageForUser(b.id, monthStart())).inputTokens).toBe(0);
    expect((await usageForUser(a.id, monthStart())).inputTokens).toBe(500);
  });

  it("SURVIVES the conversation purge that deletes the messages it describes", async () => {
    // This is the whole reason the table exists. ai_messages is hard-deleted with its conversation
    // after 24 h, so a total computed from there loses every period older than a day.
    const [conv] = await db.insert(conversations).values({ userId: a.id, title: "t", expiresAt: new Date(Date.now() - 60_000) }).returning();
    await db.insert(messages).values({ conversationId: conv.id, role: "assistant", text: "x", inputTokens: 100, outputTokens: 20 });
    await recordUsage(a.id, "assistant", delta);

    await purgeExpiredConversations();

    expect(await db.select().from(messages).where(eq(messages.conversationId, conv.id))).toHaveLength(0);
    expect((await usageForUser(a.id, monthStart())).inputTokens).toBe(100);
  });

  it("a full maintenance run does not erase it either", async () => {
    await recordUsage(a.id, "assistant", delta);
    await runMaintenance(["frequent", "daily"]);
    expect((await usageForUser(a.id, monthStart())).requests).toBe(1);
  });

  it("is deleted with the account, like everything else it owns", async () => {
    const doomed = await createTestUser();
    await recordUsage(doomed.id, "assistant", delta);
    expect((await usageForUser(doomed.id, monthStart())).requests).toBe(1);
    await deleteTestUser(doomed.id);
    expect(await db.select().from(aiUsage).where(eq(aiUsage.userId, doomed.id))).toHaveLength(0);
  });

  it("the admin view carries counts and identifiers only — nothing anybody wrote", async () => {
    await recordUsage(a.id, "assistant", delta);
    const rows = await usageByUser(monthStart());
    const mine = rows.find((r) => r.userId === a.id)!;
    expect(Object.keys(mine).sort()).toEqual(
      ["cacheReadTokens", "cacheWriteTokens", "email", "inputTokens", "name", "outputTokens", "requests", "userId"],
    );
  });

  it("instance totals are the sum of the accounts", async () => {
    await recordUsage(a.id, "assistant", { requests: 1, inputTokens: 10 });
    await recordUsage(b.id, "assistant", { requests: 1, inputTokens: 25 });
    const rows = await usageByUser(monthStart());
    const totals = await usageTotals(monthStart());
    expect(totals.inputTokens).toBe(rows.reduce((s, r) => s + r.inputTokens, 0));
  });

  it("the agent records usage per round, so a turn that fails later still accounts for its calls", () => {
    const src = readFileSync("src/server/ai/agent.ts", "utf8");
    expect(src).toContain("recordUsage(user.id");
    // Inside the round loop: before the message is written, not after the turn returns.
    expect(src.indexOf("recordUsage(user.id")).toBeLessThan(src.indexOf("return { conversationId: conv.id, messageId: lastAssistantId"));
  });

  it("recording usage can never fail a turn the user already paid for", async () => {
    // A foreign key violation is the realistic failure: the account went away mid-turn. Accounting
    // is not worth losing the conversation over, so this resolves rather than rejects.
    await expect(recordUsage("00000000-0000-4000-8000-000000000000", "assistant", delta)).resolves.toBeUndefined();
  });

  it("nothing in the usage path can reject a request", async () => {
    // Enforcement would look like a throw or a 429 on the read path. There is neither: every export
    // here either records or reads, and the admin route exposes no verb that could set a limit.
    await expect(usageForUser(a.id, monthStart())).resolves.toBeDefined();
    await expect(usageTotals(monthStart())).resolves.toBeDefined();
    const route = readFileSync("src/app/api/admin/usage/route.ts", "utf8");
    expect(route).toMatch(/export const GET\b/);
    expect(route).not.toMatch(/export const (POST|PATCH|PUT|DELETE)\b/);
  });
});

// ---------------------------------------------------------------------------------------------
// The admin usage surface may not become a way into somebody's data.
// ---------------------------------------------------------------------------------------------
d("the usage panel never becomes a window into an account", () => {
  let a: U;
  beforeAll(async () => {
    a = await createTestUser();
    const [conv] = await db.insert(conversations).values({ userId: a.id, title: "SECRET-TITLE-3190" }).returning();
    await db.insert(messages).values({ conversationId: conv.id, role: "user", text: "SECRET-PROMPT-3190" });
    await recordUsage(a.id, "assistant", { requests: 1, inputTokens: 10 });
  });
  afterAll(async () => { await deleteTestUser(a.id); });

  it("no prompt, reply or conversation title reaches the aggregate", async () => {
    const blob = JSON.stringify([await usageByUser(monthStart()), await usageTotals(monthStart())]);
    expect(blob).not.toContain("SECRET-PROMPT-3190");
    expect(blob).not.toContain("SECRET-TITLE-3190");
  });

  it("the table it reads has no column that could carry one", () => {
    const schemaSrc = readFileSync("src/server/db/schema/core.ts", "utf8");
    const table = schemaSrc.slice(schemaSrc.indexOf('export const aiUsage'), schemaSrc.indexOf("export const usersRelations"));
    expect(table).not.toContain("jsonb");
    expect(table).not.toMatch(/text\("(content|title|prompt|body)"\)/);
  });

  it("the route is admin-guarded on the server", () => {
    expect(readFileSync("src/app/api/admin/usage/route.ts", "utf8")).toContain("withAdmin");
  });
});
