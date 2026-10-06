# Release readiness

Phase 3.27. One question, answered without rounding up: **for every claim these documents make, what is
the strongest evidence behind it, and where was that evidence taken?**

The point of the phase is that it cannot "pass". Three migrations are unapplied, several secrets are
unset, and no agent can clear either. What it can do is make the gap between *works* and *works in
production* impossible to misread — including where earlier phases of this project wrote the stronger
sentence.

## The four kinds of evidence, and what each is worth

| label | means | what it does not establish |
|---|---|---|
| **local** | run on this machine, against the local PostgreSQL 16 cluster | that CI agrees, or that production does |
| **CI** | run by GitHub Actions on `ubuntu-latest` against PostgreSQL 18 | behaviour under production data volumes or Neon's pooling |
| **disposable DB** | run against `personal_os_perf`, ~110k rows, created and dropped by `scripts/perf-bench.ts` | any production figure whatsoever |
| **production** | observed against `https://alfeifal-portfolio.vercel.app` or the Neon database | nothing beyond exactly what was observed |

An unlabelled claim in any other document should be read as the weakest of these until someone checks.

## Verification status, claim by claim

### Verified in production

| claim | evidence | taken |
|---|---|---|
| The app is up and serves its login page | `GET /login` → 200 | 2026-10-03 |
| An unauthenticated request never reaches a private page | `GET /` → 307 to `/login`; `GET /admin` → 307 | 2026-10-03 |
| An unauthenticated API call is refused | `GET /api/dashboard` → 401 | 2026-10-03 |
| Security headers are actually sent | CSP with `frame-ancestors 'none'`, HSTS `max-age=63072000; includeSubDomains`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/microphone/geolocation | 2026-10-03 |
| The daily Vercel cron runs | ~57 s against a 300 s ceiling, observed daily | phase 3.23 |
| The GitHub Actions maintenance workflow has **never** succeeded | every run to date failed; needs `APP_URL` and `CRON_SECRET` | phases 3.23, 3.25 |
| Production holds exactly one account and 311 rows, all the owner's | read-only pass over all 51 tables carrying `user_id` | 2026-10-02, after the SEC-008 cleanup |
| Production runs PostgreSQL 18.6 | read from the server | phase 3.21 |

`/api/auth/status` answered in **2.6 s** cold. That is one sample of a cold serverless invocation plus a
Neon connection, not a latency measurement, and it is recorded here only so nobody later quotes it as one.

### Verified in CI

| claim | evidence |
|---|---|
| Typecheck, lint, migrations, the full suite and a production build all pass | run 48 on `5e53285`: typecheck 19 s, lint 20 s, migrate 2 s, **test 198 s**, build 39 s, inside the 20-minute bound |
| The suite passes on production's PostgreSQL major | run 48 is the first on `postgres:18`; 16 → 18 changed nothing |
| The bumped, SHA-pinned actions work | same run — `checkout` v7.0.1, `pnpm/action-setup` v6.1.0, `setup-node` v7.0.0 |
| CI was red for 43 consecutive runs before 3.23 and has been green since 45 | the run history |

There is no PostgreSQL 18 and no container runtime in the development environment, so **the 18 pairing is
a CI measurement only**; the local cluster is still 16.

### Verified locally, in a real browser

| claim | evidence |
|---|---|
| Zero accessibility violations | axe-core 4.10.2, 25 routes × 3 configurations = 75 pairs, zero; dark confirmed applied on all 25 |
| No horizontal overflow at 375 px | same run, `scrollWidth === clientWidth` on every route |
| A guarded page answers 404, not 200 | `GET /admin` as a signed-in non-administrator → 404, admin → 200, `/tasks` → 200, unmatched path → 404 |
| A forged `x-pos-pathname` header changes nothing | both directions probed |
| A list's entrance is bounded | `/news` at `SETTLE=1500`: 18 contrast nodes before, 0 after |
| A conversation that has read feed text cannot write without the user (SEC-007) | seven tests, including one across two turns through the real agent loop with a scripted client; three fail against the ungated code |
| The same-origin rule's route-level throw was **not reachable over HTTP** | every malformed-header shape answers 403 at the edge; see BUG-018 |

