import { json, parseBody, withAuth } from "@/server/http";
import { dayExerciseSchema, removeDayExercise, updateDayExercise } from "@/server/services/training";
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => json(await updateDayExercise(user.id, params.id, await parseBody(req, dayExerciseSchema.partial()))));
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await removeDayExercise(user.id, params.id); return json({ ok: true }); });
