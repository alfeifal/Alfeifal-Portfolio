import { z } from "zod";
import { json, parseQuery, withAuth } from "@/server/http";
import { globalSearch, MAX_LIMIT, MAX_QUERY_LENGTH, SEARCH_MODULES } from "@/server/services/search";

/**
 * Global search. Read-only and strictly scoped to the session's user.
 *
 * The only inputs are a query string, two caps and an optional module filter drawn from a fixed list.
 * There is deliberately no way to pass a userId, a table, a column, an ordering or any SQL: the schema
 * below is the whole surface, and anything else in the query string is ignored.
 */
const paramsSchema = z.object({
  q: z.string().max(MAX_QUERY_LENGTH, `A search query cannot be longer than ${MAX_QUERY_LENGTH} characters`).default(""),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  perEntity: z.coerce.number().int().min(1).max(20).optional(),
  modules: z.string().optional().transform((v) => v?.split(",").map((m) => m.trim()).filter(Boolean))
    .pipe(z.array(z.enum(SEARCH_MODULES)).max(SEARCH_MODULES.length).optional()),
});

export const GET = withAuth(async (req, { user }) => {
  const { q, limit, perEntity, modules } = parseQuery(req, paramsSchema);
  return json(await globalSearch(user.id, q, { limit, perEntity, modules }));
});
