# HRMS — Platform Admin Phase 1: Architecture Audit

**Project:** `d:\HRMS\mern-project`  
**Audit date:** 2026-11-14  
**Mode:** Read-only. No source changes, commits, pushes, or deployments.  
**Product constraints (authoritative):** exactly six nav modules; one Platform Admin account; no Platform Admin Accounts module; no standalone Audit Logs module (audit mandatory in backend); no unrestricted tenant DB / HR PII access; platform restrictions override company permissions; effective access = global availability AND company availability AND company permission.

---

## Verdict

There is **no Platform Admin portal** in the current codebase. Central multi-tenancy plumbing (`Company`, DB-per-tenant, provisioning CLI, company metadata cache) is solid and reusable. Tenant RBAC (Company Admin → HR Admin) is mature. Module entitlements, plans/billing, platform metrics, platform auth/MFA, central audit, and the six-module SPA are **missing or skeleton-only**.

Naming trap: `/api/admin` and `/admin/*` are the **HR / Company Admin** portals, not platform.

---

## 1. Existing architecture

### 1.1 Database split

| Layer | Location | Responsibility today |
|-------|----------|----------------------|
| **Central DB** | `CENTRAL_DB_NAME` (default `platform`) via `mongoose.connect` | `companies`, `offer_template_masters` |
| **Tenant DB** | `Company.databaseName` via `getTenantConnection` / `getCompanyModels` | Users, sessions, employees, payroll, leave, chat, attendance, faces, audit_logs, etc. (~40 collections) |

Reference: `server/config/db.js`, `docs/TENANT_CONNECTION_MANAGEMENT.md`.

Tenant resolution is **token-bound** (`JWT.companyId` → `findCompanyById` → `databaseName`). Clients never supply a DB name. `databaseName` is regex-validated and stripped from `Company.toJSON`.

### 1.2 Auth today (tenant only)

- Roles in `server/models/User.js`: `COMPANY_ADMIN`, `HR_ADMIN`, `EMPLOYEE`, `CANDIDATE` — **no** `PLATFORM_ADMIN`.
- Users and `AuthSession` live **per tenant**.
- Login requires `companyCode` + email + password (`authController.login`).
- JWT (`utils/token.js`): `{ sub, companyId, jti }`, shared `JWT_SECRET`, issuer `hrms-platform`, audience `hrms-company-users`, ~8h.
- `authenticate` always loads company + **full** `getCompanyModels(company)`.
- MFA / TOTP: **not implemented** (API or UI).

### 1.3 Company lifecycle (central)

`Company` statuses: `TRIAL` | `ACTIVE` | `SUSPENDED` | `CANCELLED`. Login allowed only for `TRIAL`/`ACTIVE` (login, authenticate, refresh). Suspension is enforced on every authenticated request (via company metadata cache, TTL ~30–60s, invalidated on Company save/update in-process).

Provisioning is **CLI / cold-start only** (`scripts/provisionCompany.js`, `tenantProvisioningService.provisionTenantDatabase`). No Platform Admin API.

### 1.4 Permission layers today

```
Company Admin (tenant)
  → configures User.hrAccess for HR_ADMIN
  → toggles config.hrAccessEnforcement OFF|ENFORCED

HR_ADMIN operational access (when ENFORCED):
  requireRole(HR_ADMIN|COMPANY_ADMIN)
  AND hrAccess.permissions
  AND employee scope
```

`Company.config.enabledModules` exists but is **not enforced** anywhere. There is no global feature catalog and no platform→company entitlement gate.

### 1.5 Cross-tenant jobs (not Platform Admin)

Cron-secret gated:

- `/api/workforce-scheduler/run`
- `/api/announcements/publish-due`

These iterate companies and call `getCompanyModels` — acceptable for machine jobs; **not** a pattern for interactive Platform Admin handlers.

### 1.6 Frontend portals today

| Portal | Routes | Roles |
|--------|--------|-------|
| HR / Company Admin | `/admin/*` | `HR_ADMIN`, `COMPANY_ADMIN` |
| Employee | `/app/*` | `EMPLOYEE` |
| Public | `/login`, onboarding, offers | — |
| **Platform** | — | **Missing** |

