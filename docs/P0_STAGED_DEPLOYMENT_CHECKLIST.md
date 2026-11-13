# Phase 2 P0 staged deployment checklist (F35–F42)

**Audit date:** 2026-11-13  
**Mode:** Deployment-readiness only. This document does **not** authorize deploy, migrate, prune, or env changes by itself.

---

## Production safety warnings (read first)

1. **Do not deploy until F35–F42 changes are committed and pushed.** As of this audit they are **not** on `origin/main`.
2. **Do not set `WORKFORCE_SCHEDULER_ENABLED=true`** on staging or production for this rollout.
3. **Do not run** `migrateNotificationReadState.js --prune` (or `--apply --prune`).
4. **Do not** call OfferLetter `syncIndexes()`.
5. **Do not** change production environment variables as part of this audit; only document required names.
6. **Do not** run `provisionAllTenants` / migrations against production until staging succeeds and a backup window is confirmed.
7. Vercel **does not** auto-create tenant indexes when `VERCEL=1` — provision scripts are mandatory after API deploy.
8. Atlas connection pressure = **sum across all API instances** × cached tenants × pool size (see F35). Tune carefully.

---

## 1. Git branch and commit status (audit snapshot)

| Item | Value |
|------|--------|
| Branch | `main` (tracking `origin/main`) |
| Ahead/behind remote | `0 / 0` (working tree dirty; nothing new pushed) |
| HEAD commit | `540c13db4f2b0e1f7b7f73a0fb047b0de90a4313` |
| HEAD subject | `Implement attendance verification with GPS, Wi-Fi and face recognition` |
| HEAD date | 2026-11-12 17:15:51 +0530 |
| F35–F42 on remote? | **No** — all Phase 2 P0 work is local **uncommitted** |

### Blocker

**Staged deploy cannot use the current remote `main`.** Operators must commit (and push to the intended deploy branch) before Vercel Production will receive F35–F42.

Suggested pre-deploy git sequence (run by humans when ready — not executed in this audit):

```bash
git checkout main
git status
git add <approved F35–F42 paths>
git commit -m "feat: Phase 2 P0 scalability F35–F42"
git push origin main
```

---

## 2. F35–F42 changed files and commit state

**All listed files are uncommitted** (modified `M` or untracked `??`). None are staged.

### Backend (server) — modified

| Path | Findings |
|------|----------|
| `server/app.js` | F35 ALS middleware |
| `server/config/db.js` | F35 cache/pool/scopes |
| `server/controllers/adminController.js` | F37 |
| `server/controllers/attendanceController.js` | F38 |
| `server/controllers/hiringWorkspaceController.js` | F36 |
| `server/controllers/notificationController.js` | F32/F33 |
| `server/controllers/settlementController.js` | F30 |
| `server/controllers/workforceSchedulerController.js` | F41 |
| `server/models/AuthSession.js` | F31 indexes |
| `server/models/LiveTrackingSession.js` | F38 `startedAt` index |
| `server/models/Notification.js` | F32/F42 dedupe index |
| `server/models/OfferLetter.js` | F34-related |
| `server/services/announcementService.js` | F35 scope |
| `server/services/attendanceLocationService.js` | F42 bulk notify |
| `server/services/attendanceService.js` | F38/F42 |
| `server/services/attendanceVerificationService.js` | F39 touch |
| `server/services/faceRecognitionService.js` | F39 |
| `server/services/pdfService.js` | F40 |
| `server/services/tenantProvisioningService.js` | Index createIndexes |
| `server/services/workforceScheduler/*` | F41 |
| `server/utils/notificationVisibility.js` | F32 |
| `server/.env.example` | F35/face docs |
| `server/tests/attendance_verification.test.js` | Related tests |

### Backend — untracked (must be included in commit)

