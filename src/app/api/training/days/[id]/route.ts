import { z } from "zod";
import { json, parseBody, withAuth } from "@/server/http";
import { updateDay } from "@/server/services/training";
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => json(await updateDay(user.id, params.id, await parseBody(req, z.object({ name: z.string().min(1).max(60).optional(), focus: z.array(z.string()).optional(), notes: z.string().nullish(), isRest: z.boolean().optional() })))));
