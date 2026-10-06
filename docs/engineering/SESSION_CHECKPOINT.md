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

Every performance number in this session's documents was measured on a **disposable** database or in
CI, never in production. Where a saving can only be confirmed in production (the cron's query count,
the RSS batching) it is written down as unconfirmed, waiting on a deployment.

## Position

- **Phase 3 — stabilization and consolidation**
- **Phase 3 is COMPLETE through 3.27**; the SEC-008 incident is closed
- **SEC-007 is now enforced in code, not only labelled** — a conversation that has read third-party feed
  text gates every write behind the user. That was the open decision the register itself named, and it
  was taken differently from the way the register proposed: raising `remember_memory` to medium would
  have asked in every conversation and still left the rest of the `low` set open.
- **Next action: phase 4.** Read `RELEASE_READINESS.md` first — it is new in 3.27 and it is the one
  document that says, claim by claim, whether the evidence is local, CI, disposable-database or
  production. Nothing in phase 4 depends on the blocked migrations, but every claim about production
  does. 3.19.2B, 3.19.3, `0007`, `0008` and `0009` stay blocked; do not retry them, and do not ask for
  secrets in chat.
- **Production deploys from this branch** — it is the repository's default branch — so the code reaches
  production on the next build. The *schema* does not: that is the whole of the gate.
- 3.26 closed BUG-005 and BUG-008 and found two more on the way (BUG-018, BUG-019). Six of the eleven
  architecture-debt items are closed; the five that remain are in `ARCHITECTURE_STATUS.md` with the
  reason each one is still open, and three of them are the production gate.
- Two items that were waiting for 3.25 are closed: the six `user_id` tables were **measured and
  deliberately left alone** (0.07–1.5 ms), and BUG-013's "hang" was **not a hang** — run 44 was
  cancelled by my own `concurrency.cancel-in-progress` at 2m17s. The 20-minute CI bound was restored.

## Commit and git state

- Branch `claude/personal-operating-system-nuoesg`
- `0784150` → `8c0531d` (3.21) → `e2d03b3` (3.22) → `642c421`, `a72c985` (chores) → `77c7665`
  (incident docs) → `1c71001`, `05999d7` (3.23) → `7420655` (3.24) → `291107c` (3.25) → `5e53285`
  (3.26) → the 3.27 commit
- **CI is green.** Run 45 was the first run in this project's history to reach the suite at all; every
  run since has passed, including run 47 on the 3.25 commit (test 180s, job well inside the 20-minute
  bound). Working tree clean, local == origin.
- **CI now runs PostgreSQL 18**, the same major as production, and every action in every workflow is
  pinned to a commit. Both of those were verified by CI rather than locally: there is no PostgreSQL 18
  in this environment and no container runtime to start one.

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
6. **3.25 — performance and scalability.** Measured first, on a **disposable** database
   (`personal_os_perf`, ~110k rows, 3 users) with `scripts/perf-bench.ts`, which counts database round
   trips as well as wall time. Two real defects, both reproduced before being claimed: **BUG-016**,
   notification generation issued **1479 queries / 496 ms** because four candidate queries were
   unbounded and every notice was a separate insert with its own dedupe read — now **31 / 38 ms**,
   with a per-category cap of 20 over an explicit `ORDER BY` and one batched insert; and **BUG-017**,
   account bootstrap wrote five rows without a transaction, so a failure part-way left a half-built
   account — now one `db.transaction`. The daily cron went **4464 / 1610 ms → 120 / 274 ms**. Migration
   `0009` adds the five FK indexes that were actually justified (cascade delete **684 → 105 ms**); it
   is **not applied**. Negative findings were left alone on purpose: the six `user_id` tables from
   3.21, 27 of the 38 missing FK indexes, and every remaining duplicate query.
7. **3.26 — bugs and technical debt.** BUG-005: the root cause was not "app-wide Next.js behaviour" but
   one `loading.tsx` above the route group, flushing the response before any page body could set a
   status; established by removing that file and re-measuring. `/admin` for a non-admin went **200 →
   404**, verified in a browser against a production build, with the skeleton kept for every route. The
   old entry's claim that it reproduced on `/projects/[id]` was wrong and is corrected. BUG-008:
   reproduced from the state that makes it reachable — eight concurrent first adds left **six** default
   watchlists — and fixed with a transaction-scoped advisory lock, so no migration and nothing waiting
   on the production gate. **BUG-018**, found while unifying the CSRF rule: the two copies had drifted,
   and a malformed `Referer` made `isTrustedOrigin` *throw*, which `errorResponse` would turn into 500.
   I first wrote that up as live and it is not: measured against a running build, the edge copy answers
   403 to every shape that would reach the throw, so it was latent. Severity corrected down to LOW in
   the register, with the probe that shows it. **BUG-019**, found while extending the database guard: `DATABASE_SSL` was applied to
   local targets, so `pnpm db:migrate --test` could only work because the session hook passed
   `DATABASE_SSL=false` — a harness workaround standing in for a fix. Also: the database-target guard is
   now a perimeter rather than one module, `drizzle-kit` no longer defaults to production, and a 3.23
   test that asserted on a line of `proxy.ts` source was rewritten to call `proxy()` instead.

## Tests run

