# Bug register

Defects found by inspection or by attacking a running build. Each one was reproduced before being
written down. Security findings live in `SECURITY_REGISTER.md`; this file covers correctness.

| ID | Severity | Component | Status |
|---|---|---|---|
| BUG-001 | **CRITICAL** | Scheduled maintenance | Fixed `273e1af`, deployed |
| BUG-002 | **HIGH** | Backups | Fixed `ad17110`, blocked on secrets |
| BUG-003 | MEDIUM | Shared CRUD | Fixed, verified (= SEC-002) |
| BUG-004 | MEDIUM | AI usage accounting | Fixed `273e1af`, dormant until `0007` |
| BUG-005 | LOW | App-wide HTTP status | Open, deferred by decision |
| BUG-006 | INFORMATIONAL | Scheduling | Open, external |

---

## BUG-001 — no scheduled work had ever run in production

**Severity:** CRITICAL · **Status:** fixed in `273e1af`, deployed and confirmed

`/api/cron` exported only `POST`. Both Vercel Cron and GitHub Actions invoke with `GET`, so the
endpoint answered 405 every night since deployment. `POST` was unreachable anyway: `proxy.ts`
rejects mutating methods whose `Origin` does not match the host, and it does so before consulting
its public-path list, so a scheduler — which sends no `Origin` — got 403 even though `/api/cron` is
public.

Nothing had processed a recurring transaction, raised a notification, checked a price alert, written
a portfolio snapshot or deleted an expired chat transcript.

**Evidence:** measured against a production build — `GET` 405, `POST` 403.
**Fix:** export `GET` with the same timing-safe secret check.
**Regression test:** `tests/operations.test.ts`.
**Verified in production:** `GET https://<app>/api/cron` now answers 401, not 405.

---

## BUG-002 — the backup had never produced a backup

**Severity:** HIGH · **Status:** code fixed in `ad17110`; a real backup is blocked on secrets

All nine runs of the daily backup failed with `DATABASE_URL is required`. Separately, the script
used a shell redirect, which creates the file before `pg_dump` runs, so a dump that died halfway
left a truncated file wearing a backup's name.

**Evidence:** demonstrated, not theorised — against an unreachable database the old script leaves a
0-byte `personal-os-<stamp>.dump`; the new one leaves nothing.
**Fix:** dump to a temporary file; reject under a minimum size; reject an archive `pg_restore
--list` cannot read; reject an archive with no table data; only then move it into place.
**Verified:** dump → integrity → encrypt → decrypt → restore → compare, against a disposable
database.
**Blocked:** see `PRODUCTION_SAFETY.md`.

---

## BUG-003 — a malformed id answered 500

**Severity:** MEDIUM · **Status:** fixed, verified

Same defect as SEC-002; recorded here because it is also a correctness bug. Five of eight probed
modules returned 500 for a non-UUID id; two returned 404, which is the inconsistency that showed the
guard was missing from the shared layer.

**Fix:** `assertResourceId` in `src/server/crud.ts`, answering 404.
**Regression test:** `tests/security-audit.test.ts`.

---

## BUG-004 — assistant usage had no durable home

**Severity:** MEDIUM · **Status:** fixed in `273e1af`; dormant until `0007` is applied

`ai_messages` carries token counts but has no `user_id` — it hangs off `ai_conversations`, which is
hard-deleted 24 hours after its last message, cascading the messages away. Every total older than a
day was already gone, and fixing the cron would have *started* the purge that destroys it.

**Fix:** `ai_usage`, hanging off `users`, written per round so a turn that fails later still
accounts for the calls it made. Cache reads and writes are separate columns because the provider
prices them differently.
**Regression test:** `tests/operations.test.ts` — including a test that purges conversations and
then checks the counter survived.
**Currently dormant:** the table does not exist in production.

---

## BUG-005 — `notFound()` answers 200

**Severity:** LOW · **Status:** open, deferred by explicit decision

