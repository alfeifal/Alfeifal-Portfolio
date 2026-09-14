import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { assignments, exams, studySessions, subjects } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/http";
import { dateSchema } from "./tasks";
import { todayKey } from "@/lib/dates";
import { recordGermanEvent } from "./german";

/** Slug of the bootstrapped German subject: study activity for it is owned by the German bridge (see logStudySession). */
export const GERMAN_SUBJECT_SLUG = "german";
const GERMAN_NAMES = /^(german|alem[aá]n|deutsch)$/i;

export const subjectSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(["subject", "course", "language", "certification"]).default("subject"),
  slug: z.string().max(50).nullish(),
  color: z.string().max(20).nullish(),
  description: z.string().max(2000).nullish(),
  weeklyGoalMinutes: z.number().int().min(0).max(10080).nullish(),
});
export const studySessionSchema = z.object({
  subjectId: z.string().uuid().nullish(),
  /** Subject may be referenced by name (AI/natural language). */
  subject: z.string().max(100).nullish(),
  date: dateSchema.optional(),
  startedAt: z.coerce.date().nullish(),
  durationMinutes: z.number().int().min(1).max(1440),
  topic: z.string().max(300).nullish(),
  notes: z.string().max(5000).nullish(),
  link: z.object({ type: z.string(), id: z.string() }).nullish(),
  source: z.enum(["user", "ai", "import"]).default("user"),
});
export const assignmentSchema = z.object({ subjectId: z.string().uuid().nullish(), title: z.string().min(1).max(200), description: z.string().max(5000).nullish(), dueDate: dateSchema.nullish(), grade: z.string().max(20).nullish() });
export const examSchema = z.object({ subjectId: z.string().uuid().nullish(), title: z.string().min(1).max(200), date: dateSchema, location: z.string().max(200).nullish(), notes: z.string().max(5000).nullish(), result: z.string().max(50).nullish() });

export async function listSubjects(userId: string) {
  return db.select().from(subjects).where(and(eq(subjects.userId, userId), eq(subjects.archived, false))).orderBy(asc(subjects.name));
}
export async function createSubject(userId: string, input: z.infer<typeof subjectSchema>) {
  const [s] = await db.insert(subjects).values({ ...input, userId }).returning();
  return s;
}
export async function updateSubject(userId: string, id: string, input: Partial<z.infer<typeof subjectSchema>> & { archived?: boolean }) {
  const [s] = await db.update(subjects).set(input).where(and(eq(subjects.id, id), eq(subjects.userId, userId))).returning();
  if (!s) throw notFound("Subject");
  return s;
}
export async function deleteSubject(userId: string, id: string) {
  await db.delete(subjects).where(and(eq(subjects.id, id), eq(subjects.userId, userId)));
}
export async function resolveSubject(userId: string, ref: { subjectId?: string | null; subject?: string | null; slug?: string }) {
  if (ref.subjectId) return ref.subjectId;
  if (ref.slug) {
    const [s] = await db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.userId, userId), eq(subjects.slug, ref.slug))).limit(1);
    if (s) return s.id;
  }
  if (ref.subject) {
    // "German" / "alemán" / "Deutsch" all mean the integrated German subject — never a second, disconnected subject.
    if (GERMAN_NAMES.test(ref.subject.trim())) {
      const [g] = await db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.userId, userId), eq(subjects.slug, GERMAN_SUBJECT_SLUG))).limit(1);
      if (g) return g.id;
    }
    const [s] = await db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.userId, userId), sql`lower(${subjects.name}) = lower(${ref.subject})`)).limit(1);
    if (s) return s.id;
    const created = await createSubject(userId, { name: ref.subject, kind: "subject" });
    return created.id;
  }
  return null;
}

export async function listStudySessions(userId: string, filter: { from?: string; to?: string; subjectId?: string; limit?: number } = {}) {
  const conds = [eq(studySessions.userId, userId)];
  if (filter.from) conds.push(gte(studySessions.date, filter.from));
  if (filter.to) conds.push(lte(studySessions.date, filter.to));
  if (filter.subjectId) conds.push(eq(studySessions.subjectId, filter.subjectId));
  return db
    .select({ s: studySessions, subjectName: subjects.name })
    .from(studySessions)
    .leftJoin(subjects, eq(subjects.id, studySessions.subjectId))
    .where(and(...conds))
    .orderBy(desc(studySessions.date), desc(studySessions.createdAt))
    .limit(filter.limit ?? 200)
    .then((r) => r.map((x) => ({ ...x.s, subjectName: x.subjectName })));
}
async function isGermanSubject(userId: string, subjectId: string) {
  const [s] = await db.select({ slug: subjects.slug }).from(subjects).where(and(eq(subjects.id, subjectId), eq(subjects.userId, userId))).limit(1);
  return s?.slug === GERMAN_SUBJECT_SLUG;
}

/** Plain insert with no cross-module effects. Only the German bridge should call this directly; everything else goes through logStudySession. */
export async function insertStudySession(userId: string, input: Omit<z.infer<typeof studySessionSchema>, "subject"> & { subjectId: string | null }, tz?: string) {
  const [s] = await db.insert(studySessions).values({ ...input, userId, date: input.date ?? todayKey(tz) }).returning();
  return s;
}

