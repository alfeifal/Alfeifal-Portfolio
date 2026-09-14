import { z } from "zod";
import { json, parseBody, withAuth } from "@/server/http";
import { recordQuiz } from "@/server/services/academy";
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => { const { score } = await parseBody(req, z.object({ score: z.number().int().min(0).max(100) })); return json(await recordQuiz(user.id, params.id, score)); });
