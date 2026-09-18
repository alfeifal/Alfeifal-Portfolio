import { z } from "zod";
import { defineTool } from "../registry";
import * as cal from "@/server/services/calendar";
import { dateSchema } from "@/server/services/tasks";
import { addDaysKey, todayKey } from "@/lib/dates";

defineTool({
  name: "get_calendar", module: "calendar", risk: "read",
  description: "Events between two dates (inclusive). Defaults to the next 7 days. Also returns free slots per day (07:00–23:00). The system-prompt snapshot only carries a clipped view of the near future, so call this for any date range, for full lists and for event ids.",
  schema: z.object({ from: dateSchema.optional(), to: dateSchema.optional(), includeFreeSlots: z.boolean().default(false) }),
  run: async (i, ctx) => {
    const from = i.from ?? todayKey(ctx.user.timezone);
    const to = i.to ?? addDaysKey(from, 6);
    const events = await cal.listEvents(ctx.user.id, { from: new Date(from + "T00:00:00"), to: new Date(to + "T23:59:59") });
    let free: unknown = undefined;
    if (i.includeFreeSlots) {
      free = [];
      for (let d = from; d <= to; d = addDaysKey(d, 1)) (free as unknown[]).push({ date: d, slots: await cal.freeSlots(ctx.user.id, new Date(d + "T07:00:00"), new Date(d + "T23:00:00"), 30) });
    }
    return { from, to, events, freeSlots: free };
  },
});
defineTool({
  name: "create_event", module: "calendar", risk: "low",
  description: "Create a calendar event: something that HAPPENS at a time, occupying a slot. Use create_task instead for something to do by a date with no fixed hour. kind: work | training | study | german | personal | deadline | reminder | event. Use ISO datetimes in the user's local time (e.g. 2026-09-15T10:00:00).",
  schema: z.object({ title: z.string(), kind: cal.eventKindSchema.default("event"), startAt: z.string(), endAt: z.string().optional(), allDay: z.boolean().default(false), description: z.string().optional(), location: z.string().optional(), taskId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), goalId: z.string().uuid().optional(), reminderMinutes: z.number().int().optional() }),
  summarize: (i) => `create_event — ${i.title} — ${i.startAt}`,
  run: (i, ctx) => cal.createEvent(ctx.user.id, cal.eventCreateSchema.parse({ ...i, source: "ai" })),
});
defineTool({
  name: "create_events", module: "calendar", risk: "medium",
  description: "Create several events at once (e.g. a whole week plan). Confirmation is requested when more than 5 events.",
  schema: z.object({ events: z.array(z.object({ title: z.string(), kind: cal.eventKindSchema.default("event"), startAt: z.string(), endAt: z.string().optional(), allDay: z.boolean().default(false), description: z.string().optional() })).min(1).max(40) }),
  needsConfirmation: (i) => (i.events.length > 5 ? `Create ${i.events.length} calendar events` : false),
  summarize: (i) => `create_events — ${i.events.length} events`,
  run: async (i, ctx) => { const out = []; for (const e of i.events) out.push(await cal.createEvent(ctx.user.id, cal.eventCreateSchema.parse({ ...e, source: "ai" }))); return out; },
});
defineTool({ name: "update_event", module: "calendar", risk: "low", description: "Update an event by id (move, rename, resize).", schema: z.object({ id: z.string().uuid(), title: z.string().optional(), startAt: z.string().optional(), endAt: z.string().optional(), kind: cal.eventKindSchema.optional(), description: z.string().optional(), location: z.string().optional(), taskId: z.string().uuid().nullable().optional(), projectId: z.string().uuid().nullable().optional(), goalId: z.string().uuid().nullable().optional() }), summarize: (i) => `update_event — ${i.id.slice(0, 8)}`, run: ({ id, ...rest }, ctx) => cal.updateEvent(ctx.user.id, id, cal.eventUpdateSchema.parse(rest)) });
defineTool({ name: "delete_event", module: "calendar", risk: "medium", description: "Delete an event by id. Requires confirmation.", schema: z.object({ id: z.string().uuid() }), needsConfirmation: (i) => `Delete event ${i.id.slice(0, 8)}`, summarize: (i) => `delete_event — ${i.id.slice(0, 8)}`, run: async ({ id }, ctx) => { await cal.deleteEvent(ctx.user.id, id); return { deleted: id }; } });