| Path | Findings |
|------|----------|
| `server/models/NotificationReadState.js` | F33 |
| `server/scripts/migrateNotificationReadState.js` | F33 |
| `server/services/adminDashboardMetrics.js` | F37 |
| `server/services/attendanceAdminQuery.js` | F38 |
| `server/services/faceLivenessProvider.js` | F39 |
| `server/services/faceRecognitionRuntime.js` | F39 |
| `server/services/notificationReadStateService.js` | F33 |
| `server/services/pdfBrowserRuntime.js` | F40 |
| `server/services/workforceScheduler/fleetProgress.js` | F41 |
| `server/tests/f30_f34_*.js` … `f42_*.js` | Regression suites |
| `server/scripts/migrateOfferLetterEmployeeIdIndex.js` | Related (F34); optional for this P0 cut |
| `server/services/offerLetterEmployeeIdIndex.js` | Related (F34) |
| `server/tests/offer_letter_employeeId_index.test.js` | Related (F34) |

### Desktop (client)

| Path | State |
|------|--------|
| `client/src/hooks/useAdminQueries.js` | M — F38 |
| `client/src/pages/AdminAttendanceOverview.jsx` | M — F38 |
| `client/src/pages/AdminLiveTracking.jsx` | M — F38 |
| `client/src/pages/AdminPayroll.jsx` | M — incidental / review before commit |
| `client/src/lib/attendancePollInterval.js` | ?? — F38 |
| `client/src/hooks/attendancePollInterval.test.js` | ?? — F38 |

### Mobile

| Path | State |
|------|--------|
| `mobile/src/pages/hr/HomePage.jsx` | M — F38 tracking-sessions |
| `mobile/src/pages/hr/LiveTrackingPage.jsx` | M — F38 |

### Docs (untracked / modified)

`docs/F36_*` … `F42_*`, `PHASE2_P0_INTEGRATION_REVIEW.md`, `SCALABILITY_*`, `TENANT_CONNECTION_MANAGEMENT.md`, `ATTENDANCE_VERIFICATION.md` (M), this checklist.

---

## 3. Exact Vercel deployment commands

Projects (from `docs/VERCEL_API_DEPLOY.md` + repo `vercel.json` files):

| App | Vercel root | Config |
|-----|-------------|--------|
| Desktop frontend | **repository root** | Root `vercel.json` → builds `client`, rewrites `/api/*` → `https://mern-hrms-api.vercel.app` |
| API backend | **`server/`** | `server/vercel.json` (`bom1`, 1024 MB, `maxDuration` 60, workforce cron) |
| Mobile web (optional) | **`mobile/`** | `mobile/vercel.json` (Vite SPA) — **not** a substitute for Android APK |

### Backend API (Production)

From a machine linked to the **API** Vercel project (`mern-hrms-api`, Root Directory = `server`):

```bash
cd server
npx vercel --prod --yes
```

Or via dashboard: Deployments → Redeploy Production after `main` contains the commit.

Confirm after deploy:

```bash
curl -sS "https://mern-hrms-api.vercel.app/api/health"
```

Expect `"service":"hrms-api"` and `"runtime":"vercel"`.

### Desktop frontend (Production)

From repository root (frontend project that uses root `vercel.json`):

```bash
npx vercel --prod --yes
```

Or push to the Git branch connected to the frontend project (auto-deploy), then verify:

`https://mern-project-nu-nine.vercel.app` (or the project’s Production URL).

**Order:** deploy **API first**, then desktop (clients depend on new overview/tracking/dashboard/hiring behavior).

### Preview / staging

```bash
# API preview (server project)
cd server
npx vercel

# Desktop preview (root project)
cd <repo-root>
npx vercel
```

Use Preview env vars that point at a **staging Atlas** cluster / `CENTRAL_DB_NAME` if available — do not point Preview at production Mongo without explicit approval.

---

## 4. `provisionAllTenants` — exact procedure

**Script:** `server/scripts/provisionAllTenants.js`  
**npm alias:** `npm run provision:tenants` (from `server/`)

Creates/repairs tenant collections and runs additive `Model.createIndexes()` (AuthSession, Notification, NotificationReadState, LiveTrackingSession, etc.). Idempotent. Skips DB names equal to `CENTRAL_DB_NAME`.

