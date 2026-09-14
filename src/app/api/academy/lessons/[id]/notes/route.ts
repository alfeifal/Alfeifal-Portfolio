import { z } from "zod";
import { json, parseBody, withAuth } from "@/server/http";
import { setLessonNotes } from "@/server/services/academy";
export const PUT = withAuth<{ id: string }>(async (req, { user, params }) => { const { notes } = await parseBody(req, z.object({ notes: z.string().max(20000) })); return json(await setLessonNotes(user.id, params.id, notes)); });
