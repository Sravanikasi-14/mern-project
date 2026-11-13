# Phase 2 P0 integration review (F35–F42)

**Date:** 2026-11-13  
**Scope:** Integrated review only. No production migrations, no F33 prune, no workforce scheduler enablement, no OfferLetter `syncIndexes()`, no P1 work.

## Verdict

F35–F42 are **integration-ready for staged deploy** with explicit provisioning steps. No product regressions requiring code changes were found. One **test isolation** flake in `f36_hiring_summary.test.js` (persistent MongoMemoryServer `dbPath` + fixed company slugs) was fixed so the suite is re-runnable.

| ID | Status | Notes |
|----|--------|-------|
| F35 | OK | ALS request/job scopes; per-instance cache + pool caps |
| F36 | OK | Light summary + page hydrate; contract preserved |
| F37 | OK | Lean dashboard facts; response shape preserved |
| F38 | OK | Slim overview/tracking; desktop + mobile clients updated |
| F39 | OK | Bounded face inference + tensor dispose; still on request path |
| F40 | OK | Shared Chromium + concurrency; still on request path |
| F41 | OK | Bounded concurrency + durable wave; **keep disabled in prod** |
| F42 | OK | Bulk `insertMany` + dedupe; punch not rolled back on notify fail |
| F30–F34 | OK | F33 dual-read intact; prune remains opt-in only |

---

## 1. Tenant connection scopes & cache

| Path | Scope behavior |
|------|----------------|
| HTTP | `tenantConnectionScopeMiddleware` in `createApp()` before routes; retain until `finish`/`close` |
| Workforce cron | `runWithTenantConnectionScope` **per company** inside bounded concurrency map |
| Announcement publish-due / provision-all | Per-company scope (documented in `TENANT_CONNECTION_MANAGEMENT.md`) |
| Attendance / face / PDF | Same HTTP request scope; no separate connection lifecycle |
| Eviction | Never closes `refCount > 0`; idle/LRU only for unpinned |

**Integration:** F39/F40 CPU/memory work shares the same request-scoped tenant connection as punch/offer handlers. No conflicting retain/release patterns found.

---

## 2. MongoDB pool pressure (multi-instance)

Limits are **per Vercel/Node isolate**, not deployment-wide.

| Env | Default | Meaning |
|-----|---------|---------|
| `TENANT_CONN_CACHE_MAX` | 50 | Cached tenant DBs per process |
| `TENANT_MONGO_MAX_POOL_SIZE` | 5 | Sockets per tenant connection |
| `TENANT_MONGO_MIN_POOL_SIZE` | 0 | |
| `TENANT_MONGO_MAX_IDLE_MS` | 30000 | |
| `TENANT_CONN_IDLE_EVICT_MS` | 60000 | Prefer idle victims |

**Rough upper bound (unmeasured):**  
`instances × (TENANT_CONN_CACHE_MAX × TENANT_MONGO_MAX_POOL_SIZE) + central pool`  
Example: 3 instances × 50 × 5 ≈ **750** tenant sockets before central — must stay under Atlas connection cap.

---

## 3. Index provisioning checklist

Additive via model schemas + `createIndexes()` in `tenantProvisioningService` (idempotent). **Vercel does not auto-provision** (`VERCEL=1` skips startup provision).

| Index | Collection | Provisioned by |
|-------|------------|----------------|
| `{ userId: 1, isActive: 1 }`, `{ token: 1, isActive: 1 }` | `authSessions` | AuthSession `createIndexes` |
| `userId+isRead+createdAt`, `role+createdAt`, `notifications_userId_createdAt`, `notifications_userId_role_createdAt`, **`notifications_metadata_dedupeKey` (sparse)** | `notifications` | Notification `createIndexes` |
| `uniq_notification_read_user_key` (`userId+notificationKey`), `{ userId: 1, readAt: -1 }` | `notification_read_states` | NotificationReadState `createIndexes` |
| `{ startedAt: -1, status: 1 }` (+ existing employee/status indexes) | `live_tracking_sessions` | LiveTrackingSession `createIndexes` |

### Exact steps (staging/prod ops — not run in this review)

```bash
# From server/ with production/staging env loaded (do NOT use --prune)
node scripts/provisionAllTenants.js
# Or single tenant:
node scripts/provisionCompany.js --slug <company-slug>

# F33 migrate only (copy legacy → notification_read_states). Do NOT pass --prune.
node scripts/migrateNotificationReadState.js          # dry-run
node scripts/migrateNotificationReadState.js --apply  # migrate only
```

