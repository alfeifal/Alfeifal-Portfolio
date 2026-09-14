import { json, parseBody, withAuth } from "@/server/http";
import { deleteLesson, getLesson, lessonSchema, updateLesson } from "@/server/services/academy";
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => json(await getLesson(user.id, params.id)));
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => json(await updateLesson(user.id, params.id, await parseBody(req, lessonSchema.partial()))));
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await deleteLesson(user.id, params.id); return json({ ok: true }); });