`notFound()` called from a dynamic Server Component returns HTTP 200 with the not-found body rather
than 404. Reproduced on `/admin` and identically on `/projects/[id]`, so it is app-wide Next.js
streaming behaviour and not specific to any route.

Not a security issue: no content reaches an unauthorised viewer, and `/api/*` answers 403/404
correctly. It is wrong for caching, crawling and monitoring. Fixing it touches the whole render
path, so it was deferred rather than folded into an unrelated phase.

---

## BUG-006 — scheduled runs arrive far less often than configured

**Severity:** INFORMATIONAL · **Status:** open, external

The maintenance workflow is configured for every 15 minutes. Observed runs: 05:33, 11:03, 16:58 UTC
— roughly every five and a half hours, against the ~46 runs a 15-minute cadence implies. This is the
documented GitHub behaviour ("some queued jobs may be dropped"), but the magnitude weakens the price
alert fix that the cadence exists for.

Whether it improves once the runs stop failing is unknown and undocumented; it needs re-measuring
after SEC-003 is resolved.

---

## BUG-007 — four check-then-insert writes duplicate under concurrency

**Severity:** HIGH · **Status:** fixed in code (commit for phase 3.21), **dormant until 0008 is
applied** — see PRODUCTION_SAFETY.md

**Reproduced** by `tests/concurrency.test.ts`: eight overlapping calls to each entry point against a
real Postgres, with the connection pool warmed first so the calls genuinely overlap. Against the
unfixed code, 6 of the 7 concurrency assertions failed, repeatably across three runs:

| Entry point | Guard it relied on | Rows after 8 concurrent calls |
|---|---|---|
| `notify()` (same `dedupeKey`) | select, then insert | 7 |
| `resolveCategory()` (same name) | select `lower(name)`, then insert | 7 |
| `resolveCategory()` (mixed case) | same | 3 |
| `upsertBudget()` (total budget, null category) | select, then insert | 8 |
| `upsertBudget()` (per category) | select, then insert | 8 |
| `addWatchlistItem()` (same symbol) | select, then insert | 8 |

None of the four writes was atomic, and `notifications_dedupe_idx` was a **plain** index, not a
unique one, so nothing at the database level rejected the second row.

**This corrects a claim made in phase 3.19.** That phase recorded that "every job is idempotent".
That had only ever been checked by calling each job twice *in sequence*. It does not hold under the
duplicate delivery both schedulers explicitly document (Vercel cron is best-effort and may deliver a
schedule more than once; GitHub Actions can start the next run while a slow one is still going), nor
under two ordinary requests arriving together.

**Fix.** Migration `0008_concurrency_unique_constraints` adds the constraint that decides each case:

- `notifications_dedupe_uniq` — unique on `(user_id, dedupe_key)`, replacing the plain index. Rows
  without a dedupe key are exempt, because nulls are distinct.
- `categories_user_kind_name_uniq` — unique on `(user_id, kind, lower(name))`.
- `budgets_user_category_uniq` — unique on `(user_id, category_id)` `NULLS NOT DISTINCT`, so the
  single total budget (null category) is covered too. Production runs PostgreSQL 18.6; the clause
  needs 15+.
- `watchlist_items_symbol_uniq` — unique on `(watchlist_id, symbol)`.

Each call site keeps its existing lookup and adds `ON CONFLICT DO NOTHING` plus a re-read of the
winning row. That shape was chosen deliberately: with no unique index present the clause never
fires, so **behaviour is unchanged until 0008 is applied, and atomic afterwards**. This matters
because 0008 sits behind the same production blocker as 0007.

**Also changed, because the constraint makes it reachable:** `createCategory()` and
`updateCategory()` now answer a duplicate name with a 400 carrying a readable message instead of
letting the driver error surface as a 500. `src/server/db/errors.ts` classifies SQLSTATE 23505,
walking the `cause` chain because Drizzle wraps driver failures in `DrizzleQueryError`.

**Verified:** 11/11 pass after the migration, three consecutive runs; 6 of them fail before it.
Full suite 878 passed / 37 files.

