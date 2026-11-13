# HRMS Scalability Audit — Phase 2

**Date:** 2026-11-12  
**Mode:** AUDIT ONLY (no application code, schema, index, config, dependency, or migration changes)  
**Design targets (not measured capacity):**

| Horizon | Companies | Employees (platform) |
|---------|-----------|----------------------|
| Initial | 100 | 10,000 |
| Growth | 500 | 50,000 |
| Long-term | 1,000 | 100,000 |

Companion index: [`SCALABILITY_FINDINGS_INDEX.md`](./SCALABILITY_FINDINGS_INDEX.md).

---

## 1. Architecture and request / data flow

```
[Desktop Vite SPA] ──HTTPS──┐
[Android Capacitor WebView]─┼──► [Vercel API: server/api/index.js]
                            │         │
                            │         ├─ authenticate
                            │         │    Central DB: Company by JWT.companyId
                            │         │    Tenant DB: getTenantConnection(company.databaseName)
                            │         │    User + AuthSession in tenant DB
                            │         │
                            │         ├─ Controllers / services (tenant models on req.auth.models)
                            │         │
                            │         └─ Atlas MongoDB
                            │              ├─ CENTRAL_DB_NAME (platform / companies)
                            │              └─ company_<slug> (DB-per-tenant)
                            │
[Vercel Cron 02:00 UTC] ───► /api/workforce-scheduler/run (Bearer CRON_SECRET)
[External / idle Messages] ► /api/announcements/publish-due (not in vercel.json crons)
```

**Tenancy model:** One Mongo database per company. Almost all HR data is naturally isolated when handlers use `req.auth.models`. Central DB holds `Company` registry and cron iteration.

**Serverless constraints (code + `server/vercel.json`):** single function `api/index.js`, **1024 MB**, **`maxDuration: 60s`**, region `bom1`. Warm invocations cache the Express app; tenant provisioning is **skipped** when `VERCEL=1`.

**Prior remediations (F30–F34):** settlements DB pagination; AuthSession indexes; notification visibility branches + bounded read-state; hiring `$lookup` on `_id`. See findings index for status. **Not reopened** in this audit except F36 (hiring **summary** still full-scans).

---

## 2. Top 10 highest-impact remaining bottlenecks

| Rank | ID | Why it dominates at target scale |
|------|----|----------------------------------|
| 1 | **F35** | 500–1000 tenant DBs × uncapped mongoose pools → Atlas / process connection exhaustion |
| 2 | **F38** | Full-roster attendance/live APIs polled every 60s multiply with HR viewers and N employees |
| 3 | **F37** | Admin dashboard same class of full-tenant memory load as attendance |
| 4 | **F41** | Daily cron cannot finish all companies within 60s as tenant count/size grows |
| 5 | **F39** | CPU face pipeline on punch path saturates 1 GB serverless under morning concurrency |
| 6 | **F40** | Chromium PDF launch on request path → timeouts/OOM under concurrent HR offer/payslip use |
| 7 | **F42** | Every successful punch fans out sequential Notification writes to all HR users |
| 8 | **F36** | Hiring workspace still `$lookup`+stage-derives **every** offer for summary chips |
| 9 | **F50** | Payroll create/recalc pulls entire ACTIVE workforce + month attendance in one request |
| 10 | **F48** / **F56** | Org chart + 300-cap people pool break correctness/UX before raw DB limits |

---

## 3. Existing strengths (do not need optimization now)

- **DB-per-company isolation** via `getCompanyModels` / `req.auth.models` (strong default tenant scope).
- **F30–F34** remediations and regression suite (`tests/f30_f34_db_bottlenecks.test.js` and related).
- Many list APIs already paginate: employees, leaves, tasks, assets, offers list rows, audit logs, payroll cycles (`limit` 36), settlements.
- Live tracking breadcrumbs **capped at 50**; tracking history query **capped at 200**.
- Punch open/close races largely mitigated (`atomicallyOpenAttendanceSession`, punch-out `findOneAndUpdate` + `arrayFilters`).
- Geofence Haversine is O(1); server-authoritative Wi-Fi/GPS checks — **do not weaken** for performance.
- Sensitive blobs often `select: false` (`avatarData`, signatures).
- Desktop React Query defaults: `staleTime` 30s, `refetchOnWindowFocus: false`, route-level `React.lazy`.
- Chat message history supports `before`/`after` paging.
- Branding/logo path documents MongoDB as primary persistence on Vercel; chat attachments use GridFS (see deploy docs).
- Workforce scheduler has **per-company** Mongo lock; default **disabled** / dry-run until env flags set.
- Cron auth pattern matches Vercel: with `CRON_SECRET` set, platform injects `Authorization: Bearer …`.

