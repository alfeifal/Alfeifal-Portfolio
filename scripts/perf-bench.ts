/**
 * Repeatable performance measurement against a disposable database.
 *
 * WHY IT EXISTS. Phase 3.21 found six tables carrying `user_id` with no leading index and left them
 * alone, because at one account and a few hundred rows there was nothing to measure. This creates the
 * volume that makes the question answerable, and answers it with the application's own service
 * functions rather than with queries invented for the benchmark.
 *
 * WHAT IT MEASURES, and what each number means:
 *   ms       wall clock for the whole scenario, median of the runs
 *   queries  round trips to Postgres. This is the N+1 detector: a scenario whose query count grows
 *            with the row count is doing per-row work no matter how fast each query is.
 *   dbMs     time inside those round trips, so the split between database and JavaScript is visible.
 *
 * Query counting wraps the pool's own `query`, so it counts what the driver actually sent — not what
 * the code looks like it should send.
 *
 *   pnpm perf:seed            # build the disposable database (drops and recreates it)
 *   pnpm perf:bench           # measure, 5 runs per scenario
 *   pnpm perf:bench --json    # same, as JSON, for before/after diffing
 *
 * It refuses any database whose name is not the disposable one, and `src/server/db`'s own guard
 * refuses a non-local host from a non-production process. Production is reachable by neither.
 */
import "dotenv/config";
import { Client } from "pg";

const DB_NAME = "personal_os_perf";
const SOCKET = process.env.PERF_PG_SOCKET ?? "/tmp";
const PORT = process.env.PERF_PG_PORT ?? "5433";
const PERF_URL = `postgres://postgres@localhost:${PORT}/${DB_NAME}?host=${SOCKET}`;
const ADMIN_URL = `postgres://postgres@localhost:${PORT}/postgres?host=${SOCKET}`;

/** "Five years of heavy single-user use", and a second account so isolation is measurable. */
const VOLUME = {
  users: Number(process.env.PERF_USERS ?? 3),
  tasks: 2_000, events: 1_500, transactions: 5_000, journal: 1_800, studySessions: 1_200,
  workoutSessions: 600, setsPerSession: 18, nutritionEntries: 5_000, notifications: 3_000,
  actionLogs: 4_000, milestones: 400, watchlistItems: 120, goals: 40, projects: 30, news: 1_500,
};

const must = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function recreateDatabase() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  // Named explicitly, every time: this statement drops a database.
  must(DB_NAME === "personal_os_perf", "refusing to drop anything but the disposable benchmark database");
  await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();
  console.log(`recreated ${DB_NAME}`);
}

async function migrate() {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate: run } = await import("drizzle-orm/node-postgres/migrator");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: PERF_URL });
  await run(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("migrations applied");
}

const dayKey = (offsetDays: number) => new Date(Date.now() - offsetDays * 86400e3).toISOString().slice(0, 10);

