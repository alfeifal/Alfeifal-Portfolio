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
      ├─ security/        rate limiting, origin check
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
| planning | goals, milestones, projects, tasks, events, journal_entries |
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
limit, CSRF, CSV, zod→JSON schema) and `tests/services.test.ts` (integration against a real
PostgreSQL: bootstrap, tasks, finance, training, calendar, German bridge, trading separation, AI tool
gating/logging, notifications, search, export).

## UI system and motion language
- **Primitives** (`src/components/ui/index.tsx`): `Card` (kinds `static` / `interactive` / `clickable`), `Stat` (metric card, `count` for a fast count-up on important numbers only), `Button` (idle / hover / press / loading / success / disabled) and `AsyncButton`, `Modal` (scale 0.97→1 + backdrop fade, bottom sheet on mobile), `ConfirmDialog` + `useConfirm` for destructive actions, `Tabs` with a shared sliding indicator, `Checkbox` with a drawn check mark, `Field`/`FieldError` (height + opacity), `Empty` (contextual copy + action), `Skeleton*` shimmer loaders, `Tooltip`, `Badge`, `Source` (provenance), `Markdown`.
- **Motion** (`src/components/motion`): one token file (`DUR` 120–240 ms, `EASE.out = [0.2,0,0,1]`, variants `fade`/`rise`/`scale`/`slide*`) and primitives `FadeIn`, `Stagger`/`StaggerItem`, `AnimatedList`/`AnimatedItem`, `PageTransition` (opacity 0→1, y 6→0 on route change; entrance only so navigation stays instant and SSR is untouched), `AnimatedNumber`, `Reveal` (in-view), `Presence`. Built on `motion` with `LazyMotion` + `domAnimation` (small feature set) and `MotionConfig reducedMotion="user"`, so `prefers-reduced-motion` disables JS animations as well as CSS transitions.
- **Feedback**: `ToastProvider`/`useToast` (`src/components/toast.tsx`) mounted in the Shell; every create/update/delete shows a toast, task completion offers Undo.
- **Shell**: collapsible sidebar (state in localStorage) with tooltips when collapsed, a single `layoutId` active indicator that slides between items, animated mobile drawer and bottom-nav indicator, and the command palette (`⌘K`: navigation, create actions, AI questions, global search results) in `src/components/shell/CommandPalette.tsx`. Quick entry stays on `⌘J`.
- **Rules**: no bounce, no parallax, no glass/gradients/glow; animations never block input or shift layout; API responses are never cached by the service worker.
