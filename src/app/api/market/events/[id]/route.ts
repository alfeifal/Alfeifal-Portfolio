import { json, withAuth } from "@/server/http";
import { deleteEconomicEvent } from "@/server/services/market";
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await deleteEconomicEvent(user.id, params.id); return json({ ok: true }); });