Mobile mirrors the same three tenant roles; no platform branch.

---

## 2. Existing implementation inventory

| Area | Status | Key locations |
|------|--------|---------------|
| Central ↔ tenant DB architecture | **Complete** | `config/db.js`, tenant connection cache/scope |
| `Company` schema (status, subscription stub, branding, config) | **Partial** | `models/Company.js` |
| Tenant provisioning (idempotent collections/indexes) | **Complete (CLI)** | `services/tenantProvisioningService.js`, `scripts/provision*.js` |
| Company create / suspend / cancel **API + UI** | **Missing** | — |
| Platform Admin model / auth / MFA / sessions | **Missing** | — |
| `/api/platform/*` | **Missing** | — |
| `/platform/*` SPA | **Missing** | — |
| `enabledModules` field | **Skeleton** (stored, echoed, unused) | `Company.config.enabledModules`, `settingsController` |
| Global feature catalog + enforcement | **Missing** | — |
| Company-specific feature overrides | **Missing** | — |
| Tenant HR access catalog + enforcement | **Complete** | `constants/hrAccessCatalog.js`, `hrAccessEnforcement*`, `/api/company-admin/*` |
| Plans / billing / seat enforcement | **Skeleton** | `Company.subscription` only |
| Platform metrics / insights | **Missing** | `/api/health` is trivial |
| Tenant audit log | **Complete (tenant)** | `models/AuditLog.js`, `GET /api/settings/audit-logs` |
| Central / platform audit | **Missing** | — |
| Dead-code foreshadowing | **Stub only** | `attendanceController.assertCompanyAttendanceAccess` blocks string `"PLATFORM_ADMIN"`; role not in `USER_ROLES` |
| Release docs | **Out of scope historically** | `docs/phase5-release-readiness-report.md` — Platform Admin + MFA “NOT TESTED” |

### Reusable assets (do not duplicate)

- `Company` model + status enum + metadata cache + invalidation hooks  
- `provisionTenantDatabase` / provision outcome shape  
- `hrAccessCatalog` pattern (code-defined catalog + confirmation + history) as a **template** for platform feature catalogs  
- Company Admin table/modal UX patterns (`CompanyHrManagement`, `CompanyHrAccessModal`)  
- Design tokens in `client/src/index.css`, shared `AppModal`, `Toast`, `StatusBadge`, `Pagination`, `ModuleToolbar`  
- Cron timing-safe secret check pattern (for machine endpoints only)  
- `docs/TENANT_CONNECTION_MANAGEMENT.md` for connection-scope rules  

### Must not reuse for Platform Admin interactive APIs

- `getCompanyModels` / full tenant model bundle  
- Tenant `/api/admin/*`, `/api/company-admin/dashboard`, employee/payroll/leave/chat/attendance routes  
- Tenant `AuditLog` schema as-is (requires tenant `User` actor + ObjectId `targetId`)  
- Shared JWT audience/cookie with company users without separation  

---

## 3. Missing and partially implemented functionality

### Missing (greenfield)

1. Single Platform Admin identity (central), password + **mandatory MFA**, distinct JWT/session store  
2. Platform auth middleware separate from `authenticate`  
3. Six-module Platform Admin SPA (layout, nav, routes, guards)  
4. Company registration / lifecycle APIs with confirmation + central audit  
5. Global + company-specific module/feature toggle system with dependency rules and history  
6. Plan catalog, assignment, renewals, billing status (beyond stub fields)  
7. Aggregated insights (usage, storage estimates, API/health) without PII  
8. Platform settings: maintenance mode, mandatory MFA policy, platform profile  
9. Central `PlatformAuditLog` (or equivalent) — UI surfaces history under Settings only  

### Partial / skeleton

| Item | Gap |
|------|-----|
| `Company.subscription` | No Plan model, no seat checks on hire/import, misleading settings fallback `ENTERPRISE` / `100` |
| `config.enabledModules` | Empty array; no catalog; no gate in `HrModuleGate` / APIs |
| Health endpoint | No DB/tenant/fleet signals |
| `COMPANY_ADMIN` bootstrap | Service exists; production provision script creates `HR_ADMIN`; enforcement UX needs a Company Admin |
| Self-serve `/auth/setup-initial-admin` | Creates tenants without platform gate — product decision required |

