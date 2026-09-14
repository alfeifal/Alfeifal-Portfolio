import { z } from "zod";
import { defineTool } from "../registry";
import * as st from "@/server/services/studies";
import { createTask, dateSchema } from "@/server/services/tasks";
import { addDaysKey, todayKey } from "@/lib/dates";

defineTool({ name: "get_study_schedule", module: "studies", risk: "read", description: "Subjects, upcoming exams and open assignments.", schema: z.object({}), run: async (_i, ctx) => ({ subjects: await st.listSubjects(ctx.user.id), exams: await st.listExams(ctx.user.id, true, ctx.user.timezone), assignments: await st.listAssignments(ctx.user.id, true) }) });
defineTool({
  name: "log_study_session", module: "studies", risk: "low",
  description: "Log a study session: subject by name (created if missing), minutes, topic.",
  schema: z.object({ subject: z.string(), durationMinutes: z.number().int().min(1).max(1440), topic: z.string().optional(), notes: z.string().optional(), date: dateSchema.optional() }),
  summarize: (i) => `log_study_session — ${i.subject} — ${i.durationMinutes} min`,
  run: (i, ctx) => st.logStudySession(ctx.user.id, { ...i, source: "ai" }, ctx.user.timezone),
});
defineTool({ name: "get_study_progress", module: "studies", risk: "read", description: "Study minutes per subject and per day for a range (default last 7 days).", schema: z.object({ from: dateSchema.optional(), to: dateSchema.optional() }), run: (i, ctx) => { const to = i.to ?? todayKey(ctx.user.timezone); return st.studyProgress(ctx.user.id, { from: i.from ?? addDaysKey(to, -6), to }); } });
defineTool({
  name: "create_study_task", module: "studies", risk: "low",
  description: "Create a study task (category 'study') for a date, optionally linked to a subject by name.",
  schema: z.object({ title: z.string(), dueDate: dateSchema.optional(), subject: z.string().optional(), estimatedMinutes: z.number().int().optional(), priority: z.enum(["low", "medium", "high", "urgent"]).default("medium") }),
  summarize: (i) => `create_study_task — ${i.title}`,
  run: (i, ctx) => createTask(ctx.user.id, { title: i.subject ? `${i.subject}: ${i.title}` : i.title, dueDate: i.dueDate, category: "study", estimatedMinutes: i.estimatedMinutes, priority: i.priority, status: "todo", source: "ai" }),
});
defineTool({ name: "create_exam", module: "studies", risk: "low", description: "Register an exam date for a subject (by name).", schema: z.object({ subject: z.string(), title: z.string(), date: dateSchema, notes: z.string().optional() }), summarize: (i) => `create_exam — ${i.title} — ${i.date}`, run: async (i, ctx) => st.createExam(ctx.user.id, { subjectId: await st.resolveSubject(ctx.user.id, { subject: i.subject }), title: i.title, date: i.date, notes: i.notes }) });
defineTool({ name: "create_assignment", module: "studies", risk: "low", description: "Register an assignment with a due date.", schema: z.object({ subject: z.string(), title: z.string(), dueDate: dateSchema.optional(), description: z.string().optional() }), summarize: (i) => `create_assignment — ${i.title}`, run: async (i, ctx) => st.createAssignment(ctx.user.id, { subjectId: await st.resolveSubject(ctx.user.id, { subject: i.subject }), title: i.title, dueDate: i.dueDate, description: i.description }) });
