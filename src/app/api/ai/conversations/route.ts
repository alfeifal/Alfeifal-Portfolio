import { json, withAuth } from "@/server/http";
import { listActiveConversations } from "@/server/services/conversations";
/** Only conversations still inside their 24 h window; expired transcripts are never listed. */
export const GET = withAuth(async (_req, { user }) => json(await listActiveConversations(user.id)));
