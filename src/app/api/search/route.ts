import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { globalSearch } from "@/server/services/search";
export const GET = withAuth(async (req, { user }) => json(await globalSearch(user.id, query(req).q ?? "")));
