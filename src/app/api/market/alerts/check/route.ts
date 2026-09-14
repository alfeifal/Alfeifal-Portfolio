import { json, withAuth } from "@/server/http";
import { checkAlerts } from "@/server/services/market";
export const POST = withAuth(async (_req, { user }) => json({ fired: await checkAlerts(user.id) }), { limit: "market" });
