import { randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, ilike, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { sessions, users } from "@/server/db/schema";
import { AppError, badRequest, notFound } from "@/server/http";
import { hashPassword } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { destroyAllSessions } from "@/server/auth/session";
import { insertUser, signupSchema } from "./users";
import { bootstrapUserData } from "./bootstrap";
import { deleteAccountAndData } from "./export";

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

/**
 * Escapes the characters `ILIKE` treats as wildcards, so a search for `100%` looks for the text
 * `100%` instead of matching every row. Without this a user could not be found by any name or address
 * containing `%` or `_`, and `%` alone would silently mean "everything".
 */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

export const listUsersSchema = z.object({ q: z.string().max(200).optional() });

/**
 * The account list, optionally narrowed by a substring of the name or the email address.
 *
 * Search exists because the panel is a list with no paging: at two accounts it is decoration, at fifty
 * it is the only way to find one. It matches the two identifiers an administrator actually knows —
 * never anything from inside an account.
 */
export function listUsers(opts: { q?: string } = {}) {
  const q = opts.q?.trim();
  const rows = db.select(adminUserColumns).from(users);
  if (!q) return rows.orderBy(desc(users.createdAt));
  const pattern = `%${likeEscape(q)}%`;
  return rows.where(or(ilike(users.name, pattern), ilike(users.email, pattern))).orderBy(desc(users.createdAt));
}

/**
 * How many live sessions each account holds, so "revoke sessions" can say what it is about to end and
 * an administrator can see at a glance that a deactivated account really is signed out everywhere.
 *
 * A count of rows in `sessions`, nothing more: no token, no IP, no user agent, no hint of what anybody
 * did with the session. Expired rows are excluded rather than waited on — the cron purges them nightly,
 * but a session that expired an hour ago is already dead and would otherwise be reported as live.
 */
export async function sessionCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ userId: sessions.userId, n: count() })
    .from(sessions)
    .where(gt(sessions.expiresAt, new Date()))
    .groupBy(sessions.userId);
  return Object.fromEntries(rows.map((r) => [r.userId, Number(r.n)]));
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

/**
 * Issues a fresh temporary password.
 *
 * This is the whole password recovery story on this instance, and it is deliberate: there is no email
 * infrastructure here, so there is no reset link to send and pretending otherwise would be worse than
 * having nothing. Somebody who cannot get in asks the administrator, who hands over a new password on
 * a channel they both trust — exactly the flow account creation already uses.
 *
 * Three things happen together, and all three matter: the old hash is replaced, so whatever the account
 * had is void; `mustChangePassword` is set, so this password can only be used to choose another one;
 * and every live session is destroyed, because a reset whose point is "I have lost control of this
 * account" is worthless if the sessions that control it survive.
 *
 * The new password is returned once and is never logged, never audited and never stored unhashed.
 */
export async function resetUserPassword(admin: { id: string }, id: string, ip?: string | null) {
  const target = await getUser(id);
  const password = temporaryPassword();
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: true, updatedAt: new Date() })
    .where(eq(users.id, id));
  await destroyAllSessions(id);
  await audit({ userId: admin.id, actor: "user", action: "admin.user.password_reset", entityType: "user", entityId: id, metadata: { email: target.email }, ip });
  return { user: await getUser(id), temporaryPassword: password };
}

/**
 * Ends every live session without touching the account otherwise.
 *
 * Deactivation already does this, but deactivation is a punishment for the account; this is for the
 * ordinary case of a lost laptop or a shared computer, where the account is fine and only its open
 * sessions are the problem. The owner signs in again with the password they already have.
 *
 * Refused on yourself: it would sign you out of the very page you clicked it on, and Settings already
 * offers "sign out other devices", which does the same thing while keeping you where you are.
 */
