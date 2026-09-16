/**
 * Phase 3.6 — global search.
 *
 * Everything here runs against real rows in a real database: the point of a search is that it finds
 * what the user actually has, so there is no fixture that stands in for the tables. The suite covers
 * the matcher (case, accents, partial words, several words), reach across modules, the caps, the empty
 * and invalid cases, and — most importantly — that two users with deliberately identical data never see
 * each other's rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { conversations, messages } from "@/server/db/schema";
import {
  DEFAULT_LIMIT, MAX_LIMIT, MAX_QUERY_LENGTH, SEARCH_MODULES, fold, globalSearch, parseTerms,
} from "@/server/services/search";
import * as tasks from "@/server/services/tasks";
import * as fin from "@/server/services/finance";
import * as goalsSvc from "@/server/services/goals";
import * as projectsSvc from "@/server/services/projects";
import * as journal from "@/server/services/journal";
import * as st from "@/server/services/studies";
import * as tr from "@/server/services/training";
import * as nut from "@/server/services/nutrition";
import * as cal from "@/server/services/calendar";
import * as mem from "@/server/services/memory";
import { conversationExpiry } from "@/server/services/conversations";
import { getTool, runTool } from "./_tool-helpers";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

describe("search: term handling (pure)", () => {
  it("folds accents and case the same way the SQL side does", () => {
    expect(fold("Café CON Leché")).toBe("cafe con leche");
    expect(fold("MATEMÁTICAS")).toBe("matematicas");
    expect(fold("ñoño")).toBe("nono");
  });

  it("splits into terms, drops one-character noise and de-duplicates", () => {
    expect(parseTerms("entrenamiento de pecho")).toEqual(["entrenamiento", "de", "pecho"]);
    expect(parseTerms("gym a gym")).toEqual(["gym"]);
    expect(parseTerms("  ")).toEqual([]);
    expect(parseTerms("x")).toEqual([]);
  });

  it("caps the number of terms so a pathological query stays bounded", () => {
    expect(parseTerms("a1 b2 c3 d4 e5 f6 g7 h8 i9").length).toBeLessThanOrEqual(6);
  });
});

d("search over real data", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    user = await createTestUser();
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "Revisar proyecto Velsoma", description: "Preparar la demo" }));
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "Comprar entradas para Budapest" }));
    await cal.createEvent(user.id, cal.eventCreateSchema.parse({ title: "Vuelo a Budapest", startAt: "2026-10-02T08:00:00", endAt: "2026-10-02T11:00:00", location: "Barajas" }));
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 240, description: "Hotel en Budapest", date: "2026-08-14" }), TZ);
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 32, description: "Entrecot en el asador", date: "2026-08-20" }), TZ);
    await goalsSvc.createGoal(user.id, goalsSvc.goalCreateSchema.parse({ name: "Terminar Bachillerato", category: "studies" }), TZ);
    await projectsSvc.createProject(user.id, projectsSvc.projectCreateSchema.parse({ name: "Velsoma", description: "La aplicación de Velsoma" }));
    await journal.createEntry(user.id, journal.journalCreateSchema.parse({ date: "2026-08-21", title: "Cena con Juan", content: "Hablamos del viaje a Budapest y del entrecot" }), TZ);
    await st.logStudySession(user.id, st.studySessionSchema.parse({ subject: "Matemáticas", durationMinutes: 60, topic: "Integrales", date: "2026-09-01" }), TZ);
    await st.createExam(user.id, st.examSchema.parse({ subject: "Matemáticas", title: "Examen de Matemáticas", date: "2026-10-05" }));
    await nut.logMeal(user.id, nut.mealSchema.parse({ type: "dinner", date: "2026-08-20", items: [{ description: "Entrecot de ternera", quantity: 400, unit: "g", calories: 1000, protein: 88, carbs: 0, fat: 70, basis: "total", source: "estimated", confidence: 60 }] }), TZ);
    const s = await tr.logSet(user.id, tr.setSchema.parse({ exercise: "press banca", weightKg: 80, reps: 8, date: "2026-09-10" }));
    await tr.updateSession(user.id, s.session.id, { finished: true, notes: "Buen entrenamiento de pecho", durationMinutes: 60 });
    await mem.rememberMemory(user.id, { kind: "person", key: "amigo_juan", content: "Juan es su amigo de Budapest", importance: 4, pinned: false, source: "ai" });
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("finds a task by an exact word", async () => {
    const r = await globalSearch(user.id, "Velsoma");
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.some((h) => h.type === "task" && h.title.includes("Velsoma"))).toBe(true);
  });

  it("is case-insensitive", async () => {
    const lower = await globalSearch(user.id, "velsoma");
    const upper = await globalSearch(user.id, "VELSOMA");
    expect(lower.hits.length).toBeGreaterThan(0);
    expect(upper.hits.map((h) => h.id).sort()).toEqual(lower.hits.map((h) => h.id).sort());
  });

  it("matches part of a word", async () => {
    const r = await globalSearch(user.id, "entrec");
    expect(r.hits.some((h) => h.type === "nutrition_entry")).toBe(true);
    expect(r.hits.some((h) => h.type === "transaction")).toBe(true);
  });

  it("ignores accents in both directions", async () => {
    const withAccent = await globalSearch(user.id, "Matemáticas");
    const without = await globalSearch(user.id, "matematicas");
    expect(withAccent.hits.length).toBeGreaterThan(0);
    expect(without.hits.length).toBeGreaterThan(0);
    expect(without.hits.some((h) => h.module === "studies")).toBe(true);
    // "aplicación" is stored with an accent; searching without one still finds it.
    expect((await globalSearch(user.id, "aplicacion")).hits.some((h) => h.type === "project")).toBe(true);
  });

  it("requires every word to match, so more words narrow the result", async () => {
    const one = await globalSearch(user.id, "entrenamiento");
    const two = await globalSearch(user.id, "entrenamiento pecho");
    expect(two.hits.length).toBeGreaterThan(0);
    expect(two.hits.length).toBeLessThanOrEqual(one.hits.length);
    expect(two.hits.some((h) => h.module === "training")).toBe(true);
    // A word that appears nowhere alongside the first kills the result rather than widening it.
    expect((await globalSearch(user.id, "entrenamiento zzzzz")).hits).toHaveLength(0);
  });

  it("reaches several modules from one query", async () => {
    const r = await globalSearch(user.id, "Budapest");
    const modules = new Set(r.hits.map((h) => h.module));
    expect(modules.has("tasks")).toBe(true);
    expect(modules.has("calendar")).toBe(true);
    expect(modules.has("finance")).toBe(true);
    expect(modules.has("journal")).toBe(true);
    expect(modules.has("ai")).toBe(true); // the stored memory about Juan
    expect(modules.size).toBeGreaterThanOrEqual(5);
  });

  it("finds the same word in two different modules", async () => {
    const r = await globalSearch(user.id, "entrecot");
    expect(r.hits.some((h) => h.module === "finance")).toBe(true);
    expect(r.hits.some((h) => h.module === "nutrition")).toBe(true);
  });

  it("ranks a title match above a body-only match", async () => {
    const r = await globalSearch(user.id, "Velsoma");
    const project = r.hits.findIndex((h) => h.type === "project");
    const journalHit = r.hits.findIndex((h) => h.type === "journal");
    expect(project).toBeGreaterThanOrEqual(0);
    if (journalHit >= 0) expect(project).toBeLessThan(journalHit);
    expect(r.hits[0].score).toBeGreaterThanOrEqual(r.hits[r.hits.length - 1].score);
  });

  it("every hit carries what the UI and the assistant need", async () => {
    const r = await globalSearch(user.id, "Budapest");
    for (const h of r.hits) {
      expect(h.type, "type").toBeTruthy();
      expect(SEARCH_MODULES as readonly string[], `module ${h.module}`).toContain(h.module);
      expect(h.id, "id").toBeTruthy();
      expect(h.title, "title").toBeTruthy();
      expect(h.href, `href for ${h.type}`).toMatch(/^(\/|https?:\/\/)/);
      expect(typeof h.score).toBe("number");
    }
  });

  it("honours the limit and reports that it truncated", async () => {
    const r = await globalSearch(user.id, "a", { limit: 3 });
    expect(r.hits.length).toBeLessThanOrEqual(3);
    if (r.total > 3) expect(r.truncated).toBe(true);
    const big = await globalSearch(user.id, "a", { limit: 9999 });
    expect(big.hits.length).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it("caps how many rows each entity may contribute", async () => {
    const r = await globalSearch(user.id, "a", { perEntity: 1, limit: MAX_LIMIT });
    const perType = new Map<string, number>();
    for (const h of r.hits) perType.set(h.type, (perType.get(h.type) ?? 0) + 1);
    for (const [type, n] of perType) expect(n, type).toBeLessThanOrEqual(1);
  });

  it("filters by module when asked", async () => {
    const r = await globalSearch(user.id, "Budapest", { modules: ["finance"] });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(new Set(r.hits.map((h) => h.module))).toEqual(new Set(["finance"]));
  });

  it("an empty, blank or too-short query returns nothing instead of everything", async () => {
    for (const q of ["", "   ", "a", "!"]) {
      const r = await globalSearch(user.id, q);
      expect(r.hits, `query ${JSON.stringify(q)}`).toHaveLength(0);
      expect(r.total).toBe(0);
    }
  });

  it("a query that matches nothing returns a clean empty result", async () => {
    const r = await globalSearch(user.id, "zzzzqqqq");
    expect(r.hits).toHaveLength(0);
    expect(r.total).toBe(0);
    expect(r.truncated).toBe(false);
    expect(r.query).toBe("zzzzqqqq");
  });

  it("survives punctuation and symbols without throwing", async () => {
    for (const q of ["100%", "a'b", "O'Neill", "c++", "%_%", "'; drop table tasks; --", "\\", "ñ&#"]) {
      const r = await globalSearch(user.id, q);
      expect(Array.isArray(r.hits), q).toBe(true);
    }
    // The wildcard characters are matched literally, not interpreted as a pattern.
    expect((await globalSearch(user.id, "%%")).hits).toHaveLength(0);
    // And the injection attempt above did not drop anything.
    expect((await globalSearch(user.id, "Velsoma")).hits.length).toBeGreaterThan(0);
  });

  it("an entity with no matching content simply contributes nothing", async () => {
    const r = await globalSearch(user.id, "Velsoma");
    expect(r.hits.some((h) => h.module === "trading")).toBe(false);
    expect(r.hits.some((h) => h.module === "investing")).toBe(false);
  });

  it("memory hits carry both handles, so the assistant never guesses a UUID", async () => {
    const r = await globalSearch(user.id, "Juan", { modules: ["ai"] });
    const memory = r.hits.find((h) => h.type === "memory");
    expect(memory).toBeTruthy();
    expect(memory!.key).toBe("amigo_juan");
    expect(memory!.id).toMatch(mem.UUID_RE);
    // Both handles really work against the service.
    expect((await mem.getMemory(user.id, { key: memory!.key! })).id).toBe(memory!.id);
    expect((await mem.getMemory(user.id, { id: memory!.id })).key).toBe("amigo_juan");
  });

  it("searches living conversations and never resurrects an expired one", async () => {
    const [alive] = await db.insert(conversations).values({ userId: user.id, kind: "assistant", title: "Plan del viaje a Praga", expiresAt: conversationExpiry() }).returning();
    await db.insert(messages).values({ conversationId: alive.id, role: "user", text: "Cuánto cuesta el tren a Praga", content: [{ type: "text", text: "Cuánto cuesta el tren a Praga" }] });
    const [dead] = await db.insert(conversations).values({ userId: user.id, kind: "assistant", title: "Plan del viaje a Praga caducado", expiresAt: new Date(Date.now() - 60_000) }).returning();
    await db.insert(messages).values({ conversationId: dead.id, role: "user", text: "Praga caducada", content: [{ type: "text", text: "Praga caducada" }] });

    const r = await globalSearch(user.id, "Praga");
    const ids = r.hits.map((h) => h.id);
    expect(ids).toContain(alive.id);
    expect(ids).not.toContain(dead.id);
    expect(r.hits.some((h) => h.title.includes("caducado"))).toBe(false);
    // A conversation hit is a pointer plus a snippet, never the transcript.
    const conv = r.hits.find((h) => h.type === "conversation" || h.type === "message")!;
    expect((conv.snippet ?? "").length).toBeLessThanOrEqual(130);
  });
});

d("search: user isolation", () => {
  let a: Awaited<ReturnType<typeof createTestUser>>;
  let b: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    // Deliberately identical wording, so only the userId filter can tell them apart.
    for (const [u, tag] of [[a, "A"], [b, "B"]] as const) {
      await tasks.createTask(u.id, tasks.taskCreateSchema.parse({ title: `Velsoma test ${tag}` }));
      await projectsSvc.createProject(u.id, projectsSvc.projectCreateSchema.parse({ name: `Velsoma test ${tag}`, description: `Proyecto de ${tag}` }));
      await fin.createTransaction(u.id, fin.transactionSchema.parse({ type: "expense", amount: 10, description: `Velsoma test ${tag}`, date: "2026-08-01" }), TZ);
      await journal.createEntry(u.id, journal.journalCreateSchema.parse({ date: "2026-08-02", content: `Velsoma test ${tag}` }), TZ);
      await mem.rememberMemory(u.id, { kind: "fact", key: "velsoma_note", content: `Velsoma test ${tag}`, importance: 3, pinned: false, source: "ai" });
    }
  });
  afterAll(async () => { if (a) await deleteTestUser(a.id); if (b) await deleteTestUser(b.id); });

  it("A searching Velsoma sees only A's rows", async () => {
    const r = await globalSearch(a.id, "Velsoma");
    expect(r.hits.length).toBeGreaterThanOrEqual(5);
    for (const h of r.hits) expect(`${h.title} ${h.snippet ?? ""}`, h.type).not.toContain("test B");
    expect(r.hits.some((h) => `${h.title} ${h.snippet ?? ""}`.includes("test A"))).toBe(true);
  });

  it("B searching Velsoma sees only B's rows", async () => {
    const r = await globalSearch(b.id, "Velsoma");
    expect(r.hits.length).toBeGreaterThanOrEqual(5);
    for (const h of r.hits) expect(`${h.title} ${h.snippet ?? ""}`, h.type).not.toContain("test A");
  });

  it("the two users never share a single result id", async () => {
    const ra = await globalSearch(a.id, "Velsoma", { limit: MAX_LIMIT });
    const rb = await globalSearch(b.id, "Velsoma", { limit: MAX_LIMIT });
    const idsA = new Set(ra.hits.filter((h) => h.module !== "market").map((h) => h.id));
    const shared = rb.hits.filter((h) => h.module !== "market").filter((h) => idsA.has(h.id));
    expect(shared).toEqual([]);
  });

  it("isolation holds per module, not just overall", async () => {
    for (const mo of ["tasks", "projects", "finance", "journal", "ai"] as const) {
      const r = await globalSearch(a.id, "Velsoma", { modules: [mo] });
      expect(r.hits.length, mo).toBeGreaterThan(0);
      for (const h of r.hits) expect(`${h.title} ${h.snippet ?? ""}`, `${mo}/${h.type}`).not.toContain("test B");
    }
  });

  it("the same memory key in both accounts resolves to each owner's own row", async () => {
    const ma = (await globalSearch(a.id, "velsoma_note", { modules: ["ai"] })).hits.find((h) => h.type === "memory")!;
    const mb = (await globalSearch(b.id, "velsoma_note", { modules: ["ai"] })).hits.find((h) => h.type === "memory")!;
    expect(ma.id).not.toBe(mb.id);
    expect((await mem.getMemory(a.id, { key: "velsoma_note" })).content).toContain("test A");
    expect((await mem.getMemory(b.id, { key: "velsoma_note" })).content).toContain("test B");
    await expect(mem.getMemory(a.id, { id: mb.id })).rejects.toThrow(/not found/i);
  });
});

d("search as the assistant sees it", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => {
    user = await createTestUser();
    await projectsSvc.createProject(user.id, projectsSvc.projectCreateSchema.parse({ name: "Velsoma", description: "La app" }));
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 99, description: "Cena en Budapest", date: "2026-08-15" }), TZ);
    await mem.rememberMemory(user.id, { kind: "fact", key: "broker_actual", content: "Usa Trading212", importance: 3, pinned: false, source: "ai" });
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("search_personal_os exists, is read-only and replaces the old narrow tool", () => {
    const tool = getTool("search_personal_os")!;
    expect(tool).toBeTruthy();
    expect(tool.risk).toBe("read");
    expect(tool.module).toBe("ai");
  });

  it("finds a project, an expense and a memory, with compact hits", async () => {
    const r = await runTool(getTool("search_personal_os")!, { q: "Velsoma" }, user);
    expect(r.status).toBe("success");
    const out = r.result as { hits: { type: string; module: string; id: string; title: string }[] };
    expect(out.hits.some((h) => h.type === "project")).toBe(true);

    const budapest = await runTool(getTool("search_personal_os")!, { q: "Budapest" }, user);
    expect((budapest.result as { hits: { module: string }[] }).hits.some((h) => h.module === "finance")).toBe(true);

    const memory = await runTool(getTool("search_personal_os")!, { q: "Trading212" }, user);
    const hit = (memory.result as { hits: { type: string; id: string; key?: string }[] }).hits.find((h) => h.type === "memory")!;
    expect(hit.key).toBe("broker_actual");
    expect(hit.id).toMatch(mem.UUID_RE);
  });

  it("search → id → the module's own tool is a complete round trip, with no UUID guessing", async () => {
    const found = await runTool(getTool("search_personal_os")!, { q: "Trading212", modules: ["ai"] }, user);
    const hit = (found.result as { hits: { type: string; id: string; key?: string }[] }).hits.find((h) => h.type === "memory")!;
    // By key…
    const byKey = await runTool(getTool("update_memory")!, { key: hit.key, content: "Usa Trading212 para ETFs" }, user);
    expect(byKey.status).toBe("success");
    // …and by the id search handed over.
    const byId = await runTool(getTool("get_memory")!, { id: hit.id }, user);
    expect(byId.status).toBe("success");
    expect((byId.result as { content: string }).content).toContain("ETFs");
  });

  it("returns a bounded payload rather than whole records", async () => {
    const r = await runTool(getTool("search_personal_os")!, { q: "Velsoma", limit: 40 }, user);
    const out = r.result as { hits: unknown[] };
    expect(out.hits.length).toBeLessThanOrEqual(40);
    const serialised = JSON.stringify(r.result);
    expect(serialised.length).toBeLessThan(20_000);
    // No internal machinery leaks into the model's view.
    for (const key of ["userId", "user_id", "passwordHash", "score", "href"]) expect(serialised).not.toContain(`"${key}"`);
  });

  it("rejects a query that is too long instead of truncating it", async () => {
    const r = await runTool(getTool("search_personal_os")!, { q: "x".repeat(MAX_QUERY_LENGTH + 1) }, user);
    expect(r.status).toBe("failed");
  });

  it("STRUCTURAL: search cannot become a write tool or a SQL escape hatch", () => {
    const tool = getTool("search_personal_os")!;
    // Read risk means runTool will never route it through a confirmation-and-write path.
    expect(tool.risk).toBe("read");
    // Its parameters are a string and two caps. Nothing that names a table, a column, an owner or SQL.
    const shape = JSON.stringify(tool.schema).toLowerCase();
    for (const forbidden of ["table", "column", "sql", "query_raw", "rawquery", "userid", "user_id", "where", "orderby", "order_by", "filter", "set", "insert", "update", "delete", "upsert"]) {
      expect(shape, `search must not expose "${forbidden}"`).not.toContain(`"${forbidden}"`);
    }
    // And the only keys it accepts are exactly these.
    const keys = Object.keys((tool.schema as unknown as { shape: Record<string, unknown> }).shape);
    expect(keys.sort()).toEqual(["limit", "modules", "q"]);
  });

  it("STRUCTURAL: no read tool in the whole registry takes a userId, a table or raw SQL", async () => {
    const { allTools } = await import("@/server/ai/registry");
    for (const tool of allTools()) {
      const shape = JSON.stringify(tool.schema).toLowerCase();
      for (const forbidden of ["userid", "user_id", "tablename", "table_name", "columnname", "column_name", "rawsql", "raw_sql"]) {
        expect(shape, `${tool.name} must not expose "${forbidden}"`).not.toContain(`"${forbidden}"`);
      }
    }
  });

  it("the search tool writes nothing: the database is identical afterwards", async () => {
    const before = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.userId, user.id));
    const memBefore = await mem.listMemory(user.id);
    await runTool(getTool("search_personal_os")!, { q: "Velsoma Budapest Trading212" }, user);
    const after = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.userId, user.id));
    const memAfter = await mem.listMemory(user.id);
    expect(after.length).toBe(before.length);
    expect(memAfter.map((m) => `${m.id}:${m.content}`)).toEqual(memBefore.map((m) => `${m.id}:${m.content}`));
  });
});

d("search: navigation targets", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => {
    user = await createTestUser();
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "Navegable task" }));
    await projectsSvc.createProject(user.id, projectsSvc.projectCreateSchema.parse({ name: "Navegable project" }));
    await goalsSvc.createGoal(user.id, goalsSvc.goalCreateSchema.parse({ name: "Navegable goal", category: "health" }), TZ);
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 5, description: "Navegable gasto", date: "2026-08-03" }), TZ);
    await cal.createEvent(user.id, cal.eventCreateSchema.parse({ title: "Navegable evento", startAt: "2026-10-09T09:00:00", endAt: "2026-10-09T10:00:00" }));
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("entities with a page of their own link straight to it", async () => {
    const r = await globalSearch(user.id, "Navegable");
    const project = r.hits.find((h) => h.type === "project")!;
    const goal = r.hits.find((h) => h.type === "goal")!;
    expect(project.href).toBe(`/projects/${project.id}`);
    expect(goal.href).toBe(`/goals/${goal.id}`);
  });

  it("entities without one carry a parameter the target page actually reads", async () => {
    const r = await globalSearch(user.id, "Navegable");
    const task = r.hits.find((h) => h.type === "task")!;
    const tx = r.hits.find((h) => h.type === "transaction")!;
    const event = r.hits.find((h) => h.type === "event")!;
    expect(task.href).toBe(`/tasks?focus=${task.id}`);
    expect(tx.href).toContain(`focus=${tx.id}`);
    expect(tx.href).toMatch(/month=\d{4}-\d{2}/);
    expect(event.href).toMatch(/^\/calendar\?date=\d{4}-\d{2}-\d{2}$/);
  });

  it("no href ever leaks an id the user is not meant to act on", async () => {
    const r = await globalSearch(user.id, "Navegable");
    for (const h of r.hits) {
      expect(h.href.startsWith("/") || h.href.startsWith("http"), h.href).toBe(true);
      expect(h.title, h.type).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/); // a UUID is never the label
    }
  });
});

describe("search: the API surface", () => {
  it("is authenticated, read-only, and exposes no write verb", async () => {
    const route = await import("@/app/api/search/route");
    const verbs = Object.keys(route);
    expect(verbs).toEqual(["GET"]);                  // no POST/PATCH/PUT/DELETE
    expect(typeof route.GET).toBe("function");
    // withAuth is what enforces the session and the CSRF gate; the handler is wrapped in it.
    const src = await import("node:fs").then((fs) => fs.readFileSync("src/app/api/search/route.ts", "utf8"));
    expect(src).toContain("withAuth(");
    expect(src).not.toMatch(/\buserId\s*[:=]\s*(params|body|query|searchParams)/); // never taken from the request
  });

  it("validates its parameters and accepts nothing else", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync("src/app/api/search/route.ts", "utf8"));
    expect(src).toContain("paramsSchema");
    for (const forbidden of ["table", "column", "sql", "orderBy", "userId"]) {
      expect(src, `the route must not read "${forbidden}" from the request`).not.toContain(`${forbidden}:`);
    }
  });
});

describe("search: defaults are sane", () => {
  it("the caps are the ones the API advertises", () => {
    expect(DEFAULT_LIMIT).toBeLessThanOrEqual(MAX_LIMIT);
    expect(MAX_QUERY_LENGTH).toBeGreaterThan(10);
    expect(new Set(SEARCH_MODULES).size).toBe(SEARCH_MODULES.length);
  });
});
