# Architecture

## Environment inspection (step 1)
The repository was empty (no commits, no files). The two attachments were:
- `account-confirmation-statement…pdf` → actually **"RUTINA SEMANAL — AYOUB"**, the gym routine (7 pages).
- `deutsch-plataforma.zip` → the existing German learning SPA (Vite/React/Zustand/IndexedDB).

Decisions taken from that inspection: the preferred stack fits (Next.js + PostgreSQL + Drizzle);
Tailwind **3** was chosen over 4 so the German module's Tailwind config, `@apply` styles and palette
could be preserved as-is; React Router stays only inside the German module.

## High-level
```
Browser (PWA, React 19 client components)
  └─ fetch /api/* (JSON, same-origin cookies)
Next.js 16
  ├─ proxy.ts             auth gate for every private route + CSRF origin check on mutations
  ├─ app/(app)/*          module pages (client) inside the Shell (sidebar / bottom nav / search / quick entry)
  ├─ app/api/*            REST route handlers: withAuth → zod → service → audit
  └─ server/
      ├─ auth/            scrypt passwords, DB-backed sessions (hashed tokens, sliding expiry)
      ├─ security/        rate limiting (shared counter in Postgres + in-memory fallback), origin check
      ├─ db/schema/*      Drizzle schema per domain (52 tables)
      ├─ services/*       ALL business logic, user-scoped, reused by API + AI tools + reports
      ├─ ai/              Anthropic client, tool registry (risk levels), agent loop, context, reports
      ├─ market/          provider abstraction (quotes, news, calendar) + implementations
      └─ training/routine.ts  the attached routine, transcribed
modules/german/          the original German project (see docs/german-audit.md)
```

## Data model (Drizzle, `src/server/db/schema`)
| File | Tables |
|---|---|
| core | users, sessions, audit_logs, notifications, ai_conversations, ai_messages, ai_action_logs, ai_memory, ai_reports |
| planning | goals (incl. linked metric: `metric_source`/`metric_kind`/`metric_ref`/`metric_period`), milestones, projects, tasks, events, journal_entries |
| finance | accounts, categories, transactions (expense/income/transfer), recurring_transactions, budgets, savings_goals |
| investing | investment_accounts, investment_assets, investment_transactions, portfolio_snapshots |
| trading | trading_accounts (mode real/paper), strategies, trades (= journal), watchlists, watchlist_items, price_alerts, market_quotes, market_news, economic_events, academy_lessons, academy_progress |
| training | exercises, training_plans, training_days, training_day_exercises, workout_sessions, workout_sets, personal_records |
| nutrition | foods, meals, nutrition_entries |
| studies | subjects, study_sessions, assignments, exams |
| german | german_progress (opaque versioned state), german_events |

Conventions: UUID ids, `user_id` on every user table with `ON DELETE CASCADE` (account deletion is
one statement), `timestamptz`, `numeric` money, a `data_source` enum on important tables
(spec §34), indexes on `(user_id, date/status)`.

## Services layer
One file per module in `src/server/services`. Each exports zod schemas (shared by API routes and
AI tools) and functions that take `userId` first. Cross-module effects live here too, e.g.
`german.recordGermanEvent` → study session → goal progress; `training.logSet` → personal records;
`finance.processRecurring` → transactions.

### Integration rules (phase 1)
- **German has one write path.** `german.recordGermanEvent` is the only function that records German
  learning activity: `german_events` row → one `study_sessions` row on the `german` subject (linked
  `{ type: "german_event", id }`) → minutes added to active goals with category `german` and unit `min`.
  The German module UI posts to `/api/german/events`; `studies.logStudySession` detects the German
  subject (by id, slug, or the names *German / alemán / Deutsch*) and delegates to the same bridge, so
  "he estudiado alemán 45 minutos" typed to the assistant and a lesson finished in the module produce
  identical state in German, Studies, Goals, Analytics, Reviews and Home. Identical events delivered
  twice within 90 s are recorded once. `source` is `user` for module activity, `ai` for the assistant.
- **A workout is a session with at least one working set.** `workoutStatus` = `started` (open, no
  sets) · `in_progress` (sets, open) · `completed` (sets, closed) · `empty` (closed, no sets). Home,
  Analytics, Reviews and `trainingStats` only count sessions with sets; empty ones are reported
  separately (`emptySessions`). Home's training metric is `weeklyTrainingStatus`: workouts this ISO
  week vs the training days the routine's cycle places in that week (no plan → no target invented).
- **Finance balance is not net worth.** `financialSummary.financeBalance` is the balance of Finance
  accounts only (labelled "Cash (Finance)"). Investing and trading (real and paper) are always shown
  separately and never summed into it.