### Staging (example)

```bash
cd server
# Load STAGING Atlas URI + CENTRAL_DB_NAME only (not production) via .env or shell export
npm run provision:tenants
# equivalent:
node scripts/provisionAllTenants.js
```

### Single company (new tenant bootstrap — different script)

`server/scripts/provisionCompany.js` / `npm run provision:company` **upserts** a company and provisions it. Prefer `provisionAllTenants` for index rollout on **existing** tenants.

### Production

Same commands only after staging success, backup confirmation, and change window. **Not executed in this audit.**

---

## 5. F33 migration — location and commands

| Item | Value |
|------|--------|
| Script | `server/scripts/migrateNotificationReadState.js` |
| Service | `server/services/notificationReadStateService.js` |
| Default | Dual-read remains; legacy `preferences.readNotificationIds` kept |

```bash
cd server
# Dry-run (report only)
node scripts/migrateNotificationReadState.js

# Apply copy into notification_read_states (SAFE for this rollout)
node scripts/migrateNotificationReadState.js --apply

# FORBIDDEN for this rollout:
# node scripts/migrateNotificationReadState.js --apply --prune
```

`--prune` requires `--apply` and clears legacy arrays only after per-user verification — **do not run** for P0 staged deploy.

---

## 6. Required environment variables (F35–F42)

### Must already exist (API)

`MONGO_URI`, `CENTRAL_DB_NAME`, `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_EXPIRES_IN`, `AUTH_COOKIE_NAME`, `CLIENT_URL` / `FRONTEND_URL`, `NODE_ENV=production`, `CRON_SECRET` (≥16 chars for Vercel cron Bearer).

### F35 (recommended on API; defaults apply if omitted)

| Variable | Default |
|----------|---------|
| `TENANT_CONN_CACHE_MAX` | 50 |
| `TENANT_CONN_IDLE_EVICT_MS` | 60000 |
| `TENANT_MONGO_MAX_POOL_SIZE` | 5 |
| `TENANT_MONGO_MIN_POOL_SIZE` | 0 |
| `TENANT_MONGO_MAX_IDLE_MS` | 30000 |
| `TENANT_MONGO_SERVER_SELECTION_MS` | 8000 |

### F39 (if face used in prod)

`FACE_BIOMETRIC_KEY` (required, ≥32 chars, not JWT), optional `FACE_MODELS_DIR`, `FACE_ENGINE`, `FACE_INFERENCE_CONCURRENCY`, `FACE_INFERENCE_QUEUE_MS`, `FACE_LIVENESS_PROVIDER`.

### F40 (optional tuning)

`PDF_GENERATION_CONCURRENCY`, `PDF_GENERATION_QUEUE_MS`, `PDF_BROWSER_IDLE_MS`, `PDF_MAX_HTML_CHARS`, optional `PUPPETEER_EXECUTABLE_PATH` / Chromium pack URLs.

### F41 — keep disabled

| Variable | This rollout |
|----------|----------------|
| `WORKFORCE_SCHEDULER_ENABLED` | **omit or `false`** |
| `WORKFORCE_SCHEDULER_MODE` | leave unset/`dry-run` |
| Others (`COMPANY_CONCURRENCY`, `BUDGET_MS`, `LOCK_MS`, …) | optional later |

### Desktop / mobile

No new public env required for F35–F42 UI; they call existing `/api/*` via rewrite or configured API base URL.

### Local vs staging vs production (differences)

| Concern | Local | Staging | Production |
|---------|-------|---------|------------|
| `MONGO_URI` | Local/Atlas dev | Staging cluster | Prod cluster |
| `CLIENT_URL` | `http://localhost:5173` | Staging frontend URL | `https://mern-project-nu-nine.vercel.app` (or current) |
| `NODE_ENV` | `development` / `test` | `production` or `staging` | `production` |
| `VERCEL` | unset | `1` on Vercel | `1` — **skips auto provision** |
| `WORKFORCE_SCHEDULER_ENABLED` | tests may set true | **false** | **false** |
| `CRON_SECRET` | test secrets | staging secret | production secret |
| Face/PDF concurrency | higher defaults possible | match prod | serverless-safe (PDF concurrency 1) |
| Provision / migrate | optional | **required after API deploy** | **required after API deploy** |

