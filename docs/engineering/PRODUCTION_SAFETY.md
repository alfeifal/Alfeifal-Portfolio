# Production safety

Last verified: 2026-09-23, against commit `8c0531d` plus the phase 3.22 changes.

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

## Incident — an account was created in production by mistake (2026-09-23)

Recorded here because it happened, it was my error, and the guard that now prevents it only makes
sense next to the story.

**What happened.** Phase 3.22 needed a throwaway account on the *local test* database to probe API
routes with a logged-in session. The script began:

```ts
import "dotenv/config";
Object.assign(process.env, { NODE_ENV: "test", DATABASE_DRIVER: "pg", DATABASE_SSL: "false" });
process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
import { db } from "@/server/db";          // ← evaluated BEFORE the line above
```

ESM evaluates imports before any statement in the module body. `src/server/db` therefore read
`.env` — `NODE_ENV` unset, so *production*, over the Neon driver — and chose its connection string
before `Object.assign` ever ran. The script reported success. It had created
`audit322@example.com` plus the 131 rows `bootstrapUserData()` seeds, in the live database.

**How it was caught.** The login it was created for failed with 401 against the local server. That
made no sense, so the next step was to look for the row — and it was not in the test database.

**Exact scope, read from production.** One `users` row and 131 rows it owns: 20 categories, 49
exercises, 49 training-day exercises, 8 training days, 1 each of accounts, subjects, trading
accounts, training plans and watchlists. **No sessions** — the account was never logged into,
because the local server was correctly pointed at the test database. Nothing belonging to the owner
was read, modified or deleted. An earlier read-only probe in the same session left no rows behind
(checked: zero `notifications` with a `probe:` dedupe key).

**Status: NOT cleaned up.** Removing the account is itself a write to production, and this
environment refused the command. It needs the owner's decision — see *Open production blockers*.

**The guard that now exists.** `src/server/db/index.ts` refuses a non-local host unless
`NODE_ENV=production` (the deployment) or `ALLOW_REMOTE_DB=1` is set explicitly for that one
command. The error names only the hostname, never the URL. Verified by running the exact script
above again: it now throws at module load instead of connecting. Six tests in
`tests/operations.test.ts` cover it, each in its own child process because the guard fires once per
process.

**Consequence for existing commands:** `pnpm db:seed` reaches production through `@/server/db`, so
it now needs `ALLOW_REMOTE_DB=1` in front of it. `pnpm db:migrate` and `pnpm backup` build their
own connections and are unaffected.

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
| **Remove `audit322@example.com` from production** | The owner's go-ahead for one `DELETE`; see the incident above. The cascade removes exactly the 131 rows it owns and nothing else: `delete from users where email = 'audit322@example.com';` |
| No backup | The two secrets above, set by the repository owner |
| `0007` not applied | A verified backup, then explicit authorization |
| `0008` not applied | The same; it applies after `0007` and BUG-007 stays live until it does |
| `/api/admin/usage` returns 500 | `0007` |
| Rate limiting is per-instance in production | `0007` |
| GitHub Actions maintenance workflow failing | `APP_URL` variable and `CRON_SECRET` secret |
| `CRON_SECRET` in Vercel unconfirmed | Access to Vercel's environment variables |
