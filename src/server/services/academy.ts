import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { academyLessons, academyProgress } from "@/server/db/schema";
import { notFound } from "@/server/http";

export const ACADEMY_TOPICS = [
  { id: "technical", name: "Technical analysis" },
  { id: "fundamental", name: "Fundamental analysis" },
  { id: "macro", name: "Macro" },
  { id: "structure", name: "Market structure" },
  { id: "risk", name: "Risk management" },
  { id: "psychology", name: "Psychology" },
  { id: "portfolio", name: "Portfolio management" },
  { id: "strategies", name: "Strategies" },
] as const;

export const lessonSchema = z.object({
  topic: z.enum(ACADEMY_TOPICS.map((t) => t.id) as [string, ...string[]]),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50000),
  position: z.number().int().min(0).default(0),
  quiz: z.array(z.object({ q: z.string().min(1), options: z.array(z.string()).min(2).max(6), answer: z.number().int().min(0), explanation: z.string().optional() })).max(30).default([]),
  source: z.enum(["user", "ai", "import"]).default("user"),
});

export async function listLessons(userId: string) {
  const lessons = await db.select().from(academyLessons).where(eq(academyLessons.userId, userId)).orderBy(asc(academyLessons.topic), asc(academyLessons.position), asc(academyLessons.createdAt));
  const progress = await db.select().from(academyProgress).where(eq(academyProgress.userId, userId));
  return lessons.map((l) => ({ ...l, progress: progress.find((p) => p.lessonId === l.id) ?? null }));
}
export async function getLesson(userId: string, id: string) {
  const [l] = await db.select().from(academyLessons).where(and(eq(academyLessons.id, id), eq(academyLessons.userId, userId)));
  if (!l) throw notFound("Lesson");
  const [p] = await db.select().from(academyProgress).where(and(eq(academyProgress.userId, userId), eq(academyProgress.lessonId, id)));
  return { ...l, progress: p ?? null };
}
export async function createLesson(userId: string, input: z.infer<typeof lessonSchema>) {
  const [l] = await db.insert(academyLessons).values({ ...input, userId }).returning();
  return l;
}
export async function updateLesson(userId: string, id: string, input: Partial<z.infer<typeof lessonSchema>>) {
  const [l] = await db.update(academyLessons).set(input).where(and(eq(academyLessons.id, id), eq(academyLessons.userId, userId))).returning();
  if (!l) throw notFound("Lesson");
  return l;
}
export async function deleteLesson(userId: string, id: string) {
  await db.delete(academyLessons).where(and(eq(academyLessons.id, id), eq(academyLessons.userId, userId)));
}
export async function recordQuiz(userId: string, lessonId: string, score: number, notes?: string | null) {
  const [p] = await db.select().from(academyProgress).where(and(eq(academyProgress.userId, userId), eq(academyProgress.lessonId, lessonId)));
  const completed = score >= 70;
  if (!p) {
    const [c] = await db.insert(academyProgress).values({ userId, lessonId, attempts: 1, bestScore: score, completedAt: completed ? new Date() : null, lastReviewedAt: new Date(), notes: notes ?? null }).returning();
    return c;
  }
  const [u] = await db.update(academyProgress).set({ attempts: p.attempts + 1, bestScore: Math.max(p.bestScore ?? 0, score), completedAt: p.completedAt ?? (completed ? new Date() : null), lastReviewedAt: new Date(), ...(notes !== undefined ? { notes } : {}) }).where(eq(academyProgress.id, p.id)).returning();
  return u;
}
export async function setLessonNotes(userId: string, lessonId: string, notes: string) {
  const [p] = await db.select().from(academyProgress).where(and(eq(academyProgress.userId, userId), eq(academyProgress.lessonId, lessonId)));
  if (!p) { const [c] = await db.insert(academyProgress).values({ userId, lessonId, notes }).returning(); return c; }
  const [u] = await db.update(academyProgress).set({ notes }).where(eq(academyProgress.id, p.id)).returning();
  return u;
}