### Intentionally out of scope for this portal (per product)

- Platform Admin Accounts module  
- Standalone Audit Logs module  
- Tenant HR PII screens  

---

## 4. Proposed six-module navigation and page structure

**Base path:** `/platform/*` (SPA) + `/api/platform/*` (API).  
**Shell:** dedicated `PlatformLayout` (no company branding, no chat widget, no HR nav).

| Nav module | Routes (proposed) | Primary pages |
|------------|-------------------|---------------|
| **1. Overview** | `/platform` or `/platform/overview` | KPI cards: companies total/by status; sum of employee seats used (aggregate counts only); subscription mix; health strip (API up, central DB, cron last-run if available) |
| **2. Companies** | `/platform/companies`, `/platform/companies/new`, `/platform/companies/:id` | List/filter by status/plan; register + provision; detail: metadata, status actions (activate/suspend/cancel), subscription assignment, company feature overrides, provisioning stamps — **no** employee list |
| **3. Modules & Features** | `/platform/modules`, `/platform/modules/history` | Global module/feature matrix; dependency warnings; company availability overview; change confirmation modal; history (backed by platform audit) |
| **4. Plans & Billing** | `/platform/plans`, `/platform/plans/:id`, `/platform/billing` | Plan CRUD (or seed + edit); entitlements mapping; assign plan to company; seat limits; renewal/end dates; billing status (manual/status fields until payment provider) |
| **5. Platform Insights** | `/platform/insights` | Aggregates: employees per tenant (counts), approx storage (collection stats), connection-cache/health stats, scheduler/announcement job summaries — **no** names, messages, salaries |
| **6. Settings** | `/platform/settings` | Tabs: Platform config / Maintenance / Security (MFA) / Profile / **Activity history** (platform audit reader — not a 7th nav item) |

**Auth screens (outside nav):** `/platform/login`, `/platform/mfa` (challenge). No company code field.

---

## 5. Global and company-specific toggle architecture

### 5.1 Effective access (product rule)

For any HR module/action exposed to a tenant user:

```
allowed =
  globalModuleEnabled
  AND globalFeatureEnabled (if feature-scoped)
  AND companyModuleEnabled
  AND companyFeatureEnabled (override, default inherit)
  AND companyPermission   // existing User.hrAccess / COMPANY_ADMIN bypass rules
```

Platform denials **always win**. Company Admin cannot enable a module the platform has turned off.

### 5.2 Catalog (code-defined, versioned)

Introduce a **platform feature catalog** (mirror `hrAccessCatalog.js` style), e.g. `server/constants/platformFeatureCatalog.js`:

- Modules aligned to existing HR portal modules: `people`, `attendance`, `leave`, `payroll`, `settlements`, `hiring`, `assets`, `organization`, `policies`, `settings`, `work`, `impactPoints`, `chat`, …  
- Features under modules where needed (e.g. `attendance.liveTracking`, `attendance.faceVerification`)  
- Declared **dependencies** (e.g. live tracking requires attendance)

Do **not** invent a parallel permission vocabulary that conflicts with `hrAccessCatalog` keys; map platform module keys → HR portal modules / route gates.

### 5.3 Storage

| Scope | Proposed store | Notes |
|-------|----------------|-------|
| Global defaults | Central `PlatformSettings` (or `PlatformFeatureFlags`) document | Single doc; modules/features + maintenanceMode + mfaRequired |
| Company overrides | `Company.config.enabledModules` **and/or** structured `Company.config.featureOverrides` | Prefer structured `{ moduleKey: { enabled, features: {…} } }` over bare string[]; migrate empty `enabledModules` carefully |
| Toggle history | Central platform audit entries | Action + before/after; confirmation required in API |

Keep tenant `User.hrAccess` unchanged — it remains Company Admin’s tool for HR operators.

### 5.4 Enforcement points

1. **API:** middleware `requirePlatformEntitlement(module|feature)` after tenant `authenticate`, before/with `requireHrPermission`  
2. **UI:** extend `HrModuleGate` / `visibleHrPortalModules()` to hide modules not entitled  
3. **Company Admin permission UI:** show platform-disabled modules as locked (read-only), not grantable  

