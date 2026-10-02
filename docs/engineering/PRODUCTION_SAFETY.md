# Production safety

Last verified: 2026-10-02, against commit `642c421`.

Nothing in this file is written from a previous report. Every line was checked in the session that
wrote it, and anything that could not be checked says so.

## Production database

| | |
|---|---|
| Host | `ep-damp-sound-b2mf1xh9-pooler.c-6.eu-central-1.aws.neon.tech` |
| Database | `neondb` |
| Provider | Neon (pooled endpoint) |
| Verified how | `DATABASE_URL` parsed locally; host and database name only, never the credentials |

**Caveat, stated because it matters:** this confirms what `.env` points at. Nobody has confirmed
from inside Vercel that the deployment's own `DATABASE_URL` is the same string — that needs access
to Vercel's environment variables, which this working environment does not have.

## Migration state

Read over HTTPS with read-only statements on 2026-09-22, re-checked 2026-09-23:

| | |
|---|---|
| Migrations recorded | **7** (`0000_init` … `0006_force_password_rotation`) |
| `ai_usage` present | no |
| `rate_limits` present | no |
| Public tables | 55 (the count from before `0007`; the migration adds two) |
| Accounts | 1 |
| Server version | PostgreSQL 18.6 (re-read 2026-09-23) |

**Migration `0007_shared_limits_and_ai_usage` is NOT applied to production.**

It is strictly additive: two `CREATE TABLE`, one foreign key, three indexes, and no `ALTER` or
`DROP` against anything that already exists. The runner was exercised against a disposable database
brought to production's exact state (7 recorded, both tables absent): it applied only `0007`, and a
second pass was a no-op.

### Consequence of the current state

The application code that uses those tables **is deployed** (`GET /api/cron` answers 401, not the
405 it answered before the fix), so production is running against a schema that is missing them:

| Surface | Behaviour with `0007` absent |
|---|---|
| Shared rate limiter | Falls back to the in-process limiter. Per instance, not shared. |
| AI usage counter | Records nothing; the write fails and is swallowed. |
| `/api/admin/usage` | **500** — the one surface that does not degrade gracefully. |
| Everything else in the cron | Unaffected; verified against a database in this exact state. |

### Migration `0008_concurrency_unique_constraints` is also NOT applied

Added in phase 3.21 for BUG-007. Four statements: three `CREATE UNIQUE INDEX`, one `ALTER TABLE …
ADD CONSTRAINT … UNIQUE NULLS NOT DISTINCT`, and one `DROP INDEX` of the plain
`notifications_dedupe_idx` that the new unique index replaces. The unique index is created before
the plain one is dropped, so the dedupe lookup is never unindexed. No table, column or row is
touched.

`NULLS NOT DISTINCT` needs PostgreSQL 15 or later; production is 18.6, confirmed by reading
`current_setting('server_version')` on 2026-09-23.

A unique index fails if the table already violates it, so this was checked before writing the
migration. Read-only against production, 2026-09-23 — **zero** rows violate any of the four:

| Constraint | Existing violations |
|---|---|
| `notifications (user_id, dedupe_key)` | 0 |
| `categories (user_id, kind, lower(name))` | 0 |
| `budgets (user_id, category_id)` nulls-not-distinct | 0 |
| `watchlist_items (watchlist_id, symbol)` | 0 |

**Consequence of it being absent:** none that is visible. The four call sites were written so the
`ON CONFLICT DO NOTHING` clause is inert without the indexes, which is exactly today's behaviour —
the duplicate writes of BUG-007 remain possible in production until it is applied. Applying it
changes no data.

## Backup state

**There is no backup of this production database. None has ever been taken.**

- All nine runs of the `Database backup` workflow have failed, from 2026-09-14 to 2026-09-22, every
  one with `DATABASE_URL is required`: the secret is not configured in GitHub.
- No `backups/` directory exists locally.
- `pg_dump` cannot run from this working environment: TCP 5432 to Neon is unreachable, and the
  outbound proxy is HTTP/HTTPS only and does not tunnel the Postgres wire protocol.

