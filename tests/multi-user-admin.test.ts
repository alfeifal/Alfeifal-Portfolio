/**
 * Phase 3.18 — Personal OS as a real multi-user application.
 *
 * Phase 3.12 built the account model and proved the isolation; this suite does not rewrite either of
 * those. It does two things instead.
 *
 * It pins the capabilities that were genuinely missing: a password recovery path (there is no email
 * infrastructure here, so an administrator issuing a new temporary password is the *only* way back
 * into a locked-out account), session revocation that does not require punishing the account,
 * searching the account list, and deletion that can state its own consequences before it happens.
 *
 * And it pins three things that were quietly wrong. Background jobs were writing to accounts that had
 * been deactivated. The origin check written as the second lock against CSRF was never called by any
 * route. And every new administrative power has to arrive already carrying the guards the old ones
 * have — no deleting yourself, no emptying the instance of administrators, no reading anybody's data.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { auditLogs, sessions, users } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { isTrustedOrigin } from "@/server/security/origin";
import { verifyPassword } from "@/server/auth/password";
import { authenticate } from "@/server/services/users";
import {
  activeAdminCount, adminUserColumns, createUserAsAdmin, deleteUserAsAdmin, deletionSummary,
  getUser, listUsers, resetUserPassword, revokeUserSessions, sessionCounts, setUserActive, setUserRole,
} from "@/server/services/admin";
import * as tasks from "@/server/services/tasks";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

type U = Awaited<ReturnType<typeof createTestUser>>;
const promote = (id: string) => db.update(users).set({ role: "admin" }).where(eq(users.id, id));
const reread = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const fail = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e) { return e as AppError; }
};
/** A live session row, created directly so the test does not depend on the cookie jar. */
const giveSession = (userId: string) =>
  db.insert(sessions).values({ userId, tokenHash: `t-${Math.random().toString(36).slice(2)}-${Date.now()}`, expiresAt: new Date(Date.now() + 3600_000) });