### 5.5 Default policy recommendation

- New companies: inherit global defaults (or plan entitlements — see §6/§8).  
- Empty `enabledModules: []` today must **not** mean “everything off” after enforcement ships without a migration; define explicit “unset = inherit global/plan”.

---

## 6. Secure company metadata and aggregation architecture

### 6.1 Hard rule

Interactive Platform Admin handlers **must not** call `getCompanyModels` or load Employee / Payroll / Message / Face / Leave documents.

### 6.2 Approved data classes

| Allowed | Forbidden |
|---------|-----------|
| Company name, slug, status, timezone, currency | Employee names, emails, profiles |
| Subscription plan, seats, dates, billing status fields | Salaries, payslips, bank/PAN |
| Feature/module flags, provisioning versions | Attendance punches, GPS, biometrics |
| Aggregates: `estimatedDocumentCount` on selected collections | Leave reasons, chat bodies, attachments, resumes |
| Primary contact **role mailbox** if treated as company metadata (product confirm) | Private messages, offer letter HTML, signatures blobs |
| Health: connection stats, cron last-run summaries | Opening tenant GridFS for document content |

### 6.3 Aggregation pattern

```
Platform service
  → Company.find (central, strict projection)
  → optional: runWithTenantConnectionScope(company)
       → connection.db.collection('employees').estimatedDocumentCount()
       → similarly users / messages metadata sizes only
  → never bind Employee/User mongoose models for reads of documents
```

Expose a dedicated helper, e.g. `getTenantAggregateCounts(company)`, separate from `getCompanyModels`. Add a lint/test guard that `/api/platform` route modules do not import HR controllers or call `getCompanyModels`.

### 6.4 Response DTO

`PlatformCompanyDTO`: strip `databaseName` (or expose only as non-secret ops flag internally), never `emailSettings.appPasswordEncrypted`, `letterhead.signatureData`, `branding.logoData`. Prefer `hasLogo` / `hasSmtpConfigured` booleans.

---

## 7. Database / model changes required

| Change | DB | Purpose |
|--------|----|---------|
| **`PlatformAdmin`** (single document / collection with unique singleton constraint) | Central | Identity: email, passwordHash, mfaSecret, mfaEnabled, profile fields |
| **`PlatformAdminSession`** (or embedded sessions) | Central | Revocable sessions; distinct from tenant `authSessions` |
| **`PlatformSettings`** | Central | Global modules/features, maintenanceMode, security policies |
| **`PlatformPlan`** (optional but recommended) | Central | Plan catalog: name, price metadata, entitlements, seat limits |
| **`PlatformAuditLog`** | Central | Immutable-ish admin actions; actor = platform admin id; targetType flexible (Company, Plan, Settings) |
| **`Company` extensions** | Central | Structured feature overrides; billingStatus; clearer subscription ref to `PlatformPlan`; statusChange history (or rely solely on platform audit) |
| Tenant models | Tenant | **No Platform Admin user rows**; optional later: entitlement cache denormalization — not required for Phase 1 |

**Avoid:** adding `PLATFORM_ADMIN` to tenant `USER_ROLES` as the primary identity (attendance stub notwithstanding). Platform identity belongs in central DB.

**AuditLog (tenant):** leave as-is for company operations. Do not force platform actors into it.

---

## 8. Backend API implementation plan

### 8.1 Auth (prerequisite)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/platform/auth/login` | Email+password → MFA challenge token if MFA on |
| POST | `/api/platform/auth/mfa/verify` | TOTP → session cookie / token |
| POST | `/api/platform/auth/logout` | Revoke session |
| GET | `/api/platform/auth/me` | Profile + security flags |
| POST | `/api/platform/auth/change-password` | |
| POST | `/api/platform/auth/mfa/setup` / `enable` / `disable` | Bootstrap MFA for the single admin |

**Middleware:** `authenticatePlatformAdmin` — separate secret/audience/cookie (`hrms_platform_auth`), no `companyId`, never attaches `req.auth.models`.

### 8.2 Module APIs (sketch)

