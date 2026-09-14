import { desc, eq } from "drizzle-orm";
import { json, withAuth } from "@/server/http";
import { db } from "@/server/db";
import { conversations } from "@/server/db/schema";
export const GET = withAuth(async (_req, { user }) => json(await db.select().from(conversations).where(eq(conversations.userId, user.id)).orderBy(desc(conversations.updatedAt)).limit(50)));