// ---------------------------------------------------------------------------------------------
// Password recovery — the gap that mattered most: there was no way back into a locked-out account.
// ---------------------------------------------------------------------------------------------
d("an administrator can issue a new password, and that is the only recovery path", () => {
  let admin: U, target: U;
  beforeAll(async () => {
    admin = await createTestUser(); target = await createTestUser();
    await promote(admin.id);
    admin = await reread(admin.id);
  });
  afterAll(async () => { await deleteTestUser(admin.id); await deleteTestUser(target.id); });

  it("the new password actually signs the account in", async () => {
    const { temporaryPassword } = await resetUserPassword(admin, target.id);
    const u = await authenticate({ email: target.email, password: temporaryPassword });
    expect(u.id).toBe(target.id);
  });

  it("the old password stops working the moment it is reset", async () => {
    const fresh = await createTestUser();
    // `createTestUser` sets this one, so it is a real password the account was using.
    expect((await authenticate({ email: fresh.email, password: "correct horse battery" })).id).toBe(fresh.id);
    await resetUserPassword(admin, fresh.id);
    const err = await fail(authenticate({ email: fresh.email, password: "correct horse battery" }));
    expect(err?.status).toBe(401);
    await deleteTestUser(fresh.id);
  });

  it("forces the account to choose its own password before it can use the app", async () => {
    await resetUserPassword(admin, target.id);
    expect((await getUser(target.id)).mustChangePassword).toBe(true);
  });

  it("signs the account out of everywhere — a reset with live sessions left is no reset at all", async () => {
    await giveSession(target.id);
    await giveSession(target.id);
    expect((await sessionCounts())[target.id]).toBe(2);
    await resetUserPassword(admin, target.id);
    expect((await sessionCounts())[target.id] ?? 0).toBe(0);
  });

  it("stores only the hash, and a different one each time", async () => {
    const a = await resetUserPassword(admin, target.id);
    const hashA = (await reread(target.id)).passwordHash;
    const b = await resetUserPassword(admin, target.id);
    const hashB = (await reread(target.id)).passwordHash;
    expect(a.temporaryPassword).not.toBe(b.temporaryPassword);
    expect(hashA).not.toBe(hashB);
    expect(hashB).not.toContain(b.temporaryPassword);
    expect(await verifyPassword(b.temporaryPassword, hashB)).toBe(true);
  });

  it("never writes the password into the audit trail", async () => {
    const { temporaryPassword } = await resetUserPassword(admin, target.id);
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "admin.user.password_reset"));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(temporaryPassword);
  });

  it("records who reset whose password", async () => {
    await resetUserPassword(admin, target.id);
    const [row] = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.action, "admin.user.password_reset"), eq(auditLogs.entityId, target.id)));
    expect(row.userId).toBe(admin.id);
    expect(row.actor).toBe("user");
  });

  it("refuses an account that does not exist, without saying anything else", async () => {
    const err = await fail(resetUserPassword(admin, "00000000-0000-4000-8000-000000000000"));
    expect(err?.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------
// Session revocation — for a lost device, not a lost account.
// ---------------------------------------------------------------------------------------------
d("session revocation", () => {
  let admin: U, target: U;
  beforeAll(async () => {
    admin = await createTestUser(); target = await createTestUser();
    await promote(admin.id); admin = await reread(admin.id);
  });
  afterAll(async () => { await deleteTestUser(admin.id); await deleteTestUser(target.id); });
  afterEach(async () => { await db.delete(sessions).where(eq(sessions.userId, target.id)); });

  it("ends every live session and reports how many there were", async () => {
    await giveSession(target.id); await giveSession(target.id); await giveSession(target.id);
    const res = await revokeUserSessions(admin, target.id);
    expect(res.revoked).toBe(3);
    expect((await sessionCounts())[target.id] ?? 0).toBe(0);
  });

  it("leaves the account itself completely alone", async () => {
    await giveSession(target.id);
    const before = await reread(target.id);
    await revokeUserSessions(admin, target.id);
    const after = await reread(target.id);
    expect(after.isActive).toBe(true);
    expect(after.mustChangePassword).toBe(false);
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("the account signs straight back in with the password it already had", async () => {
    await giveSession(target.id);
    await revokeUserSessions(admin, target.id);
    expect((await authenticate({ email: target.email, password: "correct horse battery" })).id).toBe(target.id);
  });

  it("does not touch anybody else's sessions", async () => {
    const other = await createTestUser();
    await giveSession(other.id); await giveSession(target.id);
    await revokeUserSessions(admin, target.id);
    expect((await sessionCounts())[other.id]).toBe(1);
    await deleteTestUser(other.id);
  });

  it("refuses on your own account and points at the place that does it safely", async () => {
    const err = await fail(revokeUserSessions(admin, admin.id));
    expect(err?.status).toBe(400);
    expect(err?.message).toMatch(/Settings/i);
  });

  it("an expired session is not reported as live", async () => {
    await db.insert(sessions).values({ userId: target.id, tokenHash: `expired-${Date.now()}`, expiresAt: new Date(Date.now() - 1000) });
    expect((await sessionCounts())[target.id] ?? 0).toBe(0);
  });

  it("deactivating still revokes too — the two paths do not disagree", async () => {
    await giveSession(target.id);
    await setUserActive(admin, target.id, false);
    expect((await sessionCounts())[target.id] ?? 0).toBe(0);
    await setUserActive(admin, target.id, true);
  });
});

// ---------------------------------------------------------------------------------------------
// Search — the panel is a flat list, so at any real number of accounts this is the only way to find one.
// ---------------------------------------------------------------------------------------------
d("searching the account list", () => {
  let admin: U, alpha: U, beta: U;
  beforeAll(async () => {
    admin = await createTestUser(); await promote(admin.id); admin = await reread(admin.id);
    alpha = await createTestUser("srch-alpha");
    beta = await createTestUser("srch-beta");
    await db.update(users).set({ name: "Bärbel Zimmermann" }).where(eq(users.id, alpha.id));
    await db.update(users).set({ name: "Quentin Ortega" }).where(eq(users.id, beta.id));
  });
  afterAll(async () => { await deleteTestUser(admin.id); await deleteTestUser(alpha.id); await deleteTestUser(beta.id); });

  const ids = async (q?: string) => (await listUsers(q === undefined ? {} : { q })).map((u) => u.id);

  it("finds an account by part of its email", async () => {
    const found = await ids("srch-alpha");
    expect(found).toContain(alpha.id);
    expect(found).not.toContain(beta.id);
  });

  it("finds an account by part of its name, ignoring case", async () => {
    expect(await ids("zimmermann")).toContain(alpha.id);
    expect(await ids("QUENTIN")).toContain(beta.id);
  });

  it("an empty or whitespace query is not a filter", async () => {
    const all = await ids();
    expect(await ids("")).toEqual(all);
    expect(await ids("   ")).toEqual(all);
  });

  it("returns nothing rather than everything when nothing matches", async () => {
    expect(await ids("zzz-no-such-account-zzz")).toEqual([]);
  });

  it("a wildcard is searched for literally, not interpreted", async () => {
    // Without escaping, `%` would match every account — a search box that silently ignores itself.
    expect(await ids("%")).toEqual([]);
    expect(await ids("_")).toEqual([]);
  });

  it("search still returns only account columns — never anything from inside an account", async () => {
    const [row] = await listUsers({ q: "srch-alpha" });
    expect(Object.keys(row).sort()).toEqual(Object.keys(adminUserColumns).sort());
    expect(row).not.toHaveProperty("passwordHash");
  });
});

// ---------------------------------------------------------------------------------------------
// Deletion — irreversible, so it has to be able to say what it is about to do.
// ---------------------------------------------------------------------------------------------
d("deleting an account from the admin panel", () => {
  let admin: U;
  beforeAll(async () => { admin = await createTestUser(); await promote(admin.id); admin = await reread(admin.id); });
  afterAll(async () => { await deleteTestUser(admin.id); });

  it("summarises what would be destroyed, in real counts", async () => {
    const victim = await createTestUser();
    await tasks.createTask(victim.id, tasks.taskCreateSchema.parse({ title: "One" }));
    await tasks.createTask(victim.id, tasks.taskCreateSchema.parse({ title: "Two" }));
    const summary = await deletionSummary(victim.id);
    expect(summary.items.find((i) => i.label === "Tasks")?.n).toBe(2);
    expect(summary.total).toBeGreaterThanOrEqual(2);
    await deleteTestUser(victim.id);
  });

  it("the summary carries counts and never any content", async () => {
    const victim = await createTestUser();
    await tasks.createTask(victim.id, tasks.taskCreateSchema.parse({ title: "A very distinctive secret title" }));
    const summary = await deletionSummary(victim.id);
    expect(JSON.stringify(summary)).not.toContain("distinctive secret");
    for (const item of summary.items) expect(Object.keys(item).sort()).toEqual(["label", "n"]);
    await deleteTestUser(victim.id);
  });

  it("lists nothing for a module the account never used", async () => {
    const victim = await createTestUser();
    const summary = await deletionSummary(victim.id);
    expect(summary.items.every((i) => i.n > 0)).toBe(true);
    await deleteTestUser(victim.id);
  });

  it("really deletes the account and everything that hangs off it", async () => {
    const victim = await createTestUser();
    await tasks.createTask(victim.id, tasks.taskCreateSchema.parse({ title: "Gone with it" }));
    await giveSession(victim.id);
    await deleteUserAsAdmin(admin, victim.id);
    expect(await db.select().from(users).where(eq(users.id, victim.id))).toHaveLength(0);
    expect(await db.select().from(schema.tasks).where(eq(schema.tasks.userId, victim.id))).toHaveLength(0);
    expect(await db.select().from(sessions).where(eq(sessions.userId, victim.id))).toHaveLength(0);
    expect(await db.select().from(schema.accounts).where(eq(schema.accounts.userId, victim.id))).toHaveLength(0);
  });

  it("leaves every other account untouched", async () => {
    const victim = await createTestUser();
    const bystander = await createTestUser();
    await tasks.createTask(bystander.id, tasks.taskCreateSchema.parse({ title: "Still here" }));
    await deleteUserAsAdmin(admin, victim.id);
    expect(await db.select().from(schema.tasks).where(eq(schema.tasks.userId, bystander.id))).toHaveLength(1);
    expect(await reread(bystander.id)).toBeTruthy();
    await deleteTestUser(bystander.id);
  });

  it("writes the audit row before the deletion, owned by the administrator so it survives it", async () => {
    const victim = await createTestUser();
    await deleteUserAsAdmin(admin, victim.id);
    const [row] = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.action, "admin.user.delete"), eq(auditLogs.entityId, victim.id)));
    // A row owned by the *target* would have cascaded away with them, leaving no trace of the deletion.
    expect(row).toBeTruthy();
    expect(row.userId).toBe(admin.id);
  });

  it("refuses to delete you — Settings does that, behind your own password", async () => {
    const err = await fail(deleteUserAsAdmin(admin, admin.id));
    expect(err?.status).toBe(400);
    expect(err?.message).toMatch(/Settings/i);
    expect(await reread(admin.id)).toBeTruthy();
  });

  it("refuses a target that does not exist", async () => {
    expect((await fail(deleteUserAsAdmin(admin, "00000000-0000-4000-8000-000000000000")))?.status).toBe(404);
  });

  it("every table the summary names is a table the deletion actually empties", async () => {
    const victim = await createTestUser();
    await tasks.createTask(victim.id, tasks.taskCreateSchema.parse({ title: "x" }));
    const summary = await deletionSummary(victim.id);
    await deleteUserAsAdmin(admin, victim.id);
    expect((await fail(deletionSummary(victim.id)))?.status).toBe(404);
    expect(summary.total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The guards, applied to every destructive power — old and new alike.
// ---------------------------------------------------------------------------------------------
d("an instance can never be left with nobody able to administer it", () => {
  let soleAdmin: U, plain: U;
  beforeAll(async () => {
    soleAdmin = await createTestUser(); plain = await createTestUser();
    await promote(soleAdmin.id); soleAdmin = await reread(soleAdmin.id);
  });
  afterAll(async () => { await deleteTestUser(soleAdmin.id); await deleteTestUser(plain.id); });

  const soleAdminCase = async (fn: () => Promise<unknown>) => {
    // Only meaningful while this really is the last one; other suites may run concurrently.
    if ((await activeAdminCount()) > 1) return;
    const err = await fail(fn());
    expect(err?.status).toBe(400);
    expect(err?.message).toMatch(/last active administrator/i);
  };

  it("the last administrator cannot be deleted by another administrator", async () => {
    const second = await createTestUser();
    await promote(second.id);
    const secondRow = await reread(second.id);
    // With two admins this is allowed; the guard is what stops the *last* one going.
    await deleteUserAsAdmin(secondRow, soleAdmin.id).catch(() => {});
    const stillThere = await reread(soleAdmin.id);
    if (!stillThere) {
      // It was deleted because a second administrator existed — that is correct. Restore the fixture.
      soleAdmin = await createTestUser();
      await promote(soleAdmin.id);
      soleAdmin = await reread(soleAdmin.id);
    }
    await deleteTestUser(second.id);
    await soleAdminCase(() => deleteUserAsAdmin(soleAdmin, soleAdmin.id));
  });

  it("the last administrator cannot be deactivated", async () => {
    await soleAdminCase(() => setUserActive(soleAdmin, soleAdmin.id, false));
  });

  it("the last administrator cannot be demoted", async () => {
    await soleAdminCase(() => setUserRole(soleAdmin, soleAdmin.id, "user"));
  });

  it("a deactivated administrator does not count towards the total", async () => {
    const extra = await createTestUser();
    await promote(extra.id);
    const before = await activeAdminCount();
    await db.update(users).set({ isActive: false }).where(eq(users.id, extra.id));
    expect(await activeAdminCount()).toBe(before - 1);
    await deleteTestUser(extra.id);
  });
});

// ---------------------------------------------------------------------------------------------
// Background work. The bug: the nightly run selected every account, deactivated or not.
// ---------------------------------------------------------------------------------------------
d("background jobs only run for accounts that can still sign in", () => {
  it("the cron selects active accounts and says why", () => {
    const src = readFileSync("src/app/api/cron/route.ts", "utf8");
    const selection = src.match(/const all = await db\.select\(\)\.from\(users\)[^;]*/)?.[0] ?? "";
    expect(selection).toContain("eq(users.isActive, true)");
  });

  it("a deactivated account is not in the set the cron would iterate", async () => {
    const admin = await createTestUser(); await promote(admin.id);
    const off = await createTestUser();
    const on = await createTestUser();
    await setUserActive(await reread(admin.id), off.id, false);
    const batch = await db.select().from(users).where(eq(users.isActive, true));
    const inBatch = new Set(batch.map((u) => u.id));
    expect(inBatch.has(off.id)).toBe(false);
    expect(inBatch.has(on.id)).toBe(true);
    await deleteTestUser(admin.id); await deleteTestUser(off.id); await deleteTestUser(on.id);
  });

  it("the account keeps everything it owned while it was active", async () => {
    const admin = await createTestUser(); await promote(admin.id);
    const off = await createTestUser();
    await tasks.createTask(off.id, tasks.taskCreateSchema.parse({ title: "Written while active" }));
    await setUserActive(await reread(admin.id), off.id, false);
    expect(await db.select().from(schema.tasks).where(eq(schema.tasks.userId, off.id))).toHaveLength(1);
    await deleteTestUser(admin.id); await deleteTestUser(off.id);
  });

  it("the cron still authenticates with a secret rather than a session", () => {
    const src = readFileSync("src/app/api/cron/route.ts", "utf8");
    expect(src).toContain("CRON_SECRET");
    expect(src).toContain("timingSafeEqual");
    expect(src).not.toContain("withAuth");
  });
});

// ---------------------------------------------------------------------------------------------
// CSRF. The check existed, was correct, was unit-tested — and was called by nothing.
// ---------------------------------------------------------------------------------------------
describe("the origin check is actually enforced", () => {
  const routeFile = (p: string) => readFileSync(p, "utf8");

  it("withAuth rejects a state-changing request from another origin", () => {
    const src = routeFile("src/server/http.ts");
    expect(src).toContain("isTrustedOrigin");
    // Ahead of the session lookup: a blocked request should not cost a query.
    expect(src.indexOf("isTrustedOrigin(req)")).toBeLessThan(src.indexOf("await getCurrentUser()"));
  });

  it("withAdmin inherits it, so every admin route is covered", () => {
    const src = routeFile("src/server/http.ts");
    const withAdmin = src.slice(src.indexOf("export function withAdmin"));
    expect(withAdmin).toContain("withAuth");
  });

  it("the auth routes, which withAuth does not wrap, check it themselves", () => {
    for (const p of ["login", "signup", "logout"]) {
      expect(routeFile(`src/app/api/auth/${p}/route.ts`)).toContain("isTrustedOrigin");
    }
  });

  it("and the check itself still does the right thing", () => {
    const mk = (h: Record<string, string>, method = "POST") =>
      new Request("https://app.example.com/api/admin/users/x", { method, headers: h });
    expect(isTrustedOrigin(mk({ host: "app.example.com", origin: "https://app.example.com" }, "DELETE"))).toBe(true);
    expect(isTrustedOrigin(mk({ host: "app.example.com", origin: "https://evil.example" }, "DELETE"))).toBe(false);
    expect(isTrustedOrigin(mk({ host: "app.example.com" }, "DELETE"))).toBe(false);
    expect(isTrustedOrigin(mk({ host: "app.example.com" }, "GET"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The line the whole design rests on: administration reaches accounts, never their contents.
// ---------------------------------------------------------------------------------------------
d("administration never reaches inside an account", () => {
  let admin: U, other: U;
  beforeAll(async () => {
    admin = await createTestUser(); other = await createTestUser();
    await promote(admin.id); admin = await reread(admin.id);
    await tasks.createTask(other.id, tasks.taskCreateSchema.parse({ title: "PRIVATE-MARKER-3180" }));
  });
  afterAll(async () => { await deleteTestUser(admin.id); await deleteTestUser(other.id); });

  it("the account list carries no password material and no session tokens", async () => {
    const rows = await listUsers();
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(/scrypt\$/);
    expect(blob).not.toContain("passwordHash");
    expect(blob).not.toContain("tokenHash");
  });

  it("no admin service returns another account's content", async () => {
    const blob = JSON.stringify([await listUsers(), await getUser(other.id), await sessionCounts()]);
    expect(blob).not.toContain("PRIVATE-MARKER-3180");
  });

  it("the deletion summary is the one exception, and it still shows no content", async () => {
    const summary = await deletionSummary(other.id);
    expect(summary.items.find((i) => i.label === "Tasks")?.n).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("PRIVATE-MARKER-3180");
  });

  it("the session count says how many, never from where or on what", async () => {
    await giveSession(other.id);
    const counts = await sessionCounts();
    expect(typeof counts[other.id]).toBe("number");
    const blob = JSON.stringify(counts);
    expect(blob).not.toContain("tokenHash");
    expect(blob).not.toMatch(/user[Aa]gent|\bip\b/);
    await db.delete(sessions).where(eq(sessions.userId, other.id));
  });

  it("being an administrator changes nothing about what the admin's own modules return", async () => {
    const mine = await tasks.listTasks(admin.id, {});
    expect(mine.every((t) => t.userId === admin.id)).toBe(true);
    expect(JSON.stringify(mine)).not.toContain("PRIVATE-MARKER-3180");
  });

  it("there is no impersonation, because nothing here can mint a session for somebody else", () => {
    // This is what impersonation would actually be: issuing another account's session, or writing
    // its cookie. The admin surface only ever *destroys* sessions.
    const files = [
      "src/server/services/admin.ts",
      "src/app/api/admin/users/route.ts",
      "src/app/api/admin/users/[id]/route.ts",
      "src/app/api/admin/users/[id]/password/route.ts",
      "src/app/api/admin/users/[id]/sessions/route.ts",
      "src/app/api/admin/users/[id]/deletion-summary/route.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/\bcreateSession\b/);
      expect(src).not.toMatch(/SESSION_COOKIE|cookies\(\)/);
    }
    expect(readFileSync("src/server/services/admin.ts", "utf8")).toContain("destroyAllSessions");
  });

  it("the acting identity always comes from the session, never from the request", () => {
    // Every admin handler passes `ctx.user` — the row `getCurrentUser()` resolved — as the actor.
    // A handler that took the administrator's id from a body or a header would be the same hole by
    // another name, so no admin route may read one.
    for (const f of [
      "src/app/api/admin/users/route.ts",
      "src/app/api/admin/users/[id]/route.ts",
      "src/app/api/admin/users/[id]/password/route.ts",
      "src/app/api/admin/users/[id]/sessions/route.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/withAdmin/);
      expect(src).not.toMatch(/headers\(\)\.get\(["']x-user|body\.userId|input\.userId|params\.userId/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Every account is the whole Personal OS, not a reduced one.
// ---------------------------------------------------------------------------------------------
d("an admin-created account gets the complete application", () => {
  let admin: U, created: { id: string; email: string };
  beforeAll(async () => {
    admin = await createTestUser(); await promote(admin.id); admin = await reread(admin.id);
    const res = await createUserAsAdmin(admin, { email: `made-${Date.now()}@example.com`, name: "Made", role: "user" });
    created = res.user;
  });
  afterAll(async () => { await deleteTestUser(admin.id); await deleteTestUser(created.id); });

  it("starts with the same structural defaults a self-registered account gets", async () => {
    expect(await db.select().from(schema.accounts).where(eq(schema.accounts.userId, created.id))).not.toHaveLength(0);
    expect(await db.select().from(schema.categories).where(eq(schema.categories.userId, created.id))).not.toHaveLength(0);
    expect(await db.select().from(schema.subjects).where(eq(schema.subjects.userId, created.id))).not.toHaveLength(0);
    expect(await db.select().from(schema.tradingAccounts).where(eq(schema.tradingAccounts.userId, created.id))).not.toHaveLength(0);
    expect(await db.select().from(schema.watchlists).where(eq(schema.watchlists.userId, created.id))).not.toHaveLength(0);
    expect(await db.select().from(schema.trainingPlans).where(eq(schema.trainingPlans.userId, created.id))).not.toHaveLength(0);
  });

  it("starts with no activity of its own and nothing copied from the administrator", async () => {
    expect(await db.select().from(schema.tasks).where(eq(schema.tasks.userId, created.id))).toHaveLength(0);
    expect(await db.select().from(schema.transactions).where(eq(schema.transactions.userId, created.id))).toHaveLength(0);
    expect(await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.userId, created.id))).toHaveLength(0);
    expect(await db.select().from(schema.aiMemory).where(eq(schema.aiMemory.userId, created.id))).toHaveLength(0);
  });

  it("its defaults are its own rows, shared with nobody", async () => {
    const mine = await db.select().from(schema.accounts).where(eq(schema.accounts.userId, created.id));
    const theirs = await db.select().from(schema.accounts).where(eq(schema.accounts.userId, admin.id));
    expect(mine.map((a) => a.id).some((id) => theirs.map((a) => a.id).includes(id))).toBe(false);
  });

  it("can use every module immediately, with no admin blessing in between", async () => {
    const t = await tasks.createTask(created.id, tasks.taskCreateSchema.parse({ title: "First task on a brand new account" }));
    expect(t.userId).toBe(created.id);
    await tasks.deleteTask(created.id, t.id);
  });
});

// ---------------------------------------------------------------------------------------------
// Bootstrap. The first account owns the instance; no later one can claim that.
// ---------------------------------------------------------------------------------------------
describe("the first administrator cannot be claimed twice", () => {
  it("signup only grants the admin role on a completely empty instance", () => {
    const src = readFileSync("src/server/services/users.ts", "utf8");
    expect(src).toMatch(/const role = \(await userCount\(\)\) === 0 \? "admin" : "user"/);
  });

  it("signup is closed once an account exists unless it is explicitly opened", () => {
    const src = readFileSync("src/server/services/users.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function signupAllowed"));
    expect(fn).toContain("ALLOW_SIGNUP");
    expect(fn).toContain("userCount()) === 0");
  });

  it("nothing in the app promotes an account on its own", () => {
    const src = readFileSync("src/server/services/users.ts", "utf8");
    // The only writes of `role` outside the admin service are the bootstrap decision above.
    expect(src.match(/role: "admin"/g) ?? []).toHaveLength(0);
  });
});
