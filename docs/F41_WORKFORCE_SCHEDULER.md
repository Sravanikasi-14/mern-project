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

## Architecture (after F41 + Batch C)

```
GET/POST /api/workforce-scheduler/run   (Bearer CRON_SECRET)
  └─ runSchedulerWithAutoContinue          (NEW-S1)
       └─ runSchedulerForAllCompanies × N hops (awaited in-process)
            ├─ beginOrResumeSchedulerWave (CAS — NEW-S3)
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
            │         ├─ mid-wave fleet checkpoint on contiguous completion (NEW-S2)
            │         └─ release lock + ALS scope (success / failure / return)
            └─ saveFleetProgress | clearFleetProgress (clear only when zero pending)
                 return { truncated, nextAfterCompanyId, waveStartedAt, hops, results[], durations }
```

**Allocation rules are unchanged** (weights, AUTO priorities, leave/skills/capacity, atomic UNASSIGNED assign).

## Configuration

| Env | Default | Role |
|-----|---------|------|
| `WORKFORCE_SCHEDULER_ENABLED` | false | Master switch |
| `WORKFORCE_SCHEDULER_MODE` | dry-run | dry-run \| apply |
| `WORKFORCE_SCHEDULER_COMPANY_CONCURRENCY` | 2 | Max parallel tenants (capped at 8) |
| `WORKFORCE_SCHEDULER_BUDGET_MS` | 50000 | Wall-clock budget per hop |
| `WORKFORCE_SCHEDULER_MAX_COMPANIES` | 0 (none) | Hard cap per hop |
| `WORKFORCE_SCHEDULER_LOCK_MS` | 90000 | Per-company lock TTL |
| `WORKFORCE_SCHEDULER_WAVE_STALE_MS` | 24h | Abandoned wave restart threshold |
| `WORKFORCE_SCHEDULER_AUTO_CONTINUE` | **false** | NEW-S1 in-process continuation |
| `WORKFORCE_SCHEDULER_MAX_CHAIN_DEPTH` | 3 | Max continuation hops after the first run |
| `WORKFORCE_SCHEDULER_CHAIN_BUDGET_MS` | 55000 | Wall-clock for entire chain in one invocation |
| `WORKFORCE_SCHEDULER_MIN_HOP_BUDGET_MS` | 5000 | Skip another hop if remaining time below this |
| `WORKFORCE_SCHEDULER_CONTINUE_VIA_HTTP` | false | Optional awaited HTTP self-continue |
| `WORKFORCE_SCHEDULER_CONTINUE_TIMEOUT_MS` | 55000 | HTTP continue AbortSignal timeout |
| `WORKFORCE_SCHEDULER_BASE_URL` | (VERCEL_URL) | Origin for HTTP continue |
| `CRON_SECRET` | required | Cron Bearer auth |

Cron query/body overrides (authenticated): `afterCompanyId`, `budgetMs`, `concurrency`, `maxCompanies`, `dryRun`, `chainDepth`, `waveStartedAt`.

## Continuation / retry (Batch C NEW-S1)

1. Each hop starts or **resumes** a wave via CAS on `workforce_scheduler_fleet`.
2. Companies completed in the wave (`lastRunAt >= waveStartedAt` and not truncated) are skipped.
3. Mid-queue truncation keeps `lastRunAt` unchanged and sets `lastRunSummary.truncated`.
4. When `WORKFORCE_SCHEDULER_AUTO_CONTINUE=true` and `truncated: true`, the cron handler **awaits** further in-process hops (same mode, same `waveStartedAt`, fleet/`afterCompanyId` cursor) up to `MAX_CHAIN_DEPTH`.
5. Infinite loops are prevented by max chain depth + remaining chain budget / min hop budget.
6. Idempotency: company lock + atomic UNASSIGNED claim prevent duplicate assignments on retry.
7. Progress is checkpointed after contiguous company completions (NEW-S2). **Never** clears the fleet doc until a final pending re-check shows zero remaining.
8. Optional `CONTINUE_VIA_HTTP` performs an **awaited** authenticated self-POST (not fire-and-forget). Prefer in-process hops on Vercel; lower `BUDGET_MS` so multiple hops fit under `maxDuration`.

**Production:** keep `AUTO_CONTINUE=false` until staging dry-run verification succeeds.

