# Autonomous roadmap

Status vocabulary, used strictly: **VERIFIED** means re-tested by the method that would have caught
its absence. **COMPLETE** means the work was done and its tests pass. **BLOCKED** means a named
external prerequisite is missing. Nothing is marked from a previous report.

## Current position

- **Phase 3 — stabilization and consolidation**
- **Subphase in progress:** 3.20 (security and privacy audit)
- **Commit:** see `SESSION_CHECKPOINT.md`

## Phase 3

| Subphase | Status | Evidence |
|---|---|---|
| 3.1–3.13 | COMPLETE (historical) | Not re-verified individually this session; the suite covering them passes |
| 3.14 AI protocol reliability | COMPLETE | `tests/ai-protocol.test.ts` |
| 3.15 AI descriptions / context | COMPLETE | `tests/ai-quality.test.ts` |
| 3.16 tool routing | COMPLETE | `tests/ai-routing.test.ts` |
| 3.17 native tool search | COMPLETE as prototype, **off** | `tests/ai-tool-search.test.ts`; never met a real provider |
| 3.18 multi-user / admin | **VERIFIED** | `tests/multi-user-admin.test.ts`; isolation re-attacked in 3.20 |
| 3.19 maintenance / limiter / usage | COMPLETE in code, **partly dormant in production** | `tests/operations.test.ts`; `0007` unapplied |
| 3.19.1 error sanitisation | **VERIFIED** | Tests confirmed to fail against the unfixed code |
| 3.19.2 migration checkpoint | **BLOCKED** | No backup exists |
| 3.19.2A backup repair | COMPLETE in code, **BLOCKED** for a real backup | Restore validated on a disposable database |
| **3.19.2B** real production backup | **BLOCKED** | Needs `DATABASE_URL` + `BACKUP_PASSPHRASE` secrets |
| **3.19.3** apply `0007` | **BLOCKED** | Needs a backup, then explicit authorization |
| **3.20** security & privacy audit | **IN PROGRESS** | SEC-001, SEC-002 found and fixed; `tests/security-audit.test.ts` |
| 3.21 database integrity audit | NOT STARTED | Next eligible |
| 3.22 AI assistant & tool audit | NOT STARTED | |
| 3.23 cron / CI-CD / operations | PARTLY DONE via 3.19.x | Formal pass not run |
| 3.24 UX / accessibility | NOT STARTED | |
| 3.25 performance & scalability | NOT STARTED | Earlier work in 3.9/3.11 |
| 3.26 bug & debt remediation | ONGOING | Driven by `BUG_REGISTER.md` |
| 3.27 full regression / release readiness | NOT STARTED | Cannot pass while production blockers stand |

## Phases 4–12

NOT STARTED. Phase 3 must reach a trustworthy state first, which is the stated purpose of phase 3.

## Blocked work, and exactly what unblocks it

| Item | Blocker | Who can clear it |
|---|---|---|
| 3.19.2B | `DATABASE_URL` and `BACKUP_PASSPHRASE` not set in GitHub | Repository owner |
| 3.19.3 | No backup, and no authorization given | Owner, after 3.19.2B |
| SEC-003 | `APP_URL` and `CRON_SECRET` not set in GitHub | Repository owner |
| Vercel cron confirmation | No access to Vercel environment variables | Owner |
| Real-model AI evaluation | No `ANTHROPIC_API_KEY` in this environment | Owner |

An agent may not set secrets, so these will not clear themselves and are not retried.

## Dependencies

```
3.19.2B (backup) ──> 3.19.3 (apply 0007) ──> /api/admin/usage works
                                        └──> shared rate limiter actually shared
                                        └──> AI usage measurable ──> any future quota
SEC-003 (secrets) ──> frequent maintenance runs ──> BUG-006 re-measurable
3.20 ──> 3.21 ──> 3.22 ──> 3.27
```

Everything below 3.21 is independent of the production blockers and can proceed.
