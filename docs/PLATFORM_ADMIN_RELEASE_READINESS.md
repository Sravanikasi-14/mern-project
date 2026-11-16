# Platform Admin — Release Readiness

**Date:** 2026-11-14  
**Scope:** Batches 1–5 (auth, companies, entitlements, plans/billing, insights/settings, final security validation)  
**Verdict: READY WITH CONDITIONS**

All work remains local and uncommitted. No production operations were performed.

---

## 1. Verified security controls

| Control | Status | Evidence |
|---|---|---|
| Independent Platform Admin JWT + httpOnly cookie + DB session | Verified | Separate secret/audience/`typ`, `PlatformAdminSession` revocation |
| Mandatory MFA before session cookie | Verified | Login never sets session cookie; middleware requires `mfaEnabled` |
| Recovery codes hashed; MFA secret encrypted | Verified | bcrypt hashes; AES-GCM; secrets not on `/me` |
| Singleton active Platform Admin | Verified | Partial unique index + bootstrap refusal |
| No public Platform Admin creation API | Verified | CLI bootstrap only |
| Tenant cookie ≠ Platform APIs | Verified | Batch 1/2/5 tests |
| Platform cookie ≠ tenant APIs | Verified | Batch 1 |
| Session expiry from settings applied to JWT + cookie + DB `expiresAt` | Verified (Batch 5 fix) | Shared TTL on newly issued sessions |
| Platform Origin guard for cookie CSRF | Verified (Batch 5 fix) | Rejects non-allowlisted Origin on cookie auth |
| Brute-force limiters on platform login/MFA | Verified | express-rate-limit (in-memory; skipped in tests) |
| Maintenance mode blocks tenants; Platform Admin bypass | Verified | Batch 4 |
| Audit log append-only | Verified | Model hooks + Batch 4/5 tests |
| Initial-admin takeover closed when contact email missing | Verified (Batch 5 fix) | Create requires email; setup requires match |

---

## 2. Tenant isolation results

| Check | Result |
|---|---|
| Platform handlers call `getCompanyModels` | **None found** |
| Insights/overview/subscription DTOs expose employee PII, salaries, attendance, messages, docs, biometrics | **Not found** |
| Company A subscription change affects Company B | **Isolated** (Batch 3/4) |
| Tenant settings PUT leaked subscription history / seatUsage / amount | **Fixed** (Batch 5 whitelist) |
| Analytics open every tenant DB for dashboard | **No** — central aggregates only |
| Unavailable metrics shown as zero | **No** — explicit `available: false` / `unavailableMetrics` |

---

## 3. Feature enforcement coverage

### Enforced on backend

- Global ∧ company ∧ plan entitlements via `platformEntitlementService`
- HR permission routes via `requireHrPermission` → module entitlement
- Module gates: leave, payroll (including `/api/payroll/employee/payslips*`), chat, liveTracking
- **Batch 5 additions:** attendance self-service (`/me/attendance/*`, face enrollment, remote requests), people documents upload/download

### Frontend

- Web/mobile `hrPortalAccess` hides nav only — **not a security control**
- Effective enforcement is server-side

### Remaining gaps (documented, not invented as fixed)

- Several **capability** keys (e.g. `attendance.gps`, `offers.send`) are catalogued but not wired to runtime `requireEntitledCapability`
- Some employee surfaces (tasks upload, announcements, impact `/me`, assets `/my-assets`) may still lack module gates — treat as follow-up hardening
- Entitlement snapshot on `/auth/me` can lag until refresh

---

## 4. Plans, subscriptions, billing

| Behavior | Status |
|---|---|
| Plan records are SoT; seed blueprint only for defaults | Verified |
| Global OFF wins over plan | Verified |
| Deactivated plans cannot be newly assigned | Verified |
| Missing plan fails closed | Verified |
| Company suspension ≠ subscription suspension | Verified |
| Subscription SUSPENDED/EXPIRED/CANCELLED blocks tenant login | Verified |
| Legacy company PATCH plan/seats/status blocked | Verified |
| Invoice numbers unique under concurrency | Verified (`PlatformInvoiceCounter`) |
| Manual payment never claims gateway confirmation | Verified |
| Duplicate manual payment rejected | Verified (Batch 5) |
| Seat reservation + rollback on provision failure | Verified |
| Seats on onboarding activation + portal identity create | Verified (Batch 5) |