---

## 4. Complete findings (F35+)

Evidence for all items below is **code inspection** unless noted. Impacts are **qualitative**. Do not treat proposed improvements as measured wins.

### F35 — Unbounded per-tenant connection Map / no pool caps {#f35}

| | |
|--|--|
| **Where** | `server/config/db.js` — `tenantConnections`, `getTenantConnection` |
| **Root cause** | `mongoose.createConnection(uri, { dbName, serverSelectionTimeoutMS: 8000 })` with **no** `maxPoolSize` / `maxIdleTimeMS`; Map never evicts idle tenants. Default pool ~100 sockets per connection. |
| **Impact** | 100 cos: wasteful but often survivable. **500–1000:** high risk of Atlas connection limits and process FD/memory pressure across warm serverless instances. |
| **Priority** | **P0** |
| **Status** | **Implemented** (2026-11-13): bounded per-process cache, pool options, concurrent coalesce. **Safety follow-up:** request/job-scoped auto-retain via ALS middleware + `runWithTenantConnectionScope` so ordinary in-flight work has `refCount > 0` and cannot be closed by LRU. See [`TENANT_CONNECTION_MANAGEMENT.md`](./TENANT_CONNECTION_MANAGEMENT.md). Limits remain **per instance**, not deployment-wide. |
| **Modules / risks** | All authenticated tenant traffic; tests using `disconnectAll`. |
| **Evidence** | CI + `tests/f35_tenant_connections.test.js` |

### F36 — Hiring summary still scans every offer (post-F34) {#f36}

| | |
|--|--|
| **Where** | `server/controllers/hiringWorkspaceController.js` — `buildBaseStages`, `listHiringCandidates`, `buildSummary` |
| **Root cause** | F34 fixed `$lookup` to `localField`/`foreignField` on `_id`, but list still runs base stages on **all** offers, derives `stage` via user onboarding `$expr` filter, then `$facet` for counts + paginated rows. Pagination does **not** reduce work for the counts facet. |
| **Impact** | Cost ≈ O(offers × lookup) per HR list load. Small pipelines OK; grows with hiring history per tenant. At large cos (many historical offers) list latency dominates HR hiring tab. |
| **Priority** | **P0** (for tenants with large offer history); otherwise P1 |
| **Safe fix (prefer order)** | 1) **Count-only lighter pipeline** (project status + minimal user fields; avoid HTML) separate from row page — still same semantics. 2) Persist `hiringStage` (or equivalent) on OfferLetter **only** if updated on every offer/onboarding status mutation with tests for consistency; counters then `$group` without join. **Do not** invent counters that drift from stageExpression. |
| **Status** | **Implemented** (2026-11-13): option (1) — `buildLightStageStages` + facet counts/pageIds/total; heavy `buildBaseStages` only for current page ids. No denormalized `hiringStage` (drift risk). See [`F36_HIRING_SUMMARY.md`](./F36_HIRING_SUMMARY.md). |
| **Modules / risks** | Hiring chips, stage filters, F34 tests. |
| **Evidence** | CI + `tests/f36_hiring_summary.test.js` (legacy vs optimized summary parity) |

### F37 — Admin dashboard full-tenant load {#f37}

| | |
|--|--|
| **Where** | `server/controllers/adminController.js` — `getAdminDashboard` |
| **Root cause** | `Employee.find(empQueryFilter)` (active scoped set), month/lookback `Attendance.find`, leaves/compensations/`customFields` paths, in-memory calendars; scoped HR may `Payslip.find` per cycle. |
| **Impact** | Linear in headcount and attendance rows. Concurrent HR sessions amplify. Risk of approaching 60s / memory ceiling at 10K emp/tenant. |
| **Priority** | **P0** |
| **Safe fix** | KPI aggregations (`$group` / `countDocuments`); drop `customFields` from dashboard selects; optional daily rollup collection later. Preserve response contract fields. |
| **Status** | **Implemented** (2026-11-13): lean employee facts; present/late from Attendance rows (+ targeted legacy log fallback); scoped asset/payslip queries. See [`F37_ADMIN_DASHBOARD.md`](./F37_ADMIN_DASHBOARD.md). Live attendance polling left to F38. |
| **Modules / risks** | Admin home widgets, mobile HR home. |
| **Evidence** | CI + `tests/f37_admin_dashboard.test.js` + existing `admin_dashboard.test.js` |

### F38 — Attendance overview / live tracking full roster + polling {#f38}

