# Architecture status

Written from the repository at `7420655` + the 3.25 changes, not from prior reports.
`docs/ARCHITECTURE.md` remains the design document; this file records what is actually true now,
including the parts that are true and unwelcome.

## Shape

Next.js 16 App Router on Vercel, React 19, TypeScript, Tailwind, Drizzle over Postgres (Neon).
One deployment, one database, no separate API service.

```
browser
  └─ proxy.ts            edge gate: cookie presence + same-origin check on mutating methods
      └─ route handler   withAuth / withAdmin: session, rate limit, password gate
          └─ service     the only place business rules live; every query filtered by user id
              └─ Drizzle
                  └─ Postgres
```

The AI sits beside this, never underneath it:

```
user → assistant route → agent loop → tool registry → the same services → Postgres
```

## Boundaries that are load-bearing

| Boundary | Enforced by | Verified |
|---|---|---|
| Authentication | `getCurrentUser()` resolves the cookie against `sessions ⋈ users WHERE is_active` | 3.18, re-tested 3.20 |
| Authorization | `withAdmin` reads the role from the database row, never from the request | 3.18, re-tested 3.20 |
| Ownership by reference | `assertOwned` / `assertAllOwned`, answering "not found" for a foreign id | 3.18 |
| Resource id shape | `assertResourceId` inside `withAuth`, so every route gets it | 3.22 (it was only in the CRUD factory until then — SEC-006) |
| CSRF | `proxy.ts` inline origin check + `isTrustedOrigin` in `withAuth` (two layers) | 3.19.2 |
| Redirect targets | `safeRedirect`, origin comparison rather than a prefix test | 3.20 |
| AI tool surface | `tool-groups.ts` per mode; `kind` comes from the route's enum, never the message | 3.16 |
| Tool confirmation | `runTool` sets `needs = risk === "high"` first, so a high-risk tool cannot opt out; `confirmed` is hard-coded `false` in the agent loop and only the confirm route sets it, after re-reading the pending row and claiming it with a conditional update | 3.22 |
| Database target | `src/server/db` refuses a non-local host unless `NODE_ENV=production` or `ALLOW_REMOTE_DB=1` | 3.22, after an accidental write to production |

**Two implementations of the CSRF rule exist** — `proxy.ts` has it inline, `security/origin.ts`
exports it — and they can drift. Recorded as architecture debt below.

## AI architecture

- `registry.ts` — `defineTool({ name, module, risk, schema, run, needsConfirmation, summarize })`.
- `agent.ts` — Messages API tool-use loop, ≤8 rounds, `MAX_OUTPUT_TOKENS` 8192.
- `transcript.ts` — a pure validator and repairer for the wire protocol. Nothing invalid is ever
  stored or sent; conversations already broken are repaired on read from `ai_action_logs`.
- `tool-groups.ts` — assistant gets the full surface; Fast Log 22 tools; planner 12.
- `tool-search.ts` — native deferred loading, opt-in via `AI_TOOL_SEARCH`, **off**: it has never met
  a real provider, and this file will not call it production-ready.
- The model never receives a user id or a role, and cannot reach the database except through a
  registered tool.

## Data flow and multi-user model

Every user-scoped table carries `user_id` with `ON DELETE CASCADE` (51 of 55 pre-`0007` tables; the
exceptions are `users` itself, `ai_messages` which hangs off its conversation, and the two shared
market reference tables). Deleting an account removes everything it owns.

`ai_messages` having no `user_id` is deliberate but has a consequence: it is deleted with its
conversation after 24 hours, which is why durable AI usage needed its own table.

Administrators manage accounts and nothing inside them. There is no impersonation, and nothing in
the admin surface can mint a session for another account.

## Background jobs

One registry, `services/maintenance.ts`, each job declaring the cadence it needs:

- **frequent** — price alerts, conversation expiry, news. These read the world at the instant they
  run; a daily cadence makes them wrong, not just late.
