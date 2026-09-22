# Session checkpoint

Written so the next session can continue without repeating anything.

## Position

- **Phase 3 — stabilization and consolidation**
- **Subphase: 3.20 — security and privacy audit — COMPLETE**
- **Next action: start 3.21 — database integrity and consistency audit.**
  3.19.2B and 3.19.3 stay blocked; do not retry them, and do not ask for secrets in chat.

## Commit and git state

- Branch `claude/personal-operating-system-nuoesg`
- Previous commit `ad17110`
- This session's commit: see `git log -1` (message begins `fix(security): close the post-login
  open redirect`)
- Working tree clean, local == origin at the time of writing.

## What was done this session

1. **Verified the real state** rather than trusting the report: repository at `ad17110`, tree clean,
   production read read-only over HTTPS (7 migrations, `0007` tables absent, 55 public tables, 1
   account), and `GET /api/cron` on the deployment answers 401, so the 3.19 code is deployed.
2. **3.19.2B: BLOCKED, recorded, not retried.** The backup secrets are still unset; the ninth
   backup run (2026-09-22 08:10) failed on the old commit for the same reason.
3. **3.20 executed.** Attacked a production build with two accounts and an admin, plus a headless
   browser. Two real defects found and fixed:
   - **SEC-001 (HIGH)** post-login open redirect — `next.startsWith("/")` let `//evil.example` and
     `/\evil.example` through. Reproduced in a real browser, fixed with an origin comparison
     (`src/lib/safe-redirect.ts`), re-verified in the same browser.
   - **SEC-002 / BUG-003 (MEDIUM)** a malformed resource id answered 500 across five of eight
     modules and logged the failing SQL with its bound parameters. Fixed in the shared CRUD factory
     (`assertResourceId`), which answers 404 — the same answer a foreign id gets.
   Both regression suites were confirmed to **fail against the unfixed code** (7 of 14) before being
   kept.
4. **Created `docs/engineering/`** — all six documents, written from what was verified in this
   session, with blockers recorded as blockers.

## Tests run

| | |
|---|---|
| Full suite | **867 passed / 36 files** (baseline at session start: 853 / 35) |
| New | `tests/security-audit.test.ts`, 14 tests |
| Typecheck | clean |
| Lint | 0 errors, 18 pre-existing warnings (unchanged) |
| Production build | clean |
| Browser verification | headless Chromium against a production build, before and after the fix |
| Attack harness | 30 checks against a production build; 28 passed, 2 "failures" investigated and proven to be harness bugs, not product defects |

## Harness lessons worth not repeating

- The search assertion matched the query **echoed back** in the response (`"query":"…"`), not a
  leak. Assert on `hits`/`total`, never on raw response text.
- `DELETE /api/me/sessions` issues a **fresh cookie** in the same response; a curl that does not
  capture it will wrongly conclude the caller's own session died.
- The app's own login limiter (10 per 15 min per IP) will exhaust itself during an attack run and
  make later checks pass for the wrong reason. Clear `rate_limits` between phases.

## Known blockers

| Blocker | Needs |
|---|---|
| No production backup | `DATABASE_URL` + `BACKUP_PASSPHRASE` secrets in GitHub |
| `0007` unapplied | A backup, then explicit authorization |
| Maintenance workflow failing | `APP_URL` variable + `CRON_SECRET` secret |
| Vercel `CRON_SECRET` unconfirmed | Access to Vercel's environment variables |
| Real-model AI evaluation | `ANTHROPIC_API_KEY` |

## Decisions worth carrying forward

- A malformed id answers **404, not 400**, on purpose: a distinct status for "malformed" would tell
  a caller which ids are real.
- `safeRedirect` takes the origin as an argument so it is testable without a browser.
- The engineering documents record what was *verified*, not what was *done*. If something was not
  re-tested, it says so.