| | |
|--|--|
| **Where** | `attendanceService.getAdminAttendanceOverview` / `getAdminTrackingSessions`; `client/.../AdminAttendanceOverview.jsx` (`refetchInterval: 60_000`); `AdminLiveTracking.jsx` (`POLL_MS`, **two** queries); mobile `LiveTrackingPage` / HR attendance via overview |
| **Root cause** | Unbounded `Employee.find` + `$in` attendance/sessions; selects `customFields`; clients poll full payload; mobile often uses overview instead of slim tracking API. |
| **Impact** | Multi-MB JSON × HR tabs × 60s. Hard fail at large N. |
| **Priority** | **P0** |
| **Safe fix** | Server pagination + filters; summary via aggregates; project without `customFields`/breadcrumbs; poll live-only slim endpoint; history on demand. |
| **Status** | **Implemented** — slim overview/tracking payloads, punch-first live list, bounded ranges, client poll tuning (desktop + mobile). See [F38_ATTENDANCE_LIVE_TRACKING.md](./F38_ATTENDANCE_LIVE_TRACKING.md). |
| **Modules / risks** | Admin attendance, live map, mobile HR. |
| **Evidence** | CI |

### F39 — Face TFJS/CPU on request path {#f39}

| | |
|--|--|
| **Where** | `server/services/faceRecognitionService.js` — `analyzeFaceImage` / TFJS CPU + `@vladmandic/face-api` |
| **Root cause** | Dynamic import + CPU inference inside punch/enroll verification. |
| **Impact** | Morning punch concurrency saturates 1024 MB function; cold starts heavy. |
| **Priority** | **P0** on Vercel when face mandatory |
| **Safe fix** | Offload to dedicated worker process/queue **without** changing match thresholds or tenant enrollment rules; concurrency cap; model warm path. Never skip mandatory face for speed. |
| **Status** | **Implemented (mitigation)** — process-warm models, bounded inference concurrency, tensor dispose; still synchronous on request path. See [F39_FACE_VERIFICATION_RUNTIME.md](./F39_FACE_VERIFICATION_RUNTIME.md). |
| **Modules / risks** | Attendance verification, enrollment. |
| **Evidence** | CI |

### F40 — Puppeteer PDF on request path {#f40}

| | |
|--|--|
| **Where** | `server/services/pdfService.js` — `generateOfferLetterPdf` / Chromium launch; offer send/download; payslip PDF |
| **Root cause** | Browser launch + render inside HTTP handler within 60s budget. |
| **Impact** | Concurrent offer sends / payslip downloads → OOM/timeouts. |
| **Priority** | **P0** (serverless) |
| **Safe fix** | Async generation + store PDF; reuse browser where process is long-lived; fail fast with clear UX when busy. |
| **Status** | **Implemented (mitigation)** — one shared browser, coalesced launch, bounded page concurrency, page/idle cleanup; still synchronous on request path. See [F40_PDF_BROWSER_RUNTIME.md](./F40_PDF_BROWSER_RUNTIME.md). |
| **Modules / risks** | Offers, payroll PDFs, email attachments. |
| **Evidence** | CI |

### F41 — Workforce cron vs 60s and full employee reloads {#f41}

| | |
|--|--|
| **Where** | `workforceScheduler/executionController.js` — `runSchedulerForAllCompanies`, `runCompanyScheduler`; `server/vercel.json` cron; strategy `loadEligibleEmployees` per task |
| **Root cause** | Sequential company loop; per-task eligibility reload of ACTIVE employees; queue size up to 100; function maxDuration 60s; lock TTL ~240s. |
| **Impact** | Incomplete runs as company count grows; large tenant starves later tenants. |
| **Priority** | **P0** (when scheduler enabled) |
| **Safe fix** | Cursor/shard by company; one HTTP invocation per company; cache eligible set once per company run; wall-clock budget; keep per-company lock. |
| **Status** | **Implemented** — bounded company concurrency, wall-clock budget, once-per-run roster cache, durable Mongo wave (`workforce_scheduler_fleet`), truncated `lastRunAt` policy, lock TTL 90s. See [F41_WORKFORCE_SCHEDULER.md](./F41_WORKFORCE_SCHEDULER.md). |
| **Modules / risks** | Task auto-assignment fairness. |
| **Evidence** | CI (`f41_workforce_scheduler.test.js`, `workforce_scheduler.test.js`, `f35_tenant_connections.test.js`) |

### F42 — Punch success HR notification fan-out {#f42}