---

## 5. Settings and operational controls

| Item | Status |
|---|---|
| Maintenance enable/disable with confirmation | Verified |
| Settings not changeable via tenant APIs | Verified |
| Session hours enforced on new sessions | Verified |
| Stored rate-limit fields | **Policy/docs only** — runtime still uses middleware defaults |
| Storage limits | Enforced when GridFS usage measurable; **fail-open** on disk/unmetered with explicit documentation |

---

## 6. Test results (executed this review)

### Platform Admin

```
Batch 1: 11/11 pass
Batch 2:  9/9  pass
Batch 3: 10/10 pass
Batch 4:  9/9  pass
Batch 5:  8/8  pass
Total:   47/47 pass
```

With payroll e2e included in the same run: **59/59 pass**.

### Related regressions (executed)

| Suite | Result |
|---|---|
| `auth.test.js` | Pass |
| `employee_provisioning_pathways.test.js` | Pass |
| `reporting_manager.test.js` | Pass (after ObjectId/seat fix) |
| `leave_restrictions_and_provisioning.test.js` | Pass |
| `payroll_end_to_end.test.js` | Pass |

### Known pre-existing failure (not Platform Admin)

- `employee_dashboard.test.js` check-in without location → `400 Location is required to punch in` (attendance product rule; entitlement gate returns 403 when disabled). **Not introduced as a Platform Admin defect.**

---

## 7. Defects fixed in Batch 5

1. Platform Origin allowlist guard for cookie-authenticated `/api/platform/*`
2. Session TTL aligned across JWT `exp`, cookie `maxAge`, and `PlatformAdminSession.expiresAt`
3. Payroll + attendance (+ docs) self-service entitlement gates
4. Seat reservation on onboarding activation and portal identity employee create; safe companyId coercion
5. Company create requires primary contact email; setup-initial-admin requires match + maintenance/subscription checks
6. MFA 401 interceptor no longer clears challenge on `/mfa/*` failures
7. Invoice payment/void idempotent conditional updates
8. Tenant settings PUT subscription whitelist (no history/seatUsage/amount leak)
9. Plan seed promise resets on failure; audit append failures no longer fail the mutation
10. Company metadata cache clone no longer corrupts ObjectIds via `structuredClone`

---

## 8. Known limitations

1. Stored security rate-limit settings are **not** applied to runtime limiters (in-memory, per-instance).
2. Platform access token is also returned in JSON and stored in `localStorage` (XSS residual risk alongside httpOnly cookie).
3. Capability-level entitlements largely UI/catalog; many capabilities lack route enforcement.
4. Storage accounting unavailable for disk/mixed backends → fail-open with documentation.
5. `seatUsage` for pre-Batch-4 tenants needs backfill/align on first provision (automatic raise-to-count, not a full historical audit).
6. Terminated employees do not automatically free seats.
7. Cron/API latency/employee totals remain unavailable metrics (intentionally not invented).
8. Wildcard CORS for `*.vercel.app` still exists for general API; platform cookie path is mitigated by Origin guard — prefer exact origins in production.
9. No live payment gateway (intentional).
10. MFA attempt lockout / TOTP replay tracking still thin.

---

## 9. Required environment variables

| Variable | Required | Notes |
|---|---|---|
| `MONGO_URI` | Yes | Central + tenant DBs |
| `PLATFORM_JWT_SECRET` | Yes (≥32) | Prefer dedicated; falls back to `JWT_SECRET` |
| `JWT_SECRET` | Yes (≥32) | Tenant auth |
| `CLIENT_URL` / `FRONTEND_URL` | Yes (prod) | CORS + platform Origin allowlist |
| `PLATFORM_ADMIN_ORIGIN` | Recommended | Extra exact origin for Platform Admin SPA |
| `PLATFORM_COOKIE_SAMESITE` | Optional | `strict` / `lax` / `none` |
| `PLATFORM_AUTH_COOKIE_NAME` | Optional | Default `hrms_platform_auth` |
| `PLATFORM_JWT_EXPIRES_IN` | Optional | Overridden by settings TTL when issuing sessions |
| `PLATFORM_MFA_ENCRYPTION_KEY` | Recommended | Stable key independent of JWT rotation |
| `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` | Bootstrap | Prefer env over CLI args |

