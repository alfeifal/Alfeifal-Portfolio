# Bug register

Defects found by inspection or by attacking a running build. Each one was reproduced before being
written down. Security findings live in `SECURITY_REGISTER.md`; this file covers correctness.

The table had stopped at BUG-006 while the entries below ran to BUG-019. It is complete now, and
completing it is part of closing a bug, not a separate chore.

| ID | Severity | Component | Status |
|---|---|---|---|
| BUG-001 | **CRITICAL** | Scheduled maintenance | Fixed `273e1af`, deployed |
| BUG-002 | **HIGH** | Backups | Fixed `ad17110`, blocked on secrets |
| BUG-003 | MEDIUM | Shared CRUD | Fixed, verified (= SEC-002) |
| BUG-004 | MEDIUM | AI usage accounting | Fixed `273e1af`, dormant until `0007` |
| BUG-005 | LOW | HTTP status of a guarded page | **Fixed in 3.26**, measured in a browser |
| BUG-006 | INFORMATIONAL | Scheduling | Open, external (platform behaviour) |
| BUG-007 | **HIGH** | Concurrent writes | Fixed in code, **dormant until `0008`** |
| BUG-008 | LOW | Watchlists | **Fixed in 3.26**, no migration needed |
| BUG-009 | **HIGH** | `withAuth` | Fixed, verified (self-inflicted, ten minutes) |
| BUG-010 | **HIGH** | CI | Fixed in 3.23, verified by the first green run |
| BUG-011 | MEDIUM | Admin guards + vacuous tests | Fixed in 3.23 |
| BUG-012 | MEDIUM | RSS ingestion | Fixed in 3.23; production effect **not measured** |
| BUG-013 | — | CI duration | **WITHDRAWN** — my measurement error, not a defect |
| BUG-014 | MEDIUM | Accessibility | Fixed, verified in a browser |
| BUG-015 | LOW | Form labelling | Fixed in the same phase, before it shipped |
| BUG-016 | **HIGH** | Notification generation | Fixed in 3.25, measured |
| BUG-017 | MEDIUM | Account bootstrap | Fixed in 3.25, reproduced first |
| BUG-018 | MEDIUM | CSRF rule written twice | **Fixed in 3.26** |
| BUG-019 | LOW | TLS applied to local databases | **Fixed in 3.26** |

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

## BUG-005 — a guarded page answered 200 with the not-found body

**Severity:** LOW · **Status:** **fixed in phase 3.26**, measured before and after

A signed-in non-administrator asking for `/admin` got **HTTP 200** carrying the "Not found" page.

**Root cause, established by experiment rather than inference.** The original entry blamed "app-wide
Next.js streaming behaviour". It is narrower and entirely in this repository's hands:
`src/app/(app)/loading.tsx` is a Suspense fallback above every page in the group, so the shell is
flushed — committing the 200 — before any page body runs. `notFound()` can only set a status while the
response is uncommitted. Measured against a production build with two real accounts:

| request | with `loading.tsx` | that one file moved away | after the fix |
|---|---|---|---|
| `GET /admin`, signed in, not an admin | **200** | 404 | **404** |
| `GET /admin`, signed in as an admin | 200 | 200 | 200 |
| `GET /tasks`, signed in | 200 | 200 | 200 |
| `GET /no-such-page` (no route matches) | 404 | 404 | 404 |

**The original entry was also wrong on a second point.** It claimed the defect "reproduced identically
on `/projects/[id]`". It does not: that route is a client component and never calls `notFound()` — a
missing project shows an error panel, and 200 is the correct status for it. The only page in the app
that calls `notFound()` is `/admin`.

**Fix.** The guard that has to set the status now runs in the group's layout, which is the last thing
to execute before the flush. `src/proxy.ts` stamps the request path onto a header — always overwriting
it, so a client cannot claim a different route — and `src/server/auth/route-guards.ts` holds the one
table of role-guarded prefixes. The page keeps its own `notFound()`: the table fixes the status, it is
not the protection, and if the header is ever missing the page's check is what answers.

