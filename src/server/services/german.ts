import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { germanEvents, germanProgress } from "@/server/db/schema";
import { GERMAN_SUBJECT_SLUG, insertStudySession, resolveSubject } from "./studies";
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

/** Two identical events posted within this window are treated as one (keepalive retries, double-fired effects). */
const DEDUPE_WINDOW_MS = 90_000;

export interface GermanEventOptions {
  /** Who produced the activity. Defaults to "user": the bridge is fed by actions the user performed in the German module. */
  source?: "user" | "ai" | "import";
  /** Study-session date (YYYY-MM-DD); defaults to today in the user's timezone. */
  date?: string;
  startedAt?: Date | null;
  notes?: string | null;
  /** Already-resolved German subject id (avoids a second lookup when called from logStudySession). */
  subjectId?: string | null;
}

/**
 * Bridge (spec §20) — the single write path for German learning activity.
 * A German event becomes: german_events row → one study session on the German subject (Studies) →
 * progress on active goals with category "german" and a metric in minutes (Goals) → Analytics/Reviews/Home.
 * Used by the German module UI (POST /api/german/events) and by Studies/AI via logStudySession, so both
 * produce exactly the same state. Idempotent against duplicate deliveries of the same event.
 */
export async function recordGermanEvent(userId: string, input: z.infer<typeof germanEventSchema>, tz?: string, opts: GermanEventOptions = {}) {
  const source = opts.source ?? "user";
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const [dup] = await db
    .select()
    .from(germanEvents)
    .where(and(
      eq(germanEvents.userId, userId),
      eq(germanEvents.kind, input.kind),
      gte(germanEvents.at, since),
      sql`${germanEvents.unitId} is not distinct from ${input.unitId ?? null}`,
      sql`${germanEvents.label} is not distinct from ${input.label ?? null}`,
      sql`${germanEvents.durationSec} is not distinct from ${input.durationSec ?? null}`,
      sql`${germanEvents.score} is not distinct from ${input.score ?? null}`,
    ))
    .orderBy(desc(germanEvents.at))
    .limit(1);
  if (dup) return { event: dup, session: null, goalsUpdated: 0, deduplicated: true as const };

  const [ev] = await db.insert(germanEvents).values({ ...input, data: { ...(input.data ?? {}), source }, userId }).returning();
  const minutes = input.durationSec ? Math.round(input.durationSec / 60) : 0;
  let session: Awaited<ReturnType<typeof insertStudySession>> | null = null;
  let goalsUpdated = 0;
  if (minutes >= 1) {
    const subjectId = opts.subjectId ?? (await resolveSubject(userId, { slug: GERMAN_SUBJECT_SLUG, subject: "German" }));
    session = await insertStudySession(userId, {
      subjectId,
      durationMinutes: minutes,
      topic: input.label ?? input.kind,
      notes: opts.notes ?? null,
      startedAt: opts.startedAt ?? null,
      link: { type: "german_event", id: ev.id },
      source,
      date: opts.date ?? todayKey(tz),
    }, tz);
    const goals = await listGoals(userId, "active");
    for (const g of goals.filter((g) => g.category === "german" && g.metricUnit === "min" && g.metricTarget)) {
      await updateGoalProgress(userId, g.id, { delta: minutes });
      goalsUpdated++;
    }
  }
  return { event: ev, session, goalsUpdated, deduplicated: false as const };
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