**Overview:** `GET /api/platform/overview`  
**Companies:** CRUD-lite + `POST .../provision`, `POST .../:id/status`, feature overrides, subscription assign  
**Modules:** `GET/PUT /api/platform/modules/global`, `GET/PUT /api/platform/companies/:id/modules`, `GET .../history`  
**Plans:** `GET/POST/PATCH /api/platform/plans`, assign on company  
**Insights:** `GET /api/platform/insights` (aggregates only)  
**Settings:** `GET/PATCH /api/platform/settings`, `GET /api/platform/activity` (audit page under Settings)

All mutating routes: confirm flag or `confirm: true`, write `PlatformAuditLog`.

### 8.3 Integration with existing tenant stack

- On company suspend: set `Company.status`, invalidate metadata cache; existing authenticate already blocks login.  
- On feature change: tenant gates read Company + PlatformSettings (cache briefly).  
- Reuse `provisionTenantDatabase` from company create.  
- Decide fate of public `setup-initial-admin` (disable, rate-limit, or require platform-created company).

### 8.4 Mounting

Add `app.use("/api/platform", platformRouter)` in `app.js`. Do not overload `/api/admin`.

---

## 9. Frontend implementation plan

### 9.1 Routing & auth

- `PlatformProtectedRoute` for `/platform/*`  
- Login/MFA pages without company code  
- Extend `homeForRole` **only** if a platform role string is introduced in client auth state — prefer separate `PlatformAuthContext` to avoid leaking into tenant `AuthContext`

### 9.2 Module UI batches

1. Shell + Overview (empty/aggregate-ready)  
2. Companies list/detail/lifecycle  
3. Modules & Features matrix + confirmations  
4. Plans & Billing  
5. Insights  
6. Settings (incl. activity history + MFA management)

### 9.3 Query layer

- New `qk.platform.*` in `queryKeys.js`  
- `usePlatform*Query` hooks + `api` instance with platform token interceptor (or path-based credential)  
- Do **not** call `/admin/*` or `/company-admin/*` from platform pages

### 9.4 Design

Reuse tokens and primitives; new `PlatformSidebar` with exactly the six modules. Avoid HR PII components (`AdminHome`, payroll, maps, chat).

Mobile Platform Admin: **out of Phase 1** unless explicitly required (product currently desktop-oriented for platform ops).

---

## 10. Security risks and mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Platform handler calls `getCompanyModels` → full HR data | Critical | Dedicated aggregate helpers; import/lint ban; code review checklist |
| Shared JWT secret/audience with tenants | High | Separate `PLATFORM_JWT_SECRET` / audience / cookie; reject platform tokens in tenant `authenticate` and vice versa |
| Single admin account takeover | High | Mandatory MFA; session revocation; rate-limited login; recovery runbook (ops) |
| Stale company status across Vercel isolates | Medium | Keep status check on every request; short TTL; document multi-instance delay; optional stronger invalidation later |
| `enabledModules: []` semantics flip | High | Explicit inherit rules + migration before enforcement |
| Settings fallback masks real plan (`ENTERPRISE`/100) | Medium | Fix when Plans module ships; platform APIs return raw values |
| Self-serve tenant creation bypasses platform | Medium | Product gate on `setup-initial-admin` |
| Central audit missing | High | `PlatformAuditLog` before lifecycle/toggle mutations |
| Cron jobs as “admin” | Low | Keep cron-secret separate; never reuse for browser Platform Admin |
| Attendance stub only checks role string | Low | Real platform auth won’t use tenant User; keep tenant route denials for defense in depth |
| Logo/SMTP secrets in Company lean projections | Medium | Strict allow-list projections on all platform company serializers |

**Tenant isolation:** Platform Admin must not impersonate company users or mint tenant JWTs in Phase 1.

---

## 11. Recommended first implementation batch

**Goal:** Secure platform identity + company lifecycle metadata + audit foundation — no billing provider, no heavy insights yet.