- **daily** — recurring transactions, notifications, portfolio snapshot, session purge, rate-limit
  purge. These reconcile, so a missed run costs lateness.

Both schedulers warn that runs are dropped *and* duplicated, so every job has to be idempotent.
An earlier version of this file stated flatly that they all were. That was wrong: it had only been
checked by running each job twice in sequence. Phase 3.21 ran them concurrently and four writes
produced duplicate rows (BUG-007). Idempotence now rests on unique constraints in migration `0008`
rather than on a lookup the second caller has not yet seen — **and `0008` is not applied to
production**, so in the deployment today those four writes are still not idempotent under overlap.

Two schedulers: Vercel Cron daily (runs everything — Hobby caps at once a day) and GitHub Actions
nominally every 15 minutes for the frequent half. The daily pass is the full set on purpose, so
nothing depends on the workflow existing — which is just as well, because **the workflow has never
once succeeded** (61 failures, missing secrets) and even when it does, GitHub delivers roughly one run
every two and a half hours, about 12% of what the expression asks for. Both figures are measured; see
PRODUCTION_SAFETY.md. Treat the frequent cadence as "a few times a day" in any design that rests on it.

The daily pass takes 55.6–58.1 s against a 300 s platform ceiling, measured over eleven consecutive
days in production. Since phase 3.23 it no longer fetches the news feeds twice (a job may declare it
`supersedes` another) and the ingestion inserts 200 rows per statement instead of one.

## External dependencies

| Dependency | Used for | Failure behaviour |
|---|---|---|
| Neon Postgres | everything | rate limiter degrades to per-instance; routes 500 |
| Anthropic API | the assistant | typed errors → one plain sentence; provider text never shown |
| Finnhub / Stooq / Yahoo / CoinGecko | quotes | providers tried in order; unpriceable symbols reported, never faked |
| RSS feeds | news | cached 15 min, deduped by URL |
| GitHub Actions | maintenance, backup | currently failing: secrets unset |
| Vercel Cron | daily maintenance | unconfirmed: `CRON_SECRET` not visible from here |

## Data integrity

Audited in phase 3.21 by reading every column definition and every arithmetic path, not by sampling.

**Money and quantities are exact.** No monetary value is stored as a float anywhere. Every column is
`numeric` with an explicit precision and scale: `numeric(14,2)` for amounts, `numeric(18,6)` for
prices, `numeric(18,8)` for quantities. Totals are summed in SQL, where `sum()` over `numeric` is
exact; the one place JavaScript adds money (`financeBalance` in `services/finance.ts`) reduces over
values that are already exact to two decimals and rounds through `round2()`.

**Index coverage has a known gap, deliberately not closed here.** Six tables carry `user_id` with no
index leading on it: `german_progress`, `nutrition_entries`, `milestones`, `watchlist_items`,
`training_days`, `training_day_exercises`. Every query against them filters by user, so the shape is
wrong in principle — but with one account and small tables there is no measurement showing it costs
anything, and this project does not add indexes on principle alone. It belongs to the performance
phase, with a concrete trigger: measure `EXPLAIN (ANALYZE)` on the per-user list query for each of
the six at realistic row counts, and add the index where a sequential scan actually dominates.

## Accessibility

Measured in a real browser with axe-core 4.10.2 over 25 routes, not inferred from the source:
`scripts/a11y-audit.mjs`. As of phase 3.24, **zero violations** at WCAG 2.0/2.1/2.2 A+AA plus axe's
best-practice rules, in three configurations — light 1280×900, light 375×812, dark 1280×900 — with no
horizontal overflow on any route at phone width.

What the audit established beyond the violation count:

- **`prefers-reduced-motion` is honoured.** Emulating it removed 18 apparent contrast failures that
  were opacity frames of a list fading in. Previously this was assumed from media queries existing.