| | |
|--|--|
| **Where** | `attendanceLocationService.notifyAttendanceStakeholders` → `deliverHrPortalAttendanceNotifications` (sequential `Notification.create`); called from punch in/out in `attendanceService.js` |
| **Root cause** | Every successful punch notifies employee **and** each active HR portal user. |
| **Impact** | Morning rush: punches × HR users = write storm; punch latency rises. |
| **Priority** | **P0** |
| **Safe fix** | Routine success → employee only (or digest); keep immediate HR alerts for geofence **BLOCK** / outside-area / exceptions. Batch `insertMany` if multi-recipient retained. |
| **Status** | **Implemented** — retained HR Admin + Company Admin recipients; one recipient query + `insertMany(ordered:false)`; punch `dedupeKey`; notify failures logged without rolling back punch. Digest/employee-only path not adopted (visibility preserved). See [F42_ATTENDANCE_NOTIFICATIONS.md](./F42_ATTENDANCE_NOTIFICATIONS.md). |
| **Modules / risks** | Attendance notifications UX. |
| **Evidence** | CI (`f42_attendance_notifications.test.js`, attendance/notification/location suites) |

### F43 — Serverless skips auto-provision → index drift {#f43}

| | |
|--|--|
| **Where** | `server/api/index.js`, `config/db.js` `getCompanyModels` (skip provision when Vercel); `tenantProvisioningService` |
| **Root cause** | Indexes/collections created via explicit provision scripts / registration, not on each request. New indexes (F31–F34 style) may be missing on old tenants until `provisionAllTenants` / `provisionCompany`. |
| **Impact** | Silent COLLSCAN / slower paths in prod. |
| **Priority** | **P1** |
| **Safe fix** | Deploy checklist: run provision for all tenants; index inventory health check; version stamp. |
| **Modules / risks** | All tenant collections. |
| **Evidence** | CI |

### F44 — Provisioning index coverage incomplete {#f44}

| | |
|--|--|
| **Where** | `tenantProvisioningService.provisionTenantDatabase` |
| **Root cause** | Creates indexes for leave, policy, offers, attendance, tracking, payroll, assets, tasks, notifications, AuthSession, User, etc. **Does not** call `createIndexes` for **Employee**, **Settlement**, **Message**, **Conversation***, **AuditLog**, **AuthToken**, **EmployeeCompensation** (Designation is lazy-elsewhere). Employee schema **defines** indexes but prod often has `autoIndex` off. |
| **Impact** | Directory/search/settlement/chat plans may lack indexes on existing tenants. |
| **Priority** | **P1** |
| **Safe fix** | Extend provisioner with additive `createIndexes` for missing models (never OfferLetter `syncIndexes()`). |
| **Modules / risks** | Provisioning duration; index build load. |
| **Evidence** | CI |

### F45 — No TTL indexes on growing auth/challenge collections {#f45}

| | |
|--|--|
| **Where** | `AuthSession`, `AuthToken`, `AttendanceVerificationChallenge`, `LiveTrackingSession` — `expiresAt` fields; **no** `expireAfterSeconds` in schemas |
| **Root cause** | Soft expiry via app checks; documents retained indefinitely. |
| **Impact** | Storage and scan cost grow with logins/punches over years × tenants. |
| **Priority** | **P1** |
| **Safe fix** | TTL where audit policy allows; otherwise retention job. Confirm inactive sessions still queryable if needed for “logged out” messaging. |
| **Modules / risks** | Auth refresh, challenge cleanup, tracking history retention. |
| **Evidence** | CI |

### F46 — Chat conversation list N+1 {#f46}

| | |
|--|--|
| **Where** | `conversationService.listConversations` — per conversation `lastMessagePreview` + `unreadCountForMember` |
| **Root cause** | Round-trips scale with membership count. |
| **Impact** | Heavy Messages sidebar as chat adoption grows. |
| **Priority** | **P1** |
| **Safe fix** | Batch aggregation or denormalize last message / unread on Conversation member. |
| **Modules / risks** | Chat sidebar unread badges. |
| **Evidence** | CI |

### F47 — Employee directory loads all then filters {#f47}

| | |
|--|--|
| **Where** | `employeeDirectoryService.js` employee path — `Employee.find(query).lean()` → `resolveVisibleEmployeeAccess` → `slice` |
| **Root cause** | Visibility applied in memory after full candidate load. |
| **Impact** | Memory/latency linear in directory size for employee-role viewers. |
| **Priority** | **P1** |
| **Safe fix** | Query by reporting/team edges with DB skip/limit; keep privacy rules. |
| **Modules / risks** | Directory privacy. |
| **Evidence** | CI |

### F48 — Organization hierarchy full load {#f48}

