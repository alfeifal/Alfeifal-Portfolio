import { json, withAuth } from "@/server/http";
import { confirmAction } from "@/server/ai/agent";
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => json(await confirmAction(user, params.id)));