1. Central models: `PlatformAdmin` (singleton), `PlatformAdminSession`, `PlatformAuditLog`, `PlatformSettings` (minimal)  
2. Platform auth + MFA (TOTP) + middleware + cookie/JWT separation  
3. Seed/bootstrap script for the **one** Platform Admin (CLI, not UI accounts module)  
4. `GET /api/platform/overview` (counts from `Company` only)  
5. Companies list/detail + status transitions (activate/suspend) + create+`provisionTenantDatabase`  
6. Platform SPA: login/MFA, layout, Overview, Companies  
7. Wire Settings → Activity history reader for platform audit  
8. Tests: auth/MFA, suspend blocks tenant login, platform APIs never return employee PII, singleton admin invariant  

**Defer to batch 2+:** full Modules & Features enforcement, Plans catalog UX, Insights storage/API metrics, maintenance mode UX, payment provider.

---

## Implementation roadmap

```
Phase 1A — Foundation (Batch 1)
  Auth + MFA + central audit + Companies lifecycle + Overview shell
  Acceptance: one admin can log in with MFA; list/suspend companies;
              suspended tenants cannot login; no tenant PII in platform APIs

Phase 1B — Entitlements
  Platform feature catalog + PlatformSettings + company overrides
  Enforce: API middleware + HrModuleGate
  Acceptance: global OFF hides module for all tenants; company OFF hides for one;
              Company Admin cannot override platform OFF

Phase 1C — Plans & Billing
  PlatformPlan model; map entitlements + seats; assign to Company.subscription
  Seat warnings (enforce on employee create in a follow-up if needed)
  Acceptance: plan change audited; settings no longer fake ENTERPRISE fallback

Phase 1D — Insights & Settings hardening
  Aggregate counts/storage estimates; health/cron summaries
  Maintenance mode; security policies; profile
  Acceptance: Insights show counts only; maintenance blocks tenant login with clear code

Phase 1E — Hardening & sign-off
  Lint/tests against getCompanyModels in platform routes
  Docs + runbooks (MFA recovery, provision, suspend)
  Align release readiness (closes historical “Platform Admin NOT TESTED” gap)
```

### Dependency order

```
Central identity/MFA ──► Companies APIs/UI ──► Overview
         │
         ├──► PlatformAuditLog (parallel, required before mutations)
         │
         └──► Feature catalog ──► Global/company toggles ──► Tenant gate enforcement
                        │
                        └──► Plans entitlements
                                 │
                                 └──► Insights (uses Company + safe aggregates)
```

### Explicit non-goals (remain excluded)

- Platform Admin multi-account management UI  
- Standalone Audit Logs nav item  
- Platform browsing of employee/payroll/chat/attendance/biometric data  
- Redis or new infra for this portal  
- Weakening tenant isolation or existing Company Admin HR access model  

---

## Appendix A — File map (current)

**Central / tenancy:** `server/config/db.js`, `server/models/Company.js`, `server/models/OfferTemplateMaster.js`, `server/services/tenantProvisioningService.js`, `server/utils/companyMetadataCache.js`  

**Tenant auth:** `server/middleware/authenticate.js`, `server/controllers/authController.js`, `server/models/User.js`, `server/models/AuthSession.js`, `server/utils/token.js`  

**Tenant RBAC:** `server/constants/hrAccessCatalog.js`, `server/middleware/hrAccessEnforcement.js`, `server/routes/companyAdminRoutes.js`  

**Tenant audit:** `server/models/AuditLog.js`, `server/controllers/settingsController.js`  

**Client:** `client/src/App.jsx`, `client/src/context/AuthContext.jsx`, `client/src/utils/hrPortalAccess.js`, `client/src/pages/Login.jsx`, `client/src/pages/CompanyHrManagement.jsx`  

**Docs:** `docs/TENANT_CONNECTION_MANAGEMENT.md`, `docs/phase5-release-readiness-report.md`

---

## Appendix B — Product decision checklist (resolve during Phase 1A)

1. Keep or gate public `/auth/setup-initial-admin`?  
2. Is company `primaryContact` visible to Platform Admin?  
3. Empty/legacy `enabledModules: []` → inherit global or treat as “all entitled”?  
4. MFA recovery process for the single admin (ops break-glass)?  
5. Desktop-only Platform Admin for Phase 1?  

---

*End of audit. No implementation was performed in this phase.*
