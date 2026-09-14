import { and, desc, eq } from "drizzle-orm";
import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { db } from "@/server/db";
import { aiActionLogs } from "@/server/db/schema";
export const GET = withAuth(async (req, { user }) => {
  const q = query(req);
  const conds = [eq(aiActionLogs.userId, user.id)];
  if (q.status) conds.push(eq(aiActionLogs.status, q.status as "success"));
  return json(await db.select().from(aiActionLogs).where(and(...conds)).orderBy(desc(aiActionLogs.createdAt)).limit(q.limit ? Number(q.limit) : 100));
});