Forbidden: OfferLetter `syncIndexes()`; F33 `--prune` in this rollout.

---

## 4. Notifications (F42) + F32/F33

- Punch path: one HR recipient query + `insertMany(..., { ordered: false })`.
- Partial bulk success kept; hard failure logged; **attendance already committed**.
- Event `dedupeKey` (`punch_in|out:employeeId:sessionId`) skips repeat fan-out after first durable write.
- Visibility (personal HR/CA + role-broadcast fallback) unchanged.
- F33: dual-read of `notification_read_states` + legacy array; mark-read writes bounded collection only.

**Residual race (accepted):** two concurrent notifies for the same key before either `findOne` sees a row can still double-insert (no unique index on shared event key — intentional multi-recipient docs).

---

## 5. Workforce scheduler (F41)

- Bounded company concurrency (cap 8), wall-clock budget (~50s default), once-per-run roster cache.
- Durable wave: central `workforce_scheduler_fleet`; truncated mid-queue does **not** advance `lastRunAt`.
- Per-company locks + atomic UNASSIGNED assign for multi-instance safety.
- Cron still behind `CRON_SECRET`; **`WORKFORCE_SCHEDULER_ENABLED` must remain unset/false**.

---

## 6. PDF (F40) & face (F39)

| Runtime | Concurrency default | Cleanup |
|---------|---------------------|---------|
| Face | `FACE_INFERENCE_CONCURRENCY` (default 2) | `disposeFaceDetections` after analyze |
| PDF | `PDF_GENERATION_CONCURRENCY` (1 serverless / 2 local) | Page close always; idle browser close |

Both remain **synchronous on the request path** inside 60s / 1024 MB — mitigated, not offloaded.

---

## 7. API compatibility (desktop + mobile)

| Surface | Compatibility |
|---------|----------------|
| `GET /api/admin/dashboard` | Same response keys; F37 server load reduced |
| `GET /api/hiring/candidates` | Same `candidates` / `summary` / `pagination`; F36 light+hydrate |
| `GET /api/admin/attendance/overview` | Slimmer fields; optional page/limit; summary counts preserved |
| `GET /api/admin/attendance/tracking-sessions` | Punch-first live; history without breadcrumbs |
| Desktop | Poll visibility / range / live-empty slowdown (`attendancePollInterval`) |
| Mobile | LiveTracking + HR home use `tracking-sessions` (not full overview roster) |

---

## 8. Shared lifecycle interactions

No conflicting lifecycle found across F35 scopes + F39/F40 process singletons + F41 per-tenant scopes + F42 post-punch writes. Cron and HTTP both release scopes; PDF/face do not open extra tenant pools.

---

## 9. F30–F34 / F33 safety

- Settlements pagination, AuthSession indexes, notification visibility branches, hiring `_id` lookup remain in place.
- F33 migration script defaults to **no prune**; verification blocks prune when keys missing.
- **This review did not run `--prune` and must not.**

---

## Confirmed issues & fixes

| Issue | Severity | Action |
|-------|----------|--------|
| `f36_hiring_summary.test.js` E11000 on fixed `f36-acme` slug with persistent `dbPath` | Test-only | **Fixed:** `Company.deleteMany` + unique slug/db suffix |
| Findings index listed F38–F40 without “Implemented” | Docs drift | **Updated** index status rows |
| Product regressions F35–F42 | — | **None found** |

---

## Required environment variables

### Always required (API)

| Variable | Notes |
|----------|-------|
| `MONGO_URI` | Atlas / Mongo |
| `CENTRAL_DB_NAME` | e.g. `platform` |
| `JWT_SECRET` / `JWT_ISSUER` / `JWT_AUDIENCE` | Auth |
| `CLIENT_URL` | CORS / links |
| `CRON_SECRET` | ≥16 chars; Vercel cron Bearer (announcements + workforce route) |

### F35 (recommended in production)

| Variable | Default |
|----------|---------|
| `TENANT_CONN_CACHE_MAX` | 50 |
| `TENANT_CONN_IDLE_EVICT_MS` | 60000 |
| `TENANT_MONGO_MAX_POOL_SIZE` | 5 |
| `TENANT_MONGO_MIN_POOL_SIZE` | 0 |
| `TENANT_MONGO_MAX_IDLE_MS` | 30000 |
| `TENANT_MONGO_SERVER_SELECTION_MS` | 8000 |

### F39 (when face enabled)