| | |
|--|--|
| **Where** | `organizationHierarchyService.buildOrganizationHierarchy`; client/mobile org views |
| **Root cause** | `Employee.find(statusFilter)` entire company into one response. |
| **Impact** | Payload/DOM blowups at 10K+. |
| **Priority** | **P1** |
| **Safe fix** | Lazy children by `managerId`; server search; virtualize UI. |
| **Modules / risks** | Org explorer, People org tab. |
| **Evidence** | CI |

### F49 — Auth / tenant resolution overhead {#f49}

| | |
|--|--|
| **Where** | `middleware/authenticate.js` |
| **Root cause** | Sequential central company lookup → tenant connect → `User.findById` → `AuthSession.findOne` (+ possible second session find). |
| **Impact** | Fixed tax on every protected request; dominates p95 under concurrent dashboards. |
| **Priority** | **P1** |
| **Safe fix** | Short-lived company metadata cache; single session query shape; keep revoke/logout semantics. |
| **Modules / risks** | All APIs. |
| **Evidence** | CI |

### F50 — Payroll cycle full-workforce calc {#f50}

| | |
|--|--|
| **Where** | `payrollCalculationService.calculatePayrollCycle`; payroll create/recalc controllers |
| **Root cause** | All ACTIVE employees + month Attendance/Leaves/Compensation in one request; `insertMany` payslips. |
| **Impact** | Timeout/memory at large headcount; concurrent HR recalcs amplify. |
| **Priority** | **P1** |
| **Safe fix** | Chunk by department; async job + progress; attendance aggregates. |
| **Modules / risks** | Payroll correctness / validation payload. |
| **Evidence** | CI |

### F51 — Announcement publish-due scheduling + O(users) writes {#f51}

| | |
|--|--|
| **Where** | `announcementService.publishDueForAllCompanies` / `notifyAudience`; route exists; **not** listed in `server/vercel.json` crons (Hobby = 1 cron used by workforce) |
| **Root cause** | Idle publish depends on external scheduler or opportunistic Messages open; audience notification is per-user create. |
| **Impact** | Missed publishes when idle; large audiences → long requests; multi-instance overlap partially mitigated by `notifiedAt`. |
| **Priority** | **P1** |
| **Safe fix** | External scheduler with Bearer secret (documented); batch inserts; company lock; cursor audience. |
| **Modules / risks** | Announcements, notifications. |
| **Evidence** | CI + deploy docs |

### F52 — Bulk import vs 60s {#f52}

| | |
|--|--|
| **Where** | `employeeImportController` commit loop (up to 500 sequential `provisionEmployeeAccount`) |
| **Root cause** | Single HTTP request does all provisioning. |
| **Impact** | Partial imports / timeouts on Vercel. |
| **Priority** | **P1** |
| **Safe fix** | Chunked job + resume token; lower max on serverless. |
| **Modules / risks** | Provisioning, invite emails. |
| **Evidence** | CI |

### F53 — Job noisy-neighbor across tenants {#f53}

| | |
|--|--|
| **Where** | `runSchedulerForAllCompanies`, `publishDueForAllCompanies` |
| **Root cause** | One large tenant’s work consumes wall-clock before others in the same invocation. |
| **Impact** | Fairness degrades as tenant sizes diverge. |
| **Priority** | **P1** |
| **Safe fix** | Round-robin cursor; per-company fan-out; hard time budget per company. |
| **Modules / risks** | Cron completeness. |
| **Evidence** | CI |

### F54 — Live location write amplification {#f54}

| | |
|--|--|
| **Where** | Mobile/web `watchPosition` → `updateLiveTrackingLocation` (server throttle ~4s) + RMW `session.save()` + monitoring |
| **Root cause** | Client posts every tick; server load-modify-save full session; optional exception/notify. |
| **Impact** | ~15 accepted writes/min/sharer; thousands of sharers → write hot path. |
| **Priority** | **P1** |
| **Safe fix** | Client debounce (15–30s + distance); atomic `findOneAndUpdate`; keep geofence on punch. |
| **Modules / risks** | Live tracking accuracy UX. |
| **Evidence** | CI |

### F55 — Dual-write `attendanceLogs` on Employee {#f55}

| | |
|--|--|
| **Where** | `attendanceService` punch in/out writes `employee.customFields.attendanceLogs`; overview selects `customFields` |
| **Root cause** | Legacy unbounded array beside Attendance collection. |
| **Impact** | Employee doc bloat; overview/history slow; 16MB doc risk. |
| **Priority** | **P1** |
| **Safe fix** | Stop new dual-writes; migrate readers to Attendance; never select full logs in overview. |
| **Modules / risks** | Legacy history merge path (F69). |
| **Evidence** | CI |