/**
 * Log a study session. German has a single source of truth: when the subject is the German subject
 * (by id, slug or name) the session is recorded through the German bridge (`recordGermanEvent`), so a
 * session logged from Studies or by the AI produces exactly the same state (german_events → study_session
 * → goal progress) as a lesson done in the German module. Never two paths, never two rows.
 */
export async function logStudySession(userId: string, input: z.infer<typeof studySessionSchema>, tz?: string) {
  const subjectId = await resolveSubject(userId, input);
  const { subject: _s, ...rest } = input;
  if (subjectId && (await isGermanSubject(userId, subjectId))) {
    const r = await recordGermanEvent(
      userId,
      { kind: "session", label: rest.topic ?? null, durationSec: rest.durationMinutes * 60, data: rest.notes ? { notes: rest.notes } : undefined },
      tz,
      { source: rest.source, date: rest.date, startedAt: rest.startedAt, notes: rest.notes, subjectId },
    );
    if (!r.session) throw badRequest("German study session could not be recorded");
    return r.session;
  }
  return insertStudySession(userId, { ...rest, subjectId }, tz);
}
export async function deleteStudySession(userId: string, id: string) {
  await db.delete(studySessions).where(and(eq(studySessions.id, id), eq(studySessions.userId, userId)));
}

export async function studyProgress(userId: string, range: { from: string; to: string }) {
  const rows = await db
    .select({ subjectId: studySessions.subjectId, subjectName: subjects.name, minutes: sql<number>`sum(${studySessions.durationMinutes})`, sessions: sql<number>`count(*)`, days: sql<number>`count(distinct ${studySessions.date})`, weeklyGoal: subjects.weeklyGoalMinutes })
    .from(studySessions)
    .leftJoin(subjects, eq(subjects.id, studySessions.subjectId))
    .where(and(eq(studySessions.userId, userId), gte(studySessions.date, range.from), lte(studySessions.date, range.to)))
    .groupBy(studySessions.subjectId, subjects.name, subjects.weeklyGoalMinutes);
  const bySubject = rows.map((r) => ({ subjectId: r.subjectId, name: r.subjectName ?? "Unassigned", minutes: Number(r.minutes), sessions: Number(r.sessions), days: Number(r.days), weeklyGoalMinutes: r.weeklyGoal }));
  const totalMinutes = bySubject.reduce((a, b) => a + b.minutes, 0);
  const daily = await db
    .select({ date: studySessions.date, minutes: sql<number>`sum(${studySessions.durationMinutes})` })
    .from(studySessions)
    .where(and(eq(studySessions.userId, userId), gte(studySessions.date, range.from), lte(studySessions.date, range.to)))
    .groupBy(studySessions.date)
    .orderBy(asc(studySessions.date));
  return { range, totalMinutes, bySubject, daily: daily.map((d) => ({ date: d.date, minutes: Number(d.minutes) })), source: "calculated" as const };
}

export async function listAssignments(userId: string, onlyOpen = true) {
  const conds = [eq(assignments.userId, userId)];
  if (onlyOpen) conds.push(sql`${assignments.completedAt} is null`);
  return db.select({ a: assignments, subjectName: subjects.name }).from(assignments).leftJoin(subjects, eq(subjects.id, assignments.subjectId)).where(and(...conds)).orderBy(asc(assignments.dueDate)).then((r) => r.map((x) => ({ ...x.a, subjectName: x.subjectName })));
}
export async function createAssignment(userId: string, input: z.infer<typeof assignmentSchema>) {
  const [a] = await db.insert(assignments).values({ ...input, userId }).returning();
  return a;
}
export async function updateAssignment(userId: string, id: string, input: Partial<z.infer<typeof assignmentSchema>> & { completed?: boolean }) {
  const { completed, ...rest } = input;
  const [a] = await db.update(assignments).set({ ...rest, ...(completed !== undefined ? { completedAt: completed ? new Date() : null } : {}) }).where(and(eq(assignments.id, id), eq(assignments.userId, userId))).returning();
  if (!a) throw notFound("Assignment");
  return a;
}
export async function deleteAssignment(userId: string, id: string) {
  await db.delete(assignments).where(and(eq(assignments.id, id), eq(assignments.userId, userId)));
}
export async function listExams(userId: string, upcomingOnly = false, tz?: string) {
  const conds = [eq(exams.userId, userId)];
  if (upcomingOnly) conds.push(gte(exams.date, todayKey(tz)));
  return db.select({ e: exams, subjectName: subjects.name }).from(exams).leftJoin(subjects, eq(subjects.id, exams.subjectId)).where(and(...conds)).orderBy(asc(exams.date)).then((r) => r.map((x) => ({ ...x.e, subjectName: x.subjectName })));
}
export async function createExam(userId: string, input: z.infer<typeof examSchema>) {
  const [e] = await db.insert(exams).values({ ...input, userId }).returning();
  return e;
}
export async function updateExam(userId: string, id: string, input: Partial<z.infer<typeof examSchema>>) {
  const [e] = await db.update(exams).set(input).where(and(eq(exams.id, id), eq(exams.userId, userId))).returning();
  if (!e) throw notFound("Exam");
  return e;
}
export async function deleteExam(userId: string, id: string) {
  await db.delete(exams).where(and(eq(exams.id, id), eq(exams.userId, userId)));
}