| Variable | Notes |
|----------|-------|
| `FACE_BIOMETRIC_KEY` | Required for encryption |
| `FACE_MODELS_DIR` / `FACE_ENGINE` | Model load |
| `FACE_INFERENCE_CONCURRENCY` | Default 2 |
| `FACE_INFERENCE_QUEUE_MS` | Default 25000 |
| `FACE_LIVENESS_PROVIDER` | Policy-dependent |

### F40 (optional tuning)

| Variable | Default |
|----------|---------|
| `PDF_GENERATION_CONCURRENCY` | 1 on Vercel / 2 local |
| `PDF_GENERATION_QUEUE_MS` | 45000 |
| `PDF_BROWSER_IDLE_MS` | 30000 serverless / 120000 local |
| `PDF_MAX_HTML_CHARS` | 4000000 |

### F41 — **do not enable yet**

| Variable | Required value for this rollout |
|----------|----------------------------------|
| `WORKFORCE_SCHEDULER_ENABLED` | **omit or `false`** |
| `WORKFORCE_SCHEDULER_MODE` | leave `dry-run` if ever testing |
| `WORKFORCE_SCHEDULER_COMPANY_CONCURRENCY` | 2 (when enabled later) |
| `WORKFORCE_SCHEDULER_BUDGET_MS` | 50000 |
| `WORKFORCE_SCHEDULER_LOCK_MS` | 90000 |
| `WORKFORCE_SCHEDULER_MAX_COMPANIES` | optional |
| `WORKFORCE_SCHEDULER_WAVE_STALE_MS` | 24h default |

---

## Deployment order

1. **Backend (server)** — deploy API with F35–F42 code; confirm `WORKFORCE_SCHEDULER_ENABLED` not true; `CRON_SECRET` set.  
2. **Index provision** — run `provisionAllTenants.js` against the target environment (staging first).  
3. **F33 migrate (optional but recommended)** — `--apply` only, **no `--prune`**.  
4. **Desktop client** — deploy after API (F38 poll helpers + overview/tracking consumers).  
5. **Mobile** — deploy after API (tracking-sessions mapping on LiveTracking / HR home).  

Rollback: clients tolerate older overview shapes; new slim fields are additive omissions (no breadcrumbs on admin lists). Prefer backend-first so mobile/desktop never call missing routes.

---

## Tests

### Passed (this review)

| Suite | Result |
|-------|--------|
| `f30_f34_db_bottlenecks.test.js` | Pass |
| `f35_tenant_connections.test.js` | Pass |
| `f36_hiring_summary.test.js` | Pass (after test isolation fix) |
| `f37_admin_dashboard.test.js` | Pass |
| `f38_attendance_live_tracking.test.js` | Pass |
| `f39_face_runtime.test.js` | Pass |
| `f40_pdf_browser.test.js` | Pass |
| `f41_workforce_scheduler.test.js` | Pass |
| `f42_attendance_notifications.test.js` | Pass |
| `workforce_scheduler.test.js` | Pass |
| `admin_dashboard.test.js` | Pass |
| `client/.../attendancePollInterval.test.js` | Pass (4) |
| Earlier session: `notification_isolation_location_alerts`, `attendance_geofence_rejection`, `attendance_verification` | Pass |

### Not run (this review)

- Full `npm test` / entire `server/tests/**` matrix  
- `attendance_geolocation_tracking`, `live_tracking_privacy_lifecycle`, `punch_eligibility`, `attendance_location_sessions`, `attendance_audit_fixes`  
- Mobile Detox/E2E / Playwright desktop E2E  
- Production/staging Atlas `explain` or connection-watermark measurement  
- `provisionAllTenants` / migrate against real clusters  
- Load tests (morning punch, concurrent PDF, multi-instance Atlas)

---

## Remaining risks & unmeasured claims

| Risk | Type |
|------|------|
| Atlas connections vs `instances × cache × pool` | **Unmeasured** |
| Face/PDF still sync on 60s/1024MB path under peak concurrency | Mitigated structurally; **not** offloaded |
| F38 single-day overview still returns full scoped roster (slim fields) | Documented limitation |
| F36 still light-scans all offers for summary chips | Structural; large tenants **unmeasured** |
| F41 disabled — enabling needs dry-run + truncate monitoring | Ops gate |
| F42 notify hard-fail after punch → missing notifications until next event | Logged; punch correct |
| F43 index drift if provision skipped on existing tenants | Ops must run provision |
| All “tens of tenants / fewer round-trips” statements | **Structural expectations**, not production benchmarks |

---

## STOP

Review complete. No P1 implementation started. Workforce scheduler left disabled. F33 prune not run. No production data changes.
