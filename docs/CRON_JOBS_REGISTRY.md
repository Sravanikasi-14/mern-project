# HRMS Cron Jobs Registry

Canonical inventory of scheduled business workflows and related time-based mechanisms.

**Operational policy:** every scheduled **business** workflow runs **once per day**. Do not introduce sub-daily Vercel Cron schedules on the current plan. New production cron jobs require explicit approval before activation.

**Timezone note:** Vercel Cron expressions use **UTC**. IST = UTC+05:30.

| Local (IST) | UTC |
|-------------|-----|
| 07:30 AM IST | 02:00 UTC |
| 08:30 AM IST | 03:00 UTC |

Authoritative Vercel Cron config: [`server/vercel.json`](../server/vercel.json).  
Shared cron HTTP auth: [`server/utils/cronAuth.js`](../server/utils/cronAuth.js) (`Authorization: Bearer <CRON_SECRET>`).

---

## 1. Confirmed production schedules

### 1.1 Workforce Scheduler

| Field | Value |
|-------|--------|
| **Job name** | Workforce Scheduler |
| **Business purpose** | Multi-tenant workforce task scheduling and allocation (propose / optionally assign UNASSIGNED work fairly across tenants). |
| **Endpoint** | `/api/workforce-scheduler/run` |
| **HTTP methods** | `GET`, `POST` |
| **Execution platform** | **cron-job.org** (external). Vercel Cron trigger **removed** in commit `d06fd4e`. |
| **Frequency** | Daily (one run per day — operational policy) |
| **Schedule (UTC)** | `02:00` (`0 2 * * *` equivalent) |
| **Schedule (IST)** | **07:30 AM IST** |
| **Authentication** | `Authorization: Bearer <CRON_SECRET>` (`requireCronSecret` + in-handler re-check). Fallback secret: `ANNOUNCEMENT_CRON_SECRET` if `CRON_SECRET` is unset. |
| **Environment variables** | `CRON_SECRET` (required for auth). `WORKFORCE_SCHEDULER_ENABLED` (master switch; default off). `WORKFORCE_SCHEDULER_MODE` (`dry-run` \| `apply`; **current production: dry-run**). Budgets/locks: `WORKFORCE_SCHEDULER_BUDGET_MS`, `WORKFORCE_SCHEDULER_PER_COMPANY_BUDGET_MS`, `WORKFORCE_SCHEDULER_COMPANY_CONCURRENCY`, `WORKFORCE_SCHEDULER_LOCK_MS`, `WORKFORCE_SCHEDULER_MAX_COMPANIES`. Continuation: `WORKFORCE_SCHEDULER_AUTO_CONTINUE` (**must remain `false` / unset in production**), `WORKFORCE_SCHEDULER_MAX_CHAIN_DEPTH`, `WORKFORCE_SCHEDULER_CHAIN_BUDGET_MS`, etc. |
| **Tenant isolation** | Central `Company` discovery → per-tenant `runWithTenantConnectionScope` + `getCompanyModels`. Per-company Mongo locks. Durable fleet cursor on central DB (`workforce_scheduler_fleet`). |
| **Database operations** | Reads: companies, tenant tasks/employees/leave. Writes (even in dry-run): company lock fields, `lastRunAt` / `lastRunSummary`, fleet progress, tenant scheduler audit logs. Apply mode also assigns tasks. |
| **Notifications** | None in dry-run. Apply mode may create assignment notifications via existing work-management notify path. |
| **Dry-run / apply** | **Production: dry-run.** Query `dryRun=true` forces dry-run. Apply only after explicit approval. |
| **Error handling / monitoring** | Per-tenant try/catch; truncated waves resume via fleet cursor; sanitized public HTTP summary (no per-employee decision dump). Server logs aggregate counts (avoid logging secrets). |
| **Current production status** | Endpoint **live** on the API. Trigger managed **outside the repository** on cron-job.org. Vercel no longer schedules this path. Keep `AUTO_CONTINUE` disabled. |