The workflow itself was repaired in `ad17110` and now encrypts before uploading — see
`SECURITY_REGISTER.md` SEC-000. The repair is validated end to end against a disposable database
(dump → integrity check → encrypt → decrypt → restore → compare), but **validating the procedure is
not the same as having a backup**, and this file will not say otherwise.

### What a backup needs, exactly

Two repository secrets, neither of which an agent may set:

- `DATABASE_URL` — the production connection string.
- `BACKUP_PASSPHRASE` — a long random passphrase, stored somewhere that is **not** this database.

Then *Actions → Database backup → Run workflow*. A green run with one `.gpg` artifact is the first
real backup.

## Recovery

```
gpg --decrypt --output personal-os.dump personal-os-<stamp>.dump.gpg
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" personal-os.dump
```

Restoration has been exercised against a disposable database, not against production.

Neon's own instant-restore window is an additional safety net on paper; it has not been checked from
here, because that needs the Neon console or API.

## Incident — an account was created in production by mistake (2026-09-23, resolved 2026-10-02)

Recorded in full because it happened, it was my error, and the guard that now prevents it only makes
sense next to the story.

### Root cause

Phase 3.22 needed a throwaway account on the *local test* database to probe API routes with a
logged-in session. The script began:

```ts
import "dotenv/config";
Object.assign(process.env, { NODE_ENV: "test", DATABASE_DRIVER: "pg", DATABASE_SSL: "false" });
process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
import { db } from "@/server/db";          // ← evaluated BEFORE the two lines above
```

ESM evaluates every import before any statement in the module body. `src/server/db` therefore read
`.env` — `NODE_ENV` unset, so the *production* branch, over the Neon driver — and fixed its
connection string before `Object.assign` ever ran. `TEST_DATABASE_URL ??=` was likewise too late to
matter. The script looked local, reported success, and had written to the live database.

### What was created

| | |
|---|---|
| Account | `audit322@example.com`, created 2026-09-23 09:37:10 UTC, non-admin, `is_active = true` |
| Rows at creation | **131**, all seeded by `bootstrapUserData()`: 20 categories, 49 exercises, 49 training-day exercises, 8 training days, and one each of accounts, subjects, trading accounts, training plans, watchlists |
| Rows at deletion | **149** — the 131 above plus **18 notifications** the daily maintenance job generated for the account over the nine days it existed |
| Sessions | **none, ever.** `sessions` was 6 before the delete and 6 after, so the cascade removed none: the account was never logged into. The local server it was created for was correctly pointed at the test database, which is why its login failed — and that failure is what exposed the mistake. |

### What was *not* touched

Nothing belonging to the owner was read, modified or deleted. An earlier read-only probe in the same
session left nothing behind either (checked: zero `notifications` carrying a `probe:` dedupe key).

### Detection

The login the account was created for returned 401 against the local server. That made no sense, so
the next step was to look for the row — and it was not in the test database. A read of production
found it there.

### Cleanup, 2026-10-02, on explicit written authorization

One statement, `DELETE FROM users WHERE email = 'audit322@example.com'`, run after three
preconditions were checked in the same script: the host ends in `.neon.tech`, `current_database()`
is `neondb`, and exactly one row carries that address. Whole-table counts were taken before and
after, for the nine seeded tables plus `users`, `sessions`, `notifications`, `ai_action_logs`,
`audit_logs`, `transactions`, `tasks` and `journal_entries`.

| | Before | After | Delta |
|---|---|---|---|
| `users` | 2 | 1 | −1 |
| `notifications` | 47 | 29 | −18 |
| `categories` | 41 | 21 | −20 |
| `exercises` | 98 | 49 | −49 |
| `training_day_exercises` | 98 | 49 | −49 |
| `training_days` | 16 | 8 | −8 |
| `accounts`, `subjects`, `trading_accounts`, `training_plans`, `watchlists` | 2 each | 1 each | −1 each |
| `sessions` | 6 | 6 | **0** |
| `ai_action_logs` | 41 | 41 | **0** |
| `audit_logs` | 42 | 42 | **0** |
| `transactions` | 2 | 2 | **0** |
| `tasks`, `journal_entries` | 0 | 0 | **0** |

