# Security

This application holds extremely personal data; it is designed as a *private* system.

| Control | Implementation |
|---|---|
| Authentication | Email + password, scrypt (N=2^17, r=8, p=1, 16-byte salt), constant-time compare, dummy hash on unknown emails (no timing oracle). First account via `/setup`; further sign-ups disabled unless `ALLOW_SIGNUP=true`. |
| Sessions | Opaque 256-bit token in an `HttpOnly`, `SameSite=Lax`, `Secure` (prod) cookie; only its SHA-256 is stored; 30-day sliding expiry; revoke all devices; password change revokes other sessions. |
| Authorization | `proxy.ts` blocks every non-public route/API without a session cookie; every route handler runs `withAuth` (real session lookup); every service query is scoped by `userId`; cross-user ids → 404. |
| CSRF | SameSite=Lax cookies + Origin/Referer must match the host (or `ALLOWED_ORIGINS`) for all non-GET requests (`proxy.ts`, `security/origin.ts`). |
| Input validation | Zod on every body/query (API) and every tool call (AI). Unknown tools/params fail closed. |
| SQL injection | Drizzle parameterized queries; raw fragments only with bound parameters. |
| XSS | React escaping; markdown renderer builds React nodes (no `dangerouslySetInnerHTML` for user/AI content); CSP, `X-Frame-Options: DENY`, `nosniff`, HSTS, Referrer-Policy, Permissions-Policy headers (`next.config.ts`). |
| Rate limiting | Login/sign-up per IP, API/AI/market per user (`security/rate-limit.ts`; swap the store for Redis on multi-instance). |
| Secrets | Only in server env vars; the browser never sees API keys (the German tutor was changed to call the server). `/api/me` exposes only booleans. |
| AI safety | Tools are the only way the AI changes data; risk levels + confirmation; full action log with params/result/status; audit log rows for every AI write; the model is instructed to never claim success without a tool result and failures are surfaced verbatim. |
| Audit log | `audit_logs` for auth events and every create/update/delete (user or AI). Visible via `/api/me/audit`. |
| Backups & export | `pnpm backup` (pg_dump), daily GitHub Action, JSON export of everything, CSV per dataset, account deletion with password + "DELETE" confirmation (cascade). |
| Cron | `/api/cron` requires `Authorization: Bearer $CRON_SECRET` (timing-safe compare). |
| PWA | Service worker never caches `/api/*` (private data); only the static shell. |

Known limits / next steps: no 2FA yet (recommended: TOTP or passkeys), in-memory rate limiter is
per instance, uploaded screenshots are URLs (no file storage yet), and the CSP allows inline
scripts because Next.js requires it without a nonce setup.