export async function revokeUserSessions(admin: { id: string }, id: string, ip?: string | null) {
  const target = await getUser(id);
  if (target.id === admin.id) throw badRequest("Use Settings to sign out your own other devices");
  const before = (await sessionCounts())[id] ?? 0;
  await destroyAllSessions(id);
  await audit({ userId: admin.id, actor: "user", action: "admin.user.sessions_revoke", entityType: "user", entityId: id, metadata: { email: target.email, sessions: before }, ip });
  return { user: target, revoked: before };
}

/**
 * Every table that dies with the account, in the order the UI reads best.
 *
 * This list is what makes deletion honest: the confirmation names what is about to be destroyed, and
 * it can only do that from real counts. It is checked against the schema by a test, so a table added
 * later cannot quietly go unmentioned while still being deleted.
 */
const DELETION_TABLES = [
  ["Tasks", schema.tasks], ["Calendar events", schema.events], ["Goals", schema.goals],
  ["Milestones", schema.milestones], ["Projects", schema.projects], ["Journal entries", schema.journalEntries],
  ["Transactions", schema.transactions], ["Accounts", schema.accounts], ["Budgets", schema.budgets],
  ["Savings goals", schema.savingsGoals], ["Recurring transactions", schema.recurringTransactions],
  ["Investment transactions", schema.investmentTransactions], ["Portfolio snapshots", schema.portfolioSnapshots],
  ["Trades", schema.trades], ["Watchlist items", schema.watchlistItems], ["Price alerts", schema.priceAlerts],
  ["Workout sessions", schema.workoutSessions], ["Sets logged", schema.workoutSets], ["Personal records", schema.personalRecords],
  ["Nutrition entries", schema.nutritionEntries], ["Study sessions", schema.studySessions],
  ["Assignments", schema.assignments], ["Exams", schema.exams], ["German events", schema.germanEvents],
  ["Reviews", schema.aiReports], ["Assistant memories", schema.aiMemory], ["Assistant actions", schema.aiActionLogs],
  ["Conversations", schema.conversations], ["Notifications", schema.notifications],
] as const;

/**
 * What deleting this account would destroy, as row counts per module.
 *
 * Counts, never contents. An administrator may know that an account has 412 transactions — that is the
 * consequence of the button they are about to press, and refusing to say it would only mean deleting
 * blind. They still cannot see a single one of them, here or anywhere else in the panel.
 *
 * Rows with nothing in them are dropped, so the confirmation lists what actually exists.
 */
export async function deletionSummary(id: string) {
  const user = await getUser(id);
  const counts = await Promise.all(
    DELETION_TABLES.map(async ([label, table]) => {
      const [{ n }] = await db.select({ n: count() }).from(table).where(eq(table.userId, id));
      return { label, n: Number(n) };
    }),
  );
  const items = counts.filter((c) => c.n > 0);
  return { user, items, total: items.reduce((a, c) => a + c.n, 0) };
}

/**
 * Deletes an account and everything that cascades from it. There is no undo and no recycle bin.
 *
 * The two refusals mirror the ones already on deactivation and demotion, because a delete that walked
 * past them would reach the same dead end by a different road: you cannot delete yourself from here
 * (Settings does that, behind your own password, which is the consent this page cannot ask for), and
 * you cannot remove the last active administrator, which would leave the instance with accounts nobody
 * can administer.
 *
 * The audit row is written first and belongs to the *administrator*, so it survives the deletion that
 * would have cascaded away a row belonging to the target.
 */
export async function deleteUserAsAdmin(admin: { id: string }, id: string, ip?: string | null) {
  const target = await getUser(id);
  if (target.id === admin.id) throw badRequest("Delete your own account from Settings, where it asks for your password");
  if (target.role === "admin" && target.isActive && (await activeAdminCount()) <= 1) throw badRequest("This is the last active administrator");
  const summary = await deletionSummary(id);
  await audit({
    userId: admin.id, actor: "user", action: "admin.user.delete", entityType: "user", entityId: id,
    metadata: { email: target.email, role: target.role, rows: summary.total }, ip,
  });
  await deleteAccountAndData(id);
  return { deleted: { id: target.id, email: target.email }, rows: summary.total };
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
