import { json, parseBody, withAuth } from "@/server/http";
import { audit } from "@/server/audit";
import { notesSchema, setUserNotes } from "@/server/services/reviews";

/** The user's own notes. Stored apart from the metrics; nothing else on the review is touched. */
export const PUT = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { userNotes } = await parseBody(req, notesSchema);
  const row = await setUserNotes(user.id, params.id, userNotes);
  await audit({ userId: user.id, actor: "user", action: "review.notes_updated", entityType: "review", entityId: params.id, metadata: { cleared: userNotes == null } });
  return json(row);
});
