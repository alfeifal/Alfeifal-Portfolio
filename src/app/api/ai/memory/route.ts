import { json, parseBody, withAuth } from "@/server/http";
import { listMemory, memorySchema, rememberMemory } from "@/server/services/memory";
export const GET = withAuth(async (_req, { user }) => json(await listMemory(user.id)));
export const POST = withAuth(async (req, { user }) => json(await rememberMemory(user.id, { ...(await parseBody(req, memorySchema)), source: "user" }), { status: 201 }));
