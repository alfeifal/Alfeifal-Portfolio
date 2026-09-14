import { json, parseBody, withAuth } from "@/server/http";
import { germanEventSchema, recordGermanEvent } from "@/server/services/german";
export const POST = withAuth(async (req, { user }) => json(await recordGermanEvent(user.id, await parseBody(req, germanEventSchema), user.timezone), { status: 201 }));