- **Audit policy for non-CRUD writes.** Audited: workout session start/finish/delete, German events,
  nutrition goals, preferences (keys only), notification settings. Not audited on purpose:
  `PUT /api/german/state` — the module persists its whole state on every change; the row's
  `revision`/`updatedAt` is the change trail (see the route comment).

## Domain events (`src/server/events`, phase 2)

```
USER / UI / AI tool
      ↓                     (routes and tools only call services — they never emit)
APPLICATION SERVICE          tasks · training · studies · german · finance
      ↓
DATABASE MUTATION            committed first; the event describes what already happened
      ↓
emitDomainEvent(userId, e)   in-process, synchronous, no queue, no broker, nothing to deploy
      ↓
SUBSCRIBERS (isolated)
      ├── goals          recomputes linked goals from their source of truth
      └── notifications  reacts to the derived goal.progress_changed event only
```

- **Who emits.** Only services, right after their own write. API routes, React components and AI tools
  never emit: they call the service, the service mutates and emits. `emitDomainEvent` returns which
  subscribers ran and which failed; callers ignore it.
- **Isolation.** Every subscriber runs inside its own `try/catch`. A throwing subscriber is logged to the
  console *and* written to `audit_logs` (actor `system`, action `domain_event.subscriber_failed`, with the
  subscriber name, the message and the event), and the remaining subscribers still run. The caller's
  mutation is already committed and is never rolled back: this is best-effort propagation, not a
  distributed transaction. Nothing is swallowed silently.
- **Transactions.** Events are emitted after the write they describe, outside any `db.transaction`, so a
  subscriber can always read the committed row. A failed subscriber leaves goals stale at worst, and the
  next event — or simply opening Goals, which recomputes on read — repairs it.
- **Nesting.** Subscribers may emit derived events (the goals subscriber emits `goal.progress_changed`);
  the bus refuses to go deeper than 3 levels.

### Events
| Event | Emitted by | Meaning |
|---|---|---|
| `task.completed` | `tasks.completeTask`, `tasks.updateTask` | a task moved to done |
| `task.changed` | `tasks.updateTask`, `tasks.deleteTask` | a done task was reopened, relinked or deleted |
| `workout.finished` | `training.updateSession` | a session was closed (payload says how many working sets it has) |
| `workout.changed` | `training.logSet` / `updateSet` / `deleteSet` / `updateSession` / `deleteSession` | sets or session state changed |
| `study.logged` | `studies.insertStudySession` (so also `logStudySession` and the German bridge) | a study session was recorded |
| `study.changed` | `studies.deleteStudySession` | a study session was removed |
| `expense.added` / `income.added` | `finance.createTransaction`, `finance.processRecurring` | a transaction was recorded |
| `transaction.changed` | `finance.updateTransaction` / `deleteTransaction` | an existing transaction changed |
| `german.unit_completed` | `german.recordGermanEvent` | a unit test or exam passed (score ≥ 70) |
| `german.state_saved` | `german.saveGermanState` | the module persisted its own state |
| `goal.progress_changed` | the goals subscriber (derived) | a linked goal's value actually changed |

### Linked goals
A goal may declare where its number comes from: `metricSource` + `metricKind` + `metricPeriod`
(`week` · `month` · `total`) and an optional `metricRef`. Allowed combinations live in
`services/goal-metrics.ts` (`METRIC_SOURCES`) and are validated on create/update — an unsupported
metric is a 400, never a silently dead goal:

| Source | Kind | Read from | Periods |
|---|---|---|---|
| tasks | `completed_tasks` | tasks done in the period, of a project (`metricRef`) or linked to this goal | week · month · total |
| training | `completed_workouts` | sessions with at least one working set | week · month · total |
| training | `volume_kg` | weight × reps of working sets | week · month · total |
| study | `minutes` | `study_sessions`, optionally one subject (`metricRef` = id or slug) | week · month · total |
| german | `minutes` | `study_sessions` on the German subject (the phase‑1 single path) | week · month · total |
| german | `units_passed` | the German module's own state (`testBest ≥ 70`), read-only | total |
| finance | `net_savings` / `income` | `transactions` (transfers excluded) | week · month · total |

