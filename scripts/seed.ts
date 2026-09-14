import "dotenv/config";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { seedRoutine } from "@/server/services/training";

/** Re-seeds the attached training routine for a user (idempotent). Usage: pnpm db:seed user@example.com */
async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("Usage: pnpm db:seed <email>");
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u) throw new Error("User not found");
  console.log("Routine plan id:", await seedRoutine(u.id));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
