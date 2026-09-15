import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { planItems, plans } from "@/server/db/schema";
import type { SessionUser } from "@/server/auth/session";
import { badRequest, notFound } from "@/server/http";
import { audit } from "@/server/audit";
import { isoWeekKey, todayKey } from "@/lib/dates";
import { createEvent, eventCreateSchema, eventKindSchema } from "./calendar";
import { createTask, dateSchema, prioritySchema, taskCreateSchema } from "./tasks";

/**
 * Persistent planner (phase 3.2b).
 *
 * The assistant proposes, the user disposes. `createDraft` only ever writes to `plans` / `plan_items`:
 * no task and no event is created until the user accepts, which is an explicit action of theirs — there
 * is deliberately no tool that lets the model accept or apply a plan. Acceptance materialises each item
 * through the ordinary services (`tasks.createTask`, `calendar.createEvent`), so every guarantee those
 * already give (validation, audit, domain events, goal recomputation) applies unchanged.
 *
 * Idempotency: an item is *reserved* with a conditional update before anything real is created, and the
 * created row's id is stored on it. Accepting the same plan twice, or replaying the same request, can
 * therefore never produce a second task or event; failures are reported per item and leave the item
 * proposed so it can be retried honestly.
 */

export const planHorizonSchema = z.enum(["day", "week"]);
export type PlanHorizon = z.infer<typeof planHorizonSchema>;

export const planItemInputSchema = z
  .object({
    kind: z.enum(["event", "task", "note"]).default("task"),
    title: z.string().min(1).max(300),
    notes: z.string().max(2000).nullish(),
    date: dateSchema.nullish(),
    startAt: z.coerce.date().nullish(),
    endAt: z.coerce.date().nullish(),
    allDay: z.boolean().default(false),
    estimatedMinutes: z.number().int().min(1).max(1440).nullish(),
    eventKind: eventKindSchema.nullish(),
    priority: prioritySchema.nullish(),
    projectId: z.string().uuid().nullish(),
    goalId: z.string().uuid().nullish(),
    link: z.object({ type: z.string().max(40), id: z.string().max(100) }).nullish(),
  })
  .refine((i) => i.kind !== "event" || i.startAt != null || (i.date != null && i.allDay), { message: "An event item needs startAt (or an all-day date)" })
  .refine((i) => !i.startAt || !i.endAt || i.endAt > i.startAt, { message: "endAt must be after startAt" });

export const planDraftSchema = z.object({
  horizon: planHorizonSchema.default("day"),
  /** Defaults to today (day) or the current ISO week. */
  periodKey: z.string().max(20).optional(),
  title: z.string().max(200).nullish(),
  /** The narrative shown to the user. */
  content: z.string().max(20000).default(""),
  items: z.array(planItemInputSchema).min(1).max(60),
  data: z.record(z.string(), z.unknown()).nullish(),
  source: z.enum(["user", "ai", "import"]).default("ai"),
});
export type PlanDraftInput = z.infer<typeof planDraftSchema>;

export type PlanRow = typeof plans.$inferSelect;
export type PlanItemRow = typeof planItems.$inferSelect;
export interface PlanWithItems extends PlanRow { items: PlanItemRow[] }

/** Period a plan belongs to: a date for a day plan, an ISO week key for a week plan. */
export function periodKeyFor(horizon: PlanHorizon, tz?: string, date?: string) {
  const day = date ?? todayKey(tz);
  return horizon === "week" ? isoWeekKey(new Date(day + "T12:00:00")) : day;
}

const LIVE_STATUSES = ["draft", "accepted", "partially_accepted"] as const;

export async function getPlan(userId: string, id: string): Promise<PlanWithItems> {
  const [p] = await db.select().from(plans).where(and(eq(plans.id, id), eq(plans.userId, userId)));
  if (!p) throw notFound("Plan");
  const items = await db.select().from(planItems).where(eq(planItems.planId, p.id)).orderBy(asc(planItems.position), asc(planItems.createdAt));
  return { ...p, items };
}

/** The plan in force for a period: the most recent one that was neither rejected nor superseded. */
export async function currentPlan(userId: string, opts: { horizon?: PlanHorizon; periodKey?: string; tz?: string } = {}): Promise<PlanWithItems | null> {
  const horizon = opts.horizon ?? "day";
  const periodKey = opts.periodKey ?? periodKeyFor(horizon, opts.tz);
  const [p] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, userId), eq(plans.horizon, horizon), eq(plans.periodKey, periodKey), inArray(plans.status, [...LIVE_STATUSES])))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  return p ? getPlan(userId, p.id) : null;
}

