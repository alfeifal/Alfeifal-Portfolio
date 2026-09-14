import { json, parseBody, withAuth } from "@/server/http";
import { addDayExercise, dayExerciseSchema } from "@/server/services/training";
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => json(await addDayExercise(user.id, params.id, await parseBody(req, dayExerciseSchema)), { status: 201 }));
