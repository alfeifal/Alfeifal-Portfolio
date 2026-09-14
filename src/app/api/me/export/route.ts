import { withAuth } from "@/server/http";
import { exportAll } from "@/server/services/export";
export const GET = withAuth(async (_req, { user }) => new Response(JSON.stringify(await exportAll(user.id), null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="personal-os-export-${new Date().toISOString().slice(0, 10)}.json"` } }));