- **Colour is tokenised and the tokens now encode the contrast.** `--muted` and `--warning-ink` clear
  4.5:1 against `--surface`, `--surface-2` and `--bg` in both themes, and `tests/ux-coherence.test.ts`
  computes the WCAG ratio from the declared values so a token edit cannot quietly drop below it.
- **`--warning` and `--warning-ink` are deliberately different.** One is a fill, one is for words; the
  fill does not meet text contrast and is not supposed to.
- **Every route has `main`, `nav`, `header` and a single `h1`.** Heading depth is thin on about half of
  them (an `h1` and nothing else), which axe does not flag and this file does not claim is ideal.

The audit needs a browser, and the GitHub runner has none, so **CI does not cover this**. What CI
covers is the source-level half: the contrast arithmetic on the tokens, the labelling rule and its
inverse, and the list-child rule.

## Performance, as measured

`scripts/perf-bench.ts` builds a disposable database (`personal_os_perf`), seeds five years of heavy
use — ~110,000 rows across 3 accounts — and runs the application's own service functions, counting
round trips off the driver rather than inferring them from the code. **Every figure below is a
disposable-database measurement on a Unix socket. None of it is production**, where each round trip
crosses a network to Neon and so costs far more than it does here; that makes the *query counts* the
number that matters, not the milliseconds.

| Scenario | ms | queries |
|---|---|---|
| AI system prompt (compact snapshot + memory) | 33 | 32 |
| `lifeSnapshot`, all ten sections | 27 | 33 |
| Analytics overview, month | 33 | 43 |
| Analytics overview, year | 124 | 43 |
| Global search, common term | 45 | 39 |
| `generateNotifications` | 38 | 31 |
| Transactions, default page | 3 | 1 |
| Daily cron, 3 accounts | 274 | 120 |

What that establishes:

- **No path scales its query count with row count.** The one that did — `generateNotifications`, at
  1,479 queries — is BUG-016, fixed. The others are constants: ~3 queries per snapshot section, one
  per list page, 40 per account in the cron.
- **The cron is linear in accounts, not rows**: 120 queries for 3 accounts, 40 each. Per-account work
  is sequential by design, which is the safer choice on a serverless platform with a bounded pool.
  Projected from 274 ms at 3 accounts, the 300 s Vercel window is not the binding constraint at any
  user count this project will plausibly reach — but that is a projection from a local socket, not a
  measurement.
- **Pagination is sound.** Every list path defaults to a limit (200 transactions and tasks, 100
  journal entries and notifications, 200 memories, 50 workouts); `listEvents` has none and does not
  need one, being bounded by the calendar range it is given.
- **Repeated queries were measured and left alone.** Keying on statement text *and* parameters —
  text alone wrongly flags one prepared statement reused for this period and the previous one — the
  only true repeats are `getPreferences` three times per analytics call and the training plan twice
  per snapshot. Each is a primary-key or single-row read of a table with fewer than 50 rows. Measured,
  negligible, not worth the indirection of request-scoped caching.

### Indexes: what the measurement justified, and what it did not

38 foreign keys had no supporting index. The cost of that shows up in cascades, where Postgres scans
the child table once per deleted parent row. Measured on the cascade that deletes one account and its
~37,000 rows, median of five `EXPLAIN ANALYZE` runs:

| Index set | Cascade delete |
|---|---|
| none | **684 ms** |
| the 2 largest | 131 ms |
| **the 5 in migration 0009** | **105 ms** |
| 8 | 100 ms |
| 11 | 109 ms |
| all 38 | 116 ms |

Two triggers were 69% of the original: `events_task_id` at 408 ms (2,000 tasks deleted, each scanning
4,500 events) and `tasks_milestone_id` at 133 ms. Migration `0009` adds the five whose individual
trigger cost was independently measurable — `events(task_id)`, `tasks(milestone_id)`,
`personal_records(set_id)`, `tasks(goal_id)`, `events(goal_id)` — and three of those also serve
ordinary "for this goal / for this task" reads. **The other 27 were not added:** going from 8 to 38
indexes bought nothing outside the noise band, and every index costs write throughput and storage on
a 0.5 GB tier.