**Pre-flight against production (read-only, 2026-09-23):** zero existing rows violate any of the
four constraints, so the migration cannot fail on existing data.

---

## BUG-008 — two concurrent callers can create two default watchlists

**Severity:** LOW · **Status:** open, recorded not fixed

`addWatchlistItem()` creates a default watchlist when the user has none, with the same
check-then-insert shape as BUG-007. It is left unfixed because `bootstrapUserData()` creates a
default watchlist for every account, so the branch is only reachable after a user deletes all of
their watchlists and then adds two symbols simultaneously. The consequence is a duplicate list, not
lost or misattributed data.

Fixing it needs a partial unique index on `(user_id) WHERE is_default`, which would also constrain
the existing "set another list as default" path — more product surface than the defect justifies.
Revisit if watchlist management grows.

---

## BUG-009 — `withAuth` assumed every route has `params`

**Severity:** HIGH (self-inflicted, lived about ten minutes) · **Status:** fixed, verified

Introduced while fixing SEC-006. The first version of the id guard read
`(await ctx.params).id`, assuming `params` exists whenever `ctx` does. Next passes a context object
to every route handler and only populates `params` on a dynamic route, so **every collection
endpoint** — `/api/me`, `/api/tasks`, `/api/finance/categories`, `/api/goals`, `/api/journal`,
`/api/notifications` — answered 500 with `Cannot read properties of undefined (reading 'id')`.

Not caught by the type system: `params` is typed `P` and is `undefined` at runtime. Not caught by
the test suite either, which exercises services rather than route handlers. It was caught by the
HTTP probe that the SEC-006 work happened to be running, which is the argument for probing a real
server rather than reading code.

**Fix:** `(ctx ? await ctx.params : undefined) ?? ({} as P)`. Verified: 7 collection endpoints back
to 200, 11 malformed-id probes still 404.

**Worth noting about the diagnosis.** The first hypothesis was a corrupt `.next` — a `pkill -f
next-server` had killed this agent's own shell mid-build, leaving a half-finished build directory.
A clean rebuild reproduced the 500 identically, which ruled that out and sent the search to the
right place.

---

## BUG-010 — CI had never run, on any commit

**Severity:** HIGH · **Status:** fixed in phase 3.23, verified by the first green run

**43 consecutive CI runs failed**, every one of them at step 4 of 11, in under a second:

```
Error: Multiple versions of pnpm specified:
  - version 10 in the GitHub Action config with the key "version"
  - version pnpm@10.33.0 in the package.json with the key "packageManager"
Remove one of these versions to avoid version mismatch errors like ERR_PNPM_BAD_PM_VERSION
```

`pnpm/action-setup@v4` refuses to start when the version is given in two places. Every step after it
— install, typecheck, lint, migrate, **test**, build — was skipped. So the suite has never run in CI,
on any commit in this project's history, including every commit of phases 3.19 through 3.22.

**This qualifies every "clean" report made before now.** Those runs were real, but they were local.
Nobody checked the one place that runs the suite against an empty database on a machine nobody has
been tinkering with, and that omission hid BUG-011.

**Fix:** drop `with: { version: 10 }` and let the action read `packageManager`, which keeps one source
of truth for the version. Also added to `ci.yml`, which had none of them: `permissions: contents:
read`, `timeout-minutes: 20`, and `concurrency` with `cancel-in-progress`.

**Regression tests:** six, in `tests/operations.test.ts`, reading the workflow as configuration —
including one that fails if a `version:` reappears under that step. Four of them fail against the old
`ci.yml`.

---

## BUG-011 — three tests asserted nothing, and hid a real defect

**Severity:** MEDIUM · **Status:** fixed in phase 3.23

The "an instance can never be left with nobody able to administer it" block opened every case with:

```ts
if ((await activeAdminCount()) > 1) return;   // "only meaningful while this really is the last one"
```

