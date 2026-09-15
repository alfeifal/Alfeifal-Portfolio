import { z } from "zod";
import { json, parseBody, withAuth } from "@/server/http";
import { acceptPlan } from "@/server/services/planner";

/**
 * Accepting is the user's explicit action and the only path that turns a proposal into real tasks and
 * events. No AI tool can reach it. The response reports every item individually, including failures.
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { itemIds } = await parseBody(req, z.object({ itemIds: z.array(z.string().uuid()).max(60).optional() }));
  return json(await acceptPlan(user, params.id, { itemIds }));
});
