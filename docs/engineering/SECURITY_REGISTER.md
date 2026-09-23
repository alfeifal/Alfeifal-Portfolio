# Security register

Findings carry the severity model from the master prompt. A finding is only listed once it has been
reproduced; nothing here is speculative, and nothing is marked verified that was not re-tested after
the fix.

| ID | Severity | Area | Status |
|---|---|---|---|
| SEC-000 | **CRITICAL** | CI / backups | Fixed `ad17110`, awaiting owner action |
| SEC-001 | **HIGH** | Authentication / redirects | Fixed, verified |
| SEC-002 | MEDIUM | API error handling | Fixed, verified |
| SEC-003 | MEDIUM | Operations | Open, owner action |
| SEC-004 | LOW | Logging | Fixed as a side effect of SEC-002 |
| SEC-005 | INFORMATIONAL | Rate limiting | Accepted, documented |
| SEC-006 | MEDIUM | API error handling | Fixed, verified — SEC-002 was incomplete |
| SEC-007 | MEDIUM | AI assistant | Mitigated, not eliminated — see the caveat |

---

## SEC-000 — a plaintext production dump would have been published to a public repository

**Severity:** CRITICAL (prevented; never actually published)

**Area:** `.github/workflows/backup.yml`

**Risk:** the repository is public. GitHub's documentation is explicit that anyone with read access
to a repository can download its artifacts, and that for a public repository the endpoint works
without authentication at all. The workflow uploaded an unencrypted `pg_dump`. Had the missing
`DATABASE_URL` secret been added as the workflow stood, every daily run would have published a
complete copy of the production database — accounts, password hashes, session tokens, finances,
journal entries, assistant memory — downloadable by anyone, for thirty days at a time.

**Evidence:** GitHub docs on artifact download permissions; repository confirmed public via the API
(`"visibility": "public"`). The workflow's own comment claimed artifacts are "encrypted at rest by
GitHub", which is true and irrelevant: they are decrypted for whoever downloads them. That sentence
is what made the hole invisible.

**Why it never fired:** the `DATABASE_URL` secret was never configured, so all nine runs failed
before producing anything. The absence of a backup is what prevented the disclosure.

**Remediation (`ad17110`):** the dump is encrypted with AES-256 before upload, using a passphrase
from a second secret; the step proves the ciphertext decrypts to a readable archive before deleting
the plaintext; the artifact pattern matches only `*.gpg`; `if-no-files-found: error`; permissions
narrowed to `contents: read`.

**Verification:** end to end against a disposable database — real dump of the full 57-table schema,
encrypted, plaintext deleted, decrypted, restored into a clean database, and table count, row count
and a specific seeded row all matched the source.

**Residual:** the repaired workflow has not yet run on a real runner, because the secrets are still
unset. Making the repository private would close the exposure by a different route; the encryption
is correct either way.

---

## SEC-001 — post-authentication open redirect

**Severity:** HIGH

**Area:** `src/app/(auth)/login/page.tsx`

**Risk:** the login page chose where to send somebody after a successful sign-in with
`next.startsWith("/")`. That reads like a same-site check and is not one: `//evil.example` starts
with a slash and is a protocol-relative URL, which the browser reads as `https://evil.example`.
`/\evil.example` is the same hole through a different door, because the URL parser treats a
backslash as a slash under a special scheme.

An attacker sends `https://<app>/login?next=//evil.example`. The victim sees the real domain and the
real login page, signs in for real, and lands on the attacker's site — which is what makes a
post-login redirect worth phishing with in the first place.

**Evidence:** reproduced in headless Chromium against a production build, with a real account and a
real form submission:

```
payload="//evil.example/pwned"    -> left the site
payload="/\evil.example/pwned"    -> left the site
payload="https://evil.example"    -> blocked (correct)
payload="/tasks"                  -> /tasks (correct)
```

**Root cause:** a textual prefix test standing in for an origin comparison.

**Fix:** `src/lib/safe-redirect.ts`. The candidate is resolved against the page's own origin with
the URL parser and kept only if it lands there; the returned value is rebuilt from the parsed parts,
so what comes back is always a path on this origin. `javascript:` resolves to a null origin and is
refused by the same rule.

**Verification:** the same browser test re-run against the rebuilt application — all three attack
payloads land inside the site, and the legitimate `/tasks` still works.

**Regression test:** `tests/security-audit.test.ts`, "SEC-001". Confirmed to fail against the
unfixed code (5 of 7 assertions) before being kept.

