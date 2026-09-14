import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { bootstrapUserData } from "@/server/services/bootstrap";
import { eq } from "drizzle-orm";

export async function createTestUser(suffix = Math.random().toString(36).slice(2, 8)) {
  const [u] = await db.insert(users).values({ email: `test-${suffix}@example.com`, name: "Test", passwordHash: await hashPassword("correct horse battery"), timezone: "Europe/Madrid" }).returning();
  await bootstrapUserData(u.id);
  return u;
}
export async function deleteTestUser(id: string) {
  await db.delete(users).where(eq(users.id, id));
}
