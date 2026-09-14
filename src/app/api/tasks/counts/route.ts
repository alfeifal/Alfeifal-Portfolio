import { json, withAuth } from "@/server/http";
import { taskCounts } from "@/server/services/tasks";
export const GET = withAuth(async (_req, { user }) => json(await taskCounts(user.id, user.timezone)));
