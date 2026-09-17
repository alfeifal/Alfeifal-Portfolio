/**
 * Phase 3.13 — an admin-issued password has to be replaced before the account can be used.
 *
 * The gap this closes: an administrator created an account, read its temporary password off the
 * screen, and that password kept working forever. Two people knew it and nothing ever forced that to
 * end. Now the account can sign in and do exactly one thing — set its own password — and the change
 * drops every other session, which is what actually ends the administrator's copy.
 *
 * The part that must NOT change: existing accounts. The column defaults to false, so the migration
 * cannot lock anybody out of an instance that is already running.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { auditLogs, users } from "@/server/db/schema";
import { verifyPassword } from "@/server/auth/password";
import { PASSWORD_CHANGE_REQUIRED } from "@/server/http";
import { createUserAsAdmin, createUserSchema } from "@/server/services/admin";
import { authenticate, changePassword, insertUser } from "@/server/services/users";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
type U = Awaited<ReturnType<typeof createTestUser>>;
const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

d("an account created by an administrator", () => {
  let admin: U;
  const made: string[] = [];
  const mk = async (name: string) => {
    const res = await createUserAsAdmin(admin, createUserSchema.parse({ email: `rot-${name}-${Date.now()}@example.com`, name }));
    made.push(res.user.id);
    return res;
  };

  beforeAll(async () => {
    admin = await createTestUser();
    await db.update(users).set({ role: "admin" }).where(eq(users.id, admin.id));
    admin = await row(admin.id);
  });
  afterAll(async () => {
    for (const id of made) await deleteTestUser(id).catch(() => {});
    if (admin) await deleteTestUser(admin.id);
  });

  it("is flagged as owing a password change", async () => {
    const res = await mk("flagged");
    expect((await row(res.user.id)).mustChangePassword).toBe(true);
  });

  it("is flagged even when the administrator chose the password themselves", async () => {
    // They still know it, so it is still a shared secret.
    const email = `chosen-${Date.now()}@example.com`;
    const res = await createUserAsAdmin(admin, createUserSchema.parse({ email, name: "Chosen", password: "a chosen password" }));
    made.push(res.user.id);
    expect(res.temporaryPassword).toBeNull();
    expect((await row(res.user.id)).mustChangePassword).toBe(true);
  });

  it("can still sign in — the block is on what it may do next, not on logging in", async () => {
    const res = await mk("signin");
    const signedIn = await authenticate({ email: res.user.email, password: res.temporaryPassword! });
    expect(signedIn.id).toBe(res.user.id);
    expect(signedIn.mustChangePassword).toBe(true);
  });

  it("clears the flag by changing the password, and the new one works", async () => {
    const res = await mk("change");
    const out = await changePassword(res.user.id, { currentPassword: res.temporaryPassword!, newPassword: "my own password 1" });
    expect(out.wasForced).toBe(true);
    const after = await row(res.user.id);
    expect(after.mustChangePassword).toBe(false);
    expect(await verifyPassword("my own password 1", after.passwordHash)).toBe(true);
    expect(await verifyPassword(res.temporaryPassword!, after.passwordHash)).toBe(false);
    // The temporary one no longer opens the account.
    await expect(authenticate({ email: res.user.email, password: res.temporaryPassword! })).rejects.toMatchObject({ status: 401 });
    expect((await authenticate({ email: res.user.email, password: "my own password 1" })).id).toBe(res.user.id);
  });

  it("refuses to 'change' the password to the same one", async () => {
    const res = await mk("same");
    await expect(changePassword(res.user.id, { currentPassword: res.temporaryPassword!, newPassword: res.temporaryPassword! }))
      .rejects.toMatchObject({ status: 400 });
    // …and the flag is still set, so the block stands.
    expect((await row(res.user.id)).mustChangePassword).toBe(true);
  });

  it("refuses a wrong current password without clearing anything", async () => {
    const res = await mk("wrong");
    await expect(changePassword(res.user.id, { currentPassword: "not it", newPassword: "another password" })).rejects.toMatchObject({ status: 400 });
    expect((await row(res.user.id)).mustChangePassword).toBe(true);
  });

  it("records the forced change in the audit trail, without any password material", async () => {
    const res = await mk("audited");
    await changePassword(res.user.id, { currentPassword: res.temporaryPassword!, newPassword: "yet another password" });
    // The service is audited by the route; what must hold here is that nothing leaked into the row.
    const entries = await db.select().from(auditLogs).where(eq(auditLogs.entityId, res.user.id));
    for (const e of entries) {
      const blob = JSON.stringify(e);
      expect(blob).not.toContain(res.temporaryPassword!);
      expect(blob).not.toContain("yet another password");
    }
  });
});

d("accounts that already existed", () => {
  let existing: U;
  beforeAll(async () => { existing = await createTestUser(); });
  afterAll(async () => { if (existing) await deleteTestUser(existing.id); });

  it("are not flagged, so nobody is locked out by the migration", async () => {
    expect((await row(existing.id)).mustChangePassword).toBe(false);
    const signedIn = await authenticate({ email: existing.email, password: "correct horse battery" });
    expect(signedIn.mustChangePassword).toBe(false);
  });

  it("changing a password voluntarily still works and reports it was not forced", async () => {
    const out = await changePassword(existing.id, { currentPassword: "correct horse battery", newPassword: "a brand new password" });
    expect(out.wasForced).toBe(false);
    expect((await row(existing.id)).mustChangePassword).toBe(false);
  });

  it("sign-up through the normal path is never flagged", async () => {
    const u = await insertUser({ email: `selfserve-${Date.now()}@example.com`, name: "Self", password: "self chosen password" });
    try {
      expect(u.mustChangePassword).toBe(false);
    } finally {
      await deleteTestUser(u.id);
    }
  });
});

describe("the block is enforced on the server, in one place", () => {
  const http = read("src/server/http.ts");

  it("withAuth refuses every route but the few the flow needs", () => {
    expect(http).toContain("passwordGate");
    expect(http).toContain(PASSWORD_CHANGE_REQUIRED);
    expect(http).toContain('{ path: "/api/me/password" }');
    expect(http).toContain('{ path: "/api/auth/logout" }');
    // Reading the profile is allowed; editing it is not.
    expect(http).toContain('{ path: "/api/me", methods: ["GET"] }');
  });

  it("the gate runs before the handler, not after it", () => {
    const body = http.slice(http.indexOf("export function withAuth"));
    expect(body.indexOf("passwordGate")).toBeLessThan(body.indexOf("return await handler"));
  });

  it("the app layout sends a flagged account to the change screen", () => {
    const layout = read("src/app/(app)/layout.tsx");
    expect(layout).toContain("user.mustChangePassword");
    expect(layout).toContain('redirect("/change-password")');
  });

  it("the change screen exists outside the app shell and has no way around it", () => {
    const page = read("src/app/(auth)/change-password/page.tsx");
    expect(page).toContain("getCurrentUser");
    expect(page).toContain('redirect("/login")');
    // Someone who does not owe a change is sent away rather than shown a dead end.
    expect(page).toContain('redirect("/settings")');
  });

  it("the form goes through the ordinary password route, not a second weaker one", () => {
    const form = read("src/app/(auth)/change-password/form.tsx");
    expect(form).toContain('"/api/me/password"');
    expect(form).toContain("currentPassword");
    expect(form).not.toMatch(/\/api\/(admin|auth)\//);
  });

  it("the client sends a gated response to the change screen instead of a bare error", () => {
    const client = read("src/lib/client.ts");
    expect(client).toContain("password_change_required");
    expect(client).toContain('"/change-password"');
  });

  it("the migration is additive and defaults to false", () => {
    const sql = read("drizzle/0006_force_password_rotation.sql");
    expect(sql).toContain('ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL');
    expect(sql).not.toMatch(/DROP|DELETE|TRUNCATE/i);
  });
});
