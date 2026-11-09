# HRMS Phase 5 — Final Regression, Security & Release Readiness Audit

**Project:** `D:\HRMS\mern-project`  
**Audit date:** 2026-11-09  
**Frontend:** `http://127.0.0.1:5174`  
**Backend:** `http://localhost:5000`  
**Mode:** Regression / stabilization only — no feature work, no production deploy, no schema changes.

---

## 1. Environment and Git status

| Check | Result |
|-------|--------|
| Working tree root | `D:/HRMS/mern-project` — **PASS** |
| Branch | `main` (tracks `origin/main`) |
| Uncommitted work | Large set of UI standardization changes (AppHeader/PageIdentity/ModuleToolbar, Hiring layout, Messages, etc.) plus untracked docs/screenshots/components — **preserved, not discarded** |
| D: frontend | Vite PID on **5174** — `D:\HRMS\mern-project\client` — **PASS** |
| D: backend | Nodemon + `server.js` listening on **5000** — **PASS** |
| API health | `GET /api/health` → **200** (`environment: development`) — **PASS** |
| MongoDB | `MONGO_URI` present; tenant DBs `company_acme`, `company_globex` reachable — **PASS** |
| Client API URL | Points at `http://localhost:5000` — **PASS** |
| Mobile prod API | `.env.production` points at hosted Vercel API origin (value redacted) — present |
| Server `CLIENT_URL` | Configured for port **5173** while local UI audited on **5174** — **P3 mismatch** |
| Duplicate processes | **C:** `mern-project` nodemon + vite still running alongside D: — operational risk (**P3**) |

Secrets were inspected by key name / length only; values are not included in this report.

---

## 2. Frontend and backend verification

| Item | Status | Evidence |
|------|--------|----------|
| D: client responds on 5174 | **PASS** | HTTP 200 |
| D: API health | **PASS** | HTTP 200 |
| Unauthenticated `/api/auth/me` | **PASS** | HTTP 401 |
| Client production build | **PASS** | `npm run build` in `client` succeeded |
| Mobile web build | **PASS** | `npm run build` in `mobile` succeeded (chunk-size warning) |
| Messages APIs | **PASS** (automated) | chat_* suites executed in full backend run; no Messages code changes this phase |

---

## 3. Authentication results by role

| Role | Login | Logout / session | Protected routes | Notes |
|------|-------|------------------|------------------|-------|
| HR Admin (`hr@acme.test`) | **PASS** | **PASS** (API logout → `/login`) | Admin modules load | Live session on 5174 |
| Employee (`employee@acme.test`) | **PASS** | Session `/api/auth/me` **200** | `/admin/dashboard` redirected to `/app` | Live session |
| Company Admin (`company-admin@acme.test`) | **BLOCKED** | — | — | Account exists; password for live DB unknown — no reset performed |
| Candidate | Direct login **PASS** (blocked as designed → 401) | — | Offer/onboarding via token | Live token UI **NOT TESTED**; automated hiring E2E **PASS** |
| Platform Admin | **NOT TESTED** | — | MFA **NOT TESTED** | No usable platform-admin account found in local tenant/central listing |

Page refresh / session restore: Employee cookie `/api/auth/me` remained **200** after prior login — **PASS**.

---

## 4. Tenant isolation and authorization results

### Live API probes (Acme HR vs Employee cookies)

| Probe | Result |
|-------|--------|
| Employee → `/api/admin/dashboard` | **403** PASS |
| Employee → `/api/hiring/candidates` | **403** PASS |
| Employee → other employee profile IDs | **403** PASS |
| Employee → own `/api/employees/me`, payslips | **200** PASS |
| Unauthenticated admin/conversations | **401** PASS |
| HR → dashboard / hiring / conversations | **200** PASS |
| HR dashboard with `?companyCode=globex` | Still **Acme Corp** data (no Globex leak) — **PASS** |
| Bad candidate offer token | **404** PASS |

### Automated isolation / auth suites

| Area | Status |
|------|--------|
| Auth lifecycle (16 scenarios) | **PASS** |
| Attendance RBAC + tenant isolation | **PASS** |
| Chat direct/groups/attachments/search/announcements | **PASS** |
| Hiring pipeline E2E + Globex cannot act on Acme | **PASS** |
| Offer withdrawal tenant isolation | **PASS** |
| Company Admin portal access / enforcement suites that completed | Mostly **PASS** (see defects) |

### Important product note (not treated as accidental IDOR)

Current route wiring **intentionally** allows `COMPANY_ADMIN` alongside `HR_ADMIN` on many HR modules (`adminRoutes`, `employeeRoutes`, hiring, payroll, leave, etc.).  
Older CA1 assertions expecting **403** on `/api/admin/dashboard` and `/api/employees` now see **200** — this is **test/product drift**, documented under defects. No speculative permission rollback was made (requires approval).

