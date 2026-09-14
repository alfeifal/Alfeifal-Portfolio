import { badRequest, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { CSV_DATASETS, csvFor } from "@/server/services/export";
export const GET = withAuth(async (req, { user }) => { const ds = query(req).dataset; if (!ds || !CSV_DATASETS.includes(ds)) throw badRequest(`dataset must be one of ${CSV_DATASETS.join(", ")}`); return new Response(await csvFor(user.id, ds), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${ds}-${new Date().toISOString().slice(0, 10)}.csv"` } }); });