## Multiple Vercel instances

| Mechanism | Behavior |
|-----------|----------|
| CAS wave start (NEW-S3) | Concurrent starts converge on one `waveStartedAt`; losers resume winner’s cursor. |
| Per-company lock | Only one instance runs a given company; others get `lock_held` and leave it pending. |
| Assign path | Atomic UNASSIGNED → assigned prevents duplicate ownership. |
| Connections | Each company runs inside its own `runWithTenantConnectionScope`; scopes release so the process does not pin all tenant DBs at once. Concurrency K bounds simultaneous open scopes. |

## Vercel behavior

| | |
|--|--|
| Cron | `0 2 * * *` → `/api/workforce-scheduler/run` |
| Limits | `maxDuration: 60`, memory 1024 |
| Budget | Default hop 50s; chain budget 55s leaves headroom |
| Auto-continue | Enable only with lower `BUDGET_MS` (e.g. 15–20s) so depth≤3 fits in 60s |
| Cold / warm | Same logic; ALS scopes release between companies |

## Throughput: structural vs measured

| Improvement | Type |
|-------------|------|
| Bounded tenant concurrency | **Structural** |
| Wall-clock truncation + durable wave | **Structural** |
| Once-per-company eligibility roster | **Structural** (fewer Mongo round-trips) |
| Shorter default lock TTL (90s) | **Structural** |
| Auto-continue truncated fleets (NEW-S1) | **Structural** (same-day resume) |
| CAS wave start (NEW-S3) | **Structural** |
| Mid-wave fleet checkpoints (NEW-S2) | **Structural** |
| Per-tenant failure isolation | Retained / explicit |

**Expected (not measured in production):** with concurrency 2 and ~1–3s dry-run per small tenant, on the order of **tens of tenants per 50s budget** is plausible; large rosters/queues reduce that sharply. CI does not claim production RPS or tenant/minute benchmarks.

## Files

| File | Change |
|------|--------|
| `workforceScheduler/config.js` | Concurrency / budget / lock / auto-continue flags |
| `workforceScheduler/autoContinue.js` | NEW-S1 awaited in-process (+ optional HTTP) continuation |
| `workforceScheduler/fleetProgress.js` | Durable wave cursor; CAS start; contiguous cursor helper |
| `workforceScheduler/eligibility.js` | Roster/leave cache inputs |
| `workforceScheduler/strategy.js` | Pass cache into eligibility |
| `workforceScheduler/executionController.js` | Bounded concurrency, budget, checkpoints, truncated lastRunAt policy |
| `workforceScheduler/index.js` | Re-exports |
| `controllers/workforceSchedulerController.js` | Cron entry uses auto-continue; chainDepth / waveStartedAt |
| `tests/f41_workforce_scheduler.test.js` | Regression + Batch C suite |
| `docs/F41_WORKFORCE_SCHEDULER.md` | This doc |

## Deployment requirements

1. Set Production `CRON_SECRET` (≥16 chars) so Vercel injects Bearer on the cron.
2. Keep `WORKFORCE_SCHEDULER_ENABLED=false` until dry-run review; then `MODE=dry-run`, later `apply`.
3. **Do not enable `WORKFORCE_SCHEDULER_AUTO_CONTINUE` in production until staging dry-run verification.**
4. Staging dry-run: `ENABLED=true`, `MODE=dry-run`, `AUTO_CONTINUE=true`, lower `BUDGET_MS` / `MAX_COMPANIES` as needed; confirm multi-hop `hops`, cursor resume, no duplicate assigns.
5. Optionally tune `COMPANY_CONCURRENCY` (2–4), `BUDGET_MS`, `MAX_COMPANIES`, `MAX_CHAIN_DEPTH`.
6. No Redis/Kafka. No OfferLetter `syncIndexes()`. No Batch D.
7. Redeploy `server` so `vercel.json` cron + `maxDuration: 60` apply.

## Remaining limitations

- Hobby plan still has one scheduled cron per day; auto-continue only helps within a single invocation’s chain budget / maxDuration.
- Hard kill mid-company before `lastRunSummary` write may re-process that company’s queue; assigns remain idempotent.
- Enabling `apply` at scale needs monitoring of `truncated` / `errorCount` / fleet doc / `hops`.
- Unrelated announcement / notification / payslip workflows are intentionally untouched.
