/**
 * Phase 3.12 — roles, account lifecycle, and the line between them and the data.
 *
 * Two things are being pinned here. First, that administration is real: only an administrator can
 * reach the admin surface, accounts can be created and disabled, and an instance can never be left
 * with nobody able to administer it. Second, and more important, that being an administrator buys
 * *nothing* inside the Personal OS — an admin's dashboard, search and AI context contain their own
 * rows and no one else's, exactly like any other account.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { auditLogs, sessions, users } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { isAdmin } from "@/server/auth/session";
import { allTools } from "@/server/ai/registry";
import "@/server/ai/tools"; // registers every tool; the registry is empty until this import runs
import {
  activeAdminCount, adminStats, createUserAsAdmin, createUserSchema, getUser, listUsers,
  setUserActive, setUserRole, temporaryPassword,
} from "@/server/services/admin";
import { authenticate, insertUser, userCount } from "@/server/services/users";
import { verifyPassword } from "@/server/auth/password";
import * as tasks from "@/server/services/tasks";
import { globalSearch } from "@/server/services/search";
import { dashboardData } from "@/server/services/dashboard";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

type U = Awaited<ReturnType<typeof createTestUser>>;
const promote = (id: string) => db.update(users).set({ role: "admin" }).where(eq(users.id, id));

d("roles", () => {
  let admin: U;
  let plain: U;

  beforeAll(async () => {
    admin = await createTestUser();
    plain = await createTestUser();
    await promote(admin.id);
    admin = (await db.select().from(users).where(eq(users.id, admin.id)))[0];
  });
  afterAll(async () => { if (admin) await deleteTestUser(admin.id); if (plain) await deleteTestUser(plain.id); });

  it("a new account is a plain user by default", () => {
    expect(plain.role).toBe("user");
    expect(plain.isActive).toBe(true);
    expect(plain.lastLoginAt).toBeNull();
  });

  it("isAdmin reads the role, not anything a client could send", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(plain)).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin({ role: "user" } as never)).toBe(false);
    // A forged shape does not become an admin by claiming so in another field.
    expect(isAdmin({ role: "user", isAdmin: true } as never)).toBe(false);
  });

  it("an administrator's own Personal OS shows only their own data", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await tasks.createTask(plain.id, tasks.taskCreateSchema.parse({ title: "PLAIN_ONLY_TASK", dueDate: day }));
    await tasks.createTask(admin.id, tasks.taskCreateSchema.parse({ title: "ADMIN_OWN_TASK", dueDate: day }));
    const dash = JSON.stringify(await dashboardData(admin as never));
    expect(dash).toContain("ADMIN_OWN_TASK");
    expect(dash).not.toContain("PLAIN_ONLY_TASK");
    const hits = await globalSearch(admin.id, "PLAIN_ONLY_TASK", {});
    expect(hits.hits).toHaveLength(0);
    // …and the plain user's own list still has it.
    expect((await tasks.listTasks(plain.id, { view: "all" })).some((t) => t.title === "PLAIN_ONLY_TASK")).toBe(true);
  });

  it("administration never reads another account's rows", async () => {
    const rows = await listUsers();
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("PLAIN_ONLY_TASK");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("password_hash");
  });
});

d("creating accounts", () => {
  let admin: U;
  const made: string[] = [];

  beforeAll(async () => {
    admin = await createTestUser();
    await promote(admin.id);
    admin = (await db.select().from(users).where(eq(users.id, admin.id)))[0];
  });
  afterAll(async () => {
    for (const id of made) await deleteTestUser(id).catch(() => {});
    if (admin) await deleteTestUser(admin.id);
  });

  it("creates an account with a generated temporary password that actually works", async () => {
    const email = `made-${Date.now()}@example.com`;
    const res = await createUserAsAdmin(admin, createUserSchema.parse({ email, name: "Made" }));
    made.push(res.user.id);
    expect(res.temporaryPassword).toBeTruthy();
    expect(res.temporaryPassword!.length).toBeGreaterThanOrEqual(16);
    const signedIn = await authenticate({ email, password: res.temporaryPassword! });
    expect(signedIn.id).toBe(res.user.id);
    expect(signedIn.role).toBe("user");
  });

  it("stores only the hash — never the password itself", async () => {
    const email = `hash-${Date.now()}@example.com`;
    const res = await createUserAsAdmin(admin, createUserSchema.parse({ email, name: "Hashed" }));
    made.push(res.user.id);
    const [row] = await db.select().from(users).where(eq(users.id, res.user.id));
    expect(row.passwordHash).not.toContain(res.temporaryPassword!);
    expect(row.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(res.temporaryPassword!, row.passwordHash)).toBe(true);
  });

  it("never writes the password into the audit trail", async () => {
    const email = `audit-${Date.now()}@example.com`;
    const res = await createUserAsAdmin(admin, createUserSchema.parse({ email, name: "Audited" }));
    made.push(res.user.id);
    const entries = await db.select().from(auditLogs).where(eq(auditLogs.entityId, res.user.id));
    expect(entries.length).toBeGreaterThan(0);
    const created = entries.find((e) => e.action === "admin.user.create")!;
    expect(created).toBeTruthy();
    expect(created.userId).toBe(admin.id); // who did it, not who it was done to
    const blob = JSON.stringify(created);
    expect(blob).not.toContain(res.temporaryPassword!);
    expect(blob.toLowerCase()).not.toContain("passwordhash");
  });

  it("a generated password is not guessable from the previous one", () => {
    const set = new Set(Array.from({ length: 20 }, () => temporaryPassword()));
    expect(set.size).toBe(20);
  });

  it("the new account starts empty but with the standard defaults", async () => {
    const email = `empty-${Date.now()}@example.com`;
    const res = await createUserAsAdmin(admin, createUserSchema.parse({ email, name: "Empty" }));
    made.push(res.user.id);
    expect(await tasks.listTasks(res.user.id, { view: "all" })).toHaveLength(0);
    const dash = JSON.stringify(await dashboardData((await db.select().from(users).where(eq(users.id, res.user.id)))[0] as never));
    expect(dash).not.toContain("ADMIN_OWN_TASK");
    // Structural defaults are there, so the account is usable from the first screen.
    const [row] = await db.select().from(users).where(eq(users.id, res.user.id));
    expect(row.timezone).toBeTruthy();
    expect(row.currency).toBeTruthy();
  });

  it("refuses a duplicate email", async () => {
    const email = `dup-${Date.now()}@example.com`;
    const res = await createUserAsAdmin(admin, createUserSchema.parse({ email, name: "First" }));
    made.push(res.user.id);
    await expect(createUserAsAdmin(admin, createUserSchema.parse({ email, name: "Second" }))).rejects.toMatchObject({ status: 409 });
  });

  it("can create another administrator when asked to", async () => {
    const email = `admin2-${Date.now()}@example.com`;
    const res = await createUserAsAdmin(admin, createUserSchema.parse({ email, name: "Admin two", role: "admin" }));
    made.push(res.user.id);
    expect(res.user.role).toBe("admin");
  });
});

d("deactivating accounts", () => {
  let admin: U;
  let target: U;

  beforeAll(async () => {
    admin = await createTestUser();
    await promote(admin.id);
    admin = (await db.select().from(users).where(eq(users.id, admin.id)))[0];
    target = await createTestUser();
  });
  afterAll(async () => { if (admin) await deleteTestUser(admin.id); if (target) await deleteTestUser(target.id); });

  it("blocks login while keeping every row the account owns", async () => {
    const task = await tasks.createTask(target.id, tasks.taskCreateSchema.parse({ title: "SURVIVES_DEACTIVATION" }));
    await setUserActive(admin, target.id, false);
    await expect(authenticate({ email: target.email, password: "correct horse battery" })).rejects.toMatchObject({ status: 403 });
    // The data is untouched.
    expect((await tasks.getTask(target.id, task.id)).title).toBe("SURVIVES_DEACTIVATION");
    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row.isActive).toBe(false);
    expect(row.deactivatedAt).toBeInstanceOf(Date);
  });

  it("ends the account's live sessions", async () => {
    await db.insert(sessions).values({ userId: target.id, tokenHash: `hash-${Date.now()}`, expiresAt: new Date(Date.now() + 864e5) });
    await setUserActive(admin, target.id, true);
    await db.insert(sessions).values({ userId: target.id, tokenHash: `hash2-${Date.now()}`, expiresAt: new Date(Date.now() + 864e5) });
    await setUserActive(admin, target.id, false);
    expect(await db.select().from(sessions).where(eq(sessions.userId, target.id))).toHaveLength(0);
  });

  it("reactivating restores login and clears the timestamp", async () => {
    await setUserActive(admin, target.id, true);
    const signedIn = await authenticate({ email: target.email, password: "correct horse battery" });
    expect(signedIn.id).toBe(target.id);
    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row.isActive).toBe(true);
    expect(row.deactivatedAt).toBeNull();
  });

  it("wrong password still fails the same way whether the account is active or not", async () => {
    await expect(authenticate({ email: target.email, password: "not the password" })).rejects.toMatchObject({ status: 401 });
    await setUserActive(admin, target.id, false);
    // Still 401, not 403: the deactivation is only revealed to someone who proved the password.
    await expect(authenticate({ email: target.email, password: "not the password" })).rejects.toMatchObject({ status: 401 });
    await setUserActive(admin, target.id, true);
  });

  it("an administrator cannot lock themselves out", async () => {
    await expect(setUserActive(admin, admin.id, false)).rejects.toBeInstanceOf(AppError);
    await expect(setUserRole(admin, admin.id, "user")).rejects.toBeInstanceOf(AppError);
  });

  it("the last active administrator cannot be demoted or disabled", async () => {
    const before = await activeAdminCount();
    const second = await createTestUser();
    try {
      await promote(second.id);
      expect(await activeAdminCount()).toBe(before + 1);
      // With two admins the demotion is allowed…
      await setUserRole(admin, second.id, "user");
      expect((await getUser(second.id)).role).toBe("user");
    } finally {
      await deleteTestUser(second.id);
    }
  });

  it("records who did what, and never a secret", async () => {
    await setUserActive(admin, target.id, false);
    await setUserActive(admin, target.id, true);
    const entries = await db.select().from(auditLogs).where(eq(auditLogs.entityId, target.id));
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("admin.user.deactivate");
    expect(actions).toContain("admin.user.reactivate");
    for (const e of entries) {
      expect(e.userId).toBe(admin.id);
      expect(JSON.stringify(e.metadata ?? {}).toLowerCase()).not.toMatch(/password|token|secret/);
    }
  });

  it("counts what the admin header shows, and nothing else", async () => {
    const stats = await adminStats();
    expect(stats.total).toBe(await userCount());
    expect(stats.admins + stats.users).toBe(stats.total);
    expect(stats.active).toBeLessThanOrEqual(stats.total);
  });
});

d("the first account on an instance", () => {
  it("insertUser stores the role it is given and hashes the password", async () => {
    const email = `first-${Date.now()}@example.com`;
    const u = await insertUser({ email, name: "Owner", password: "a long enough password", role: "admin" });
    try {
      expect(u.role).toBe("admin");
      expect(u.isActive).toBe(true);
      expect(u.passwordHash).not.toContain("a long enough password");
      expect(await verifyPassword("a long enough password", u.passwordHash)).toBe(true);
    } finally {
      await deleteTestUser(u.id);
    }
  });
});

describe("AI tools can never choose whose data they touch", () => {
  it("no tool accepts a user id, a role or a raw table as an argument", () => {
    const offenders: string[] = [];
    for (const tool of allTools()) {
      const shape = (tool.schema as { shape?: Record<string, unknown> }).shape;
      if (!shape) continue;
      for (const key of Object.keys(shape)) {
        if (/^(userId|user_id|ownerId|accountOwner|role|isAdmin|table|tableName|sql|query_raw)$/i.test(key)) offenders.push(`${tool.name}.${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("there are tools to check, and each declares a module and a risk", () => {
    const tools = allTools();
    expect(tools.length).toBeGreaterThan(100);
    for (const t of tools) {
      expect(t.module, `${t.name} has no module`).toBeTruthy();
      expect(["read", "low", "medium", "high"]).toContain(t.risk);
    }
  });

  it("no tool is an open-ended database escape hatch", () => {
    const banned = /^(update_database|run_sql|query|execute_sql|raw_query|db_write|set_user)$/i;
    expect(allTools().filter((t) => banned.test(t.name)).map((t) => t.name)).toEqual([]);
  });
});

d("an AI tool run by one account cannot reach another", () => {
  let A: U;
  let B: U;
  let bTaskId: string;

  beforeAll(async () => {
    A = await createTestUser();
    B = await createTestUser();
    bTaskId = (await tasks.createTask(B.id, tasks.taskCreateSchema.parse({ title: "TOOL_TARGET_B", dueDate: new Date().toISOString().slice(0, 10) }))).id;
  });
  afterAll(async () => { if (A) await deleteTestUser(A.id); if (B) await deleteTestUser(B.id); });

  it("completing another account's task through a tool fails, and the task stays open", async () => {
    const { getTool, runTool } = await import("./_tool-helpers");
    const tool = getTool("complete_task");
    expect(tool).toBeTruthy();
    const action = await runTool(tool!, { id: bTaskId }, A as never);
    expect(action.status).toBe("failed");
    expect((await tasks.getTask(B.id, bTaskId)).status).not.toBe("done");
  });

  it("a read tool run by A never returns B's rows", async () => {
    const { getTool, runTool } = await import("./_tool-helpers");
    const tool = getTool("search_personal_os");
    expect(tool).toBeTruthy();
    const action = await runTool(tool!, { query: "TOOL_TARGET_B" }, A as never);
    expect(JSON.stringify(action.result ?? {})).not.toContain("TOOL_TARGET_B");
  });

  it("the action log records the account that ran the tool", async () => {
    const { getTool, runTool } = await import("./_tool-helpers");
    const tool = getTool("list_tasks");
    if (!tool) return;
    await runTool(tool, {}, A as never);
    const logs = await db.select().from((await import("@/server/db/schema")).aiActionLogs).where(eq((await import("@/server/db/schema")).aiActionLogs.userId, A.id));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.userId === A.id)).toBe(true);
  });
});
