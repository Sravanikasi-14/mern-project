# F41 — Workforce scheduler multi-tenant execution performance

## Audit summary (Step 1)

| Question | Answer |
|----------|--------|
| How are tenants discovered? | Central `Company` docs with `status` ACTIVE or TRIAL; each has its own `databaseName`. |
| Sequential before F41? | Yes — one company after another with no wall-clock budget. |
| Overlapping cron possible? | Yes across Vercel instances; mitigated by per-company Mongo locks (`lockUntil` / `lockToken`). |
| Partial failures? | Per-company try/catch; one tenant error does not abort the batch. |
| Resume after timeout? | Durable wave + per-company `lastRunAt` / `lastRunSummary` on central Mongo (no Redis). |
| Completed vs pending? | A company needs work in the current wave if `lastRunSummary.truncated`, or `!lastRunAt`, or `lastRunAt < waveStartedAt`. |

| Finding | Detail |
|---------|--------|
| Before | Full fleet sequential; Vercel `maxDuration: 60` easily exceeded as company count grew. |
| Per tenant | Up to 100 tasks; eligibility used to reload ACTIVE roster per task. |
| Locks | Per-company lock (anti-overlap); TTL now 90s (was 240s ≫ kill window). |
| Resume | Fleet document `workforce_scheduler_fleet` + fair ordering; optional `afterCompanyId`. |

## Architecture (after F41)

```
GET/POST /api/workforce-scheduler/run   (Bearer CRON_SECRET)
  └─ runSchedulerForAllCompanies
       ├─ beginOrResumeSchedulerWave (central collection workforce_scheduler_fleet)
       ├─ discover ACTIVE|TRIAL companies
       ├─ filter: companyNeedsSchedulerRun(waveStartedAt)
       ├─ order: truncated-first, then lastRunAt asc, then _id
       ├─ optional afterCompanyId (fully completed only — never skips truncated)
       ├─ optional maxCompanies cap
       ├─ mapWithBoundedConcurrency(K ≤ 8)
       │    └─ runWithTenantConnectionScope → runCompanyScheduler
       │         ├─ company lock
       │         ├─ load roster + leave **once**
       │         ├─ decideAssignment (rules unchanged)
       │         ├─ stop tasks if deadline reached (summary.truncated; do not advance lastRunAt)
       │         └─ release lock + ALS scope (success / failure / return)
       └─ saveFleetProgress | clearFleetProgress
            return { truncated, nextAfterCompanyId, waveStartedAt, results[], durations }
```

**Allocation rules are unchanged** (weights, AUTO priorities, leave/skills/capacity, atomic UNASSIGNED assign).

## Configuration

| Env | Default | Role |
|-----|---------|------|
| `WORKFORCE_SCHEDULER_ENABLED` | false | Master switch |
| `WORKFORCE_SCHEDULER_MODE` | dry-run | dry-run \| apply |
| `WORKFORCE_SCHEDULER_COMPANY_CONCURRENCY` | 2 | Max parallel tenants (capped at 8) |
| `WORKFORCE_SCHEDULER_BUDGET_MS` | 50000 | Wall-clock budget per invocation |
| `WORKFORCE_SCHEDULER_MAX_COMPANIES` | 0 (none) | Hard cap per invocation |
| `WORKFORCE_SCHEDULER_LOCK_MS` | 90000 | Per-company lock TTL |
| `WORKFORCE_SCHEDULER_WAVE_STALE_MS` | 24h | Abandoned wave restart threshold |
| `CRON_SECRET` | required | Cron Bearer auth |

Cron query/body overrides (authenticated): `afterCompanyId`, `budgetMs`, `concurrency`, `maxCompanies`, `dryRun`.

## Continuation / retry (Mongo only — no Redis / Kafka / fire-and-forget)