**No parallel counters.** `metricCurrent` is a cache of a query, never an accumulator: subscribers call
`goals.recomputeLinkedGoals`, which re-reads the owning module and writes only when the value actually
changed. That is what makes the whole design idempotent — replaying an event, delivering it twice, or
running a recompute for no reason all converge on the same number, so no event ids need to be persisted
and no new table was added. Reads (`listGoals`, `getGoal`) recompute too, which is how period roll-overs
(a new week or month) are picked up even though no event announces them. Manual progress edits
(`updateGoalProgress`, `metricCurrent` in `updateGoal`) are refused for linked goals with a message
pointing at the activity to log; purely manual goals keep working exactly as before. Periodic goals
(week/month) never auto-complete — they reset with their period; `total` goals do.
A goal is **behind pace** (`goalPace`) when at least 40 % of its window has elapsed and it is below 75 %
of a steady pace; goals with no end date are never at risk.

### Audit trail
The existing `audit_logs` table is the only audit system. The user's own action is recorded as before
(actor `user`, e.g. `tasks.complete`, `finance.transaction.create`). Everything the bus causes is
recorded separately as a system consequence: `goal.recomputed` (actor `system`, with the cause event,
the metric and the before/after state) and `domain_event.subscriber_failed`. So a goal moving on its own
is always traceable to the user action that caused it.

### Notifications from events
Only two transitions are pushed, both deduplicated per goal and period: a linked goal **reaching** its
target, and a goal that was behind pace being **back on track**. Ordinary progress sends nothing — no
message per workout, expense or task — and everything is skipped when the user turns goal notifications
off. "Goal at risk" is deliberately *not* emitted here: it becomes true on a quiet day, not on an
action, so it belongs to the daily generator (a later phase).

### Nutrition: energy and macros must agree
Calories and the three macros are four separate columns, so nothing structural stops them contradicting
each other. `services/nutrition.ts` owns the arithmetic and every writer goes through it:
`scaleFactor` turns the quantity into a multiplier (`basis` says whether the given numbers are the total,
per 100 g or per serving, so the model never does the multiplication), `normalizeEntry` scales and then
checks the energy against Atwater (protein×4 + carbs×4 + fat×9) with a tolerance of 25 kcal or 10%.
An **estimate** that falls outside tolerance has its calories recomputed from the macros and the
adjustment is returned to the caller, so the assistant reports what was stored rather than what it
guessed. **User-declared and food-database values are never rewritten** — real labels deviate — but the
discrepancy is reported on read. `totalsOf` is the single summation used by the day view, and the range
summary reports the same check, so a day and a range can never tell different stories.

## AI layer (`src/server/ai`)
- `registry.ts` — `defineTool({ name, module, risk, schema, run, needsConfirmation, summarize })`.
  Adding a tool is one call; `tools/index.ts` imports every tool file.
- `agent.ts` — Anthropic Messages API tool-use loop (≤ 8 rounds). Every tool call goes through
  `runTool`: zod validation → risk gate → execute → `ai_action_logs` row → audit log. Pending
  (medium/high-risk) calls return a *NOT EXECUTED* tool result so the model tells the user it is
  waiting for confirmation; `confirmAction` runs the stored params once you approve in the UI.
