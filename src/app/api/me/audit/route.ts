import { desc, eq } from "drizzle-orm";
import { json, withAuth } from "@/server/http";
import { db } from "@/server/db";
import { auditLogs } from "@/server/db/schema";
export const GET = withAuth(async (_req, { user }) => json(await db.select().from(auditLogs).where(eq(auditLogs.userId, user.id)).orderBy(desc(auditLogs.createdAt)).limit(200)));