---

## 7. Required MongoDB indexes and verification

### Indexes (tenant DB)

| Collection | Index |
|------------|--------|
| `authSessions` | `{ userId: 1, isActive: 1 }`, `{ token: 1, isActive: 1 }` |
| `notifications` | existing user/role/createdAt compounds + **`notifications_metadata_dedupeKey`** sparse on `metadata.dedupeKey` |
| `notification_read_states` | unique `{ userId: 1, notificationKey: 1 }`, `{ userId: 1, readAt: -1 }` |
| `live_tracking_sessions` | `{ startedAt: -1, status: 1 }` (+ existing employee/status indexes) |

Created by `provisionAllTenants` → `createIndexes()` (additive).

### Verify (mongosh against one tenant DB — read-only)

```javascript
// Replace <tenantDb>
use <tenantDb>
db.authSessions.getIndexes()
db.notifications.getIndexes()
db.notification_read_states.getIndexes()
db.live_tracking_sessions.getIndexes()
```

Confirm names/keys above exist. Repeat for a second tenant. **Do not** drop indexes or run `syncIndexes()` on OfferLetter.

Central DB may also gain `workforce_scheduler_fleet` only if/when scheduler runs — not required while scheduler stays disabled.

---

## 8. Does mobile need a new APK build?

**Yes, for Capacitor Android users.**

F38 changes `mobile/src/pages/hr/HomePage.jsx` and `LiveTrackingPage.jsx` (switch to `/admin/attendance/tracking-sessions`). Those ship only after:

```bash
cd mobile
npm run build:android
# then open Android Studio / CI to produce a signed APK/AAB
npx cap open android
```

| Channel | Action |
|---------|--------|
| Capacitor APK/AAB already installed | **Rebuild and redistribute** |
| Mobile Vite hosted on Vercel (`mobile/` project) | Redeploy that project after commit (optional web channel) |
| Desktop-only HR | No APK required |

Backend-only deploy without mobile rebuild leaves native app on old overview calls (still functional against API but misses F38 payload/poll benefits and may over-fetch).

---

## 9. Pre-deployment checklist

- [ ] All approved F35–F42 files committed (see §2); exclude secrets (never commit `server/.env`).
- [ ] CI / local suites green for F35–F42 (see integration review).
- [ ] Staging Atlas backup or snapshot available.
- [ ] Production Atlas backup scheduled before prod provision/migrate.
- [ ] Confirm Vercel API project Root Directory = `server`.
- [ ] Confirm desktop project uses root `vercel.json` rewrite to API host.
- [ ] `CRON_SECRET` already set on API Production (do not rotate unless planned).
- [ ] Confirm **`WORKFORCE_SCHEDULER_ENABLED` is not `true`** on staging/prod.
- [ ] Confirm no OfferLetter `syncIndexes` steps in the runbook.
- [ ] F33 prune **not** in the runbook.
- [ ] Mobile owners notified if APK rebuild is in scope.

---

## 10. Deployment order (exact)

1. **Commit + push** F35–F42 to the deploy branch (`main` or release branch).  
2. **Staging API** — `cd server && npx vercel --prod` (or Preview → staging host).  
3. **Staging provision** — `cd server && npm run provision:tenants` with staging `MONGO_URI`.  
4. **Staging F33** — dry-run then `--apply` only (no prune).  
5. **Staging desktop** — root `npx vercel --prod` / auto-deploy.  
6. **Staging mobile** — APK rebuild and/or mobile Vercel deploy if used.  
7. **Staging verification** (§11).  
8. **Production API** deploy.  
9. **Production provision** (`provision:tenants`).  
10. **Production F33** `--apply` only.  
11. **Production desktop** deploy.  
12. **Production mobile APK** (if applicable).  
13. **Production verification** (§11).  