- `context.ts` — structured memory: profile, long-term `ai_memory` rows (user-editable), and a
  compact live snapshot (today's tasks/events/training/finance). History is fetched on demand via
  read tools, not stuffed into the prompt.
- `reports.ts` — daily review, weekly review, daily market brief (facts from tools only,
  interpretation labelled), personal planner (planner mode over the same tools), quick entry, news
  interpretation.
- Risk levels: `read` · `low` (immediate) · `medium` (confirm when the tool says so — deletes,
  bulk changes, real trades — or always when the user enables *confirm medium-risk*) · `high`
  (always confirm: transfers, investment transactions).

### AI write capabilities
Rule: **any user-editable application state gets a controlled AI action when that action is
semantically appropriate for an assistant.** Always as an explicit per-domain tool that calls the
domain service — never a generic `update_database(table, fields)`, never SQL, never a table, column or
user id chosen by the model. A tool's reach is exactly the service's reach, so validation, ownership
and the audit trail come for free.

Risk follows impact: `low` for reversible, everyday actions (complete a task or an assignment, tick a
milestone, mark notifications read), `medium` for persistent changes worth a second look (nutrition
targets, a subject's weekly goal, shifting the training cycle, deleting one entry or one set) and
`high` for destructive ones (delete a goal or a project), which always stop for confirmation. The two
destructive tools take the record's **name** as well as its id: the confirmation card can then say
exactly what disappears, and a name that does not match the id refuses to delete anything.

The rule is now closed across the app: every create, update, delete, completion and preference the web
UI offers has a tool, in journal, finance, investing, trading, studies, academy, notifications,
training, goals, projects, nutrition, tasks, calendar, memory and the profile. Removals are
confirmation-gated except three that cost nothing to redo (a price alert, a watchlist symbol, a
notification), which stay `low`.

Documented exceptions, where an AI action would be wrong rather than missing: accepting or rejecting a
plan (the user's decision by design, phase 3.2b), the German module's own progress state (the module
owns it), account security (password, sessions, account deletion), and conversation deletion.

## Market data (`src/server/market`)
`QuoteProvider` / `NewsProvider` / `EconomicCalendarProvider` interfaces. Implemented: Finnhub
(realtime, key), Stooq (delayed/EOD, no key), Yahoo Finance chart endpoint (delayed, no key, unofficial), CoinGecko (crypto, no key), RSS aggregator (13 public
feeds + `EXTRA_NEWS_FEEDS`). `fetchQuotes` tries providers in order per asset class; symbols nobody
can price are reported as missing. Quotes are cached 5 min in `market_quotes`, news 15 min in
`market_news` (deduped by URL, pruned after 30 days).

## Integrations (future)
Add a provider class implementing an interface in `src/server/market/types.ts` and register it in
`index.ts`; for calendars/email/brokers create a service under `src/server/integrations/` and expose
it as tools. Nothing else needs to change.

## Adding a module
1. schema file + `pnpm db:generate` · 2. service with zod schemas · 3. API routes (use `crud()` from
`src/server/crud.ts`) · 4. tools in `src/server/ai/tools/<module>.ts` · 5. page under
`src/app/(app)/<module>` · 6. one line in `src/components/nav.ts`.

## Self-evolving application (phase 7, design)
Not implemented in code by design (the AI must never modify production directly). The intended
pipeline is: request → development agent working on a branch in an isolated environment → tests +
build (`pnpm check`) → preview deployment (Vercel preview per branch) → explicit approval → merge →
deploy. The repo already provides the guardrails: CI (`.github/workflows/ci.yml`), migrations as
files, and a fully typed service/tool layer the agent can inspect.

## Testing
`tests/unit.test.ts` (pure logic: passwords, recurrence, trade metrics, routine transcription, rate
limit, CSRF, CSV, zod→JSON schema) and three integration suites against a real PostgreSQL:
`tests/services.test.ts` (bootstrap, tasks, finance, training, calendar, German bridge, trading
separation, AI tool gating/logging, notifications, search, export), `tests/integration.test.ts`
(phase 1: the single German write path, workouts vs empty sessions, finance balance labelling) and
`tests/events.test.ts` (phase 2: one test per domain event, subscriber failure isolation,
idempotency on replay, cross-user isolation, events with no matching goal, and operations with no
subscriber at all).

## UI system and motion language
- **Primitives** (`src/components/ui/index.tsx`): `Card` (kinds `static` / `interactive` / `clickable`), `Stat` (metric card, `count` for a fast count-up on important numbers only), `Button` (idle / hover / press / loading / success / disabled) and `AsyncButton`, `Modal` (scale 0.97→1 + backdrop fade, bottom sheet on mobile), `ConfirmDialog` + `useConfirm` for destructive actions, `Tabs` with a shared sliding indicator, `Checkbox` with a drawn check mark, `Field`/`FieldError` (height + opacity), `Empty` (contextual copy + action), `Skeleton*` shimmer loaders, `Tooltip`, `Badge`, `Source` (provenance), `Markdown`.
- **Motion** (`src/components/motion`): one token file (`DUR` 120–240 ms, `EASE.out = [0.2,0,0,1]`, variants `fade`/`rise`/`scale`/`slide*`) and primitives `FadeIn`, `Stagger`/`StaggerItem`, `AnimatedList`/`AnimatedItem`, `PageTransition` (opacity 0→1, y 6→0 on route change; entrance only so navigation stays instant and SSR is untouched), `AnimatedNumber`, `Reveal` (in-view), `Presence`. Built on `motion` with `LazyMotion` + `domAnimation` (small feature set) and `MotionConfig reducedMotion="user"`, so `prefers-reduced-motion` disables JS animations as well as CSS transitions.
- **Feedback**: `ToastProvider`/`useToast` (`src/components/toast.tsx`) mounted in the Shell; every create/update/delete shows a toast, task completion offers Undo.
- **Shell**: collapsible sidebar (state in localStorage) with tooltips when collapsed, a single `layoutId` active indicator that slides between items, animated mobile drawer and bottom-nav indicator, and the command palette (`⌘K`: navigation, create actions, AI questions, global search results) in `src/components/shell/CommandPalette.tsx`. Quick entry stays on `⌘J`.
- **Rules**: no bounce, no parallax, no glass/gradients/glow; animations never block input or shift layout; API responses are never cached by the service worker.