Cross-tenant live login as Globex HR: **BLOCKED** (credentials unknown). Covered by automated tests.

---

## 5. Business workflow results

| Workflow | Status | How verified |
|----------|--------|--------------|
| People listing / search / filters | **PASS** (HR UI + APIs) | HR dashboard workforce metrics; employee list APIs gated |
| Employee create/edit | **NOT TESTED** live (avoid irreversible edits) | Covered partially by automated employee suites **PASS** |
| Attendance punch / history / live tracking | **PASS** automated; Employee UI **PASS** (punch controls visible, not punched) | Did not force GPS punch |
| Leave apply / approve | HR Leave UI **PASS**; Employee leave UI **PASS**; policy consecutive-days assertion **FAIL** (flaky date cutoff) | No irreversible approve/reject clicked |
| Payroll / payslips | Employee payslips UI **PASS** (statement visible); no payment runs started | Admin payroll **NOT deep-tested** live |
| Hiring stages / table / New offer chrome | **PASS** UI | Stage filter URL + table verified earlier; workflows via automated E2E **PASS** |
| Offer sign / onboarding / corrections / activation | **PASS** automated E2E | Live candidate pages **NOT TESTED** (no token) |
| Assets | **PASS** automated `company_assets_e2e` (in suite) | Live UI spot-check **NOT TESTED** this pass |
| Work / Impact | Covered in suite files executed | Live deep UI **NOT TESTED** |
| Settlements | Nav present | No irreversible settlement actions |

---

## 6. Messages regression results

| Check | Status |
|-------|--------|
| HR Messages page loads (identity + channels + list) | **PASS** |
| `/api/conversations` auth required | **PASS** (401 unauth, 200 HR/Employee) |
| Automated chat suites | **PASS** |
| Messages APIs modified this phase | **No** |

---

## 7. Company Admin portal results

| Check | Status |
|-------|--------|
| Live Company Admin portal session | **BLOCKED** — authorized password not available; account not reset |
| Automated CA auth/login/singleton rules | Partial **PASS** / **FAIL** (see §13) |
| CA intentional HR module access in code | Confirmed in routes |

---

## 8. Employee portal results

| Page / check | Status |
|--------------|--------|
| Login → `/app/dashboard` | **PASS** |
| Unauthorized `/admin/*` redirect to employee home | **PASS** |
| Leave | **PASS** (balances + schedule) |
| Attendance | **PASS** (punch UI, not clocked in) |
| Payslips | **PASS** (Oct 2026 statement) |
| Profile / Assets / Tasks | **NOT TESTED** deeply this pass |
| Screenshots | `docs/phase5-screenshots/04-employee-dashboard.png`, `05-employee-leave.png`, `06-employee-payslips.png`, `07-employee-attendance.png` |

---

## 9. Candidate portal results

| Check | Status |
|-------|--------|
| Direct candidate password login | **PASS** (rejected 401) |
| Live offer review / sign / onboarding UI | **NOT TESTED** (no active plaintext signing token in live DB listing) |
| Automated offer→onboarding→activation pipeline | **PASS** |

---

## 10. Android results

