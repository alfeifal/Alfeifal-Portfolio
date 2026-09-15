import { z } from "zod";
import { defineTool } from "../registry";
import * as ac from "@/server/services/academy";

/** Trading academy: the user's own lessons, notes and quiz results. */
defineTool({
  name: "get_academy_lessons", module: "academy", risk: "read",
  description: "The trading academy lessons with the user's progress (attempts, best score, notes).",
  schema: z.object({ id: z.string().uuid().optional() }),
  run: (i, ctx) => (i.id ? ac.getLesson(ctx.user.id, i.id) : ac.listLessons(ctx.user.id)),
});
defineTool({
  name: "create_academy_lesson", module: "academy", risk: "low",
  description: "Add a lesson to the trading academy: topic, title, content and an optional quiz (questions with options and the index of the right answer). Teach with the user's own material, never invented market claims.",
  schema: ac.lessonSchema,
  summarize: (i) => `create_academy_lesson — ${i.title}`,
  run: (i, ctx) => ac.createLesson(ctx.user.id, i),
});
defineTool({
  name: "update_academy_lesson", module: "academy", risk: "medium",
  description: "Edit a lesson: title, topic, body, position or quiz. Use set_academy_notes for the user's personal notes on it.",
  schema: z.object({ id: z.string().uuid() }).extend(ac.lessonSchema.partial().shape),
  summarize: (i) => `update_academy_lesson — ${i.id.slice(0, 8)}`,
  run: ({ id, ...rest }, ctx) => ac.updateLesson(ctx.user.id, id, rest),
});
defineTool({
  name: "delete_academy_lesson", module: "academy", risk: "medium",
  description: "Delete a lesson and the progress recorded on it. Requires confirmation.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete academy lesson ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_academy_lesson — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await ac.deleteLesson(ctx.user.id, i.id); return { deleted: i.id }; },
});
defineTool({
  name: "set_academy_notes", module: "academy", risk: "low",
  description: "Save the user's notes for a lesson (replaces the previous notes).",
  schema: z.object({ lessonId: z.string().uuid(), notes: z.string().max(20000) }),
  summarize: (i) => `set_academy_notes — ${i.lessonId.slice(0, 8)}`,
  run: (i, ctx) => ac.setLessonNotes(ctx.user.id, i.lessonId, i.notes),
});
defineTool({
  name: "record_academy_quiz", module: "academy", risk: "low",
  description: "Record a quiz attempt for a lesson with the score the user got (0-100). Attempts and the best score accumulate; a passing score completes the lesson.",
  schema: z.object({ lessonId: z.string().uuid(), score: z.number().int().min(0).max(100), notes: z.string().max(5000).optional() }),
  summarize: (i) => `record_academy_quiz — ${i.lessonId.slice(0, 8)} — ${i.score}%`,
  run: (i, ctx) => ac.recordQuiz(ctx.user.id, i.lessonId, i.score, i.notes ?? null),
});