---

## 10. Bootstrap instructions

```bash
cd server
# Ensure PLATFORM_JWT_SECRET (≥32) and MONGO_URI are set
node scripts/bootstrapPlatformAdmin.js \
  --email 'platform@yourdomain.com' \
  --password '<≥12 chars>' \
  --name 'Platform Admin'
```

1. Open `/platform/login`
2. Complete MFA enrollment (store recovery codes offline)
3. Create companies with a **required** primary contact email
4. Have that contact complete `/api/auth/setup-initial-admin` or invitation flow

Refuses a second active admin. Does not print secrets.

---

## 11. Required migrations / backfills

| Item | Action |
|---|---|
| `PlatformPlan` seed | Automatic on first plan/entitlement use (`ensureDefaultPlansSeeded`) |
| `PlatformSettings` general/security/maintenance | Schema defaults on first load |
| `Company.subscription.planId` | Linked on create/assign; legacy code-only rows resolve by code |
| `Company.subscription.seatUsage` | Aligns upward from employee count on next provision; **run a one-time backfill** for accurate insights: set `seatUsage` = tenant `Employee.countDocuments()` per company |
| `PlatformInvoiceCounter` | Created on first invoice |
| Existing employees when seats already over plan max | **Do not delete**; only block new reservations |

No Redis or new infrastructure required.

---

## 12. Deployment sequence and rollback

### Sequence (staging first)

1. Deploy server with Batches 1–5 (central models + routes + middleware)
2. Set env vars (`PLATFORM_JWT_SECRET`, origins, MFA key)
3. Run `bootstrapPlatformAdmin.js` once
4. Smoke: platform login → MFA → overview → companies → modules → plans → insights → settings
5. Smoke: tenant login blocked under maintenance; restored after disable
6. Deploy client Platform Admin SPA routes
7. Optional: seatUsage backfill script in maintenance window

### Rollback

1. Revert client routes to hide Platform Admin if needed
2. Revert server deploy; central collections (`platform_*`) can remain (non-destructive)
3. Tenant login behavior returns to pre-subscription/maintenance gates if those commits are reverted
4. Do **not** drop `platform_audit_logs` during rollback

---

## 13. Outstanding business decisions

1. Payment provider, tax, dunning, and auto-charge rules (no gateway until decided)
2. Exact-origin CORS only vs preview-host allowlists for tenant API
3. Whether Platform Admin should be **cookie-only** or **Bearer-only** (drop dual token storage)
4. Wire stored rate limits to a shared store (or accept display-only)
5. Suspended subscription: full login block (current) vs read-only portal
6. Seat free-on-terminate policy and backfill ownership
7. Hard-fail uploads when storage cannot be measured vs current fail-open
8. Capability catalog: enforce or remove from admin UI to avoid false assurance
9. MFA recovery / admin unlock runbook if authenticator + codes are lost

---

## 14. Conditions for staging

Staging is appropriate when **all** of the following are accepted:

1. Exact `CLIENT_URL` / `PLATFORM_ADMIN_ORIGIN` configured; Origin guard verified against a non-allowlisted host  
2. `PLATFORM_JWT_SECRET` and `PLATFORM_MFA_ENCRYPTION_KEY` set independently  
3. Bootstrap completed; MFA recovery codes stored offline  
4. Stakeholders accept rate-limit settings as documentation-only for now  
5. SeatUsage backfill plan scheduled before relying on Insights utilization  
6. No payment gateway expectations in this release  

**Production** should wait until conditions 1–3 are mandatory and CORS preview wildcards are reviewed.

---

## Final verdict

# READY WITH CONDITIONS

Platform Admin Batches 1–5 are functionally and security-validated for **staging** under the conditions above. Critical isolation, MFA, entitlement core paths, billing safety, and Batch 5 hardening fixes are verified by automated tests. Remaining items are documented limitations and business decisions, not unverified claims of readiness.
