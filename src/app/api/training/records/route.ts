import { json, withAuth } from "@/server/http";
import { listPersonalRecords } from "@/server/services/training";
export const GET = withAuth(async (_req, { user }) => json(await listPersonalRecords(user.id)));