The only delta that was not predicted in advance is the 18 notifications: the prediction was made on
the day the account was created, when it owned none, and the daily job had been generating them for
it ever since. A correct cascade, not collateral.

### Verification afterwards (read-only, a second pass over all 51 tables carrying `user_id`)

```
rows still referencing the deleted account    : 0
rows belonging to any account but the owner   : 0
total rows belonging to the owner             : 311
owner's notifications                         : 29   (= every notification in the database)
users remaining                               : ayoub.afak.aaa@gmail.com (2026-09-14 17:49:18 UTC)
```

### Remediation

`src/server/db/index.ts` refuses a non-local host unless `NODE_ENV=production` (the deployment) or
`ALLOW_REMOTE_DB=1` is set explicitly for that one command. The error names only the hostname, never
the URL or its credentials. Verified by re-running the exact script above: it now throws at module
load instead of connecting.

**Regression tests:** six, in `tests/operations.test.ts` under *"the database module refuses a remote
host from a process that is not the deployment"*. Each runs in its own child process, because the
guard fires once per process at module evaluation. They cover: refused with `NODE_ENV` unset;
refused under `NODE_ENV=test` (the shape that caused this); the message naming the host and never
the URL or credentials; allowed under `NODE_ENV=production`; allowed with `ALLOW_REMOTE_DB=1`;
allowed for a local database with no ceremony.

**Commit:** `e2d03b3` carries the guard and its tests. `642c421` follows it (unrelated chore).

**Consequence for existing commands:** `pnpm db:seed` reaches production through `@/server/db`, so
it now needs `ALLOW_REMOTE_DB=1` in front of it. `pnpm db:migrate` and `pnpm backup` build their own
connections and are unaffected — which is itself a gap, noted below.

### Remaining risk

1. **The guard only covers `@/server/db`.** `scripts/migrate.ts`, `scripts/backup.sh` and anything
   using `neon()` or `pg` directly build their own connection and are not checked. That is partly
   deliberate — the read-only production probes in these documents work that way — but it means the
   guard is a safety net for one specific, repeated mistake, not a perimeter.
2. **`drizzle-kit` is still unguarded.** `drizzle.config.ts` defaults to `DATABASE_URL`, so any
   `drizzle-kit` command points at production unless told otherwise. `push` remains forbidden.
3. **`ALLOW_REMOTE_DB=1` is one keystroke.** It is meant to be: the point is that reaching
   production has to be typed deliberately, not that it is impossible.
4. **Nothing was lost, and nothing is outstanding from this incident.** Production holds exactly one
   account and 311 rows, all the owner's.

## Deployment restrictions

- **Never** `drizzle-kit push` against production. `drizzle.config.ts` defaults to `DATABASE_URL`,
  so `drizzle-kit` commands point at production unless told otherwise — a `push` was started here
  by mistake once, and only failed to touch anything because it could not open a connection.
- Migrations go through `pnpm db:migrate --http` and nothing else.
- Port 5432 is unreachable from this environment; anything needing a direct connection must run
  elsewhere.

## Open production blockers

| Blocker | Needs |
|---|---|
| No backup | The two secrets above, set by the repository owner |
| `0007` not applied | A verified backup, then explicit authorization |
| `0008` not applied | The same; it applies after `0007` and BUG-007 stays live until it does |
| `/api/admin/usage` returns 500 | `0007` |
| Rate limiting is per-instance in production | `0007` |
| GitHub Actions maintenance workflow failing | `APP_URL` variable and `CRON_SECRET` secret |
| `CRON_SECRET` in Vercel unconfirmed | Access to Vercel's environment variables |