export async function listPlans(userId: string, filter: { horizon?: PlanHorizon; status?: PlanRow["status"]; limit?: number } = {}) {
  const conds = [eq(plans.userId, userId)];
  if (filter.horizon) conds.push(eq(plans.horizon, filter.horizon));
  if (filter.status) conds.push(eq(plans.status, filter.status));
  return db.select().from(plans).where(and(...conds)).orderBy(desc(plans.createdAt)).limit(filter.limit ?? 50);
}

/**
 * Saves a proposal as a draft. Nothing real is created here. A previous *draft* for the same period is
 * superseded (only one proposal waits for an answer at a time); plans already accepted are historical
 * records and are left alone.
 */
export async function createDraft(user: SessionUser, input: PlanDraftInput, opts: { conversationId?: string | null; tz?: string } = {}): Promise<PlanWithItems> {
  const horizon = input.horizon;
  const periodKey = input.periodKey ?? periodKeyFor(horizon, opts.tz ?? user.timezone);
  const superseded = await db
    .update(plans)
    .set({ status: "superseded" })
    .where(and(eq(plans.userId, user.id), eq(plans.horizon, horizon), eq(plans.periodKey, periodKey), eq(plans.status, "draft")))
    .returning({ id: plans.id });
  const [plan] = await db
    .insert(plans)
    .values({ userId: user.id, horizon, periodKey, status: "draft", title: input.title ?? null, content: input.content, data: input.data ?? null, conversationId: opts.conversationId ?? null, source: input.source })
    .returning();
  const rows = input.items.map((i, position) => ({
    userId: user.id, planId: plan.id, position, kind: i.kind, status: "proposed" as const,
    title: i.title, notes: i.notes ?? null, date: i.date ?? null,
    startAt: i.startAt ?? null, endAt: i.endAt ?? null, allDay: i.allDay,
    estimatedMinutes: i.estimatedMinutes ?? null, eventKind: i.eventKind ?? null, priority: i.priority ?? null,
    projectId: i.projectId ?? null, goalId: i.goalId ?? null, link: i.link ?? null,
  }));
  await db.insert(planItems).values(rows);
  await audit({ userId: user.id, actor: input.source === "ai" ? "ai" : "user", action: "planner.draft", entityType: "plan", entityId: plan.id, metadata: { horizon, periodKey, items: rows.length, superseded: superseded.map((s) => s.id) } });
  return getPlan(user.id, plan.id);
}

export interface AcceptedItemResult { itemId: string; title: string; kind: PlanItemRow["kind"]; status: "created" | "already_created" | "skipped" | "failed"; taskId?: string; eventId?: string; error?: string }

/**
 * Materialises the accepted items. Explicit user action only — never reachable from an AI tool.
 * Returns one result per item, so the caller can report exactly what was created and what failed
 * instead of assuming success.
 */
