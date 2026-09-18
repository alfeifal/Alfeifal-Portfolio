import { z } from "zod";
import { defineTool } from "../registry";
import * as st from "@/server/services/studies";
import { createTask, dateSchema } from "@/server/services/tasks";
import { addDaysKey, todayKey } from "@/lib/dates";

defineTool({ name: "get_study_schedule", module: "studies", risk: "read", description: "Subjects, upcoming exams and open assignments.", schema: z.object({}), run: async (_i, ctx) => ({ subjects: await st.listSubjects(ctx.user.id), exams: await st.listExams(ctx.user.id, true, ctx.user.timezone), assignments: await st.listAssignments(ctx.user.id, true) }) });
defineTool({
  name: "log_study_session", module: "studies", risk: "low",
  description: "Log a study session: `subject` by name (created if missing), `durationMinutes`, and optionally a topic.",
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

defineTool({
  name: "update_subject", module: "studies", risk: "medium",
  description:
    "Update a subject: its name, colour, description or weekly study goal in minutes (weeklyGoalMinutes), or archive it. The weekly goal is what the study-consistency notifications and the study progress screen measure against. Find the subject id with get_study_schedule.",
  schema: z.object({ id: z.string().uuid(), name: z.string().max(100).optional(), weeklyGoalMinutes: z.number().int().min(0).max(10080).optional(), description: z.string().max(2000).optional(), color: z.string().max(20).optional(), archived: z.boolean().optional() }),
  needsConfirmation: (i) => (i.archived ? "Archive subject" : false),
  summarize: (i) => `update_subject — ${i.id.slice(0, 8)}${i.weeklyGoalMinutes != null ? ` — ${i.weeklyGoalMinutes} min/week` : ""}`,
  run: ({ id, ...rest }, ctx) => st.updateSubject(ctx.user.id, id, rest),
});
defineTool({
  name: "complete_assignment", module: "studies", risk: "low",
  description: "Mark an assignment as done (or reopen it with completed=false). Find its id with get_study_schedule.",
  schema: z.object({ id: z.string().uuid(), completed: z.boolean().default(true), grade: z.string().max(20).optional() }),
  summarize: (i) => `complete_assignment — ${i.id.slice(0, 8)}${i.completed ? "" : " (reopened)"}`,
  run: ({ id, ...rest }, ctx) => st.updateAssignment(ctx.user.id, id, rest),
});

defineTool({
  name: "create_subject", module: "studies", risk: "low",
  description: "Create a subject, course, language or certification to track study time against, with an optional weekly goal in minutes. The German course already exists as the subject 'German' — never create a second one for it.",
  schema: st.subjectSchema,
  summarize: (i) => `create_subject — ${i.name}`,
  run: (i, ctx) => st.createSubject(ctx.user.id, i),
});
defineTool({
  name: "delete_subject", module: "studies", risk: "high",
  description: "Delete a subject. Its study sessions, exams and assignments are kept but stop belonging to a subject, so the progress per subject changes. Always confirmed, and the subject's exact name must be given.",
  schema: z.object({ id: z.string().uuid(), name: z.string().min(1).max(100).describe("The subject's exact name, for the confirmation") }),
  summarize: (i) => `delete_subject — "${i.name}"`,
  needsConfirmation: (i) => `Permanently delete the subject "${i.name}" (its sessions, exams and assignments stay but lose their subject)`,
  run: async (i, ctx) => {
    const subject = (await st.listSubjects(ctx.user.id)).find((s) => s.id === i.id);
    if (!subject) throw new Error("Subject not found");
    if (subject.name.trim().toLowerCase() !== i.name.trim().toLowerCase()) throw new Error(`That id belongs to "${subject.name}", not "${i.name}". Nothing was deleted.`);
    await st.deleteSubject(ctx.user.id, i.id);
    return { deleted: i.id, name: subject.name };
  },
});
defineTool({
  name: "update_exam", module: "studies", risk: "low",
  description: "Change an exam's date, title, location, notes or result. Find ids with get_study_schedule.",
  schema: z.object({ id: z.string().uuid() }).extend(st.examSchema.partial().shape),
  summarize: (i) => `update_exam — ${i.id.slice(0, 8)}${i.date ? " — " + i.date : ""}`,
  run: ({ id, ...rest }, ctx) => st.updateExam(ctx.user.id, id, rest),
});
defineTool({
  name: "delete_exam", module: "studies", risk: "medium",
  description: "Delete an exam. Requires confirmation. Deadlines and study notifications stop counting it.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete exam ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_exam — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await st.deleteExam(ctx.user.id, i.id); return { deleted: i.id }; },
});
defineTool({
  name: "delete_assignment", module: "studies", risk: "medium",
  description: "Delete an assignment. Requires confirmation. Use complete_assignment when it is simply done.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete assignment ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_assignment — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await st.deleteAssignment(ctx.user.id, i.id); return { deleted: i.id }; },
});
defineTool({
  name: "delete_study_session", module: "studies", risk: "medium",
  description: "Delete a logged study session (a mistake, a duplicate). Requires confirmation. Study totals, goals and German minutes are recomputed from what is left.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete study session ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_study_session — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await st.deleteStudySession(ctx.user.id, i.id); return { deleted: i.id }; },
});
