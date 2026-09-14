import { z } from "zod";
import { defineTool } from "../registry";
import * as j from "@/server/services/journal";
import { dateSchema } from "@/server/services/tasks";

defineTool({ name: "create_journal_entry", module: "journal", risk: "low", description: "Write a journal entry (kind: entry | note | reflection | event | achievement | problem | idea), optional mood 1-5 and tags.", schema: j.journalCreateSchema.omit({ source: true }), summarize: (i) => `create_journal_entry — ${i.kind} — ${(i.title ?? i.content).slice(0, 40)}`, run: (i, ctx) => j.createEntry(ctx.user.id, { ...i, source: "ai" }, ctx.user.timezone) });
defineTool({ name: "get_journal_entries", module: "journal", risk: "read", description: "Read journal entries for a range (default last 14 days).", schema: z.object({ from: dateSchema.optional(), to: dateSchema.optional(), kind: z.string().optional(), limit: z.number().int().max(100).default(30) }), run: (i, ctx) => j.listJournal(ctx.user.id, i) });