### F56 — Employees pool hard-capped at 300 {#f56}

| | |
|--|--|
| **Where** | `client/src/hooks/useAdminQueries.js` `useEmployeesPoolQuery` (`limit: 300`); AdminHome / mobile People filters |
| **Root cause** | Incomplete option universe when N > 300; still large always-on fetch. |
| **Impact** | Wrong filters above 300; unnecessary payload. |
| **Priority** | **P1** |
| **Safe fix** | `GET /employees/filter-options` (distinct depts/titles/projects). |
| **Modules / risks** | People filters. |
| **Evidence** | CI |

### F57 — Durable uploads vs ephemeral FS {#f57}

| | |
|--|--|
| **Where** | `documentStorage.getUploadsRoot` uses `os.tmpdir()` when `VERCEL`; branding documents Mongo as primary; chat/offers use GridFS per deploy docs |
| **Root cause** | Any code path that **only** persists to local disk on Vercel loses files across instances. |
| **Impact** | Correctness bugs for those paths under multi-instance. |
| **Priority** | **P1** (audit remaining FS-only callers; branding/chat already safer) |
| **Safe fix** | Inventory upload callers; force GridFS/DB/object storage for durable blobs when `VERCEL=1`. |
| **Modules / risks** | Documents, branding, chat. |
| **Evidence** | CI |

### F58 — `$regex` search {#f58}

Leave/settlement/hiring search use case-insensitive regex → index-unfriendly. **P2**. Prefer prefix indexes / constrained candidates; apply text match before heavy `$lookup` when possible.

### F59 — Redundant indexes {#f59}

Overlapping compounds on OfferLetter, Attendance, LeaveRequest, Notification, Task. **P2**. Explain-driven prune only after measuring write vs read.

### F60 — Large documents {#f60}

Offer HTML/`issuedContent`, Mixed `customFields`, onboarding documents. **P2**. Keep HTML out of list projections (hiring already projects light); strip legacy logs.

### F61 — Payslip full-cycle then filter {#f61}

`Payslip.find({ payrollCycleId })` then scope filter. **P2**. Query with `employeeId $in` scoped set.

### F62 — HR intelligence full scans {#f62}

`hrIntelligenceService` active employees / attendance / tasks. **P2**. Prefer counts/aggregations; cache.

### F63 — Employee summary loads all IDs + comps {#f63}

`employeeController.getEmployeeSummary`. **P2**. Aggregate or store current CTC.

### F64 — SSE vs serverless {#f64}

`leaveEventsService` / `onboardingEventsService` 25s heartbeats. **P2**. Prefer polling on Vercel or short-lived SSE + reconnect.

### F65 — Rate limiting gaps {#f65}

Login/email limiters only; memory store ineffective across instances. **P2**. Route limits on PDF/face/payroll/import; shared store only if already acceptable infra (do not assume Redis for this audit’s “fix”).

### F66 — Chat 10s polling {#f66}

`useChatQueries` web + mobile. **P2**. Raise intervals when blurred; pause off-route.

### F67 — AuthedAvatar N+1 {#f67}

`useAuthedImage` cache max 50. **P2**. Lazy intersection observer; signed URLs.

### F68 — Mobile eager route imports {#f68}

`mobile/src/app/App.jsx` static imports all pages. **P2**. Mirror desktop `React.lazy`.

### F69 — Legacy attendance history unbounded {#f69}

When `attendanceLogs` present, history may `Attendance.find` without limit then merge. **P2**. Always paginate; migrate off logs.

### F70 — Map rebuild every poll {#f70}

`AttendanceMap.jsx` clearLayers + fitBounds. **P2**. Diff markers; cluster; user-controlled fit.

### F71 — Client pagination after full fetch {#f71}

Onboarding submissions, impact leaderboard, some history UIs. **P2**. Server `page`/`limit`.

### F72 — Large JSON bodies {#f72}

`express.json({ limit: "15mb" })` + face/chat base64. **P2**. Route-specific lower limits; multipart to storage.

### F73 — ACTIVE tracking session uniqueness {#f73}

Start path `updateMany` then `create`; index not partial-unique on ACTIVE. **P2**. Partial unique `{employeeId}` where ACTIVE.

### F74 — Breadcrumbs loaded unused {#f74}

Admin tracking `.lean()` without excluding breadcrumbs. **P2**. `.select('-breadcrumbs')`.

### F75 — Read-state full key load {#f75}

