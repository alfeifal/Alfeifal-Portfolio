import { z } from "zod";
import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { conversationRetention, resumeConversation } from "@/server/services/conversations";

/**
 * What the assistant should show on mount. `id` is the pointer the browser remembered; if it is missing,
 * unknown or expired the most recent living conversation is returned instead, and `null` means start fresh.
 * A static segment, so it never collides with /api/ai/conversations/[id].
 */
export const GET = withAuth(async (req, { user }) => {
  const id = z.string().uuid().safeParse(query(req).id);
  const conversation = await resumeConversation(user.id, id.success ? id.data : null);
  return json({ conversation, retention: await conversationRetention(user.id) });
});