`activeAdminCount()` is global, and other suites leave administrators behind, so on any database that
is not empty the three cases returned before asserting anything. They had been green for weeks.

Rebuilding the local test database from scratch made the count 1, the bodies ran for the first time,
and **all three failed**. They called the action with the sole administrator as *both* actor and
target, so the self-protection guard answered first and the message never mentioned the last
administrator:

| Expected | Actually returned |
|---|---|
| `/last active administrator/i` | `Delete your own account from Settings, where it asks for your password` |
| `/last active administrator/i` | `You cannot deactivate your own account` |
| `/last active administrator/i` | `You cannot remove your own administrator role` |

**What the audit then established.** The "last active administrator" refusal is unreachable in the
dangerous direction. `getCurrentUser` joins on `is_active`, so the actor is always an active
administrator; acting on somebody else therefore always leaves the actor behind, and acting on
yourself hits the self-guard first. **The invariant holds — but the self-guards are what hold it**,
not the guard the tests were named after. The backstop is kept, because a future path that lets an
administrator act on another without the self-guard would need it.

**And a real defect it exposed.** The guard counts *active* administrators, so an inactive
administrator is not the last of anything. `deleteUserAsAdmin` checked `target.isActive`;
`setUserActive` and `setUserRole` did not, and refused to demote or deactivate an administrator who
could not sign in anyway. Fixed by adding `target.isActive` to both, matching the third.

**Tests rewritten** to assert the mechanism that actually works, with no vacuous early return: the
sole administrator cannot deactivate, demote or delete themselves and remains active afterwards; with
two administrators removing one is allowed; a dormant administrator may be demoted. Where the guard
depends on there being exactly one active administrator, the test now *forces* that condition and
restores the others afterwards rather than skipping when it does not hold. Two of the four fail
against the unfixed guards.

---

## BUG-012 — the daily maintenance pass did the news ingestion twice, one row at a time

**Severity:** MEDIUM · **Status:** fixed in phase 3.23; the production effect is **not yet measured**

Two separate wastes in the one scheduled path that actually runs:

1. **Twice.** The daily invocation carries no `?scope=`, so it selects every job — and `news`
   (`refreshNews(false)`, which respects a 15-minute cache) ran immediately before `newsForced`
   (`refreshNews(true)`, which ignores it). On a cold serverless instance the cache is empty, so both
   fetched all thirteen feeds and re-inserted the same items, back to back, for no benefit.
2. **One row at a time.** `refreshNews` looped over up to 400 items issuing one `INSERT … ON CONFLICT
   DO NOTHING` per item — up to 400 sequential round trips to a database in another region, twice.

**Measured in production (read-only):** the daily pass takes 55.6–58.1 s wall clock, every day across
eleven days. That is against a **300 s** ceiling (Vercel Hobby default and maximum with fluid compute,
per their documentation, consulted 2026-10-02), so it was never close to timing out — an earlier
suspicion that it was hitting a limit was wrong. It is still most of a minute of Neon compute a day on
a 100 CU-hour monthly budget.

**Fix:** `newsForced` declares `supersedes: "news"`, and `runMaintenance` skips a job another
*selected* job supersedes — so the frequent scope on its own still refreshes the news. And the insert
is batched 200 rows per statement, after deduplicating by URL in JavaScript (two feeds carrying the
same story would otherwise put the same URL in one statement, which the arbiter index cannot resolve
against a row the same command is still inserting). 400 statements become 2.

**What is not claimed:** the production duration after this change. It needs a deployment, which this
phase was not authorized to do. The structural change is certain; the saving is not yet observed.

**Regression tests:** three, including one that spies on `refreshNews` and asserts the unscoped run
calls it exactly once, with `force: true`. Two fail against the unfixed registry.

---

## Conventions

- A bug is only recorded once reproduced.
- Every fix carries a regression test that was confirmed to fail against the unfixed code.
- "Fixed" means re-verified after the change, by the same method that found it.
- "Verified in production" is used only for something actually observed against the deployment.
