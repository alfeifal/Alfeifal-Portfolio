import { json, parseBody, withAuth } from "@/server/http";
import { createLesson, lessonSchema, listLessons } from "@/server/services/academy";
export const GET = withAuth(async (_req, { user }) => json(await listLessons(user.id)));
export const POST = withAuth(async (req, { user }) => json(await createLesson(user.id, await parseBody(req, lessonSchema)), { status: 201 }));
