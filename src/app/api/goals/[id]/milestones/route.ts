import { json, parseBody, withAuth } from "@/server/http";
import { addMilestone, milestoneSchema } from "@/server/services/goals";
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => json(await addMilestone(user.id, params.id, await parseBody(req, milestoneSchema)), { status: 201 }));
