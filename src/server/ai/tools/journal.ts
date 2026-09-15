import { z } from "zod";
import { defineTool } from "../registry";
import * as j from "@/server/services/journal";
import { dateSchema } from "@/server/services/tasks";

defineTool({ name: "create_journal_entry", module: "journal", risk: "low", description: "Write a journal entry (kind: entry | note | reflection | event | achievement | problem | idea), optional mood 1-5 and tags.", schema: j.journalCreateSchema.omit({ source: true }), summarize: (i) => `create_journal_entry — ${i.kind} — ${(i.title ?? i.content).slice(0, 40)}`, run: (i, ctx) => j.createEntry(ctx.user.id, { ...i, source: "ai" }, ctx.user.timezone) });
defineTool({ name: "get_journal_entries", module: "journal", risk: "read", description: "Read journal entries for a range (default last 14 days).", schema: z.object({ from: dateSchema.optional(), to: dateSchema.optional(), kind: z.string().optional(), limit: z.number().int().max(100).default(30) }), run: (i, ctx) => j.listJournal(ctx.user.id, i) });

defineTool({
  name: "update_journal_entry", module: "journal", risk: "low",
  description: "Edit a journal entry: its text, title, kind, mood (1-5) or tags. Get ids from get_journal_entries. Rewriting what the user wrote is their call, so only change what they asked for.",
  schema: z.object({ id: z.string().uuid(), content: z.string().max(50000).optional(), title: z.string().max(200).nullish(), kind: z.enum(["entry", "note", "reflection", "event", "achievement", "problem", "idea"]).optional(), mood: z.number().int().min(1).max(5).nullish(), tags: z.array(z.string().max(30)).max(20).optional() }),
  summarize: (i) => `update_journal_entry — ${i.id.slice(0, 8)}`,
  run: ({ id, ...rest }, ctx) => j.updateEntry(ctx.user.id, id, rest),
});
defineTool({
  name: "delete_journal_entry", module: "journal", risk: "medium",
  description: "Delete a journal entry. Requires confirmation: a diary page cannot be recovered.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete journal entry ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_journal_entry — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await j.deleteEntry(ctx.user.id, i.id); return { deleted: i.id }; },
});
