# Production safety

Last verified: 2026-09-22, against commit `ad17110`.

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

Read over HTTPS with read-only statements on 2026-09-22:

| | |
|---|---|
| Migrations recorded | **7** (`0000_init` … `0006_force_password_rotation`) |
| `ai_usage` present | no |
| `rate_limits` present | no |
| Public tables | 55 (the count from before `0007`; the migration adds two) |
| Accounts | 1 |

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
| `/api/admin/usage` returns 500 | `0007` |
| Rate limiting is per-instance in production | `0007` |
| GitHub Actions maintenance workflow failing | `APP_URL` variable and `CRON_SECRET` secret |
| `CRON_SECRET` in Vercel unconfirmed | Access to Vercel's environment variables |
