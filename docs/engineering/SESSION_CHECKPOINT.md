# Session checkpoint

Written so the next session can continue without repeating anything.

## Read this first

**One row exists in production that should not: `audit322@example.com`, plus the 131 rows it owns.**
I created it by mistake in this session; the full story, exact scope and the one-line remedy are in
`PRODUCTION_SAFETY.md` under *Incident*. This environment refused the `DELETE`, so it is waiting on
the owner. The guard that prevents a repeat is in `src/server/db/index.ts` and is covered by six
tests.

## Position

- **Phase 3 — stabilization and consolidation**
- **Subphases 3.21 and 3.22 — COMPLETE**
- **Next action: start 3.23 — cron / CI-CD / operations audit** (partly done via 3.19.x; the formal
  pass has never been run). 3.19.2B, 3.19.3 and `0008` stay blocked; do not retry them, and do not
  ask for secrets in chat.

## Commit and git state

- Branch `claude/personal-operating-system-nuoesg`
- `0784150` → `8c0531d` (3.21, pushed) → this session's 3.22 commit, see `git log -1`
- Working tree clean, local == origin at the time of writing.

## What was done this session

1. **3.21 — database integrity.** Money precision audited and found sound. Four check-then-insert
   races reproduced (BUG-007) and fixed with migration `0008` plus `ON CONFLICT DO NOTHING`, written
   to be inert until the migration is applied. Corrected the false 3.19 claim that "every job is
   idempotent". Commit `8c0531d`.
2. **3.22 — AI assistant and tool system.**
   - **SEC-006:** the 3.20 id guard only ever covered the CRUD factory. Eight hand-written routes
     answered **500** to a malformed id, probed against a production build. The guard moved into
     `withAuth`; all 11 probes now answer 404.
   - **A second defect the same probe exposed:** the first version of that guard assumed
     `ctx.params` exists whenever `ctx` does. It does not — Next only populates `params` on a
     dynamic route — so every collection endpoint answered 500 until it was fixed. Caught by
     probing, not by types.
   - **SEC-007:** `get_market_news` hands verbatim third-party RSS text to a loop that can call
     write tools, and low-risk tools (`remember_memory` among them) run with no confirmation.
     Mitigated by labelling the content and adding a system-prompt rule. **The mitigation is an
     instruction to a model and has never met one; the register says so explicitly.**
   - **Checked and found sound:** high-risk tools always require confirmation regardless of their
     own `needsConfirmation`; `confirmed` is hard-coded false in the agent loop and only the confirm
     route sets it, after re-reading the row and claiming it with a conditional update; no
     destructive tool is classified `read`; the model never receives a user id or a role.
   - **Not changed, on purpose:** no risk level and no confirmation was touched (standing rule). The
     open decision — whether `remember_memory` should be medium — is recorded, not taken.
3. **The database-target guard**, written after the incident above and verified by re-running the
   exact script that caused it.

## Tests run

| | |
|---|---|
| Full suite | **895 passed / 38 files** (session start: 867 / 36) |
| New | `tests/concurrency.test.ts` (11), `tests/ai-audit.test.ts` (11), 6 db-guard tests in `tests/operations.test.ts` |
| Fails against the unfixed code | 6/7 concurrency assertions; the AI-001 location test; 2 of the 3 AI-002 assertions |
| Typecheck / lint / build | clean; 18 pre-existing lint warnings, unchanged |
| Route probes | production build, logged-in session: 11 malformed ids → 404, 7 collections → 200 |

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
- Carried forward: assert on `hits`/`total` not raw response text; `DELETE /api/me/sessions`
  reissues the cookie; clear `rate_limits` between probe phases; tests that count rows need their
  own user.

## Known blockers

| Blocker | Needs |
|---|---|
| **Remove `audit322@example.com` from production** | The owner's go-ahead for one `DELETE` |
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
