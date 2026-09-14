import { z } from "zod";
import { defineTool } from "../registry";
import * as de from "@/server/services/german";
import { addDaysKey, todayKey } from "@/lib/dates";
import { UNITS, CONCEPTS } from "@/modules/german/content";
import { dateSchema } from "@/server/services/tasks";

defineTool({
  name: "get_german_progress", module: "german", risk: "read",
  description: "German course progress: XP, streak, units passed, study minutes in a range, recent events, plus the next recommended unit and weak concepts.",
  schema: z.object({ from: dateSchema.optional(), to: dateSchema.optional() }),
  run: async (i, ctx) => {
    const to = i.to ?? todayKey(ctx.user.timezone);
    const summary = await de.germanSummary(ctx.user.id, { from: i.from ?? addDaysKey(to, -6), to });
    const st = await de.getGermanState(ctx.user.id);
    const s = (st.state ?? {}) as { lessons?: Record<string, { testBest: number; sectionsDone: string[] }>; errors?: { concepts: string[]; resolved: boolean; at: number }[]; settings?: { unlockAll?: boolean } };
    const lessons = s.lessons ?? {};
    const unlocked = (idx: number) => idx <= 0 || s.settings?.unlockAll || (lessons[UNITS[idx - 1].id]?.testBest ?? 0) >= 70;
    const next = UNITS.find((u, idx) => unlocked(idx) && (lessons[u.id]?.testBest ?? 0) < 70) ?? null;
    const counts: Record<string, number> = {};
    for (const e of s.errors ?? []) if (!e.resolved && Date.now() - e.at < 7 * 86400e3) for (const c of e.concepts) counts[c] = (counts[c] ?? 0) + 1;
    const weak = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({ concept: CONCEPTS.find((c) => c.id === id)?.nameEs ?? id, errors: n }));
    return { ...summary, nextUnit: next ? { id: next.id, number: next.number, title: next.title, cefr: next.cefr, href: `/german/curso/${next.id}` } : null, weakConcepts: weak, unitsTotal: UNITS.length };
  },
});
defineTool({ name: "get_german_syllabus", module: "german", risk: "read", description: "The 28-unit syllabus with concepts (ids, titles, CEFR).", schema: z.object({}), run: async () => UNITS.map((u) => ({ id: u.id, number: u.number, block: u.block, title: u.title, titleDe: u.titleDe, cefr: u.cefr, concepts: u.concepts })) });
