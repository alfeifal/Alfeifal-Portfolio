# Bug register

Defects found by inspection or by attacking a running build. Each one was reproduced before being
written down. Security findings live in `SECURITY_REGISTER.md`; this file covers correctness.

| ID | Severity | Component | Status |
|---|---|---|---|
| BUG-001 | **CRITICAL** | Scheduled maintenance | Fixed `273e1af`, deployed |
| BUG-002 | **HIGH** | Backups | Fixed `ad17110`, blocked on secrets |
| BUG-003 | MEDIUM | Shared CRUD | Fixed, verified (= SEC-002) |
| BUG-004 | MEDIUM | AI usage accounting | Fixed `273e1af`, dormant until `0007` |
| BUG-005 | LOW | App-wide HTTP status | Open, deferred by decision |
| BUG-006 | INFORMATIONAL | Scheduling | Open, external |

---

## BUG-001 — no scheduled work had ever run in production

**Severity:** CRITICAL · **Status:** fixed in `273e1af`, deployed and confirmed

`/api/cron` exported only `POST`. Both Vercel Cron and GitHub Actions invoke with `GET`, so the
endpoint answered 405 every night since deployment. `POST` was unreachable anyway: `proxy.ts`
rejects mutating methods whose `Origin` does not match the host, and it does so before consulting
its public-path list, so a scheduler — which sends no `Origin` — got 403 even though `/api/cron` is
public.

Nothing had processed a recurring transaction, raised a notification, checked a price alert, written
a portfolio snapshot or deleted an expired chat transcript.

**Evidence:** measured against a production build — `GET` 405, `POST` 403.
**Fix:** export `GET` with the same timing-safe secret check.
**Regression test:** `tests/operations.test.ts`.
**Verified in production:** `GET https://<app>/api/cron` now answers 401, not 405.

---

## BUG-002 — the backup had never produced a backup

**Severity:** HIGH · **Status:** code fixed in `ad17110`; a real backup is blocked on secrets

All nine runs of the daily backup failed with `DATABASE_URL is required`. Separately, the script
used a shell redirect, which creates the file before `pg_dump` runs, so a dump that died halfway
left a truncated file wearing a backup's name.

**Evidence:** demonstrated, not theorised — against an unreachable database the old script leaves a
0-byte `personal-os-<stamp>.dump`; the new one leaves nothing.
**Fix:** dump to a temporary file; reject under a minimum size; reject an archive `pg_restore
--list` cannot read; reject an archive with no table data; only then move it into place.
**Verified:** dump → integrity → encrypt → decrypt → restore → compare, against a disposable
database.
**Blocked:** see `PRODUCTION_SAFETY.md`.

---

## BUG-003 — a malformed id answered 500

**Severity:** MEDIUM · **Status:** fixed, verified

Same defect as SEC-002; recorded here because it is also a correctness bug. Five of eight probed
modules returned 500 for a non-UUID id; two returned 404, which is the inconsistency that showed the
guard was missing from the shared layer.

**Fix:** `assertResourceId` in `src/server/crud.ts`, answering 404.
**Regression test:** `tests/security-audit.test.ts`.

---

## BUG-004 — assistant usage had no durable home

**Severity:** MEDIUM · **Status:** fixed in `273e1af`; dormant until `0007` is applied

`ai_messages` carries token counts but has no `user_id` — it hangs off `ai_conversations`, which is
hard-deleted 24 hours after its last message, cascading the messages away. Every total older than a
day was already gone, and fixing the cron would have *started* the purge that destroys it.

**Fix:** `ai_usage`, hanging off `users`, written per round so a turn that fails later still
accounts for the calls it made. Cache reads and writes are separate columns because the provider
prices them differently.
**Regression test:** `tests/operations.test.ts` — including a test that purges conversations and
then checks the counter survived.
**Currently dormant:** the table does not exist in production.

---

## BUG-005 — `notFound()` answers 200

**Severity:** LOW · **Status:** open, deferred by explicit decision

`notFound()` called from a dynamic Server Component returns HTTP 200 with the not-found body rather
than 404. Reproduced on `/admin` and identically on `/projects/[id]`, so it is app-wide Next.js
streaming behaviour and not specific to any route.

Not a security issue: no content reaches an unauthorised viewer, and `/api/*` answers 403/404
correctly. It is wrong for caching, crawling and monitoring. Fixing it touches the whole render
path, so it was deferred rather than folded into an unrelated phase.

---

## BUG-006 — scheduled runs arrive far less often than configured

**Severity:** INFORMATIONAL · **Status:** open, external

The maintenance workflow is configured for every 15 minutes. Observed runs: 05:33, 11:03, 16:58 UTC
— roughly every five and a half hours, against the ~46 runs a 15-minute cadence implies. This is the
documented GitHub behaviour ("some queued jobs may be dropped"), but the magnitude weakens the price
alert fix that the cadence exists for.

Whether it improves once the runs stop failing is unknown and undocumented; it needs re-measuring
after SEC-003 is resolved.

---

## Conventions

- A bug is only recorded once reproduced.
- Every fix carries a regression test that was confirmed to fail against the unfixed code.
- "Fixed" means re-verified after the change, by the same method that found it.
- "Verified in production" is used only for something actually observed against the deployment.
