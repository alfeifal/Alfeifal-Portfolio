import { json, parseBody, withAuth } from "@/server/http";
import { deleteMilestone, milestoneUpdateSchema, updateMilestone } from "@/server/services/goals";

/** Edits a milestone: title, due date, order, or done. Ownership is enforced in the service's WHERE. */
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) =>
  json(await updateMilestone(user.id, params.id, await parseBody(req, milestoneUpdateSchema))));

export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => json(await deleteMilestone(user.id, params.id)));
