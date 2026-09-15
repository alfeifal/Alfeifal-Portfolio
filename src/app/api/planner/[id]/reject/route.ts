import { json, withAuth } from "@/server/http";
import { rejectPlan } from "@/server/services/planner";
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => json(await rejectPlan(user, params.id)));