### Verified on a disposable database only

Every performance figure in these documents, without exception:

| claim | before → after |
|---|---|
| `generateNotifications` | 1479 queries / 496 ms → 31 / 38 ms |
| the daily cron pass | 4464 / 1610 ms → 120 / 274 ms |
| account cascade delete, with migration `0009` | 684 ms → 105 ms |
| the six `user_id` tables from 3.21 | 0.07–1.5 ms; no index justified |

**None of these is a production measurement, and none may be quoted as one.** Two of them cannot be
confirmed without a deployment that exercises them: the cron's query count and the RSS batching from
BUG-012.

### Verified by tests only, and dormant in production

| claim | why it is dormant |
|---|---|
| Four concurrent check-then-insert writes settle on one row (BUG-007) | needs migration `0008`; **the duplicates are still live in production** |
| A retried account bootstrap changes nothing (BUG-017) | needs `0008` for the collision that makes it reachable |
| The shared rate limiter works across instances | needs `0007`; production is silently in single-instance fallback |
| `/api/admin/usage` returns usage | needs `0007`; it currently returns 500 in production |
| The account cascade is fast | needs `0009` |

### Not verified at all, and honestly cannot be here

| claim | what it needs |
|---|---|
| A real production backup exists | `DATABASE_URL` + `BACKUP_PASSPHRASE` in GitHub |
| The assistant behaves as described against a real model | `ANTHROPIC_API_KEY` |
| SEC-007's **labelling** is obeyed by a model | the same key; it is an instruction and has never met one. Its **enforcement** half needs no model and is verified locally — see below |
| Native tool search (3.17) | the same key; the flag path has never met a provider |
| Vercel's `CRON_SECRET` is set | access to Vercel's environment variables |

## Where this project has overstated things before

Kept as a list because the pattern repeats, and the pattern is the finding.

1. **"Idempotent"** meant "called twice in a row, by hand". Corrected in 3.21 after four real races.
2. **"CI is green"** was said while CI had never once reached the test step — 43 runs (BUG-010).
3. **"The suite passes"** was true only because three admin tests asserted nothing (BUG-011).
4. **"The run hung"** was a cancelled run, read from the duration alone (BUG-013, withdrawn).
5. **"80× faster"** was the time of a `ROLLBACK` captured by `tail -1` (3.25).
6. **"`notFound()` is app-wide Next.js behaviour"** was one `loading.tsx` in this repository, and the
   claim that it reproduced on `/projects/[id]` was simply untrue (BUG-005).
7. **"A malformed `Referer` answered 500"** — mine, in 3.26. It was latent; the edge answered 403
   (BUG-018, severity corrected down).
8. **"`prefers-reduced-motion` is honoured"** was half right: transforms yes, opacity deliberately not,
   which is why the same audit mis-read a fade twice (BUG-020).

Six of those eight were my own. The guard against the ninth is the same each time: say where the
measurement was taken, and re-run it after the thing you think caused it is removed.

## The release gate, stated plainly

Production is deployed from `claude/personal-operating-system-nuoesg`, which is this repository's default
branch, so what is described here reaches production on the next build. What does **not** reach it is any
schema change: `0007`, `0008` and `0009` are written, tested against a disposable database, and
unapplied.

**Blocking, in order:**

1. A verified production backup — needs two secrets only the owner can set.
2. Explicit written authorization to apply `0007`, then `0008`, then `0009`.
3. `APP_URL` and `CRON_SECRET` in GitHub, for the maintenance workflow (SEC-003).

Until 1 and 2 clear, this is honestly described as: **a correct, tested application running against a
schema older than itself.** Every known consequence of that gap is listed under *dormant in production*
above, and none of it is silent — each one is a documented entry with the test that covers it.