| | |
|---|---|
| Full suite | **972 passed / 39 files** (session start: 867 / 36) |
| New this session | `tests/concurrency.test.ts` (12), `tests/ai-audit.test.ts` (11), `tests/http-contract.test.ts` (18), 28 in `tests/operations.test.ts`, 11 in `tests/ux-coherence.test.ts`, 10 in `tests/performance.test.ts`; 3 vacuous admin tests replaced by 4 real ones, and 1 brittle source-string test rewritten to call the code |
| Confirmed to fail against the unfixed code | 6/7 concurrency + the watchlist race (6 lists where 1 is required); AI-001 location; 2/3 AI-002; 4 CI-config, and 2 more for the pinning and the database major; 1 idempotence-claim; 2 supersede; 2 admin-guard; 8 accessibility; 5 of 10 performance; 6 of 10 HTTP-contract; 3 of 8 CSRF-parity |
| Typecheck / lint / build | clean; 18 pre-existing lint warnings, unchanged |
| **CI** | **green** — run 45: install 5 s, typecheck 14 s, lint 15 s, migrate 2 s, test 2m35s, build 30 s |
| Browser audit | 25 routes × 3 configurations, zero axe violations, no horizontal overflow |
| Benchmark | `pnpm perf:seed` + `pnpm perf:bench`, 13 scenarios, median of 5, on a disposable database — **never production** |

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
- **`\timing` with `tail -1` measures the last statement, not the one you care about.** My first
  cascade figure ("80× faster") was the time of the `ROLLBACK`. Use `EXPLAIN ANALYZE`, which reports
  per-trigger time, and read the plan.
- **A cancelled CI run looks exactly like a hung one in the UI.** Read `conclusion` and the step
  durations before touching a timeout. Mine said `cancelled` at 2m17s, by my own
  `cancel-in-progress` when I pushed the next commit. Raising the timeout fixed nothing.
- **Key a duplicate-query detector on SQL text *and* parameters.** On text alone, one prepared
  statement reused with different periods looks like four duplicates.
- **`.slice(0, N)` over a query with no `ORDER BY` caps an arbitrary N.** A cap is only a cap if the
  set is ordered; otherwise the output changes between runs for no visible reason.
- **`chat()` does not take a client; `chatStream()` does.** My first end-to-end injection test reached
  for a real provider and died behind the sanitised error message. If a test of the agent loop fails
  with "Something went wrong with this conversation", that is what it means.
- **A guarantee a model has to cooperate with is not a control.** The useful question about a
  prompt-injection mitigation is "what does this stop even if the model does exactly what the attacker
  asked?" — and if the answer is nothing, the mitigation is documentation.
- **A test that asserts on a line of source is a test of the formatting.** One from 3.23 pinned a
  literal string from `proxy.ts` and broke the moment that rule moved into the module that already
  owned it — the source had changed, the contract had not. Call the thing and assert what it answers.
  (The exception that earns its place: a *structural* sweep over files, like "no page under a Suspense
  fallback relies on `notFound()`", which is an invariant no behavioural test can reach.)
- **Removing a file to see what changes is a legitimate experiment.** Moving `(app)/loading.tsx` aside,
  rebuilding and re-measuring turned "app-wide Next.js streaming behaviour" into one file and one line.
  A root cause you have not made disappear and come back is a hypothesis.
- **Two copies of a security rule are defence in depth only while they agree.** These had drifted into
  a 500 where a 403 belonged. If a rule is worth applying twice, import it twice.
- **A workaround in the harness hides a defect indefinitely.** `pnpm db:migrate --test` had been broken
  for anyone without the session hook's `DATABASE_SSL=false`, and nothing was ever red.
- **`??` is not `||`.** A variable that is set but empty passes `??` and becomes the connection string.
  Both instances were found by a test asserting the *default* target, not by reading the code.
- Carried forward: assert on `hits`/`total` not raw response text; `DELETE /api/me/sessions`
  reissues the cookie; clear `rate_limits` between probe phases; tests that count rows need their
  own user.

## Known blockers

| Blocker | Needs |
|---|---|
| No production backup | `DATABASE_URL` + `BACKUP_PASSPHRASE` secrets in GitHub |
| `0007` unapplied | A backup, then explicit authorization |
| `0008` unapplied | The same; BUG-007 stays live in production until it lands |
| `0009` unapplied | The same; it is purely additive (five `CREATE INDEX`), so it has nothing to pre-flight, but it still queues behind `0007` and `0008` |
| PostgreSQL 18 locally | Not installable here and there is no container runtime, so the 18 pairing of CI and production is verified **in CI only**; the development cluster is still 16 |
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
- **A guard that affects the HTTP status belongs above the Suspense boundary.** That is the layout, and
  it is the reason the role table exists at all. The page keeps its own check: the table decides the
  status, not who may see the page. If the proxy's header is ever missing, the page's guard answers and
  the worst case is the old wrong status — never a page shown to somebody who may not see it.
- **An advisory lock is the right fix when a unique index would be partial.** BUG-008 needed
  `(user_id) WHERE is_default`, which would also constrain a path that legitimately moves the flag — and
  any migration here waits behind the production gate, so the defect would have stayed live. A
  transaction-scoped lock needs nothing but the code.
- **Pin actions to commits, bump them deliberately.** `@v4` is a branch its owner can move. The version
  goes in a trailing comment so the file stays readable, and a test fails on any `uses:` that is not a
  40-character commit.
- **Keep CI's database on production's major, and pin the major rather than the patch.** A managed
  database moves on its own; the thing worth pinning is the compatibility boundary.
