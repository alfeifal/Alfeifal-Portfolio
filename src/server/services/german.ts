import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { germanEvents, germanProgress } from "@/server/db/schema";
import { logStudySession } from "./studies";
import { updateGoalProgress, listGoals } from "./goals";
import { todayKey } from "@/lib/dates";

/** The German module owns its state shape; the server treats it as an opaque, versioned JSON document. */
export async function getGermanState(userId: string) {
  const [row] = await db.select().from(germanProgress).where(eq(germanProgress.userId, userId));
  return row ? { state: row.state, revision: row.revision, updatedAt: row.updatedAt } : { state: null, revision: 0, updatedAt: null };
}

export async function saveGermanState(userId: string, state: Record<string, unknown>, baseRevision?: number) {
  const [row] = await db.select().from(germanProgress).where(eq(germanProgress.userId, userId));
  if (!row) {
    const [created] = await db.insert(germanProgress).values({ userId, state, revision: 1 }).returning();
    return { revision: created.revision, conflict: false };
  }
  // Last-writer-wins with conflict flag: the client merges on conflict instead of clobbering.
  const conflict = baseRevision != null && baseRevision !== row.revision;
  const [updated] = await db.update(germanProgress).set({ state, revision: row.revision + 1, updatedAt: new Date() }).where(eq(germanProgress.id, row.id)).returning();
  return { revision: updated.revision, conflict };
}

export const germanEventSchema = z.object({
  kind: z.enum(["session", "unit_test", "exam", "daily_challenge", "section", "review"]),
  unitId: z.string().max(20).nullish(),
  label: z.string().max(200).nullish(),
  score: z.number().int().min(0).max(100).nullish(),
  durationSec: z.number().int().min(0).max(36000).nullish(),
  data: z.record(z.string(), z.unknown()).nullish(),
});

/**
 * Bridge (spec §20): a German learning event becomes a study session (Studies), feeds goal progress
 * (Goals with category "german" and a metric in minutes) and therefore Analytics.
 */
export async function recordGermanEvent(userId: string, input: z.infer<typeof germanEventSchema>, tz?: string) {
  const [ev] = await db.insert(germanEvents).values({ ...input, userId }).returning();
  const minutes = input.durationSec ? Math.round(input.durationSec / 60) : 0;
  if (minutes >= 1) {
    await logStudySession(userId, { slug: "german", subject: "German", durationMinutes: minutes, topic: input.label ?? input.kind, link: input.unitId ? { type: "german_unit", id: input.unitId } : { type: "german", id: input.kind }, source: "import", date: todayKey(tz) } as never, tz);
    const goals = await listGoals(userId, "active");
    for (const g of goals.filter((g) => g.category === "german" && g.metricUnit === "min" && g.metricTarget)) await updateGoalProgress(userId, g.id, { delta: minutes });
  }
  return ev;
}

export async function germanSummary(userId: string, range: { from: string; to: string }) {
  const rows = await db
    .select({ kind: germanEvents.kind, n: sql<number>`count(*)`, seconds: sql<number>`coalesce(sum(${germanEvents.durationSec}),0)`, avgScore: sql<number>`avg(${germanEvents.score})` })
    .from(germanEvents)
    .where(and(eq(germanEvents.userId, userId), gte(germanEvents.at, new Date(range.from)), lte(germanEvents.at, new Date(range.to + "T23:59:59Z"))))
    .groupBy(germanEvents.kind);
  const st = await getGermanState(userId);
  const state = (st.state ?? {}) as { xp?: number; streak?: number; totalTimeSec?: number; lessons?: Record<string, { testBest: number }>; lastStudyDay?: string };
  const recent = await db.select().from(germanEvents).where(eq(germanEvents.userId, userId)).orderBy(desc(germanEvents.at)).limit(10);
  return {
    range,
    byKind: rows.map((r) => ({ kind: r.kind, count: Number(r.n), minutes: Math.round(Number(r.seconds) / 60), avgScore: r.avgScore != null ? Math.round(Number(r.avgScore)) : null })),
    totalMinutes: Math.round(rows.reduce((a, r) => a + Number(r.seconds), 0) / 60),
    xp: state.xp ?? 0,
    streak: state.streak ?? 0,
    totalStudyMinutes: Math.round((state.totalTimeSec ?? 0) / 60),
    unitsPassed: Object.values(state.lessons ?? {}).filter((l) => l.testBest >= 70).length,
    lastStudyDay: state.lastStudyDay ?? null,
    recent,
    source: "calculated" as const,
  };
}
