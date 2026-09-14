import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { events, exams, goals, journalEntries, marketNews, projects, studySessions, tasks, trades, transactions, workoutSessions, exercises, subjects } from "@/server/db/schema";
import { UNITS, CONCEPTS, VOCAB } from "@/modules/german/content";

export interface SearchHit { type: string; id: string; title: string; subtitle?: string | null; href: string; date?: string | null }

/** Global search across every module (spec §32). Uses ILIKE — good enough for a single user's data. */
export async function globalSearch(userId: string, q: string, limit = 8): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const [t, e, tx, g, p, j, s, w, tr, ex, n, sub] = await Promise.all([
    db.select().from(tasks).where(and(eq(tasks.userId, userId), sql`(${tasks.title} ilike ${like} or ${tasks.description} ilike ${like})`)).orderBy(desc(tasks.createdAt)).limit(limit),
    db.select().from(events).where(and(eq(events.userId, userId), sql`(${events.title} ilike ${like} or ${events.description} ilike ${like})`)).orderBy(desc(events.startAt)).limit(limit),
    db.select().from(transactions).where(and(eq(transactions.userId, userId), sql`(${transactions.description} ilike ${like} or ${transactions.merchant} ilike ${like})`)).orderBy(desc(transactions.date)).limit(limit),
    db.select().from(goals).where(and(eq(goals.userId, userId), sql`(${goals.name} ilike ${like} or ${goals.description} ilike ${like})`)).limit(limit),
    db.select().from(projects).where(and(eq(projects.userId, userId), sql`(${projects.name} ilike ${like} or ${projects.description} ilike ${like} or ${projects.notes} ilike ${like})`)).limit(limit),
    db.select().from(journalEntries).where(and(eq(journalEntries.userId, userId), sql`(${journalEntries.title} ilike ${like} or ${journalEntries.content} ilike ${like})`)).orderBy(desc(journalEntries.date)).limit(limit),
    db.select().from(studySessions).where(and(eq(studySessions.userId, userId), sql`(${studySessions.topic} ilike ${like} or ${studySessions.notes} ilike ${like})`)).orderBy(desc(studySessions.date)).limit(limit),
    db.select().from(workoutSessions).where(and(eq(workoutSessions.userId, userId), sql`(${workoutSessions.dayName} ilike ${like} or ${workoutSessions.notes} ilike ${like})`)).orderBy(desc(workoutSessions.date)).limit(limit),
    db.select().from(trades).where(and(eq(trades.userId, userId), sql`(${trades.symbol} ilike ${like} or ${trades.notes} ilike ${like} or ${trades.setup} ilike ${like})`)).orderBy(desc(trades.createdAt)).limit(limit),
    db.select().from(exercises).where(and(eq(exercises.userId, userId), sql`${exercises.name} ilike ${like}`)).limit(limit),
    db.select().from(marketNews).where(sql`${marketNews.headline} ilike ${like}`).orderBy(desc(marketNews.publishedAt)).limit(limit),
    db.select().from(exams).where(and(eq(exams.userId, userId), sql`${exams.title} ilike ${like}`)).limit(limit),
  ]);
  const hits: SearchHit[] = [
    ...t.map((x) => ({ type: "task", id: x.id, title: x.title, subtitle: x.status, href: `/tasks?focus=${x.id}`, date: x.dueDate })),
    ...e.map((x) => ({ type: "event", id: x.id, title: x.title, subtitle: x.kind, href: `/calendar?date=${x.startAt.toISOString().slice(0, 10)}`, date: x.startAt.toISOString() })),
    ...tx.map((x) => ({ type: "transaction", id: x.id, title: x.description || x.merchant || x.type, subtitle: `${x.type} ${x.amount} ${x.currency}`, href: `/finance?focus=${x.id}`, date: x.date })),
    ...g.map((x) => ({ type: "goal", id: x.id, title: x.name, subtitle: `${x.progress}% · ${x.status}`, href: `/goals/${x.id}` })),
    ...p.map((x) => ({ type: "project", id: x.id, title: x.name, subtitle: x.status, href: `/projects/${x.id}` })),
    ...j.map((x) => ({ type: "journal", id: x.id, title: x.title ?? x.content.slice(0, 60), subtitle: x.kind, href: `/journal?focus=${x.id}`, date: x.date })),
    ...s.map((x) => ({ type: "study", id: x.id, title: x.topic ?? "Study session", subtitle: `${x.durationMinutes} min`, href: `/studies`, date: x.date })),
    ...w.map((x) => ({ type: "workout", id: x.id, title: x.dayName ?? "Workout", href: `/training/sessions/${x.id}`, date: x.date })),
    ...tr.map((x) => ({ type: "trade", id: x.id, title: `${x.symbol} ${x.direction}`, subtitle: `${x.mode} · ${x.status}`, href: `/trading/journal/${x.id}` })),
    ...ex.map((x) => ({ type: "exercise", id: x.id, title: x.name, subtitle: x.anatomicalTarget, href: `/training/exercises/${x.id}` })),
    ...n.map((x) => ({ type: "news", id: x.id, title: x.headline, subtitle: x.source, href: x.url, date: x.publishedAt.toISOString() })),
    ...sub.map((x) => ({ type: "exam", id: x.id, title: x.title, href: "/studies", date: x.date })),
  ];
  // German content (in-code source of truth)
  const nq = term.toLowerCase();
  for (const u of UNITS) if (u.title.toLowerCase().includes(nq) || u.titleDe?.toLowerCase().includes(nq)) hits.push({ type: "german_unit", id: u.id, title: `U${u.number} ${u.title}`, subtitle: u.cefr, href: `/german/curso/${u.id}` });
  for (const c of CONCEPTS.slice(0, 200)) if (c.name.toLowerCase().includes(nq) || c.nameEs.toLowerCase().includes(nq)) hits.push({ type: "german_concept", id: c.id, title: c.name, subtitle: c.nameEs, href: `/german/gramatica/${c.id}` });
  for (const v of VOCAB) if (v.de.toLowerCase().includes(nq) || v.es.toLowerCase().includes(nq)) { hits.push({ type: "german_vocab", id: v.id, title: `${v.article ? v.article + " " : ""}${v.de}`, subtitle: v.es, href: `/german/vocabulario` }); if (hits.length > 80) break; }
  void subjects;
  return hits.slice(0, 60);
}