Rejected alternatives: deleting `loading.tsx` (every route loses its skeleton for one route's status
code); a `loading.tsx` per leaf route (24 files, and the 25th is forgotten); checking the role in the
proxy (it runs on the edge and deliberately never touches the database).

**Regression tests** — `tests/http-contract.test.ts`. Six of its ten pin this: the matcher's semantics
including near-misses (`/administration` is not `/admin`), the proxy stamping and refusing to trust an
incoming header, and a structural sweep asserting that **no** page calling `notFound()` sits under a
Suspense fallback unless the layout covers its path. That last one is what stops the defect returning
through a different route. Confirmed to fail against the unfixed code: 6 of 10.

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

**Severity:** LOW · **Status:** **fixed in phase 3.26**, reproduced first

`addWatchlistItem()` creates a default watchlist when the account has none, with the same
check-then-insert shape as BUG-007. `bootstrapUserData()` gives every new account a list, so the branch
only opens after the owner deletes all of them — which is why this was recorded and left.

**Reproduced** from exactly that state: eight simultaneous adds against an account with no lists left
**six** lists behind, every one of them flagged default. The symbols then scatter across them, so the
UI shows one list holding a fraction of what was added. That is worse than the "duplicate list, not
lost data" the original entry predicted.

**Fix, and why it needed no migration.** A transaction-scoped advisory lock keyed on the account
(`pg_advisory_xact_lock(hashtextextended('watchlist:default:<id>', 0))`) serialises just the
create-if-missing and releases itself when the transaction ends. The index the original entry proposed
would have to be partial — `(user_id) WHERE is_default` — which also constrains "make this other list
the default", a path that clears one flag and sets another; and a migration in this repository waits
behind a production gate, so the defect would have stayed live. The lock needs nothing but the code.
`hashtextextended` is stable across sessions and servers, so two application instances agree.

**Regression test** — `tests/concurrency.test.ts`, on its own account because it starts by deleting
every list that account owns. Asserts one list, flagged default, with all eight symbols on it. Against
the unfixed code it reports six.

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

## BUG-013 — WITHDRAWN: the CI run that "hung" was cancelled at 2m17s

**Status:** not a defect. My measurement error, corrected here with the evidence.

I recorded that CI run 44 hung in `pnpm test` for over twenty minutes, and raised the job bound to 45
minutes on that reading. Phase 3.25 was asked to investigate rather than accept it. The GitHub API
says plainly what happened:

| | |
|---|---|
| Run 44 conclusion | **`cancelled`** |
| `pnpm test` step | started 02:42:36, completed **02:44:53** — **2m17s** |
| Run 44 completed | 02:44:55 |
| Run 45 created | 02:44:39 |

Run 45 was created by my own next push, and `concurrency: cancel-in-progress: true` — which that same
commit added — cancelled run 44 sixteen seconds later. Its test step ran 137 s; run 45's ran 155 s.
There was no hang, and nothing to reproduce.

**Where the twenty minutes came from:** me. I polled the job repeatedly across several turns while
real time passed on my side, and read a step that still reported `in_progress` as a step still
running. I never re-read the run's `conclusion` until afterwards. The lesson is about the method:
`status: in_progress` from a snapshot is not evidence of elapsed time — the step's own
`started_at`/`completed_at` are, and the run's `conclusion` is what says whether it finished at all.

**Second lesson, about the workflow:** with `cancel-in-progress: true`, pushing a follow-up commit
kills the verification run of the previous one. "Push, then watch the earlier run" cannot work.

**What was done:** the job bound is back to 20 minutes, which is ~5× the measured 4m16s job, and the
two things that would make a genuine hang diagnosable were checked and are already in place —
`testTimeout: 30000` and `hookTimeout: 60000` in `vitest.config.ts`, and an explicit `timeout: 60_000`
on every `execFileAsync` that spawns a child process. A hung test fails as a test; it does not hang
the job.

