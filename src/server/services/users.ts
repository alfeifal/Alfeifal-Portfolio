import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { AppError } from "@/server/http";

export const signupSchema = z.object({
  email: z.string().email().max(200).transform((s) => s.trim().toLowerCase()),
  name: z.string().min(1).max(100).transform((s) => s.trim()),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
  timezone: z.string().max(64).optional(),
  currency: z.string().length(3).optional(),
});
export const loginSchema = z.object({ email: z.string().email().transform((s) => s.trim().toLowerCase()), password: z.string().min(1).max(200) });

export async function userCount() {
  const [{ n }] = await db.select({ n: count() }).from(users);
  return Number(n);
}

export async function signupAllowed() {
  if ((await userCount()) === 0) return true;
  return process.env.ALLOW_SIGNUP === "true";
}

export async function createUser(input: z.infer<typeof signupSchema>) {
  if (!(await signupAllowed())) throw new AppError(403, "Sign-up is disabled on this private instance");
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (existing.length) throw new AppError(409, "An account with this email already exists");
  const passwordHash = await hashPassword(input.password);
  const [u] = await db
    .insert(users)
    .values({ email: input.email, name: input.name, passwordHash, timezone: input.timezone ?? process.env.DEFAULT_TIMEZONE ?? "Europe/Madrid", currency: input.currency ?? process.env.DEFAULT_CURRENCY ?? "EUR" })
    .returning();
  return u;
}

export async function authenticate(input: z.infer<typeof loginSchema>) {
  const [u] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  // Always run the hash to avoid timing leaks on unknown emails.
  const ok = await verifyPassword(input.password, u?.passwordHash ?? "scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  if (!u || !ok) throw new AppError(401, "Invalid email or password");
  return u;
}

export const profileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().max(64).optional(),
  currency: z.string().length(3).optional(),
  locale: z.string().max(10).optional(),
});
export async function updateProfile(userId: string, input: z.infer<typeof profileSchema>) {
  const [u] = await db.update(users).set({ ...input, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
  return u;
}

export const passwordChangeSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(200) });
export async function changePassword(userId: string, input: z.infer<typeof passwordChangeSchema>) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || !(await verifyPassword(input.currentPassword, u.passwordHash))) throw new AppError(400, "Current password is incorrect");
  await db.update(users).set({ passwordHash: await hashPassword(input.newPassword), updatedAt: new Date() }).where(eq(users.id, userId));
}

/** Preferences are a JSON document; patches are shallow-merged per top-level key. */
export async function getPreferences(userId: string) {
  const [u] = await db.select({ p: users.preferences }).from(users).where(eq(users.id, userId));
  return (u?.p ?? {}) as Record<string, unknown>;
}
export async function patchPreferences(userId: string, patch: Record<string, unknown>) {
  const current = await getPreferences(userId);
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v) && current[k] && typeof current[k] === "object" && !Array.isArray(current[k])) {
      next[k] = { ...(current[k] as object), ...(v as object) };
    } else next[k] = v;
  }
  await db.update(users).set({ preferences: next, updatedAt: new Date() }).where(eq(users.id, userId));
  return next;
}

export async function deleteUser(userId: string) {
  await db.delete(users).where(eq(users.id, userId));
}
