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
- **Subphases 3.21, 3.22, 3.23 and 3.24 — COMPLETE**; the SEC-008 incident is closed
- **Next action: start 3.25 — performance and scalability audit.** Two items are already waiting for
  it: the six tables carrying `user_id` with no leading index (3.21), and the suite's own duration
  plus BUG-013's hang (3.23). 3.19.2B, 3.19.3 and `0008` stay blocked; do not retry them, and do not
  ask for secrets in chat.

## Commit and git state

- Branch `claude/personal-operating-system-nuoesg`
- `0784150` → `8c0531d` (3.21) → `e2d03b3` (3.22) → `642c421`, `a72c985` (chores) → `77c7665`
  (incident docs) → `1c71001`, `05999d7` (3.23) → the 3.24 commit
- **CI is green.** Run 45 passed end to end — the first time any run in this project's history reached
  the suite. Working tree clean, local == origin.

## What was done

1. **3.21 — database integrity.** Four check-then-insert races reproduced (BUG-007), fixed with
   migration `0008` written to be inert until applied. Corrected the false 3.19 idempotence claim.
2. **3.22 — AI assistant and tool system.** SEC-006 (the 3.20 id guard covered only the CRUD factory;
   eight hand-written routes answered 500), BUG-009 (my own fix assumed `ctx.params` always exists, and
   every collection endpoint 500'd until that was caught by probing), SEC-007 (third-party RSS text
   reaches a tool-enabled loop; mitigated by labelling, with the caveat stated).
3. **SEC-008 closed** — the accidentally created production account removed under written
   authorization, with before/after counts and a 51-table verification pass.
4. **3.23 — cron / CI-CD / operations.** **CI had never run**, on any commit, for 43 runs (BUG-010).
   That hid BUG-011: three admin tests asserted nothing because of a global-count guard clause, and
   fixing them exposed a real defect in two guards. BUG-012: the daily pass fetched every RSS feed
   twice, one row per statement. Measured in production: the Vercel cron works daily at ~57 s against a
   300 s ceiling; the GitHub workflow has never once succeeded and delivers ~12% of its cadence even
   when it does. Added `.claude/hooks/session-start.sh`.
5. **3.24 — accessibility.** axe-core over 25 routes in a real browser (BUG-014): 34 violation nodes
   across five rules, including two critical. Now **zero** in light, dark and phone width. Root cause
   of 25 of the 26 contrast nodes was one token in the shared header. BUG-015: my own first fix added
   `aria-label`s that shadowed visible labels — caught and reverted before it shipped.

## Tests run

| | |
|---|---|
| Full suite | **915 passed / 38 files** (session start: 867 / 36) |
| New this session | `tests/concurrency.test.ts` (11), `tests/ai-audit.test.ts` (11), 14 in `tests/operations.test.ts`, 11 in `tests/ux-coherence.test.ts`; 3 vacuous admin tests replaced by 4 real ones |
| Confirmed to fail against the unfixed code | 6/7 concurrency; AI-001 location; 2/3 AI-002; 4 CI-config; 1 idempotence-claim; 2 supersede; 2 admin-guard; 8 accessibility |
| Typecheck / lint / build | clean; 18 pre-existing lint warnings, unchanged |
| **CI** | **green** — run 45: install 5 s, typecheck 14 s, lint 15 s, migrate 2 s, test 2m35s, build 30 s |
| Browser audit | 25 routes × 3 configurations, zero axe violations, no horizontal overflow |

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
- **Run the audit with `prefers-reduced-motion: reduce` emulated.** Without it axe measures the page
  mid-animation and reports a dozen contrast failures that are opacity frames of one element fading in.
- **Do not trust a home-made heuristic over the real rule.** My target-size heuristic said 198 on one
  route; axe's `target-size`, which implements the WCAG exceptions, said 2. And remember to include the
  `wcag22a`/`wcag22aa` tags, or that rule never runs at all.
- **An `aria-label` overrides a visible label.** Adding one to a field a `<Field label>` already names
  is not belt-and-braces, it is two names that can diverge. A label generated from a placeholder
  (`"a"`, `"1H"`, `"min"`) is worse than no label.
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