---

## SEC-002 — a malformed resource id was a 500

**Severity:** MEDIUM

**Area:** `src/server/crud.ts`, affecting every module built on the shared CRUD factory

**Risk:** `GET /api/tasks/not-a-uuid` reached Postgres, which raised `invalid input syntax for type
uuid`, and the wrapper turned a client's typo into a server fault. Any caller could mint 500s at
will, which buries real faults in monitoring noise, and it reports a client error as a server error.

**Evidence:** measured across modules against a production build — `tasks`, `goals`, `projects`,
`events` and `journal` returned 500; `transactions` and `accounts` returned 404 because their
services validate separately. The inconsistency is itself the tell that the guard was missing from
the shared layer.

**Fix:** `assertResourceId` in `src/server/crud.ts`, called by the generated `GET`, `PATCH` and
`DELETE` item handlers. A malformed id answers **404** — deliberately the same answer a real id
belonging to somebody else gets, so the status cannot be used to tell which ids exist.

**Verification:** re-measured after the fix; all seven probed modules answer 404 for `GET`, `PATCH`
and `DELETE`, a valid-but-nonexistent id still answers 404, and the SQL no longer appears in the
server log.

**Regression test:** `tests/security-audit.test.ts`, "SEC-002". Confirmed to fail against the
unfixed code before being kept.

---

## SEC-003 — the maintenance workflow cannot authenticate

**Severity:** MEDIUM (availability, not disclosure)

**Area:** `.github/workflows/maintenance.yml`

**Risk:** `APP_URL` and `CRON_SECRET` are not configured, so every run fails and no frequent
maintenance happens: price alerts are evaluated at most once a day by Vercel's cron, and chat
transcripts outlive their stated 24-hour retention.

**Evidence:** the job log shows both variables empty and the guard firing.

**Status:** open. Needs the repository owner; an agent may not set secrets.

---

## SEC-004 — SQL and bound parameters in the server log

**Severity:** LOW (the logs are private to the deployment)

**Area:** `errorResponse` in `src/server/http.ts`

**Risk:** an unhandled database error logged the failing statement together with its parameters,
which for the SEC-002 path included the authenticated account's own id.

**Fix:** SEC-002 removes the path that produced it — the query is no longer attempted. The general
shape of `errorResponse` is unchanged and is reviewed in phase 4.1.

**Note:** the same class of leak on the cron path was fixed separately in `8736f7f` (E-2).

---

## SEC-005 — rate limiting degrades to per-instance

**Severity:** INFORMATIONAL

The shared limiter counts in Postgres. When the database is unreachable — and, today, while `0007`
is unapplied — it falls back to an in-process map, which on a serverless platform means the real
ceiling is the configured limit times however many instances are warm. This is documented in
`src/server/security/rate-limit.ts` and `docs/SECURITY.md`, and the code does not describe the
limit as global. Accepted: the alternative is failing closed, which turns a degraded control into
an outage.

---

## SEC-006 — the SEC-002 fix covered only the routes the CRUD factory generates

**Severity:** MEDIUM · **Status:** fixed in phase 3.22, verified against a production build

**Area:** `src/server/http.ts`, `src/server/crud.ts`, every hand-written `[id]` route

SEC-002 put `assertResourceId` in `src/server/crud.ts`, so it applied to routes the factory
generates and to nothing else. Eleven hand-written routes pass `params.id` straight to a service.
Probed against a production build with a logged-in session, **eight of them answered 500**:

| Route | Before | After |
|---|---|---|
| `GET`/`DELETE /api/ai/conversations/[id]` | 500 | 404 |
| `POST /api/ai/actions/[id]/confirm` | 500 | 404 |
| `POST /api/ai/actions/[id]/reject` | 500 | 404 |
| `GET`/`PATCH`/`DELETE /api/academy/lessons/[id]` | 500 | 404 |
| `POST /api/goals/[id]/milestones` | 500 | 404 |
| `GET /api/admin/users/[id]` | 500 | 404 |
| `PATCH`/`DELETE /api/ai/memory/[id]` | 400 (the service validated it) | 404 |

The response body was already masked to `{"error":"Internal error"}` under `NODE_ENV=production`,
so nothing internal reached the caller — but the status was wrong, any caller could mint 500s at
will, and the server log carried `invalid input syntax for type uuid` with the bound parameter.

