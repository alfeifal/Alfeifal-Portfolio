import { z } from "zod";
import { json, parseBody, withAuth } from "@/server/http";
import { getQuotes } from "@/server/services/market";
const schema = z.object({ symbols: z.array(z.object({ symbol: z.string().min(1).max(20), assetClass: z.enum(["stock", "etf", "crypto", "forex", "commodity", "index", "other"]).default("stock") })).min(1).max(30) });
export const POST = withAuth(async (req) => json(await getQuotes((await parseBody(req, schema)).symbols)), { limit: "market" });
