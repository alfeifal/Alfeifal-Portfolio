# Session checkpoint

Written so the next session can continue without repeating anything.

## Position

- **Phase 3 — stabilization and consolidation**
- **Subphase: 3.21 — database integrity and consistency audit — COMPLETE in code**
- **Next action: start 3.22 — AI assistant and tool system audit.**
  3.19.2B, 3.19.3 and now `0008` stay blocked; do not retry them, and do not ask for secrets in chat.

## Commit and git state

- Branch `claude/personal-operating-system-nuoesg`
- Previous commit `0784150` (`fix(security): close the post-login open redirect …`)
- This session's commit: see `git log -1` (message begins `fix(db): make four check-then-insert
  writes atomic`)
- Working tree clean, local == origin at the time of writing.

## What was done this session

1. **Re-established state after a container restart**: HEAD `0784150`, tree clean, local Postgres
   restarted. Nothing was lost; 3.20 was already committed.
2. **3.21 audit, by reading rather than sampling.**
   - **Money precision: sound.** No float anywhere. Every monetary and quantity column is `numeric`
     with explicit precision and scale. Totals are summed in SQL; the one JavaScript reduction is
     over values already exact to two decimals and rounds through `round2()`.
   - **Index coverage: one gap, deliberately left open.** Six tables carry `user_id` with no index
     leading on it. No measurement shows it costs anything at current volumes, so it was recorded
     in `ARCHITECTURE_STATUS.md` with a concrete trigger rather than fixed on principle.
   - **Concurrency: four real defects (BUG-007).** Reproduced, not inferred.
3. **BUG-007 fixed.** Migration `0008_concurrency_unique_constraints` plus `ON CONFLICT DO NOTHING`
   and a re-read at each of the four call sites, written so behaviour is **unchanged until the
   migration is applied and atomic afterwards** — `0008` queues behind the same blocker as `0007`.
4. **A claim from 3.19 was corrected.** "Every job is idempotent" was false: it had only been
   checked sequentially. `ARCHITECTURE_STATUS.md` now says so explicitly.

## Tests run

| | |
|---|---|
| Full suite | **878 passed / 37 files** (baseline at session start: 867 / 36) |
| New | `tests/concurrency.test.ts`, 11 tests |
| Fails against the unfixed code | **6 of 7** concurrency assertions, repeatably across three runs |
| Passes after the fix | 11 of 11, three consecutive runs |
| Typecheck | clean |
| Lint | 0 errors, 18 pre-existing warnings (unchanged) |
| Production build | clean |
| Production pre-flight | read-only: PostgreSQL 18.6, zero rows violate any of the four new constraints |

## Harness lessons worth not repeating

- **A cold connection pool hides concurrency bugs.** The first version of the `notify()` race test
  passed against known-broken code, because an empty pool serialises the fan-out while it opens
  connections. Probed directly: n=2 → 1 row, n=4 → 2, n=8 → 4, then 8, 8. The suite now opens N
  connections before racing anything, and the failure is deterministic.
- **Drizzle wraps driver errors.** SQLSTATE lives on `error.cause.code`, not `error.code`. The first
  `isUniqueViolation` missed it and the test caught it.
- **Tests that share a user leak state.** The budget-count assertion failed on 4 rows because an
  earlier test in the same file had left a budget on that user. Counting tests need their own user.
- Carried from the previous session: assert on `hits`/`total` not raw response text; `DELETE
  /api/me/sessions` reissues the cookie; clear `rate_limits` between attack phases.

## Known blockers

| Blocker | Needs |
|---|---|
| No production backup | `DATABASE_URL` + `BACKUP_PASSPHRASE` secrets in GitHub |
| `0007` unapplied | A backup, then explicit authorization |
| `0008` unapplied | The same; BUG-007 stays live in production until it lands |
| Maintenance workflow failing | `APP_URL` variable + `CRON_SECRET` secret |
| Vercel `CRON_SECRET` unconfirmed | Access to Vercel's environment variables |
| Real-model AI evaluation | `ANTHROPIC_API_KEY` |

## Decisions worth carrying forward

- **`ON CONFLICT DO NOTHING` + re-read, not `ON CONFLICT DO UPDATE` with a target.** A target clause
  needs the unique index to exist, so it would have broken production the moment it deployed. The
  bare form is inert without the index and atomic with it, which is what "unchanged before, correct
  after" requires when the migration is blocked.
- **Category names are now unique per (user, kind), case-insensitively.** That is a product change,
  taken on purpose: two categories called "Food" silently split the user's spending in every report,
  and `resolveCategory()` only makes sense if a name identifies a category. `createCategory` and
  `updateCategory` answer a collision with a 400 and a readable message.
- **The local test database's migration journal was repaired.** `0007` had been applied there with
  raw `psql` in phase 3.19 and never recorded, so `pnpm db:migrate --test` would have failed. Its
  row was inserted with the correct file hash, and `0008` then applied through the normal runner.
- `pnpm db:migrate --test` needs `DATABASE_SSL=false` in front of it: `.env` sets it for production
  and local Postgres refuses SSL.