**Fix.** The guard moved into `withAuth`, where it runs for every route before the handler. There
are only two dynamic segment names in `src/app/api` — `id` (41 routes) and `kind` (1) — so this is
complete rather than a longer list of call sites. `crud()` passes the resource name through
`{ resource }` so its 404 still says "Transaction not found" rather than "Resource not found".

**A second defect this exposed, found by the same probe.** The first version of the guard read
`(await ctx.params).id` assuming `ctx.params` exists whenever `ctx` does. Next passes a context
object to *every* handler and only populates `params` on a dynamic route, so every collection
endpoint — `/api/me`, `/api/tasks`, `/api/finance/categories`, all of them — answered 500 for
about ten minutes of this session. Caught by probing, not by the type system: `params` is typed `P`
and is `undefined` at runtime. Fixed with `?? ({} as P)` and re-verified.

**Verified after the fix:** all 11 malformed-id probes answer 404; all 7 collection probes answer
200. `tests/ai-audit.test.ts` pins the guard's location, and fails when `http.ts` is reverted.

**Note, not a defect:** on an admin route a non-admin now gets 404 for a malformed id rather than
403, because the id guard runs inside `withAuth` and `withAdmin` wraps it. Nothing is disclosed —
a well-formed id still gets 403 — and the earlier answer is the less informative of the two.

---

## SEC-007 — third-party news text reaches a tool-enabled loop

**Severity:** MEDIUM · **Status:** mitigated in phase 3.22. **Not eliminated, and this entry will
not claim otherwise.**

**Area:** `src/server/ai/tools/market.ts`, `src/server/ai/context.ts`, `src/server/ai/untrusted.ts`

`get_market_news` is a read tool available in assistant mode — `toolsForMode("assistant")` returns
`null`, meaning every registered tool — and it returns `headline` and `summary` copied verbatim
from public RSS feeds (CNBC, MarketWatch, Investing.com, CoinDesk and others). That text lands in
the same transcript from which the model chooses its next tool call.

What an instruction hidden in a feed item could reach:

| Class | Requires confirmation? | Reachable |
|---|---|---|
| `read` | n/a | yes |
| `low` (`add_expense`, `create_task`, `remember_memory`, `delete_notification`, …) | **no — runs immediately** | yes |
| `medium` deletes | yes, `needsConfirmation` is set on all of them | no |
| `high` | yes, always, regardless of the tool's own opinion | no |

The worst of the low-risk set is `remember_memory`: a memory is durable and `buildSystemPrompt`
replays it into every later conversation, so one poisoned write persists.

**Mitigation.** `get_market_news` now returns `{ untrustedContent, items }` instead of a bare
array, and the system prompt gains a rule naming that label and saying what to do with it. Nothing
in the feed content is altered or dropped — it is wrapped, not filtered.

**The caveat, stated plainly.** This is an instruction to a language model. No test in this
repository can show that a model obeys it, because no test here has ever reached a real provider
(there is no `ANTHROPIC_API_KEY` in this environment). `tests/ai-audit.test.ts` proves the label is
present, that wrapping preserves the content unchanged, and that the prompt carries the rule — that
is all it proves.

**The controls that do not depend on the model's cooperation**, and which carry the actual risk
reduction: high-risk tools always confirm, every medium-risk delete confirms, and every action the
assistant takes is written to `ai_action_logs` where the user can see it.

**Not changed on purpose:** no risk level was raised and no confirmation was added or removed.
Raising `remember_memory` to medium would close the durable path, but changing risk levels is
outside what this phase was authorized to do. Recorded here as the open decision it is.

---

## Checked and found sound

Re-tested against a production build during 3.20; no defect found:

- Cross-account read, update and delete by id (403/404, target unchanged).
- Cross-account leakage through list endpoints and through search.
- An administrator's own module data and search results contain nothing of another account's.
- The admin account list carries no password material or session tokens.
- A plain account is refused by `/api/admin/users` and `/api/admin/usage` (403).
- Session cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` under `NODE_ENV=production`.
- A revoked session stops serving immediately; the session that performed the revocation is issued
  a fresh cookie in the same response.
- A forged session cookie does not authenticate.
- CSRF: every mutating request without a matching `Origin` is refused, including from another
  origin, on ordinary routes, account deletion and admin routes.
- Malformed, traversal and injection-shaped ids return a client error with no internal detail **on
  the routes the CRUD factory generates**. This line originally had no qualifier and was wrong for
  the hand-written routes; see SEC-006, which found and fixed them.
- An invalid JSON body returns 400 without exposing the parser.
- `/api/me` exposes no password material, tokens, environment values or another account's address.
