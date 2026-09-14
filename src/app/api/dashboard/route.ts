import { json, withAuth } from "@/server/http";
import { dashboardData } from "@/server/services/dashboard";
export const GET = withAuth(async (_req, { user }) => json(await dashboardData(user)));
