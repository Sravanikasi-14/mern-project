# HRMS Phase 5.2 — Test Reliability & Remaining Regression Blockers

**Date:** 2026-11-09  
**Project:** `D:\HRMS\mern-project`  
**Scope:** Mongo `E11000` fixture isolation and leave-date assertion flakiness only.  
**Production code changes:** None.

---

## 1. Executive summary

Phase 5 / 5.1 leftover reliability blockers are resolved in the test harness:

| Issue | Root cause | Fix |
|-------|------------|-----|
| Mongo `E11000` duplicate `companies.slug` cancelling CA/HR suites | Persisted WiredTiger `dbPath` under `D:/tmp/hrms-mongo/*` retained prior fixture companies; `before` hooks re-seeded fixed slugs | Wipe `dbPath` with `fs.rmSync` + recreate directory before `MongoMemoryServer.create` (same pattern as CA2 / portal / c8–c10) |
| Policy `maxConsecutiveDays` assertion flake | Test used `2026-11-09`…`2026-11-16`, which became **today** on the audit date; same-day leave cutoff ran **before** consecutive-days validation | Move leave window to far-future Mon→Mon (`2027-06-07`…`2027-06-14`) |

**No unique indexes removed, no assertion weakening, no production leave/auth/tenant changes.**

**Updated recommendation:** **READY WITH LIMITATIONS** — automated backend reliability blockers from Phase 5 D2/D3 are cleared; live CA portal credential coverage and non-test limitations from Phase 5 remain.

---

## 2. E11000 investigation

### 2.1 Collection and unique index

| Item | Detail |
|------|--------|
| Collection | Central `companies` (platform DB) |
| Field | `slug` |
| Constraint | Unique index on `Company.slug` (production constraint preserved) |
| Error | `E11000 duplicate key error collection: platform.companies index: slug_1` |

Observed colliding fixture slugs from Phase 5:

| Slug | Suite / dbPath |
|------|----------------|
| `acme-ca2` / `globex-ca2` | `company_admin_dashboard` → `D:/tmp/hrms-mongo/ca2-company-admin-dashboard` (already wiped in 5.1) |
| `acme-ca3` / `globex-ca3` | `company_admin_hr_management` → `ca3-hr-management` |
| `acme-ca4b-iso` / `globex-ca4b-iso` | `company_admin_hr_access` → `ca4b-hr-access-iso` |
| `acme-ca4c-iso` | `hr_access_enforcement` → `ca4c-hr-enforce-iso` |
| `acme-ca4c2` | `hr_access_remediation` → `ca4c2-remediation` |
| `acme-ca4c6-iso` | `hr_access_rollout_readiness` → `ca4c6-readiness-iso` |

### 2.2 Intentional vs collision

Duplicate values were **not** intentional multi-company test data. They were **stale records** from a previous suite run on the same persisted WiredTiger path colliding with identical seed slugs on the next run.

### 2.3 Concurrency and shared DB

| Check | Finding |
|-------|---------|
| Runner concurrency | `npm test` / focused commands use `--test-concurrency=1` |
| Shared live Mongo | No — suites use `MongoMemoryServer` |
| Shared disk paths | Yes — several suites intentionally pin `instance.dbPath` under `D:/tmp/hrms-mongo/*` (C: space avoidance) |
| Cross-suite slug collision on disk | Yes, when wipe was missing |
| Async cleanup awaited | `after` hooks disconnect/stop mongo; the failure mode was **missing pre-create wipe**, not un-awaited teardown |
| Stale records reused | Yes — WiredTiger files survived process exit |

### 2.4 Fix applied

Added pre-create wipe + mkdir (test-only) to:

- `server/tests/company_admin_hr_management.test.js`
- `server/tests/company_admin_hr_access.test.js`
- `server/tests/hr_access_enforcement.test.js`
- `server/tests/hr_access_remediation.test.js`
- `server/tests/hr_access_rollout_readiness.test.js`

Already correct from Phase 5.1 / earlier: `company_admin_dashboard`, `company_admin_portal_access`, `hr_access_c8_remediation`, `hr_access_c9_remediation`, `hr_access_c10_dashboard`, org/department suites.

**Not done (by design):** removing unique indexes; suppressing `E11000`; changing production slug generation.

---

## 3. Leave-date flakiness investigation

### 3.1 Failing assertion

`server/tests/policy_configuration_workflows.test.js` —  
“Leave application enforces policy maxConsecutiveDays”:

- Expected: HTTP **400** with `/exceeds the company maximum limit of 4 consecutive days/i`
- Observed (Phase 5): same-day cutoff message instead

### 3.2 Cause analysis

| Hypothesis | Verdict |
|------------|---------|
| UTC vs local timezone conversion bug | **Not demonstrated** as a user-facing defect |
| Date-only parsed as timestamp | Not the failure mode here |
| DST assumptions | Not implicated |
| Test environment timezone | Company business date uses company timezone; “today” matched calendar date of run |
| Inclusive/exclusive boundaries | Span length was fine; wrong validation path fired first |
| Unstable use of current date | **Yes** — hardcoded range included **today** (`2026-11-09`) on audit day |