export async function acceptPlan(user: SessionUser, planId: string, opts: { itemIds?: string[] } = {}): Promise<{ plan: PlanWithItems; results: AcceptedItemResult[] }> {
  const plan = await getPlan(user.id, planId);
  if (plan.status === "rejected" || plan.status === "superseded") throw badRequest(`This plan is ${plan.status} and can no longer be accepted`);
  const wanted = opts.itemIds?.length ? plan.items.filter((i) => opts.itemIds!.includes(i.id)) : plan.items;
  if (opts.itemIds?.length && wanted.length !== opts.itemIds.length) throw notFound("Plan item");
  const results: AcceptedItemResult[] = [];

  for (const item of wanted) {
    const base = { itemId: item.id, title: item.title, kind: item.kind };
    if (item.createdTaskId || item.createdEventId) { results.push({ ...base, status: "already_created", taskId: item.createdTaskId ?? undefined, eventId: item.createdEventId ?? undefined }); continue; }
    if (item.status !== "proposed") { results.push({ ...base, status: "skipped" }); continue; }

    // Reserve the item first: only the run that flips it out of "proposed" may create anything.
    const [reserved] = await db
      .update(planItems)
      .set({ status: "accepted" })
      .where(and(eq(planItems.id, item.id), eq(planItems.userId, user.id), eq(planItems.status, "proposed"), isNull(planItems.createdTaskId), isNull(planItems.createdEventId)))
      .returning({ id: planItems.id });
    if (!reserved) { results.push({ ...base, status: "already_created" }); continue; }

    try {
      if (item.kind === "task") {
        const created = await createTask(user.id, taskCreateSchema.parse({
          title: item.title, description: item.notes, dueDate: item.date, priority: item.priority ?? "medium",
          projectId: item.projectId, goalId: item.goalId, estimatedMinutes: item.estimatedMinutes, source: "ai",
        }));
        await db.update(planItems).set({ createdTaskId: created.id }).where(eq(planItems.id, item.id));
        results.push({ ...base, status: "created", taskId: created.id });
      } else if (item.kind === "event") {
        const startAt = item.startAt ?? new Date(`${item.date}T00:00:00`);
        const created = await createEvent(user.id, eventCreateSchema.parse({
          title: item.title, description: item.notes, kind: item.eventKind ?? "event",
          startAt, endAt: item.endAt ?? undefined, allDay: item.allDay,
          projectId: item.projectId, goalId: item.goalId, link: item.link, source: "ai",
        }));
        await db.update(planItems).set({ createdEventId: created.id }).where(eq(planItems.id, item.id));
        results.push({ ...base, status: "created", eventId: created.id });
      } else {
        results.push({ ...base, status: "created" }); // a note is accepted as-is; it has no real counterpart
      }
    } catch (e) {
      // Nothing was created: hand the item back so the user can retry, and say so.
      await db.update(planItems).set({ status: "proposed" }).where(eq(planItems.id, item.id));
      results.push({ ...base, status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }

  const [counts] = await db
    .select({ proposed: sql<number>`count(*) filter (where ${planItems.status} = 'proposed')`, accepted: sql<number>`count(*) filter (where ${planItems.status} = 'accepted')` })
    .from(planItems)
    .where(eq(planItems.planId, plan.id));
  const proposed = Number(counts.proposed), accepted = Number(counts.accepted);
  const status: PlanRow["status"] = accepted === 0 ? plan.status : proposed > 0 ? "partially_accepted" : "accepted";
  await db.update(plans).set({ status, acceptedAt: accepted > 0 ? plan.acceptedAt ?? new Date() : plan.acceptedAt }).where(eq(plans.id, plan.id));
  const created = results.filter((r) => r.status === "created");
  if (created.length) await audit({ userId: user.id, actor: "user", action: "planner.accept", entityType: "plan", entityId: plan.id, metadata: { created: created.length, failed: results.filter((r) => r.status === "failed").length, status } });
  return { plan: await getPlan(user.id, plan.id), results };
}

/** Rejects the whole plan: every still-proposed item is dropped. Already created items stay created. */
export async function rejectPlan(user: SessionUser, planId: string) {
  const plan = await getPlan(user.id, planId);
  if (plan.status === "rejected") return plan;
  await db.update(planItems).set({ status: "rejected" }).where(and(eq(planItems.planId, plan.id), eq(planItems.status, "proposed")));
  const hasAccepted = plan.items.some((i) => i.status === "accepted");
  await db.update(plans).set({ status: hasAccepted ? "partially_accepted" : "rejected", rejectedAt: new Date() }).where(eq(plans.id, plan.id));
  await audit({ userId: user.id, actor: "user", action: "planner.reject", entityType: "plan", entityId: plan.id });
  return getPlan(user.id, plan.id);
}

/** Drops a plan entirely (items go with it by cascade). Created tasks and events are real and stay. */
export async function deletePlan(userId: string, planId: string) {
  await getPlan(userId, planId);
  await db.delete(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId)));
  await audit({ userId, actor: "user", action: "planner.delete", entityType: "plan", entityId: planId });
}

/** Compact view for the life snapshot and the assistant: what is planned right now, and what is pending an answer. */
export async function plannerSnapshot(userId: string, tz?: string) {
  const [day, week] = await Promise.all([currentPlan(userId, { horizon: "day", tz }), currentPlan(userId, { horizon: "week", tz })]);
  const slim = (p: PlanWithItems | null) =>
    p ? {
      id: p.id, periodKey: p.periodKey, status: p.status, title: p.title,
      items: p.items.map((i) => ({ id: i.id, kind: i.kind, status: i.status, title: i.title, date: i.date, startAt: i.startAt, materialised: Boolean(i.createdTaskId || i.createdEventId) })),
      pendingItems: p.items.filter((i) => i.status === "proposed").length,
    } : null;
  const [pending] = await db
    .select({ n: sql<number>`count(*)` })
    .from(plans)
    .where(and(eq(plans.userId, userId), eq(plans.status, "draft"), ne(plans.status, "superseded")));
  return { day: slim(day), week: slim(week), draftsAwaitingAnswer: Number(pending.n), source: "calculated" as const };
}
