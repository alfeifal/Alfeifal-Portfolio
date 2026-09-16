import { json, withAuth } from "@/server/http";
import { audit } from "@/server/audit";
import { deleteReview, getReview } from "@/server/services/reviews";

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => json(await getReview(user.id, params.id)));

export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => {
  const r = await deleteReview(user.id, params.id);
  await audit({ userId: user.id, actor: "user", action: "review.deleted", entityType: "review", entityId: params.id });
  return json(r);
});