`loadUserReadNotificationKeys` loads all keys for user. **P3**. Restrict to visible IDs + watermark; optional TTL.

### F76 — Process-local caches {#f76}

Gemini explanation cache; email transporter Map. **P3**. Document multi-instance behavior; company-keyed (isolation OK).

### F77 — Serial boot provisioning {#f77}

`provisionAllTenantDatabases` over all companies (non-Vercel boot). **P3**. Background / concurrency limit / version stamp.

### F78 — Sparse transactions {#f78}

Some onboarding/chat paths use sessions; most HR mutations do not. **P3** (correctness under concurrency more than throughput).

### F79 — Mobile offline gaps {#f79}

RQ reconnect/retry without persist; many HR screens imperative `api.get`. **P3**. Offline pause + persist; status-aware retry.

---

## 5. Hiring summary follow-up (H)

**Current semantics:** Stage is a **derived** function of offer `status` + linked user’s `onboarding.status` (`stageExpression` / `deriveStage`). Summary chips are `$group` by that derived stage after `$lookup`.

**Efficient options that preserve semantics:**

1. **Separate count pipeline** that still joins but projects only `_id`, offer status, and onboarding status — cheaper than list row mapping; still O(offers).
2. **Materialized `hiringStage` on OfferLetter** updated in the **same** code paths that change offer status or onboarding status, covered by tests for every transition. Then summary = `$group` without lookup; list can `$match` stage early. Consistency risk if any mutation path is missed — **do not** ship without an audit of writers.
3. **Approximate counters from offer.status alone** — **rejected** unless product accepts different chip meanings.

**Recommendation:** Measure offer counts per tenant (`db.offer_letters.estimatedDocumentCount()`). If typically &lt; few thousand, F36 is P1 and a lighter count pipeline may suffice. If historical offers grow large, justify denormalized `hiringStage` with writer-coverage tests — not a blind counter table.

---

## 6. Capacity risks and unmeasured assumptions

- Atlas connection limits vs F35 pool sizes — **unmeasured**.
- Actual p95 of admin dashboard / attendance overview on production tenants — **unmeasured**.
- Face/PDF concurrency ceiling on 1024 MB Vercel — **unmeasured** (architecture risk is clear).
- Workforce cron wall-clock with `ENABLED=true` at N companies — **unmeasured**.
- Hiring offer cardinality per tenant — **unmeasured** (drives F36 priority).
- Whether all durable upload callers already use GridFS/DB — **inventory incomplete**.
- Index presence on every existing production tenant DB — **unverified** (F43/F44).
- F33 production migrate/prune — **not run** in this audit.

---

## 7. Recommended fix order (dependencies)

1. **F35** connection pool + eviction (foundation for multi-tenant safety).  
2. **F43 + F44** provision/index hygiene (so later query fixes hit indexes).  
3. **F38 + F37 + F55/F74** attendance/dashboard payload slim + stop dual-write/select bloat.  
4. **F42** punch notification fan-out (reduces write storm independently).  
5. **F39 / F40** move face/PDF off synchronous critical path (serverless survival).  
6. **F41 + F53 + F51** job sharding / budgets / announcement scheduling.  
7. **F36** hiring summary (measure offer counts first).  
8. **F50 / F52** payroll + import chunking.  
9. **F46–F49, F54, F56** chat N+1, directory/org, auth tax, location sampling, filter-options.  
10. **F45** TTLs after retention policy sign-off.  
11. **P2/P3** client polling, avatars, mobile lazy routes, regex/search, SSE, etc.

**Do not** block on Redis/Kafka/new paid infra for these remediations.

---

## 8. Validation commands and safe local procedures

### 8.1 Index inventory (per tenant DB)

```javascript
// mongosh — replace TENANT_DB
use TENANT_DB
db.authSessions.getIndexes()
db.employees.getIndexes()
db.settlements.getIndexes()
db.attendances.getIndexes()
db.offer_letters.getIndexes()
db.notifications.getIndexes()
db.notification_read_states.getIndexes()
db.live_tracking_sessions.getIndexes()
db.users.getIndexes()
// Confirm no expireAfterSeconds unless added later
```

### 8.2 Hiring join + summary cost (F34/F36)

