import { and, desc, eq, gte, sql, sum } from "drizzle-orm";
import { db } from "@/server/db";
import { aiUsage, users } from "@/server/db/schema";
import { todayKey } from "@/lib/dates";

/**
 * What each account spends on the assistant — measured, visible, and deliberately not enforced.
 *
 * WHY THIS EXISTS AT ALL. The token counts were already being written, to `ai_messages`. That table
 * cannot answer "how much did this account use last month" for two independent reasons: it has no
 * `user_id` (it hangs off `ai_conversations`), and a conversation is hard-deleted 24 h after its last
 * message, cascading its messages away. Every total older than a day was already gone. This table
 * hangs off `users`, so the purge cannot touch it.
 *
 * WHY IT RECORDS FOUR TOKEN KINDS. `ai_messages` had columns for input and output only, but the
 * provider bills cache reads at a tenth of the input rate and cache writes at 1.25×. Folding them
 * into one number gives an answer that is wrong in both directions at once, so they are kept apart.
 *
 * WHAT IS NOT HERE. No quota, no ceiling, no enforcement anywhere in this file — by instruction and
 * on the merits: there is no historical data to set a number from, precisely because until now none
 * survived. Measure first. When there are weeks of real usage, a limit can be argued from it.
 */

export interface UsageDelta {
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Adds one turn's usage to the account's counter for today.
 *
 * Upsert on (user, day, kind), adding rather than replacing, so concurrent turns cannot lose each
 * other's counts and a retry adds exactly what it did.
 *
 * It never throws. Accounting is not worth failing a turn the user already paid for — if this row
 * cannot be written the conversation still completes, and the miss is a gap in a statistic rather
 * than an error in the product.
 */
export async function recordUsage(userId: string, kind: string, delta: UsageDelta, tz?: string) {
  const day = todayKey(tz);
  const v = {
    requests: delta.requests ?? 0,
    inputTokens: delta.inputTokens ?? 0,
    outputTokens: delta.outputTokens ?? 0,
    cacheReadTokens: delta.cacheReadTokens ?? 0,
    cacheWriteTokens: delta.cacheWriteTokens ?? 0,
  };
  try {
    await db
      .insert(aiUsage)
      .values({ userId, day, kind, ...v })
      .onConflictDoUpdate({
        target: [aiUsage.userId, aiUsage.day, aiUsage.kind],
        set: {
          requests: sql`${aiUsage.requests} + ${v.requests}`,
          inputTokens: sql`${aiUsage.inputTokens} + ${v.inputTokens}`,
          outputTokens: sql`${aiUsage.outputTokens} + ${v.outputTokens}`,
          cacheReadTokens: sql`${aiUsage.cacheReadTokens} + ${v.cacheReadTokens}`,
          cacheWriteTokens: sql`${aiUsage.cacheWriteTokens} + ${v.cacheWriteTokens}`,
          updatedAt: new Date(),
        },
      });
  } catch (e) {
    console.warn("[ai-usage] could not record usage", e instanceof Error ? e.message : e);
  }
}

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}
const ZERO: UsageTotals = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const n = (v: unknown) => Number(v ?? 0);

const totalsSelect = {
  requests: sum(aiUsage.requests),
  inputTokens: sum(aiUsage.inputTokens),
  outputTokens: sum(aiUsage.outputTokens),
  cacheReadTokens: sum(aiUsage.cacheReadTokens),
  cacheWriteTokens: sum(aiUsage.cacheWriteTokens),
};
const toTotals = (r: Record<string, unknown> | undefined): UsageTotals =>
  r
    ? {
        requests: n(r.requests), inputTokens: n(r.inputTokens), outputTokens: n(r.outputTokens),
        cacheReadTokens: n(r.cacheReadTokens), cacheWriteTokens: n(r.cacheWriteTokens),
      }
    : { ...ZERO };

/** One account's own totals since `fromDay` (inclusive, `YYYY-MM-DD`). Used by the account itself. */
export async function usageForUser(userId: string, fromDay: string): Promise<UsageTotals> {
  const [row] = await db
    .select(totalsSelect)
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.day, fromDay)));
  return toTotals(row);
}

/** Per-day totals for one account, newest first — the shape a small chart or table wants. */
export async function usageByDay(userId: string, fromDay: string) {
  return db
    .select({ day: aiUsage.day, ...totalsSelect })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.day, fromDay)))
    .groupBy(aiUsage.day)
    .orderBy(desc(aiUsage.day));
}

/**
 * Every account's totals since `fromDay`, for the admin panel.
 *
 * Joined to `users` for the name and address an administrator already sees in the account list, and
 * nothing else. There is no column here that could carry a prompt, a reply, a conversation title or
 * any other thing somebody wrote: the table it reads stores five integers and a date.
 */
export async function usageByUser(fromDay: string) {
  const rows = await db
    .select({
      userId: aiUsage.userId,
      email: users.email,
      name: users.name,
      ...totalsSelect,
    })
    .from(aiUsage)
    .innerJoin(users, eq(users.id, aiUsage.userId))
    .where(gte(aiUsage.day, fromDay))
    .groupBy(aiUsage.userId, users.email, users.name);

  return rows
    .map((r) => ({ userId: r.userId, email: r.email, name: r.name, ...toTotals(r) }))
    .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
}

/** Instance-wide totals since `fromDay`, for the admin header. */
export async function usageTotals(fromDay: string): Promise<UsageTotals> {
  const [row] = await db.select(totalsSelect).from(aiUsage).where(gte(aiUsage.day, fromDay));
  return toTotals(row);
}

/** First day of the current month, `YYYY-MM-01`. The period the counters are naturally read over. */
export const monthStart = (tz?: string) => todayKey(tz).slice(0, 8) + "01";
