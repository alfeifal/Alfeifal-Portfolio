import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { getSession, lastPerformance, seedRoutine, workoutForDate } from "@/server/services/training";
import { todayKey } from "@/lib/dates";
export const GET = withAuth(async (req, { user }) => {
  const date = query(req).date ?? todayKey(user.timezone);
  let w = await workoutForDate(user.id, date);
  if (!w) { await seedRoutine(user.id); w = await workoutForDate(user.id, date); }
  if (!w) return json(null);
  const last = w.day ? await lastPerformance(user.id, w.day.exercises.map((e) => e.exerciseId), w.session?.id) : {};
  const session = w.session ? await getSession(user.id, w.session.id) : null;
  return json({ ...w, date, lastPerformance: last, session });
});