Production order in `leaveService` date eligibility: past / same-day cutoff checks run before policy `maxConsecutiveDays`. When start date equals company “today” after cutoff, the cutoff error correctly shadows the consecutive-days message. That is intentional product behavior.

### 3.3 Fix applied

Test-only date change to a far-future Mon→Mon working span:

- `startDate: "2027-06-07"`
- `endDate: "2027-06-14"` (six working days vs policy max 4)

**No production leave duration, balance, approval, or cutoff logic changed.**

---

## 4. Files changed

| File | Change |
|------|--------|
| `server/tests/company_admin_hr_management.test.js` | `fs.rmSync` / `mkdirSync` before MongoMemoryServer |
| `server/tests/company_admin_hr_access.test.js` | same |
| `server/tests/hr_access_enforcement.test.js` | same |
| `server/tests/hr_access_remediation.test.js` | same |
| `server/tests/hr_access_rollout_readiness.test.js` | same |
| `server/tests/policy_configuration_workflows.test.js` | far-future leave dates |
| `docs/phase5-2-test-reliability-report.md` | this report |
| `docs/phase5-2-*.log` / `.exit` / results artifacts | captured run outputs |

---

## 5. Test commands and results

Base runner (from `server/`):

```text
node --import ./tests/mongoMemoryEnv.js --test --test-concurrency=1 <files>
```

### 5.1 Individual (affected E11000 suites)

| File | Exit | Result |
|------|------|--------|
| `company_admin_hr_management.test.js` | **0** | 10 pass |
| `company_admin_hr_access.test.js` | **0** | 9 pass |
| `hr_access_enforcement.test.js` | **0** | 16 pass |
| `hr_access_remediation.test.js` | **0** | 22 pass |
| `hr_access_rollout_readiness.test.js` | **0** | 13 pass |
| `policy_configuration_workflows.test.js` | **0** | 6 pass (incl. leave consecutive-days) |

### 5.2 Together + repeatability (3 consecutive runs)

Files:

```text
company_admin_auth.test.js
company_admin_dashboard.test.js
company_admin_hr_management.test.js
company_admin_hr_access.test.js
hr_access_enforcement.test.js
hr_access_remediation.test.js
hr_access_rollout_readiness.test.js
hr_access_c10_dashboard.test.js
policy_configuration_workflows.test.js
```

| Run | Exit | Pass | Fail | Cancelled |
|-----|------|------|------|-----------|
| 1 | **0** | 105 | 0 | 0 |
| 2 | **0** | 105 | 0 | 0 |
| 3 | **0** | 105 | 0 | 0 |

No order dependency or intermittent failure observed across three consecutive combined runs.

### 5.3 Security / workflow validation batch

Additional coverage batch (CA auth, portal, HR access c8–c10, leave management, leave restrictions, employee foundation + dashboard, policy):

| Metric | Result |
|--------|--------|
| Exit code | **0** |
| Pass | **185** |
| Fail | **0** |
| Cancelled | **0** |
| Log | `docs/phase5-2-validation.log` |

### 5.4 Full backend suite

```text
node --import ./tests/mongoMemoryEnv.js --test --test-concurrency=1 tests/*.test.js
```

| Metric | Result |
|--------|--------|
| Exit code | **0** |
| Tests | **952** |
| Pass | **943** |
| Fail | **0** |
| Cancelled | **0** |
| Skipped | **9** (pre-existing skips; not used to hide failures) |
| Duration | ~26 minutes |
| Log | `docs/phase5-2-full-suite.log` |
| E11000 occurrences | **None** |

---

## 6. Remaining failures / limitations

| Item | Status |
|------|--------|
| E11000 slug fixture cancellations (Phase 5 D2) | **Resolved** for identified persisted-path suites |
| Leave consecutive-days flake (Phase 5 D3) | **Resolved** (test dates) |
| Full suite failures | **None** in this run (`fail 0`, `cancelled 0`) |
| Live Company Admin browser session credentials | Still limited (unchanged from Phase 5/5.1) |
| Platform Admin / MFA live coverage | Still out of scope |
| Puppeteer Chromium path noise under `D:/tmp/hrms-mongo/tmpdir` | Logged during PDF fallback; tests still passed via pure-JS generator — not a Phase 5.2 blocker |

---

## 7. Updated release recommendation

**READY WITH LIMITATIONS**

Cleared relative to Phase 5 / 5.1:

- Automated CA/HR fixture isolation (`E11000` cancellations) for the known persisted WiredTiger paths
- Policy leave consecutive-days assertion stability
- Full backend suite green in this phase (`exit 0`, `fail 0`, `cancelled 0`)

Still limiting unqualified READY:

- Incomplete live portal credential coverage for Company Admin / Candidate / Platform Admin (process/coverage, not this harness fix)
- Local ops notes from Phase 5 (`CLIENT_URL` / dual C: processes) remain operational hygiene, not test reliability

**Do not deploy from this workstream.** No production schema, auth, payroll, or leave behavior changes were made.
