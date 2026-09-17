import { randomBytes } from "node:crypto";
import { and, count, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { AppError, badRequest, notFound } from "@/server/http";
import { audit } from "@/server/audit";
import { destroyAllSessions } from "@/server/auth/session";
import { insertUser, signupSchema } from "./users";
import { bootstrapUserData } from "./bootstrap";

/**
 * Account administration.
 *
 * This module manages *accounts*, never their contents. Nothing here reads a task, a transaction, a
 * workout or a memory, and there is no impersonation: an administrator who opens the Personal OS sees
 * their own data like everybody else, because every user-scoped query is filtered by the session's own
 * user id and that is the only identity the app has.
 */

/** What the admin list may show. Password hashes and session tokens never leave the database. */
export const adminUserColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  isActive: users.isActive,
  deactivatedAt: users.deactivatedAt,
  lastLoginAt: users.lastLoginAt,
  mustChangePassword: users.mustChangePassword,
  timezone: users.timezone,
  currency: users.currency,
  createdAt: users.createdAt,
};
export type AdminUser = { [K in keyof typeof adminUserColumns]: (typeof adminUserColumns)[K]["_"]["data"] };

export function listUsers() {
  return db.select(adminUserColumns).from(users).orderBy(desc(users.createdAt));
}

export async function getUser(id: string) {
  const [u] = await db.select(adminUserColumns).from(users).where(eq(users.id, id));
  if (!u) throw notFound("User");
  return u;
}

export const createUserSchema = z.object({
  email: signupSchema.shape.email,
  name: signupSchema.shape.name,
  role: z.enum(["admin", "user"]).default("user"),
  timezone: z.string().max(64).optional(),
  currency: z.string().length(3).optional(),
  /** Optional: when omitted a strong temporary password is generated and returned once. */
  password: z.string().min(10).max(200).optional(),
});

/**
 * Generates a temporary password with the same source of randomness the session tokens use.
 * It is returned to the administrator exactly once, in the create response, and never logged,
 * never audited and never stored in any form but the scrypt hash `insertUser` writes.
 */
export function temporaryPassword() {
  return randomBytes(12).toString("base64url");
}

export async function createUserAsAdmin(admin: { id: string }, input: z.infer<typeof createUserSchema>, ip?: string | null) {
  const password = input.password ?? temporaryPassword();
  // The administrator knows this password, whether it was generated here or typed by them, so the
  // account cannot do anything until it has been replaced.
  const user = await insertUser({ email: input.email, name: input.name, password, role: input.role, timezone: input.timezone, currency: input.currency, mustChangePassword: true });
  // Same structural defaults a self-registered account gets: categories, a cash account, the German
  // subject, a paper trading account, a watchlist and the training routine template. No activity data,
  // and nothing copied from the administrator.
  await bootstrapUserData(user.id);
  await audit({ userId: admin.id, actor: "user", action: "admin.user.create", entityType: "user", entityId: user.id, metadata: { email: user.email, role: user.role, generatedPassword: !input.password }, ip });
  return { user: await getUser(user.id), temporaryPassword: input.password ? null : password };
}

export const setActiveSchema = z.object({ isActive: z.boolean() });

export async function setUserActive(admin: { id: string }, id: string, isActive: boolean, ip?: string | null) {
  const target = await getUser(id);
  if (target.id === admin.id && !isActive) throw badRequest("You cannot deactivate your own account");
  if (!isActive && target.role === "admin" && (await activeAdminCount()) <= 1) throw badRequest("This is the last active administrator");
  if (target.isActive === isActive) return target;
  await db.update(users).set({ isActive, deactivatedAt: isActive ? null : new Date(), updatedAt: new Date() }).where(eq(users.id, id));
  // Deactivating ends the account's live sessions immediately; the data itself is untouched.
  if (!isActive) await destroyAllSessions(id);
  await audit({ userId: admin.id, actor: "user", action: isActive ? "admin.user.reactivate" : "admin.user.deactivate", entityType: "user", entityId: id, metadata: { email: target.email }, ip });
  return getUser(id);
}

export const setRoleSchema = z.object({ role: z.enum(["admin", "user"]) });

export async function setUserRole(admin: { id: string }, id: string, role: "admin" | "user", ip?: string | null) {
  const target = await getUser(id);
  if (target.id === admin.id && role !== "admin") throw badRequest("You cannot remove your own administrator role");
  if (role === "user" && target.role === "admin" && (await activeAdminCount()) <= 1) throw badRequest("This is the last active administrator");
  if (target.role === role) return target;
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id));
  await audit({ userId: admin.id, actor: "user", action: "admin.user.role", entityType: "user", entityId: id, metadata: { email: target.email, from: target.role, to: role }, ip });
  return getUser(id);
}

/** Guards the two ways an instance could be left with nobody able to administer it. */
export async function activeAdminCount() {
  const [{ n }] = await db.select({ n: count() }).from(users).where(and(eq(users.role, "admin"), eq(users.isActive, true)));
  return Number(n);
}

/** Counts for the admin header. Aggregate account state only — never anybody's module data. */
export async function adminStats() {
  const [total] = await db.select({ n: count() }).from(users);
  const [active] = await db.select({ n: count() }).from(users).where(eq(users.isActive, true));
  const [admins] = await db.select({ n: count() }).from(users).where(eq(users.role, "admin"));
  const [others] = await db.select({ n: count() }).from(users).where(ne(users.role, "admin"));
  return { total: Number(total.n), active: Number(active.n), admins: Number(admins.n), users: Number(others.n) };
}

/** Thrown by the API layer when a non-administrator reaches an admin route. */
export const forbiddenAdmin = () => new AppError(403, "Administrator access required");