**Related (not a cron):** authenticated HR `POST /api/workforce-scheduler/company/run` for on-demand tenant dry-run/apply.

Implementation map: `server/routes/workforceSchedulerRoutes.js`, `server/controllers/workforceSchedulerController.js`, `server/services/workforceScheduler/*`. Technical deep-dive: [`F41_WORKFORCE_SCHEDULER.md`](./F41_WORKFORCE_SCHEDULER.md).

---

### 1.2 Announcements Publisher

| Field | Value |
|-------|--------|
| **Job name** | Announcements Publisher |
| **Business purpose** | Publish company announcements whose scheduled time is due and fan out notifications. |
| **Endpoint** | `/api/announcements/publish-due` |
| **HTTP methods** | `GET`, `POST` |
| **Execution platform** | **Vercel Cron** (`server/vercel.json`) |
| **Frequency** | Daily |
| **Schedule (UTC)** | `03:00` — expression `0 3 * * *` |
| **Schedule (IST)** | **08:30 AM IST** |
| **Authentication** | Existing cron authorization: `cronAuthorized(req)` in the controller (`Bearer CRON_SECRET` or `ANNOUNCEMENT_CRON_SECRET`). |
| **Environment variables** | `CRON_SECRET` and/or `ANNOUNCEMENT_CRON_SECRET`. |
| **Tenant isolation** | Multi-tenant loop over companies with `runWithTenantConnectionScope` / tenant models. Soft wall-clock budget and rotate-after patterns (F53). |
| **Database operations** | Reads/updates scheduled announcements; claim/publish state; tenant notification inserts. |
| **Notifications** | Yes — announcement notifications to eligible portal users. |
| **Dry-run / apply** | No separate dry-run mode; idempotent publish claims reduce duplicate fan-out. |
| **Error handling / monitoring** | Per-tenant failure isolation; JSON summary response; server logs on tenant failures. |
| **Current production status** | **Confirmed** in-repo Vercel Cron schedule. |

**Related (not a cron):** create/update/publish HR API paths may also publish due announcements for the active tenant when a user hits those routes. That does **not** replace the daily idle cron.

Implementation map: `server/routes/announcementRoutes.js`, `server/controllers/announcementController.js`, `server/services/announcementService.js`.

---

## 1.3 Central Scheduler Dispatcher (implemented; production OFF)

| Field | Value |
|-------|--------|
| **Job name** | Central Scheduler Dispatcher |
| **Endpoint** | `/api/scheduler/dispatch` |
| **HTTP methods** | `GET`, `POST` |
| **Purpose** | Single HTTP entry that runs only **due** registry jobs (workforce dry-run, announcements detect-only). Designed for a future 15-minute cron-job.org trigger. |
| **Feature flag** | `SCHEDULER_DISPATCH_ENABLED` — **default false** |
| **Budget** | `SCHEDULER_DISPATCH_BUDGET_MS` default **22000** |
| **Auth** | `requireCronSecret` + Bearer `CRON_SECRET` |
| **Production status** | **Code present; not cut over.** Existing workforce + announcement triggers remain. Announcement adapter is **detect-only** (no publish/notify). Workforce adapter forces **dry-run**. |
| **Idle behavior** | When no `nextRunAt` is due → no tenant DB connections |

Job registry (central Mongo): `scheduler_dispatch_jobs` with daily IST schedules — workforce **07:30**, announcements **08:30**.

---

## 2. External schedules (outside the repository)

| Job | Platform | Notes |
|-----|----------|--------|
| Workforce Scheduler | cron-job.org | Schedule, retries, and timeout live in the cron-job.org dashboard — **not** in git. Keep aligned with **07:30 AM IST / 02:00 UTC** daily. Document changes in this registry when ops updates them. |

Do not assume cron-job.org settings from `vercel.json`. After any ops change, update **section 1.1** and the ops runbook.

---

## 3. Future planned automations (not implemented)

These are **policy placeholders only**. They are **not** present in `server/vercel.json`, have **no** production cron, and must not be described as live.