1. Each invocation starts or **resumes** a wave via `workforce_scheduler_fleet`.
2. Companies completed in the wave (`lastRunAt >= waveStartedAt` and not truncated) are skipped.
3. Mid-queue truncation keeps `lastRunAt` unchanged and sets `lastRunSummary.truncated` so the tenant is preferred next.
4. If `truncated: true`, the next cron (or manual `?afterCompanyId=`) continues the same wave.
5. Idempotency: company lock + atomic UNASSIGNED claim prevent duplicate assignments on retry.
6. Progress is durable only after Mongo writes succeed. **Vercel may terminate before persistence** — the next invocation re-selects still-pending tenants; it does not claim guaranteed completion of an in-flight company.

Self-chained HTTP continuation is **not** auto-fired (avoids fire-and-forget without completion tracking).

## Multiple Vercel instances

| Mechanism | Behavior |
|-----------|----------|
| Shared wave doc | Instances may both resume the same `waveStartedAt`. |
| Per-company lock | Only one instance runs a given company; others get `lock_held` and leave it pending. |
| Assign path | Atomic UNASSIGNED → assigned prevents duplicate ownership. |
| Connections | Each company runs inside its own `runWithTenantConnectionScope`; scopes release so the process does not pin all tenant DBs at once. Concurrency K bounds simultaneous open scopes. |

## Vercel behavior

| | |
|--|--|
| Cron | `0 2 * * *` → `/api/workforce-scheduler/run` |
| Limits | `maxDuration: 60`, memory 1024 |
| Budget | Default 50s leaves headroom for response serialization |
| Cold / warm | Same logic; ALS scopes release between companies |

## Throughput: structural vs measured

| Improvement | Type |
|-------------|------|
| Bounded tenant concurrency | **Structural** |
| Wall-clock truncation + durable wave | **Structural** |
| Once-per-company eligibility roster | **Structural** (fewer Mongo round-trips) |
| Shorter default lock TTL (90s) | **Structural** |
| Per-tenant failure isolation | Retained / explicit |

**Expected (not measured in production):** with concurrency 2 and ~1–3s dry-run per small tenant, on the order of **tens of tenants per 50s budget** is plausible; large rosters/queues reduce that sharply. CI does not claim production RPS or tenant/minute benchmarks.

## Files

| File | Change |
|------|--------|
| `workforceScheduler/config.js` | Concurrency / budget / lock defaults |
| `workforceScheduler/fleetProgress.js` | Durable wave cursor on central Mongo |
| `workforceScheduler/eligibility.js` | Roster/leave cache inputs |
| `workforceScheduler/strategy.js` | Pass cache into eligibility |
| `workforceScheduler/executionController.js` | Bounded concurrency, budget, wave filter, truncated lastRunAt policy |
| `workforceScheduler/index.js` | Re-exports |
| `controllers/workforceSchedulerController.js` | Cursor/budget query params |
| `tests/f41_workforce_scheduler.test.js` | Regression suite |
| `docs/F41_WORKFORCE_SCHEDULER.md` | This doc |

## Deployment requirements

1. Set Production `CRON_SECRET` (≥16 chars) so Vercel injects Bearer on the cron.
2. Keep `WORKFORCE_SCHEDULER_ENABLED=false` until dry-run review; then `MODE=dry-run`, later `apply`.
3. Optionally tune `COMPANY_CONCURRENCY` (2–4), `BUDGET_MS` (≤50000), `MAX_COMPANIES`.
4. No Redis/Kafka. No OfferLetter `syncIndexes()`.
5. Redeploy `server` so `vercel.json` cron + `maxDuration: 60` apply.

## Remaining limitations

- One scheduled cron per day on Hobby — large fleets may need same-day ops re-invoke (cron or authenticated POST).
- Hard kill mid-company before `lastRunSummary` write may re-process that company’s queue; assigns remain idempotent.
- Enabling `apply` at scale needs monitoring of `truncated` / `errorCount` / fleet doc.
- Unrelated announcement / notification / payslip workflows are intentionally untouched.
