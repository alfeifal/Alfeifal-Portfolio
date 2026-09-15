/**
 * Memory identity.
 *
 * A memory has a UUID primary key and an optional semantic key (a slug the assistant itself picks,
 * like "investments_trading212"). The context block only ever shows the key, so the key has to be a
 * first-class way to address a memory — and a key must never be accepted where a UUID is required,
 * which is exactly the bug this covers: update_memory used to take `id: uuid()` only, so the model
 * passed the slug it could see and every edit died with "Invalid UUID".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { aiMemory } from "@/server/db/schema";
import * as mem from "@/server/services/memory";
import { getTool, runTool } from "./_tool-helpers";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("memory service: two identities, never confused", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); other = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); if (other) await deleteTestUser(other.id); });

  it("remembering with a key upserts instead of duplicating", async () => {
    const a = await mem.rememberMemory(user.id, { kind: "fact", key: "investments_trading212", content: "Uses Trading212 for ETFs", importance: 3, pinned: false, source: "ai" });
    const b = await mem.rememberMemory(user.id, { kind: "fact", key: "investments_trading212", content: "Uses Trading212 for ETFs and stocks", importance: 3, pinned: false, source: "ai" });
    expect(b.id).toBe(a.id);
    const rows = await db.select().from(aiMemory).where(and(eq(aiMemory.userId, user.id), eq(aiMemory.key, "investments_trading212")));
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("Uses Trading212 for ETFs and stocks");
  });

  it("updates by key — the handle the model actually has", async () => {
    const updated = await mem.updateMemory(user.id, { key: "investments_trading212" }, { content: "Trading212 is the broker for the real portfolio" });
    expect(updated.content).toBe("Trading212 is the broker for the real portfolio");
    expect(updated.key).toBe("investments_trading212");
  });

  it("updates by real UUID too", async () => {
    const found = await mem.getMemory(user.id, { key: "investments_trading212" });
    const updated = await mem.updateMemory(user.id, { id: found.id }, { importance: 5 });
    expect(updated.id).toBe(found.id);
    expect(updated.importance).toBe(5);
  });

  it("a slug passed as an id is rejected with an explanation, never coerced", async () => {
    await expect(mem.updateMemory(user.id, { id: "investments_trading212" }, { content: "x" }))
      .rejects.toThrow(/not a memory id.*key/is);
    // and the memory is untouched
    const still = await mem.getMemory(user.id, { key: "investments_trading212" });
    expect(still.content).toBe("Trading212 is the broker for the real portfolio");
  });

  it("a well-formed but unknown UUID is a clean not-found, not a silent no-op", async () => {
    await expect(mem.updateMemory(user.id, { id: "00000000-0000-4000-8000-000000000000" }, { content: "x" })).rejects.toThrow(/not found/i);
  });

  it("an unknown key says which key was missing", async () => {
    await expect(mem.updateMemory(user.id, { key: "no_such_key" }, { content: "x" })).rejects.toThrow(/no_such_key/);
  });

  it("neither handle is a validation error, not a wildcard update", async () => {
    await expect(mem.updateMemory(user.id, {}, { content: "x" })).rejects.toThrow(/either the memory id.*or its key/i);
    const untouched = await mem.getMemory(user.id, { key: "investments_trading212" });
    expect(untouched.content).toBe("Trading212 is the broker for the real portfolio");
  });

  it("partial updates do not reset the fields that were not sent", async () => {
    await mem.updateMemory(user.id, { key: "investments_trading212" }, { pinned: true, importance: 4 });
    await mem.updateMemory(user.id, { key: "investments_trading212" }, { content: "Broker: Trading212" });
    const m = await mem.getMemory(user.id, { key: "investments_trading212" });
    expect(m.content).toBe("Broker: Trading212");
    expect(m.pinned).toBe(true);      // survived
    expect(m.importance).toBe(4);      // survived
  });

  it("search finds a memory by content, by key and by kind, and returns its real id", async () => {
    const byContent = await mem.searchMemory(user.id, "Trading212");
    expect(byContent.length).toBeGreaterThan(0);
    expect(byContent[0].id).toMatch(mem.UUID_RE);
    expect((await mem.searchMemory(user.id, "investments_")).length).toBeGreaterThan(0);
    expect((await mem.searchMemory(user.id, "fact")).length).toBeGreaterThan(0);
  });

  it("search is case-insensitive and handles accents in the stored text", async () => {
    await mem.rememberMemory(user.id, { kind: "person", key: "amigo_jose", content: "José vive en Budapest", importance: 3, pinned: false, source: "ai" });
    expect((await mem.searchMemory(user.id, "josé")).length).toBeGreaterThan(0);
    expect((await mem.searchMemory(user.id, "BUDAPEST")).length).toBeGreaterThan(0);
  });

  it("another user's memory is invisible by key and by id alike", async () => {
    const theirs = await mem.rememberMemory(other.id, { kind: "fact", key: "secreto", content: "Their private note", importance: 3, pinned: false, source: "ai" });
    await expect(mem.getMemory(user.id, { key: "secreto" })).rejects.toThrow(/not found/i);
    await expect(mem.getMemory(user.id, { id: theirs.id })).rejects.toThrow(/not found/i);
    await expect(mem.updateMemory(user.id, { id: theirs.id }, { content: "hijacked" })).rejects.toThrow(/not found/i);
    await expect(mem.forgetMemory(user.id, { id: theirs.id })).rejects.toThrow(/not found/i);
    const [after] = await db.select().from(aiMemory).where(eq(aiMemory.id, theirs.id));
    expect(after.content).toBe("Their private note"); // genuinely untouched
    expect((await mem.searchMemory(user.id, "private note"))).toHaveLength(0);
  });

  it("deleting works by key and removes exactly one row", async () => {
    await mem.rememberMemory(user.id, { kind: "note", key: "to_delete", content: "temporary", importance: 1, pinned: false, source: "ai" });
    const before = await db.select().from(aiMemory).where(eq(aiMemory.userId, user.id));
    await mem.forgetMemory(user.id, { key: "to_delete" });
    const after = await db.select().from(aiMemory).where(eq(aiMemory.userId, user.id));
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((m) => m.key === "to_delete")).toBe(false);
  });
});

d("memory tools as the model sees them", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => {
    user = await createTestUser();
    await mem.rememberMemory(user.id, { kind: "fact", key: "work_schedule", content: "Works 10 to 18 on weekdays", importance: 4, pinned: false, source: "ai" });
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("search_memory is read-only and hands back the id the model needs", async () => {
    const tool = getTool("search_memory")!;
    expect(tool.risk).toBe("read");
    const r = await runTool(tool, { q: "work" }, user);
    expect(r.status).toBe("success");
    const hits = r.result as { id: string; key: string | null; content: string }[];
    expect(hits[0].key).toBe("work_schedule");
    expect(hits[0].id).toMatch(mem.UUID_RE);
  });

  it("update_memory accepts the key straight from the context block", async () => {
    const r = await runTool(getTool("update_memory")!, { key: "work_schedule", content: "Works 9 to 17 on weekdays" }, user);
    expect(r.status).toBe("success");
    expect((r.result as { content: string }).content).toBe("Works 9 to 17 on weekdays");
  });

  it("the original bug: a slug in `id` now fails validation with a message that says what to do", async () => {
    const r = await runTool(getTool("update_memory")!, { id: "investments_trading212", content: "x" }, user);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/uuid/i);
  });

  it("search → id → update is a complete round trip", async () => {
    const found = await runTool(getTool("search_memory")!, { q: "9 to 17" }, user);
    const id = (found.result as { id: string }[])[0].id;
    const updated = await runTool(getTool("update_memory")!, { id, importance: 5 }, user);
    expect(updated.status).toBe("success");
    expect((updated.result as { importance: number }).importance).toBe(5);
  });

  it("calling update_memory with neither handle fails instead of touching a random row", async () => {
    const r = await runTool(getTool("update_memory")!, { content: "orphan" }, user);
    expect(r.status).toBe("failed");
    const rows = await db.select().from(aiMemory).where(eq(aiMemory.userId, user.id));
    expect(rows.some((m) => m.content === "orphan")).toBe(false);
  });

  it("forget_memory still requires confirmation", async () => {
    const r = await runTool(getTool("forget_memory")!, { key: "work_schedule" }, user);
    expect(r.status).toBe("pending_confirmation");
    const rows = await db.select().from(aiMemory).where(and(eq(aiMemory.userId, user.id), eq(aiMemory.key, "work_schedule")));
    expect(rows).toHaveLength(1); // nothing deleted while it waits
  });

  it("no memory tool accepts a table, a column, raw SQL or someone else's userId", async () => {
    for (const name of ["search_memory", "get_memory", "update_memory", "forget_memory", "remember_memory"]) {
      const shape = JSON.stringify(getTool(name)!.schema);
      for (const forbidden of ["table", "column", "sql", "query", "userId", "user_id", "where"]) {
        expect(shape.toLowerCase(), `${name} must not expose ${forbidden}`).not.toContain(`"${forbidden.toLowerCase()}"`);
      }
    }
  });
});
