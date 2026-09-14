import { json, parseBody, withAuth } from "@/server/http";
import { addProjectMilestone } from "@/server/services/projects";
import { milestoneSchema } from "@/server/services/goals";
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => json(await addProjectMilestone(user.id, params.id, await parseBody(req, milestoneSchema)), { status: 201 }));
