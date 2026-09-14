# Personal OS

A private, authenticated, AI-powered **Personal Operating System**: one place to manage, document,
analyze and improve your life — and to *talk to it* so the system organizes your life with you.

Modules: Home · Assistant · Calendar · Tasks · Planner · Finance · Investing · Trading · Market News ·
Training · Nutrition · Studies · German · Goals · Projects · Journal · Analytics · Reviews ·
Notifications · Settings.

```
USER → AI ASSISTANT → TOOL / FUNCTION CALLING → APPLICATION SERVICES → POSTGRESQL
```
The AI never touches the database directly: it can only call typed, risk-classified tools
(`src/server/ai/tools/*`) that go through the same services the UI uses. Every call is validated,
logged (`ai_action_logs`) and, for medium/high-risk actions, held for your confirmation.

## Stack
Next.js 16 (App Router, route handlers, `proxy.ts`) · React 19 · TypeScript · Tailwind CSS 3 ·
PostgreSQL 16 · Drizzle ORM · Zod · Anthropic SDK (tool use) · Recharts · PWA (manifest + SW) ·
Vitest.

## Quick start
```bash
pnpm install
cp .env.example .env            # set DATABASE_URL, AUTH_SECRET, ANTHROPIC_API_KEY (optional), FINNHUB_API_KEY (optional)
pnpm db:migrate                 # applies ./drizzle migrations
pnpm dev                        # http://localhost:3000 → /setup creates the owner account
```
The first account is created from `/setup`. Afterwards sign-up is closed unless `ALLOW_SIGNUP=true`.
Creating the account seeds: finance categories + a default account, the **training routine from
your attached document** (8-day cycle, 49 exercises), the `German` subject linked to the module,
a paper trading account and an empty watchlist. No fake activity data is ever inserted.

## Scripts
| Command | What |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` | Checks (tests use `TEST_DATABASE_URL`) |
| `pnpm db:generate` · `pnpm db:migrate [--test|--http]` · `pnpm db:studio` | Drizzle migrations (`--http` = Neon over HTTPS) / studio |
| `pnpm db:seed <email>` | Re-seed the routine for a user (idempotent) |
| `pnpm backup` | `pg_dump` to `backups/` (see `scripts/backup.sh`) |
| `pnpm check` | typecheck + lint + test + build |

## Documentation
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture, data model, folder structure, AI/tool design, integrations
- [docs/SECURITY.md](docs/SECURITY.md) — threat model and the controls implemented
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel/Neon, Docker, cron, backups, environment variables
- [docs/training-routine.md](docs/training-routine.md) — the routine as imported (source of truth)
- [docs/german-audit.md](docs/german-audit.md) — audit of the German project and how it was integrated

## Data honesty
Every important record carries a `source` label (`user` exact · `ai` · `estimated` · `import`/database ·
`external` · `calculated`) and the UI shows it. Market prices and news come only from real providers
(Finnhub / Stooq / Yahoo / CoinGecko / public RSS feeds) and are shown with their source and freshness;
missing data is reported as missing, never invented. Real and simulated trading results are never
mixed.
