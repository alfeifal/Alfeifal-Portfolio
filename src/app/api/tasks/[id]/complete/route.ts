import { json, withAuth } from "@/server/http";
import { completeTask } from "@/server/services/tasks";
import { audit } from "@/server/audit";
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  const r = await completeTask(user.id, params.id);
  await audit({ userId: user.id, actor: "user", action: "tasks.complete", entityId: params.id });
  return json(r);
});