| Check | Status | Evidence |
|-------|--------|----------|
| Capacitor Android project present | **PASS** | `mobile/android` |
| Plugins (filesystem, geolocation, share, file-opener, app) | **PASS** | Sync log |
| `npm run build:android` (web + cap sync) | **PASS** | |
| `gradlew assembleDebug` | **PASS** | BUILD SUCCESSFUL (~2m 31s) |
| Debug APK artifact | **PASS** | `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (~5.3 MB) |
| Device install / login / GPS / downloads on hardware | **NOT TESTED** | APK not installed or published |
| `appId` | Still `com.hrms.app` (temporary per CAPACITOR.md) — **release checklist item** |
| Prod API bake-in | `.env.production` present (host redacted) | |

---

## 11. Automated test results

**Command:** `npm test` in `D:\HRMS\mern-project\server`  
**Log:** `docs/phase5-test-output.log`

| Metric | Count |
|--------|-------|
| Total tests | **952** |
| Pass | **859** |
| Fail | **4** |
| Cancelled | **80** |
| Skipped | **9** |
| Duration | ~20 minutes |
| Exit code | **1** |

### Categorization highlights

| Suite / area | Category |
|--------------|----------|
| Auth lifecycle, attendance geo/tracking, chatbot, chat_* | **PASS** |
| Hiring pipeline E2E, offer email/withdrawal, onboarding section review | **PASS** |
| Payroll / settlement / assets e2e (executed in run) | **PASS** (within the 859) |
| CA1: CA must get 403 on HR dashboard / employees | **FAIL** (got 200; conflicts with current intentional CA+HR route access) |
| CA2/CA3/CA4-B/CA4-C many cases | **FAIL/CANCELLED** — parent hooks hit Mongo `E11000` duplicate company `slug` (test isolation / shared memory DB residue) |
| Policy maxConsecutiveDays | **FAIL** — same-day leave cutoff message instead of consecutive-days message (date-sensitive) |

---

## 12. Build results

| Build | Result |
|-------|--------|
| Client Vite production build | **PASS** |
| Mobile Vite production build | **PASS** (large chunk warning) |
| Android `assembleDebug` | **PASS** |
| APK published / distributed | **Not done** (per instructions) |

---

## 13. Defects and severity

| ID | Severity | Finding | Recommendation |
|----|----------|---------|----------------|
| D1 | **P2** | Automated CA tests expect 403 on `/api/admin/dashboard` and `/api/employees`, but production routes allow `COMPANY_ADMIN` (intentional). Suite reports failures / confuses readiness. | Align tests with approved CA permission matrix; do **not** blindly revoke CA access without product sign-off |
| D2 | **P2** | ~80 tests **cancelled** due to `E11000` duplicate `companies.slug` in memory/shared test DB hooks | Fix test isolation / unique slugs / cleanup in `mongoMemoryEnv` + CA fixtures |
| D3 | **P3** | Policy workflow test fails on same-day leave cutoff vs consecutive-days assertion | Make test dates timezone-safe / use future ranges |
| D4 | **P3** | Server `CLIENT_URL` uses **5173** while local audit UI is **5174** | Point local `CLIENT_URL` at the active Vite origin for email/CORS redirects |
| D5 | **P3** | Duplicate **C:** frontend/backend node processes still running | Stop C: dev servers to avoid wrong-port confusion |
| D6 | **P3** | Mobile production bundle >500 kB warning; temporary `appId` `com.hrms.app` | Split chunks before store release; set final applicationId |
| D7 | **P2** (coverage) | Live Company Admin + Candidate portals not exercised with authorized sessions | Obtain/reset authorized passwords/tokens under change control, then re-run portal checklist |
| D8 | **P2** (coverage) | Platform Admin + MFA not verified | Provision test platform admin or mark out of release scope |

**No P0 critical tenant-leak or unauthenticated data access confirmed in live probes.**  
Employee IDOR attempts against other employee IDs returned **403**.

**Safe fixes this phase:** None applied — findings involving auth/permission policy and test harness need approval; no speculative code changes.

---

## 14. Files changed

**Application code:** none in this Phase 5 audit.  

**Audit artifacts created:**

- `docs/phase5-release-readiness-report.md` (this file)
- `docs/phase5-test-output.log`
- `docs/phase5-client-build.log` (if present from build tee)
- `docs/phase5-android-sync.log`
- `docs/phase5-android-gradle.log`
- `docs/phase5-screenshots/*`

---

## 15. Remaining blockers / limitations

1. Live **Company Admin** portal verification blocked (credentials).  
2. Live **Candidate** offer/onboarding UI blocked (no signing token).  
3. **Platform Admin MFA** not tested.  
4. Backend suite **exit code 1** (4 fails + 80 cancelled) — must be cleaned for green CI confidence.  
5. Android APK built but **not device-validated**.  
6. Uncommitted UI work on `main` should be reviewed/committed before release tagging.

---

## 16. Screenshots and test evidence

| Evidence | Path |
|----------|------|
| HR dashboard | `docs/phase5-screenshots/01-hr-dashboard.png` |
| HR leave | `docs/phase5-screenshots/02-hr-leave.png` |
| HR hiring layout | `docs/phase5-screenshots/03-hr-hiring.png` |
| Employee dashboard | `docs/phase5-screenshots/04-employee-dashboard.png` |
| Employee leave | `docs/phase5-screenshots/05-employee-leave.png` |
| Employee payslips | `docs/phase5-screenshots/06-employee-payslips.png` |
| Employee attendance | `docs/phase5-screenshots/07-employee-attendance.png` |
| Backend test log | `docs/phase5-test-output.log` |
| Android APK | `mobile/android/app/build/outputs/apk/debug/app-debug.apk` |

---

## Recommendation

**READY WITH LIMITATIONS**

**Evidence:** Core HR Admin and Employee portals work on the D: stack; health/auth/session and employee authorization probes behave correctly; hiring/messaging/attendance automation largely passes; client and Android debug builds succeed.  

**Limitations preventing unqualified READY:** incomplete live coverage for Company Admin, Candidate, and Platform Admin; backend test suite not green (permission-matrix drift + isolation cancellations + one date-flaky policy test); local process/`CLIENT_URL` hygiene; Android not run on a physical device.

Do not deploy, publish, migrate production data, or distribute the APK until the limitations above are accepted or cleared.
