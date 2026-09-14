# Deployment

## Environment variables
See `.env.example`. Required: `DATABASE_URL`, `AUTH_SECRET`. Optional: `ANTHROPIC_API_KEY`
(assistant, reviews, briefs, tutor), `ANTHROPIC_MODEL`, `FINNHUB_API_KEY` (realtime quotes),
`EXTRA_NEWS_FEEDS`, `ALLOW_SIGNUP`, `ALLOWED_ORIGINS`, `CRON_SECRET`, `DATABASE_SSL=true` for
managed Postgres, `DATABASE_DRIVER=neon` to talk to Neon over WebSocket/443 instead of TCP 5432
(needed only where 5432 is blocked; Vercel/Docker can keep the default `pg`), `DEFAULT_TIMEZONE`,
`DEFAULT_CURRENCY`.

## Vercel + managed PostgreSQL (Neon / Supabase / RDS)
1. Create the database, set `DATABASE_URL` (+ `DATABASE_SSL=true`).
2. Import the repo in Vercel; build command `pnpm build`; add the env vars.
3. Run migrations once from your machine or CI: `DATABASE_URL=… pnpm db:migrate`
   (migrations are plain SQL in `./drizzle`, reviewed in git). If outbound port 5432 is blocked
   where you run it (some sandboxes/CI runners), use Neon's HTTPS endpoint instead:
   `pnpm db:migrate --http`.
4. `vercel.json` schedules `POST /api/cron` hourly — set `CRON_SECRET` in Vercel (Vercel sends it
   automatically as the bearer token for cron invocations).
5. Open `/setup` once to create the owner account. Then leave `ALLOW_SIGNUP` unset.

## Docker / any VPS
```bash
docker build -t personal-os .
docker run -p 3000:3000 --env-file .env personal-os   # runs migrations, then next start
```
Put it behind HTTPS (Caddy/Traefik/Cloudflare). Schedule the cron with `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron` hourly.

## Backups
- `pnpm backup` → `backups/personal-os-<stamp>.dump` (custom format, restore with `pg_restore`).
- `.github/workflows/backup.yml` runs daily with the `DATABASE_URL` repository secret and keeps 30
  days of artifacts. Managed providers (Neon/Supabase) also offer point-in-time recovery — enable it.
- Users can always download a full JSON export from Settings.

## Before a release
```bash
pnpm check   # typecheck + lint + tests (needs TEST_DATABASE_URL) + build
```
CI (`.github/workflows/ci.yml`) does the same against a PostgreSQL 16 service.

## Local development database
Any PostgreSQL 16. Example with Docker: `docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16`
then `createdb personal_os && createdb personal_os_test`.
