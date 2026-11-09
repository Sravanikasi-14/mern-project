# HRMS Phase 5.1 — Company Admin Authorization & Tenant Isolation

**Date:** 2026-11-09  
**Project:** `D:\HRMS\mern-project`  
**Scope:** Company Admin 200-vs-403 mismatches and tenant isolation only.

---

## 1. Exact failing routes (from Phase 5)

| Route | Method | Observed (Phase 5) | Old test expectation |
|-------|--------|--------------------|----------------------|
| `/api/admin/dashboard` | GET | **200** for Company Admin | **403** (`company_admin_auth`, `company_admin_dashboard`, `hr_access_c10_dashboard`) |
| `/api/employees` | GET | **200** for Company Admin | **403** (`company_admin_auth`) |

Related positive control (already green in Phase 5):

| Route | Method | Observed |
|-------|--------|----------|
| `/api/company-admin/dashboard` | GET | **200** for Company Admin only; **403** for HR/Employee |
| Wrong-company login | POST `/api/auth/login` | **401** |

---

## 2. Root cause for each 200-versus-403 mismatch

### Investigation evidence

| Item | `/api/admin/dashboard` | `/api/employees` |
|------|------------------------|------------------|
| Registered middleware | `authenticate` → `requireRole(HR_ADMIN, COMPANY_ADMIN)` → `loadHrAccessContext` → `requireHrPermission(...)` | Same role gate + `requireHrPermission("people.view")` |
| Tenant check | JWT `companyId` → `authenticate` loads that company DB into `req.auth.models` | Same |
| Company Admin permission behavior | `assertHrPermission` / scope checks **no-op** for non-`HR_ADMIN` (company-wide within tenant) | Same |
| Competing suite | `company_admin_portal_access.test.js` **expects 200** and asserts no Globex employees in Acme list | Same |

### Conclusion per route

| Route | Conclusion |
|-------|------------|
| `GET /api/admin/dashboard` | **A — outdated test expectation.** Approved design intentionally allows Company Admin onto HR admin modules within the authenticated tenant. Not a missing-auth defect. |
| `GET /api/employees` | **A — outdated test expectation.** Same intentional Company Admin people-directory access; tenant isolation is via session company binding. |

**Not B** (missing middleware): role gate explicitly includes `COMPANY_ADMIN`.  
**Not C** (tenant leak via these 200s): responses are still bound to the JWT company; cross-tenant login with foreign email returns **401**; Globex CA list does not contain Acme employees.

Supporting product signals:

- `adminRoutes.js` / `employeeRoutes.js` include `USER_ROLES.COMPANY_ADMIN`.
- `hrAccessEnforcementService.js`: Company Admin bypasses HR permission/scope enforcement (company-wide in-tenant).
- Portal access suite title: *“lets Company Admin use company HR modules and HR management”*.

---

## 3. Which test expectations were correct or outdated

| Expectation | Verdict |
|-------------|---------|
| CA → `/api/admin/dashboard` must be **403** | **Outdated** |
| CA → `/api/employees` must be **403** | **Outdated** |
| CA → `/api/company-admin/*` only for CA; HR/Employee **403** | **Correct** (unchanged) |
| Cross-company login with foreign email **401** | **Correct** |
| Enforced HR without `people.view` → employees **403** | **Correct** |
| Employee → `/api/admin/dashboard` **403** | **Correct** |
| Portal suite CA → dashboard/employees **200** + no foreign tenant rows | **Correct** (source of truth for current design) |

---

## 4. Security defects discovered

**No confirmed authorization defect** on the investigated 200-vs-403 routes.

Tenant isolation for Company Admin remains enforced by authentication binding (company id in token → tenant models). Negative cross-tenant assertions were added/strengthened in tests.

---

## 5. Files changed

| File | Change |
|------|--------|
| `server/tests/company_admin_auth.test.js` | Align expectations with approved CA HR-module access; add cross-tenant people/dashboard negatives |
| `server/tests/company_admin_dashboard.test.js` | Replace outdated “CA cannot use HR dashboard” with same-tenant allow + cross-tenant non-leakage; clear persisted WiredTiger fixture before seed (isolation only) |
| `server/tests/hr_access_c10_dashboard.test.js` | Expect CA **200** on `/api/admin/dashboard` while keeping CA-only company-admin dashboard and employee **403** |
| `docs/phase5-1-ca-auth-investigation-report.md` | This report |
| `docs/phase5-1-ca-auth-test-output.log` | Focused test run log |

**No production route/middleware/controller authorization changes** — behavior already matched approved design.

---

## 6. Authorization changes made

None in application code.

Test harness only: wipe `D:/tmp/hrms-mongo/ca2-company-admin-dashboard` before seeding so fixed slugs do not collide across runs (same pattern as `company_admin_portal_access.test.js`). This is **not** a change to slug-generation logic.

---

## 7. Cross-tenant negative test results

After updates, focused run verified:

- Acme CA login with Globex company code → **401**
- Globex CA `GET /api/employees` does not include Acme employee emails
- Acme CA `GET /api/employees` does not include Globex employee emails
- Acme CA `/api/admin/dashboard` body does not contain “globex”
- Globex CA `/api/admin/dashboard` body does not contain “acme”
- Portal access: Acme CA people list excludes Globex person; Globex HR people list excludes Acme Alice

---

## 8. Test execution results

Command:

```text
node --import ./tests/mongoMemoryEnv.js --test --test-concurrency=1 \
  tests/company_admin_auth.test.js \
  tests/company_admin_dashboard.test.js \
  tests/company_admin_portal_access.test.js \
  tests/hr_access_c10_dashboard.test.js
```

| Metric | Result |
|--------|--------|
| Exit code | **0** |
| Pass | All cases in the four files (including updated CA isolation cases) |
| Log | `docs/phase5-1-ca-auth-test-output.log` |

### Separately recorded (not modified in this phase)

| Issue | Status |
|-------|--------|
| Broader suite Mongo `E11000` duplicate company `slug` cancellations in other CA fixtures | **Still a known test-isolation debt** outside these four files |
| Flaky leave `maxConsecutiveDays` vs same-day cutoff assertion | **Unrelated; not touched** |

---

## 9. Remaining blockers

1. Full `npm test` may still cancel other CA suites that persist WiredTiger paths without cleanup (same class of isolation issue as pre-fix CA2).
2. Live Company Admin browser session was not re-exercised here (password still unavailable in local Acme DB from Phase 5).
3. Leave date flaky test remains open as a non-security item.

---

## 10. Updated release-readiness recommendation

**READY WITH LIMITATIONS** (unchanged overall posture), with this clarification:

- The Phase 5 “CA got 200 where tests expected 403” item is **resolved as outdated tests**, not as an open authorization hole.
- Company Admin same-tenant HR module access is **intentional** and covered by aligned tests + cross-tenant negatives.
- Remaining limitations: other suite isolation/`E11000` noise, leave date flake, incomplete live CA portal credential coverage.

Do not deploy from this workstream. No production data changes.