| Planned workflow | Intent | Must follow |
|------------------|--------|-------------|
| Attendance Reminder / daily attendance processing | Missed punch detection, reminders, optional HR escalation | Daily central trigger; company TZ / policy; **not** immediate real-time reminders |
| Leave automation | Accrual / expiry style processing | Daily; tenant-aware; idempotent |
| Payroll automation | Period close / batch calc triggers | Daily or approved period boundary; never inside employee APIs |
| Onboarding / offer automation | Expiry nudges, stale pipeline cleanup | Daily; explicit approval |
| Asset automation | Assignment / return reminders | Daily; explicit approval |

### Attendance limitation (explicit)

**Daily attendance processing does not guarantee immediate punch-in or punch-out reminders.**  
A once-daily job can only evaluate attendance relative to that run’s window. Employees who miss punch-in mid-morning may not be reminded until the next daily execution. Real-time / sub-daily reminders would violate the current scheduling policy and require separate product approval (and typically a plan that allows more frequent schedules or an external scheduler with an approved exception).

---

## 4. Non-cron mechanisms (do not confuse with business crons)

| Mechanism | What it is | Examples |
|-----------|------------|----------|
| **MongoDB TTL indexes** | Database deletes ephemeral rows after `expiresAt` / `purgeAt` | Platform admin sessions, rate-limit hits, auth tokens, auth sessions (`purgeAt`), attendance verification challenges (`server/services/ephemeralTtlIndexes.js`) |
| **Browser / client polling** | React Query `refetchInterval` while a tab is open | Chat list/thread/unread; live attendance tracking |
| **Request-scoped timers** | Timeouts / SSE heartbeats / idle resource cleanup | SSE lifecycle, PDF browser idle close, chatbot abort timers |
| **In-memory cache TTL** | Short-lived process caches | Platform entitlement cache |
| **Manual CLI scripts** | Operator-run migrations / cleanups | `cleanupDuplicateActiveLiveTracking.js`, notification read-state migrate — **not** scheduled in-repo |
| **HR on-demand APIs** | User-triggered | Workforce `company/run`, announcement publish button |

There are **no** in-repo `node-cron`, Bull/BullMQ, Agenda, or Bree workers for business workflows.

---

## 5. Scheduling standards for future modules

1. Scheduled business workflows must run **once daily**.
2. **No** per-employee or per-company cron jobs.
3. **One** central trigger per independent business workflow.
4. The **backend** decides which tenants and records need processing.
5. Each workflow must have **independent** execution state and **idempotency** (do not share workforce fleet locks/cursors with other jobs).
6. Use **tenant-aware** database access (`getCompanyModels` / connection scope).
7. Use **bounded** processing and **safe resumption** (budgets, cursors, company locks as appropriate).
8. **Never** run expensive background sweeps inside employee-facing API requests (punch, login, chat send, etc.).
9. **New cron jobs require explicit approval** before production activation.
10. Prefer documenting the job in this registry **before** enabling any external or Vercel schedule.

Future attendance, leave, payroll, onboarding, and asset automations must follow this policy.

---

## 6. Quick reference matrix

| Job | Platform | UTC | IST | In `server/vercel.json`? |
|-----|----------|-----|-----|--------------------------|
| Workforce Scheduler | cron-job.org | 02:00 | 07:30 AM | **No** (removed `d06fd4e`) |
| Announcements Publisher | Vercel Cron | 03:00 | 08:30 AM | **Yes** (`0 3 * * *`) |

---

## 7. Related docs

- [`VERCEL_API_DEPLOY.md`](./VERCEL_API_DEPLOY.md) — API project deploy + cron auth notes  
- [`F41_WORKFORCE_SCHEDULER.md`](./F41_WORKFORCE_SCHEDULER.md) — workforce multi-tenant execution design  
- [`P0_STAGED_DEPLOYMENT_CHECKLIST.md`](./P0_STAGED_DEPLOYMENT_CHECKLIST.md) — staged rollout checklist  

---

*Last updated: documentation cleanup for daily scheduling policy and workforce → cron-job.org cutover. Application code and production env were not changed by this doc update.*