**The six tables phase 3.21 flagged were measured and left alone.** They carry `user_id` with no
leading index, and their real per-account read query is:

| Table | Rows for one account | Query |
|---|---|---|
| `nutrition_entries` | 5,000 | 1.5 ms |
| `milestones` | 400 | 0.17 ms |
| `watchlist_items` | 120 | 0.14 ms |
| `training_day_exercises` | 48 | 0.09 ms |
| `training_days` | 8 | 0.08 ms |
| `german_progress` | 1 | 0.07 ms |

All sequential scans, all trivially fast, because the tables are small — `training_days` holds eight
rows per account by construction and never will hold more. 3.21 flagged them on principle; the
measurement says do nothing. The one with a growth path is `nutrition_entries`: an index takes it
1.55 ms → 0.73 ms today, and since the scan is linear in the *whole* table it is worth adding when
that table passes roughly 50,000 rows. Not before.

## Known architecture debt

1. **The CSRF rule is implemented twice** (`proxy.ts` inline, `security/origin.ts` exported). Kept
   as defence in depth, but they can diverge. No test currently pins them to the same behaviour.
2. **Production runs a schema older than its code.** `0007` is unapplied, so the shared rate limiter
   is silently in fallback and `/api/admin/usage` returns 500. `0008` is unapplied too, so the four
   concurrent-write duplicates of BUG-007 remain live in production; the fix is deployed but inert
   without its constraints, by design.
3. **`notFound()` answers 200** app-wide (BUG-005).
4. **Native tool search is unvalidated** and off; the flag path exists but has never met a provider.
5. **No per-account AI spend ceiling.** Usage is measured, not capped — deliberately, because until
   `0007` lands there is no history to justify a number.
6. **`drizzle.config.ts` defaults to `DATABASE_URL`**, so any `drizzle-kit` command points at
   production unless told otherwise. This has already caused one accidental (harmless) attempt.
7. **The suite runs serially and takes ~2m35s in CI.** `vitest` is configured with
   `fileParallelism: false`, which is necessary rather than incidental: the tests share one database
   and several assert on counts that are global to it. Making it parallel means a database per file.
   Not a problem at the current duration; the constraint is written down so the reason is not lost.
   (The "hang" once recorded here was BUG-013 and has been withdrawn — that run was cancelled at
   2m17s by this workflow's own `cancel-in-progress`.)
8. **CI runs PostgreSQL 16; production runs 18.6.** The local development database is 16 too. Nothing
   currently depends on the difference — migration `0008` needs 15+ and no further — but a feature
   available on one and not the other would pass CI and fail production, or the reverse. Aligning CI
   to 18 is the next step and was deliberately not bundled with the change that made CI run at all.
9. **The GitHub Actions in use target Node 20**, which GitHub has deprecated; they are being forced
   onto Node 24 with a warning today and will eventually stop. `actions/checkout`,
   `pnpm/action-setup`, `actions/setup-node`, `actions/upload-artifact` all need a major bump, and
   they are pinned to mutable tags rather than commit SHAs.
10. **The assistant reads third-party text in a loop that can act** (SEC-007). `get_market_news`
   returns RSS headlines verbatim, and low-risk tools — `remember_memory` among them — execute
   without a confirmation step. Mitigated by labelling the content and by a system-prompt rule;
   the mitigation is an instruction to a model and has never been tested against a real one.
11. **The database-target guard covers one module, not a perimeter.** `src/server/db` refuses a
   remote host from a non-production process (SEC-008), but `scripts/migrate.ts`, `scripts/backup.sh`
   and anything using `neon()` or `pg` directly build their own connections and are unchecked.