```javascript
db.offer_letters.explain("executionStats").aggregate([
  { $project: { candidate: 1, status: 1, candidateUserId: 1, onboardingId: 1, updatedAt: 1, createdAt: 1 } },
  { $addFields: { _lookupUserId: { $ifNull: ["$candidateUserId", "$onboardingId"] } } },
  { $lookup: {
      from: "users",
      localField: "_lookupUserId",
      foreignField: "_id",
      as: "userDocs",
      pipeline: [{ $limit: 1 }]
  }},
  { $facet: {
      counts: [{ $group: { _id: "$status", n: { $sum: 1 } } }],
      rows: [{ $sort: { updatedAt: -1 } }, { $limit: 20 }]
  }}
])
// Expect: users side IXSCAN on _id; totalDocsExamined ≈ offer count for full facet
db.offer_letters.estimatedDocumentCount()
```

### 8.3 Attendance overview shape (F38)

```javascript
db.employees.explain("executionStats").find({ status: { $ne: "TERMINATED" } }).limit(1)
db.attendances.explain("executionStats").find({
  date: "2026-11-12",
  employeeId: { $in: [/* sample ObjectIds */] }
})
```

### 8.4 Connection pressure (F35) — local/staging only

```bash
# With API running against staging Atlas, open N tenant sessions and watch:
# Atlas Metrics → Connections; process env logging of tenantConnections.size if added later.
# Do not load-test production.
```

### 8.5 Cron auth smoke (ops, non-destructive)

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://<api-host>/api/workforce-scheduler/run"
# Expect 200 with skipped/disabled or results — not 401 when secret matches deployment
```

### 8.6 Regression suites (already used for F30–F34; safe to re-run)

```bash
cd server
node --import ./tests/mongoMemoryEnv.js --test --test-concurrency=1 \
  tests/f30_f34_db_bottlenecks.test.js \
  tests/settlement.test.js \
  tests/notification_isolation_location_alerts.test.js \
  tests/hiring_workspace.test.js
```

### 8.7 F33 migration (ops — **do not run prune in prod during audit**)

```bash
cd server
node scripts/migrateNotificationReadState.js              # dry-run
# After dual-read app deploy:
node scripts/migrateNotificationReadState.js --apply
node scripts/migrateNotificationReadState.js              # verify
# Only when verifyFail=0:
# node scripts/migrateNotificationReadState.js --apply --prune
```

---

## 9. Deployment / environment notes (no code changes)

- Ensure Production `CRON_SECRET` is set and redeployed so Vercel injects Bearer on workforce cron.  
- `WORKFORCE_SCHEDULER_ENABLED` remains off until dry-run review after F41 mitigations (see [F41_WORKFORCE_SCHEDULER.md](./F41_WORKFORCE_SCHEDULER.md)).  
- Announcement due-publish needs an **external** scheduler on Hobby (one cron slot used).  
- After any index schema change: run `node scripts/provisionAllTenants.js` (or per-company) on staging then prod — **additive `createIndexes` only**; never OfferLetter `syncIndexes()`.  
- F33 migrate on staging before production; prune last.

---

## 10. Files inspected / areas not inspected / limitations

### Inspected (representative; via direct reads + targeted searches + explore passes)

- `server/config/db.js`, `server/api/index.js`, `server/server.js`, `server/vercel.json`
- `server/middleware/authenticate.js`
- `server/services/tenantProvisioningService.js`, `announcementService.js`, `attendanceService.js`, `attendanceLocationService.js`, `documentStorage.js`, `pdfService.js`, `faceRecognitionService.js`, `conversationService.js`, `employeeDirectoryService.js`, `organizationHierarchyService.js`, `workforceScheduler/executionController.js`
- `server/controllers/hiringWorkspaceController.js`, `adminController.js` (dashboard paths)
- Models under `server/models/` (index/TTL patterns)
- `client/src/hooks/useAdminQueries.js`, `useChatQueries.js`, attendance/live pages, `App.jsx` lazy routes
- `mobile/src/app/App.jsx` and HR/employee API usage patterns
- `docs/VERCEL_API_DEPLOY.md`

### Not fully inspected

- Every controller line-by-line (sample of heavy paths prioritized)
- Production Atlas metrics, explain plans on live data, Lighthouse/Android profiling
- Full GridFS/R2 caller inventory for every upload type
- Third-party SMTP/Gemini quota behavior under load
- Desktop landing marketing assets (secondary to app scale)

### Limitations

- **No runtime measurements** — all scale statements are qualitative.  
- **No production migrations, prune, drops, or load tests** performed.  
- Explore subagents used for breadth; critical findings **re-verified** against source snippets cited above.  
- Cron auth is **not** assumed broken: Vercel injects Bearer when `CRON_SECRET` is set (docs + code align).

### Documentation created

- `docs/SCALABILITY_AUDIT_PHASE2.md` (this file)  
- `docs/SCALABILITY_FINDINGS_INDEX.md`

**STOP:** No application fixes were implemented in this phase.
