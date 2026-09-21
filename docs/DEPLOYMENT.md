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
4. Set `CRON_SECRET` in Vercel. Vercel sends it automatically as the bearer token when it invokes a
   cron job, and `/api/cron` refuses every request without it — including when the variable is unset,
   so an instance that forgot to configure one is closed rather than open.
5. Open `/setup` once to create the owner account. Then leave `ALLOW_SIGNUP` unset.

## Scheduled maintenance

`/api/cron` answers **GET**, which is the method both schedulers use. (It answered only POST until
phase 3.19, so on Vercel it returned 405 and no scheduled work ran at all. POST was unusable anyway:
`proxy.ts` rejects mutating methods whose `Origin` does not match the host, before it consults its
public-path list, and a scheduler sends no `Origin`.)

Jobs are declared once in `src/server/services/maintenance.ts`, each with the cadence it needs:

| Scope | Jobs | Why |
|---|---|---|
| `frequent` | price alerts, conversation expiry, news | These read the world at the instant they run. Once a day, an alert only ever sees one price, and a transcript with a 24 h TTL lives up to 48 h. |
| `daily` | recurring transactions, notifications, portfolio snapshot, session purge, rate-limit purge | These reconcile: they catch up on whatever is outstanding, so a missed run costs lateness, not work. |

    GET /api/cron                  every job          (the daily safety net)
    GET /api/cron?scope=frequent   the frequent ones
    GET /api/cron?scope=daily      the daily ones

**Two schedulers, on purpose.** Vercel's Hobby plan caps cron jobs at **one run per day** and invokes
them anywhere within the scheduled hour (±59 min); a more frequent expression fails at deployment.
So `vercel.json` keeps its daily entry, which runs *everything*, and
`.github/workflows/maintenance.yml` runs the frequent half every 15 minutes — free and unmetered on
a public repository, with a documented floor of 5 minutes.

To enable the workflow: add repository **variable** `APP_URL` (the deployment's URL) and repository
**secret** `CRON_SECRET` (the same value as in Vercel). Two things to know about it: scheduled
workflows only ever run on the repository's **default branch**, whatever branch the file lives on;
and in a public repository they are **disabled automatically after 60 days without repository
activity**. That is exactly why the Vercel daily job still runs everything — if the workflow stops,
the app stays correct and only loses timeliness.

Delivery is best effort on both sides: GitHub drops queued runs under load and Vercel warns that a
scheduled run can be missed *or* delivered twice. Every job is idempotent, so a duplicate run is a
no-op and a missed one is made up by the next.

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
