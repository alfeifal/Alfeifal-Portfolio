import { json, parseBody, withAuth } from "@/server/http";
import { createExercise, exerciseSchema, listExercises } from "@/server/services/training";
export const GET = withAuth(async (_req, { user }) => json(await listExercises(user.id)));
export const POST = withAuth(async (req, { user }) => json(await createExercise(user.id, await parseBody(req, exerciseSchema)), { status: 201 }));
