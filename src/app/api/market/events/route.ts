import { json, parseBody, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { createEconomicEvent, econEventSchema, listEconomicEvents } from "@/server/services/market";
export const GET = withAuth(async (req, { user }) => { const q = query(req); const days = Number(q.days ?? 14); return json(await listEconomicEvents(user.id, { from: new Date(Date.now() - 86400e3), to: new Date(Date.now() + days * 86400e3) })); });
export const POST = withAuth(async (req, { user }) => json(await createEconomicEvent(user.id, await parseBody(req, econEventSchema)), { status: 201 }));
