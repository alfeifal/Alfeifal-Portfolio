# Architecture status

Written from the repository at `8c0531d` + the 3.22 changes, not from prior reports.
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
every 15 minutes for the frequent half. The daily pass is the full set on purpose, so nothing
depends on the workflow existing.

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
7. **The assistant reads third-party text in a loop that can act** (SEC-007). `get_market_news`
   returns RSS headlines verbatim, and low-risk tools — `remember_memory` among them — execute
   without a confirmation step. Mitigated by labelling the content and by a system-prompt rule;
   the mitigation is an instruction to a model and has never been tested against a real one.
8. **One production row does not belong there.** `audit322@example.com` was created by mistake in
   this session and could not be removed from this environment; see PRODUCTION_SAFETY.md.