## BUG-014 — five classes of accessibility defect across every route

**Severity:** MEDIUM (one class critical by axe's scale) · **Status:** fixed, verified in a browser

Found by running axe-core 4.10.2 against a production build in a real Chromium, over 25 routes —
`scripts/a11y-audit.mjs`, written for this and committed. Before:

| Rule | axe impact | Nodes | Routes | What it was |
|---|---|---|---|---|
| `color-contrast` | serious | 26 | 25 | `--muted` at 4.43:1 on `--surface-2` (the ⌘K hint, 10px) and `--warning` used as text at 3.25:1 |
| `label` | **critical** | 3 | 3 | `type="date"` / `type="month"` fields with no name |
| `select-name` | **critical** | 2 | 2 | the calendar view and memory-kind selects |
| `list` | serious | 2 | 2 | an empty-state `<p>` written *inside* its `<ul>` |
| `landmark-unique` | moderate | 1 | 1 | two unnamed `<nav>` landmarks |

Plus, once WCAG 2.2 rules were included — which the first pass omitted, so `target-size` never ran —
2 nodes of `target-size`: inline routine-editor buttons at 36×16 and 25.3×16 with 13.6px of safe
clickable space against a required 24.

**Fixes.** `--muted` 107 111 123 → 101 105 116 (4.43 → 4.85:1), which clears 25 of the 26 contrast
nodes at a stroke because the offending element is in the shared header. A new `--warning-ink` token
carries warning *text* at 5.24:1 while `--warning` stays the fill colour it was chosen to be. Seven
`aria-label`s, two empty states moved out of their lists, two named navigation landmarks, and a
`.link-tap` utility giving the inline routine controls a 24px target.

**Verified after the fix, same instrument, 25 routes in three configurations:**

| | Routes | Violations | Horizontal overflow |
|---|---|---|---|
| Light, 1280×900 | 25 | **0** | none |
| Light, 375×812 | 25 | **0** | none |
| Dark, 1280×900 | 25 (theme confirmed applied on all 25) | **0** | none |

Rule set: WCAG 2.0, 2.1 and 2.2 at A and AA, plus axe's best-practice rules.

### Two measurement mistakes worth recording, because both nearly became false findings

**Animation frames read as contrast failures.** The first pass reported 18 contrast violations on
`/news` — the same `<span>` at `#e7e7e9`, `#d9d9d9`, `#b0b2b9`, `#9497a0`, `#848791`, `#797d88`. Those
are opacity steps of one element fading in, not six defects. Emulating `prefers-reduced-motion:
reduce` removed all of them, which also **verified that the app honours reduced motion** — a property
previously assumed from the presence of media queries in three files. (Worth knowing separately: for
a viewer who does *not* set that preference, the staggered list entrance passes through contrast as
low as 1.23:1. WCAG measures the settled state, so it is not a violation.)

**My own target-size heuristic over-reported by 99×.** It counted every focusable under 24px: 198 on
`/training/routine`, 120 on `/news`. axe's `target-size` rule, which implements the WCAG 2.2
exceptions for inline targets, found **2**. The script keeps the heuristic as a hint and says in its
own header not to trust it.

---

## BUG-015 — an `aria-label` was added to fields a visible label already named

**Severity:** LOW · **Status:** fixed within the same phase, before it shipped

While closing BUG-014 I swept every `<input>`/`<textarea>` with a placeholder and gave each one an
`aria-label` derived from that placeholder. That produced names like `"a"` (from `placeholder="a, b"`),
`"1H"`, `"min"` and `"For breakfast I had 3 eggs"` — and, on eight fields, a second name for a control
that `<Field label="Tags">` already named.

Both halves are harmful. A label of `"a"` is noise read aloud in place of a usable name, and
`aria-label` **overrides** the visible label, so the words on screen and the words announced can
diverge silently. Eight redundant labels were removed and ten noise labels replaced with names that
say what the field is.

The test that caught it had the same flaw — it demanded `aria-label` and did not accept a labelled
wrapper, which is what prompted the bad sweep in the first place. It now asserts the real rule, *and*
its inverse: no control may carry both a wrapper label and an `aria-label`. Containment is checked by
finding the nearest unclosed labelled opener, not by a fixed look-back, because the shared prompt's
`<Field>` opens further back than any window I guessed.

---

## BUG-016 — notification generation was two round trips per candidate, over an unbounded candidate set

**Severity:** HIGH · **Status:** fixed, measured

Found with `scripts/perf-bench.ts` against a disposable database seeded with five years of use
(~110,000 rows, 3 accounts). `generateNotifications` called `notify()` once per candidate, and
`notify()` is a SELECT plus an INSERT. Four of its source queries have no lower bound: every overdue
task, every active goal past its deadline, every late project, every late milestone.

**Measured, disposable database — not production:**

| Scenario | Before | After |
|---|---|---|
| `generateNotifications`, one account | **1,479 queries / 496 ms** | **31 queries / 38 ms** |
| `runMaintenance(["daily"])`, 3 accounts | **4,464 queries / 1,610 ms** | **120 queries / 274 ms** |

Notification generation was 92% of the whole daily cron's query count. That cron is the only
scheduled path that actually runs in production (see PRODUCTION_SAFETY.md), inside a 300 s window.

**The second half of the finding is not performance at all.** The dedupe key for an overdue task
carries the date — `task:overdue:<id>:<today>` — so a backlog of 1,479 overdue tasks produced 1,479
*fresh* notifications every single day, against a list the UI reads 100 at a time. The faster version
would simply have produced the avalanche faster.

**Fix.** Candidates are collected and written in two statements: one `IN` over the dedupe keys this
run produced, then one multi-row insert with `onConflictDoNothing`, which is still what decides under
concurrency. And each unbounded category emits at most 20 individual notices plus one line counting
the remainder.

**Caught by reviewing the diff, not by a test:** the cap is a `slice` over the query result, and those
four queries had no `ORDER BY` — so which twenty tasks got a notice was whatever order the heap
returned, and could change between runs. All four are now ordered by the column that makes the cap
mean something (most overdue first), with a test that pins it.

**Regression tests** in `tests/performance.test.ts`: the query count does not grow with the backlog
(constant for 10 rows and for 400 — the N+1 assertion as an equality, not a ratio), the cap holds at
20 + 1, the summary names the right remainder, the kept notices are the most overdue, a second run
the same day creates nothing, two overlapping runs do not double anything, and nothing crosses
between accounts. Three fail against the unfixed generator.

---

## BUG-017 — a new account was not built atomically

**Severity:** MEDIUM, data integrity · **Status:** fixed, reproduced first

Found while auditing transaction boundaries: the whole codebase had two `db.transaction` calls, and
`bootstrapUserData` — five sequential inserts across `accounts`, `categories`, `subjects`,
`trading_accounts` and `watchlists` — was not one of them.

**Migration 0008 is what made it reachable.** That migration made a category name unique per account
and kind, so a *retried* bootstrap now throws on the categories insert. Reproduced before the fix:

```
after one bootstrap : {"accounts":1,"categories":20,"subjects":1,"trading":1,"watchlists":1,"plans":1}
second bootstrap threw: Failed query: insert into "categories" ...
after failed retry   : {"accounts":2,"categories":20,"subjects":1,"trading":1,"watchlists":1,"plans":1}
```

A second "Main account" row, and nothing else — the inserts before the failure stayed. Partial
structural data is worse than none: the account looks set up and silently lacks a watchlist or a paper
trading account, and there is no button anywhere to finish the job.

**Fix:** the five inserts are one transaction. `seedRoutine` stays outside it — it already has its own
transaction and its own early return, and nesting would pull its hundred-plus inserts into this
commit for no benefit. **Regression test** asserts a failed retry changes nothing; it fails against the
unfixed version with `accounts: 2`.

---

## BUG-018 — the same-origin rule was written twice, and the copies had drifted

**Severity:** MEDIUM · **Status:** fixed in phase 3.26, both divergences reproduced

`src/proxy.ts` carried its own inline implementation of the CSRF check that `server/security/origin.ts`
exports. This was deliberate — defence in depth, the rule applied at the edge and again in each
mutating route. Two copies of a rule are only defence in depth while they agree. Probed directly:

| request | `isTrustedOrigin` | the proxy's copy |
|---|---|---|
| `POST` with `Referer: not a url` | **threw `TypeError: Invalid URL`** | 403 |
| `POST`, `Origin: https://x.example:443`, `ALLOWED_ORIGINS=https://x.example` | true | **403** |

The throw is the one that mattered. Every mutating route calls `isTrustedOrigin` inside a `try` that
ends at `errorResponse`, which turns an unrecognised `Error` into **500 Internal error** and writes it
to the server log. So a malformed `Referer` header — which any client can send, and some privacy tools
do — answered 500 where it should have answered 403. A predicate whose job is to return false must
not throw.

The second row is a configuration bug rather than a security hole: the proxy compared `ALLOWED_ORIGINS`
entries as raw strings, so an entry written without its default port never matched an `Origin` that
carried one, and the edge blocked a cross-origin client that the route would have accepted. It failed
closed, which is why nobody noticed.

**Fix.** One implementation. `origin.ts` parses every header through a helper that cannot throw, and
normalises both sides to an origin before comparing, so a path or a default port cannot change the
answer. `src/proxy.ts` imports it — it runs on the edge, and that module touches nothing but headers.

**Regression tests** — eight in `tests/http-contract.test.ts`, each asserting both call paths agree:
malformed `Referer`, malformed `Origin`, the default-port allow-list entry, an origin that is neither
the host nor allowed, a write with no origin at all, the matching host, and `x-forwarded-host` winning
over `host` as it must behind Vercel. One also asserts the proxy no longer contains the giveaways of a
second implementation. Confirmed to fail against the two-copy code: 3 of 8.

---

## BUG-019 — the production TLS flag was applied to local databases

**Severity:** LOW · **Status:** fixed in phase 3.26

`DATABASE_SSL` describes the production connection, and every path that opened a connection applied it
to whatever target it happened to have. None of this project's local databases speaks TLS — not the
development cluster, not the CI service container, not the socket under `/tmp`. So in any checkout with
`DATABASE_SSL=true` in `.env` — every real one — `pnpm db:migrate --test` died with:

```
DrizzleQueryError: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"
  cause: Error: The server does not support SSL connections
```

and `pnpm test` would have too. It had been invisible because `.claude/hooks/session-start.sh` passes
`DATABASE_SSL=false` on the command line, and CI simply never sets the variable. A workaround in the
harness had been standing in for the fix, which is how a defect survives: nothing is red.

Found while extending the database-target guard, not while looking for it.

**Fix.** `sslFor(url)` in `src/server/db/target.ts` decides from the target: never TLS to a local host
or a unix socket, and otherwise exactly the old rule (`DATABASE_SSL=true`). Remote behaviour is
unchanged. Verified by running `pnpm db:migrate --test` with no overrides at all, which now succeeds.

Two smaller defects of the same family were fixed alongside it, both found by a test rather than by
reading: `??` where `||` was meant, in `drizzle.config.ts` and in `src/server/db/index.ts`, so a
variable that was *set but empty* became the connection string instead of falling through.

**Regression tests** — two in `tests/operations.test.ts` covering local hosts, `127.0.0.1`, a libpq
socket URL and the remote cases both ways, plus a structural one asserting no entry point keeps its own
copy of the decision.

---

## Conventions

- A bug is only recorded once reproduced.
- Every fix carries a regression test that was confirmed to fail against the unfixed code.
- "Fixed" means re-verified after the change, by the same method that found it.
- "Verified in production" is used only for something actually observed against the deployment.
