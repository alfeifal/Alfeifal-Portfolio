# Session checkpoint

Written so the next session can continue without repeating anything.

## Read this first

The production incident from the previous working day is **closed**. `audit322@example.com` and the
149 rows it owned were removed on 2026-10-02 under written authorization, with before/after counts
and a read-only verification pass over all 51 tables carrying `user_id`. Production holds exactly one
account and 311 rows, all the owner's. Full record: `PRODUCTION_SAFETY.md` → *Incident*, and
SEC-008 in `SECURITY_REGISTER.md`.

The guard that prevents a repeat is in `src/server/db/index.ts`, covered by six tests. It covers that
module only — scripts building their own connection are still unchecked, which is listed as residual
risk rather than quietly left out.

## Position

- **Phase 3 — stabilization and consolidation**
- **Subphases 3.21, 3.22 and 3.23 — COMPLETE**; the SEC-008 incident is closed
- **Next action: start 3.24 — UX / accessibility / responsive audit.** 3.19.2B, 3.19.3 and `0008` stay
  blocked; do not retry them, and do not ask for secrets in chat.

## Commit and git state

- Branch `claude/personal-operating-system-nuoesg`
- `0784150` → `8c0531d` (3.21) → `e2d03b3` (3.22) → `642c421`, `a72c985` (chores) → `77c7665` (incident
  docs) → the 3.23 commit
- Working tree clean, local == origin at the time of writing.

## What was done

1. **3.21 — database integrity.** Money precision sound. Four check-then-insert races reproduced
   (BUG-007), fixed with migration `0008` plus `ON CONFLICT DO NOTHING`, written to be inert until the
   migration is applied. Corrected the false 3.19 claim that every job is idempotent.
2. **3.22 — AI assistant and tool system.** SEC-006: the 3.20 id guard only covered the CRUD factory;
   eight hand-written routes answered 500 to a malformed id. Guard moved into `withAuth`. BUG-009, found
   by the same probe: that guard assumed `ctx.params` always exists, and every collection endpoint 500'd
   until fixed. SEC-007: third-party RSS text reaches a tool-enabled loop; mitigated by labelling, with
   the caveat that no test here can show a model obeys a label.
3. **The production incident (SEC-008) is closed** — account removed under written authorization, full
   before/after counts in PRODUCTION_SAFETY.md, guard in `src/server/db/index.ts` with six tests.
4. **3.23 — cron / CI-CD / operations.** The big one:
   - **BUG-010: CI had never run.** 43 runs, every one failed at `pnpm/action-setup` because `ci.yml`
     pinned a pnpm version that `package.json` also pins. Install, typecheck, lint, migrate, **test**
     and build were skipped on every commit in this project's history. Fixed, plus `permissions`,
     `timeout-minutes` and `concurrency`, which `ci.yml` had none of.
   - **BUG-011: three tests asserted nothing.** They opened with `if (activeAdminCount() > 1) return`,
     and the count is global, so on any non-empty database they returned immediately. A freshly built
     test database made them run — and fail. The audit then established that the "last active
     administrator" guard is unreachable in the dangerous direction and that the **self-guards** are
     what hold the invariant; and it exposed a real defect, `setUserActive`/`setUserRole` refusing to
     demote an *inactive* administrator. Fixed and rewritten to force the condition instead of skipping.
   - **BUG-012: the daily pass fetched every RSS feed twice**, one row per statement, up to 400 of them.
     Fixed with a `supersedes` declaration and batched inserts. The production saving is **not yet
     measured** — that needs a deployment.
   - **Measured, not assumed:** the Vercel daily cron has run every day for eleven days and takes
     55.6–58.1 s against a **300 s** ceiling (not 60 s — I had the wrong number and the wrong
     conclusion). The GitHub workflow has never once succeeded in 61 runs, and even working, delivers
     ~12% of its configured cadence.
   - **`.claude/hooks/session-start.sh`** builds the local test database so no future session has to
     rediscover it. Validated from nothing: 904 tests pass on the database it provisions.

## Tests run

| | |
|---|---|
| Full suite | **904 passed / 38 files** (session start: 867 / 36) |
| New this session | `tests/concurrency.test.ts` (11), `tests/ai-audit.test.ts` (11), 6 db-guard + 8 CI/cron tests in `tests/operations.test.ts`; 3 vacuous admin tests replaced by 4 real ones |
| Confirmed to fail against the unfixed code | 6/7 concurrency; AI-001 location; 2/3 AI-002; 4 CI-config; 1 idempotence-claim; 2 supersede; 2 admin-guard |
| Typecheck / lint / build | clean; 18 pre-existing lint warnings, unchanged |
| Session-start hook | run from a stopped cluster: initialised, migrated, 904 tests green; second run a no-op |

## Harness lessons worth not repeating

- **A script that sets `process.env` at the top of the file does not redirect a static import.**
  ESM evaluates imports first. This is what wrote to production. Set the variables before importing,
  use `await import(...)`, and assert the host — or just let the new guard stop you.
- **A cold connection pool hides concurrency bugs.** Warm it before racing anything.
- **Drizzle wraps driver errors**; SQLSTATE is on `error.cause.code`.
- **Never `pkill -f next-server`** — it matches this agent's own shell and kills it mid-command,
  which also left a half-finished `.next` and an hour of confusing 500s. Find the pid with `ps` and
  kill that.
- **Asserting on `run.toString()` is fragile** — the transpiler renames things. Call the tool and
  look at what it returns.
- **A green local suite is not a green suite.** CI had been red for 43 runs while every report here
  said "clean". Check the actual CI run, not just the local one — and a suite that only passes on a
  database somebody has been using is not passing for the right reason.
- **`if (someGlobalCount() > 1) return;` in a test is an assertion that never runs.** Force the
  condition the guard needs and restore it afterwards.
- **`service postgresql start` is not enough here**: the project's test database is a separate cluster
  on port 5433 with a socket in `/tmp`. The session-start hook now handles it; if it ever needs doing
  by hand, that script is the reference.
- Carried forward: assert on `hits`/`total` not raw response text; `DELETE /api/me/sessions`
  reissues the cookie; clear `rate_limits` between probe phases; tests that count rows need their
  own user.

## Known blockers

| Blocker | Needs |
|---|---|
| No production backup | `DATABASE_URL` + `BACKUP_PASSPHRASE` secrets in GitHub |
| `0007` unapplied | A backup, then explicit authorization |
| `0008` unapplied | The same; BUG-007 stays live in production until it lands |
| Maintenance workflow failing | `APP_URL` variable + `CRON_SECRET` secret |
| Vercel `CRON_SECRET` unconfirmed | Access to Vercel's environment variables |
| Real-model AI evaluation | `ANTHROPIC_API_KEY` — and with it, SEC-007's mitigation could finally be tested |

## Decisions worth carrying forward

- **The id guard belongs in `withAuth`, not in each handler.** There are only two dynamic segment
  names in `src/app/api` (`id` and `kind`), so one place is complete; a list of call sites is not.
- **A mitigation that depends on a model's cooperation is written down as such.** SEC-007 states
  what the tests prove (the label is present, the content is unaltered, the rule is in the prompt)
  and what they do not (that any model obeys it).
- **`ALLOW_REMOTE_DB=1` is per command, never exported.** It is the whole point that reaching
  production is something you have to type.
- Carried forward from 3.21: `ON CONFLICT DO NOTHING` + re-read rather than a targeted upsert, so
  the code is correct both before and after a blocked migration; category names are unique per
  (user, kind), case-insensitively, on purpose.