---

## 11. Post-deployment verification

### API

```bash
curl -sS "https://mern-hrms-api.vercel.app/api/health"
curl -sS -o /dev/null -w "%{http_code}" -X POST "https://mern-hrms-api.vercel.app/api/workforce-scheduler/run"
# expect 401 without Bearer
curl -sS -X GET "https://mern-hrms-api.vercel.app/api/workforce-scheduler/run" \
  -H "Authorization: Bearer $CRON_SECRET"
# expect success + skipped: true / scheduler_disabled while ENABLED is false
```

### Product smoke (staging then prod)

- [ ] HR login (desktop + mobile).  
- [ ] `GET /api/admin/dashboard` loads summary widgets.  
- [ ] Hiring candidates list + summary chips.  
- [ ] Attendance overview (single day + short range).  
- [ ] Live tracking list after punch-in; clears after punch-out.  
- [ ] Punch-in creates HR/CA notifications; unread + mark-read.  
- [ ] Offer/payslip PDF download (one concurrent).  
- [ ] Face enroll/verify only if mandatory in that tenant policy.  
- [ ] mongosh index verification on ≥2 tenant DBs.  

### Atlas

- [ ] Connection count stable vs pre-deploy baseline.  
- [ ] No sustained 503 “Tenant database connection capacity reached”.

---

## 12. Rollback procedure

### Application rollback

1. Vercel → API project → Deployments → **Promote previous Production** deployment (pre-F35–F42).  
2. Vercel → Desktop project → promote previous Production deployment.  
3. Mobile: redistribute previous APK if a bad build was shipped.  

Git alternative: revert the F35–F42 commit on `main` and redeploy (only if that commit is isolated).

### Data / config rollback notes

| Change | Rollback |
|--------|----------|
| Additive indexes from provision | **Leave in place** (safe); do not drop unless directed |
| F33 `--apply` rows in `notification_read_states` | Harmless with dual-read; do **not** prune/delete blindly |
| Fleet / scheduler state | Irrelevant while scheduler disabled |
| Env | Keep `WORKFORCE_SCHEDULER_ENABLED` false; no need to unset F35 pool defaults |

### Emergency

If punches succeed but notifications fail: attendance remains source of truth (F42 design). If API OOMs on face/PDF: temporarily disable mandatory face / limit PDF concurrency via env **only with change control** (not part of this audit’s actions).

---

## 13. Backup precautions

Before **production** provision/migrate:

1. Atlas → cluster → **Backup / Snapshot** (or confirm PITR enabled).  
2. Record current Vercel Production deployment URLs/IDs for API + desktop.  
3. Export or note current Production env var **names** (not values in tickets).  
4. Keep previous Android APK artifact if redistributing mobile.  

---

## 14. Audit findings summary

| # | Finding | Severity |
|---|---------|----------|
| 1 | F35–F42 **not committed**; HEAD = pre-P0 `540c13d` | **Blocker** |
| 2 | Deploy path documented: API `server/` + desktop root `vercel.json` | Info |
| 3 | Provision via `npm run provision:tenants` / `node scripts/provisionAllTenants.js` | Info |
| 4 | F33 script ready; prune must stay forbidden | Info |
| 5 | Mobile Capacitor sources changed → **APK rebuild required** for native | High (channel-dependent) |
| 6 | Scheduler cron remains in `server/vercel.json` but stays no-op while ENABLED false | OK |
| 7 | Local `.env` / Vercel Production / Preview must not share secrets; Preview should not use prod Mongo without approval | Warning |
| 8 | This audit executed **no** deploy, migrate, prune, or env mutation | Compliance |

---

## STOP

Deployment-readiness audit complete. No application code modified for product behavior; checklist written to this file only. No deploy/migrate/prune executed. Workforce scheduler remains documented as disabled.