async function seed() {
  const c = new Client({ connectionString: PERF_URL });
  await c.connect();
  const t0 = Date.now();
  const userIds: string[] = [];
  for (let u = 0; u < VOLUME.users; u++) {
    const r = await c.query(
      `insert into users (email, name, password_hash, timezone, role, is_active)
       values ($1,$2,$3,'Europe/Madrid',$4,true) returning id`,
      [`perf${u}@example.com`, `Perf ${u}`, "scrypt$17$8$1$x$y", u === 0 ? "admin" : "user"],
    );
    userIds.push(r.rows[0].id);
  }

  /** One multi-row INSERT per table per user: the seeding itself must not dominate the run. */
  const bulk = async (table: string, cols: string[], rows: unknown[][]) => {
    if (!rows.length) return;
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const params: unknown[] = [];
      const values = slice.map((row) => `(${row.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`).join(",");
      await c.query(`insert into "${table}" (${cols.map((x) => `"${x}"`).join(",")}) values ${values}`, params);
    }
  };

  for (const uid of userIds) {
    const acc = (await c.query(`insert into accounts (user_id, name, type, currency) values ($1,'Main','checking','EUR') returning id`, [uid])).rows[0].id;
    const catIds: string[] = [];
    for (const n of ["Food", "Rent", "Transport", "Fun", "Salary"]) {
      catIds.push((await c.query(`insert into categories (user_id, name, kind) values ($1,$2,$3) returning id`, [uid, n, n === "Salary" ? "income" : "expense"])).rows[0].id);
    }
    const goalIds: string[] = [];
    for (let i = 0; i < VOLUME.goals; i++) goalIds.push((await c.query(`insert into goals (user_id, name, category, status) values ($1,$2,'personal','active') returning id`, [uid, `Goal ${i}`])).rows[0].id);
    const projIds: string[] = [];
    for (let i = 0; i < VOLUME.projects; i++) projIds.push((await c.query(`insert into projects (user_id, name, status) values ($1,$2,'active') returning id`, [uid, `Project ${i}`])).rows[0].id);
    const subj = (await c.query(`insert into subjects (user_id, name) values ($1,'Maths') returning id`, [uid])).rows[0].id;
    const plan = (await c.query(`insert into training_plans (user_id, name, cycle_length, start_date) values ($1,'Cycle',8,current_date) returning id`, [uid])).rows[0].id;
    const exIds: string[] = [];
    for (let i = 0; i < 40; i++) exIds.push((await c.query(`insert into exercises (user_id, name) values ($1,$2) returning id`, [uid, `Exercise ${i}`])).rows[0].id);
    const dayIds: string[] = [];
    for (let i = 0; i < 8; i++) dayIds.push((await c.query(`insert into training_days (user_id, plan_id, day_index, name) values ($1,$2,$3,$4) returning id`, [uid, plan, i, `Day ${i}`])).rows[0].id);
    await bulk("training_day_exercises", ["user_id", "day_id", "exercise_id", "position", "sets", "reps"],
      dayIds.flatMap((d) => exIds.slice(0, 6).map((e, j) => [uid, d, e, j, 4, "8-10"])));
    const wl = (await c.query(`insert into watchlists (user_id, name, is_default) values ($1,'Watchlist',true) returning id`, [uid])).rows[0].id;
    const meal = (await c.query(`insert into meals (user_id, date, type) values ($1,$2,'lunch') returning id`, [uid, dayKey(0)])).rows[0].id;

    await bulk("tasks", ["user_id", "title", "status", "priority", "due_date", "goal_id"],
      Array.from({ length: VOLUME.tasks }, (_, i) => [uid, `Task ${i}`, i % 4 === 0 ? "done" : "todo", ["low", "medium", "high", "urgent"][i % 4], dayKey(i % 900 - 30), i % 7 === 0 ? goalIds[i % goalIds.length] : null]));
    await bulk("events", ["user_id", "title", "start_at", "end_at", "kind", "goal_id", "project_id"],
      Array.from({ length: VOLUME.events }, (_, i) => [uid, `Event ${i}`, new Date(Date.now() - (i % 900 - 30) * 86400e3), new Date(Date.now() - (i % 900 - 30) * 86400e3 + 3600e3), "work", i % 11 === 0 ? goalIds[i % goalIds.length] : null, i % 13 === 0 ? projIds[i % projIds.length] : null]));
    await bulk("transactions", ["user_id", "type", "amount", "date", "description", "account_id", "category_id"],
      Array.from({ length: VOLUME.transactions }, (_, i) => [uid, i % 9 === 0 ? "income" : "expense", (10 + (i % 300)).toFixed(2), dayKey(i % 1800), `Tx ${i}`, acc, catIds[i % catIds.length]]));
    await bulk("journal_entries", ["user_id", "date", "content", "kind"],
      Array.from({ length: VOLUME.journal }, (_, i) => [uid, dayKey(i % 1800), `Entry ${i} about things that happened`, "daily"]));
    await bulk("study_sessions", ["user_id", "date", "duration_minutes", "subject_id"],
      Array.from({ length: VOLUME.studySessions }, (_, i) => [uid, dayKey(i % 900), 30 + (i % 60), subj]));
    const sessionIds: string[] = [];
    for (let i = 0; i < VOLUME.workoutSessions; i++) {
      sessionIds.push((await c.query(`insert into workout_sessions (user_id, date, plan_id, day_id) values ($1,$2,$3,$4) returning id`, [uid, dayKey(i % 900), plan, dayIds[i % dayIds.length]])).rows[0].id);
    }
    await bulk("workout_sets", ["user_id", "session_id", "exercise_id", "set_number", "reps", "weight_kg"],
      sessionIds.flatMap((s, i) => Array.from({ length: VOLUME.setsPerSession }, (_, j) => [uid, s, exIds[(i + j) % exIds.length], j + 1, 10, "60.00"])));
    await bulk("nutrition_entries", ["user_id", "meal_id", "description", "calories", "protein"],
      Array.from({ length: VOLUME.nutritionEntries }, (_, i) => [uid, meal, `Food ${i}`, (200 + (i % 500)).toFixed(2), "20.00"]));
    await bulk("notifications", ["user_id", "kind", "title", "dedupe_key", "read_at"],
      Array.from({ length: VOLUME.notifications }, (_, i) => [uid, "task", `Notification ${i}`, `seed:${i}`, i % 3 === 0 ? null : new Date()]));
    await bulk("ai_action_logs", ["user_id", "tool", "risk", "status", "summary"],
      Array.from({ length: VOLUME.actionLogs }, (_, i) => [uid, "add_expense", "low", "success", `did thing ${i}`]));
    await bulk("milestones", ["user_id", "title", "goal_id", "completed_at", "position"],
      Array.from({ length: VOLUME.milestones }, (_, i) => [uid, `Milestone ${i}`, goalIds[i % goalIds.length], i % 2 === 0 ? new Date() : null, i]));
    await bulk("watchlist_items", ["user_id", "watchlist_id", "symbol", "position"],
      Array.from({ length: VOLUME.watchlistItems }, (_, i) => [uid, wl, `SYM${i}`, i]));
    await bulk("german_progress", ["user_id", "state"],
      [[uid, JSON.stringify({ units: Object.fromEntries(Array.from({ length: 28 }, (_, i) => [`u${i + 1}`, { passed: i < 10 }])) })]]);
  }
  // Shared reference data, not per user.
  await bulk("market_news", ["headline", "source", "url", "published_at", "category", "provider"],
    Array.from({ length: VOLUME.news }, (_, i) => [`Headline ${i}`, "Source", `https://example.com/${i}`, new Date(Date.now() - i * 3600e3), "global", "rss"]));

  await c.query("analyze");
  const counts = await c.query(`select relname, n_live_tup from pg_stat_user_tables where n_live_tup > 0 order by n_live_tup desc limit 12`);
  await c.end();
  console.log(`seeded ${VOLUME.users} users in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const r of counts.rows) console.log(`  ${String(r.n_live_tup).padStart(7)}  ${r.relname}`);
}

async function bench() {
  // Assigned before the first `await import`, because src/server/db fixes its connection string at
  // module evaluation — the mistake SEC-008 came from. Object.assign sidesteps NODE_ENV being typed
  // read-only without changing what it does.
  Object.assign(process.env, {
    NODE_ENV: "test", DATABASE_DRIVER: "pg", DATABASE_SSL: "false",
    TEST_DATABASE_URL: PERF_URL, DATABASE_URL: PERF_URL,
    AUTH_SECRET: process.env.AUTH_SECRET ?? "perf-bench",
  });

  const { db, pool } = await import("@/server/db");
  const { users } = await import("@/server/db/schema");
  const { eq } = await import("drizzle-orm");

  // Count what the driver actually sends, not what the code appears to send.
  let queries = 0, dbMs = 0, counting = false;
  /** Query text -> times sent in this scenario. The same text twice is a repeated query. */
  let seen = new Map<string, number>();
  const p = pool as unknown as { query: (...a: unknown[]) => Promise<unknown> };
  const original = p.query.bind(p);
  p.query = async (...args: unknown[]) => {
    if (!counting) return original(...args);
    /*
     * Keyed on text AND parameters. The first version keyed on text alone and reported the analytics
     * aggregates as duplicated — they are the same statement run for this period and the previous
     * one, which is reuse of a prepared statement, not repeated work. A true duplicate is the same
     * statement with the same arguments.
     */
    const first = args[0] as { text?: string } | string | undefined;
    const text = (typeof first === "string" ? first : first?.text) ?? "(unknown)";
    const params = Array.isArray(args[1]) ? args[1] : (first as { values?: unknown[] } | undefined)?.values;
    const key = text + " ⟨" + JSON.stringify(params ?? []) + "⟩";
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const t = performance.now();
    try { return await original(...args); } finally { queries++; dbMs += performance.now() - t; }
  };

  const [u] = await db.select().from(users).where(eq(users.email, "perf0@example.com"));
  must(u, "seed first: pnpm perf:seed");
  const user = u as unknown as import("@/server/auth/session").SessionUser;

  const snapshot = await import("@/server/services/snapshot");
  const analytics = await import("@/server/services/analytics");
  const search = await import("@/server/services/search");
  const notifications = await import("@/server/services/notifications");
  const finance = await import("@/server/services/finance");
  const tasks = await import("@/server/services/tasks");
  const training = await import("@/server/services/training");
  const admin = await import("@/server/services/admin");
  const context = await import("@/server/ai/context");
  const maintenance = await import("@/server/services/maintenance");

  const SCENARIOS: { name: string; run: () => Promise<unknown> }[] = [
    { name: "ai: system prompt (compact snapshot + memory)", run: () => context.buildSystemPrompt(user) },
    { name: "ai: lifeSnapshot, all sections", run: () => snapshot.lifeSnapshot(user, { sections: snapshot.SNAPSHOT_SECTIONS }) },
    { name: "analytics: overview, month", run: () => analytics.analyticsOverview(user.id, "month", user.timezone) },
    { name: "analytics: overview, year", run: () => analytics.analyticsOverview(user.id, "year", user.timezone) },
    { name: "search: common term", run: () => search.globalSearch(user.id, "Task") },
    { name: "notifications: generate", run: () => notifications.generateNotifications(user.id, user.timezone) },
    { name: "notifications: list unread", run: () => notifications.listNotifications(user.id, { unreadOnly: true }) },
    { name: "finance: transactions, default page", run: () => finance.listTransactions(user.id, {}) },
    { name: "finance: 1-year summary", run: () => finance.financialSummary(user.id, { from: "2025-10-01", to: "2026-10-01" }) },
    { name: "tasks: list open", run: () => tasks.listTasks(user.id, { status: "todo" }) },
    { name: "training: personal records", run: () => training.listPersonalRecords(user.id) },
    { name: "admin: user list", run: () => admin.listUsers({}) },
    { name: "cron: daily maintenance, all users", run: () => maintenance.runMaintenance(["daily"]) },
  ];

  const runs = Number(process.env.PERF_RUNS ?? 5);
  const out: { name: string; ms: number; queries: number; dbMs: number; error?: string }[] = [];
  const repeats = new Map<string, [string, number][]>();
  for (const s of SCENARIOS) {
    const samples: { ms: number; q: number; db: number }[] = [];
    let error: string | undefined;
    for (let i = 0; i < runs; i++) {
      queries = 0; dbMs = 0; seen = new Map(); counting = true;
      const t = performance.now();
      try { await s.run(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
      const ms = performance.now() - t;
      counting = false;
      samples.push({ ms, q: queries, db: dbMs });
      if (i === runs - 1) repeats.set(s.name, [...seen.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]));
      if (error) break;
    }
    out.push({ name: s.name, ms: Math.round(med(samples.map((x) => x.ms))), queries: med(samples.map((x) => x.q)), dbMs: Math.round(med(samples.map((x) => x.db))), ...(error ? { error } : {}) });
  }

  if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 1));
  else {
    console.log(`\nmedian of ${runs} runs, ${VOLUME.users} users, disposable ${DB_NAME}\n`);
    console.log("      ms  queries    dbMs  scenario");
    for (const r of out) console.log(`${String(r.ms).padStart(8)} ${String(r.queries).padStart(8)} ${String(r.dbMs).padStart(7)}  ${r.name}${r.error ? `   !! ${r.error}` : ""}`);
    // The same statement text sent more than once in one scenario: either a legitimate per-row read
    // or something that should have been hoisted. Printed so the judgement is made on evidence.
    console.log("\nidentical statements sent more than once in a single run:");
    let any = false;
    for (const [name, list] of repeats) {
      if (!list.length) continue;
      any = true;
      console.log(`  ${name}`);
      for (const [text, n] of list.slice(0, 4)) console.log(`    ${String(n).padStart(4)}x  ${text.replace(/\s+/g, " ").slice(0, 104)}`);
    }
    if (!any) console.log("  none");
  }
  await (pool as unknown as { end: () => Promise<void> }).end();
}

async function main() {
  const mode = process.argv[2];
  if (mode === "seed") { await recreateDatabase(); await migrate(); await seed(); }
  else if (mode === "bench") await bench();
  else throw new Error("usage: perf-bench.ts seed|bench");
  process.exit(0);
}
main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
