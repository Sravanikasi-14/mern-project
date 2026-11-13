# HRMS Scalability Findings Index

Last updated: 2026-11-12  
Scope: design targets of 100 / 10,000 → 500 / 50,000 → 1,000 / 100,000 companies / employees. These are **planning targets**, not measured capacity.

Evidence legend: **CI** = code inspection · **T** = automated tests · **E** = Mongo explain · **M** = production/runtime measurement

---

## Prior wave (F30–F34) — implementation-reviewed

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| F30 | Settlements DB pagination + projection | P1 (was) | **Implementation-reviewed** | DB `count`/`skip`/`limit`, search via employee `$in`, tenant isolation covered by tests. |
| F31 | AuthSession `{userId,isActive}` (+ token) indexes | P1 (was) | **Implementation-reviewed** | Schema + `createIndexes` in provisioning; idempotent. Confirm on **existing** prod tenants via provision script / index inventory. |
| F32 | Notification visibility parallel indexed branches | P1 (was) | **Implementation-reviewed** | Merge preserves sort/pagination/dedup/unread rules in tests. |
| F33 | Bounded `notification_read_states` + migrate/prune | P0 (was) | **Implementation-reviewed; migration pending** | Dual-read + verify-before-prune in code. **Staging/prod migrate `--apply` and optional `--prune` not executed in audit.** Production verification pending. |
| F34 | Hiring `$lookup` localField/`_id` join | P1 (was) | **Implementation-reviewed** | Join key unchanged semantically. **Summary counters still scan all offers** → see **F36**. Atlas explain on tenant DB still recommended. |

Do **not** reopen F30–F34 for reimplementation unless a regression is proven. Do **not** run `syncIndexes()` on OfferLetter.

---

## Phase 2 wave (F35+)

| ID | Title | Area | Priority | Evidence | Doc section |
|----|-------|------|----------|----------|-------------|
| F35 | Unbounded per-tenant Mongo connection Map / no pool caps | A/G | **P0** | CI → **Implemented** | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f35) · [lifecycle](./TENANT_CONNECTION_MANAGEMENT.md) |
| F36 | Hiring list `$facet` still derives stage for every offer | A/H | **P0** | CI → **Implemented** (light summary + page hydrate) | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f36) · [F36 doc](./F36_HIRING_SUMMARY.md) |
| F37 | Admin dashboard loads all employees + month attendance | A/B | **P0** | CI → **Implemented** (lean facts + attendance-row counts) | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f37) · [F37 doc](./F37_ADMIN_DASHBOARD.md) |
| F38 | Attendance overview / live tracking full-roster APIs + 60s poll | A/C/F | **P0** | CI → **Implemented** (slim APIs + poll tuning) | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f38) · [F38 doc](./F38_ATTENDANCE_LIVE_TRACKING.md) |
| F39 | Face recognition TFJS/CPU on punch/enroll request path | B/C/G | **P0** | CI → **Implemented** (bounded inference + dispose) | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f39) · [F39 doc](./F39_FACE_VERIFICATION_RUNTIME.md) |
| F40 | Offer/payslip PDF via Puppeteer/Chromium on request path | B/G | **P0** | CI → **Implemented** (shared browser + concurrency) | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f40) · [F40 doc](./F40_PDF_BROWSER_RUNTIME.md) |
| F41 | Workforce cron: sequential all-companies × per-task employee reload vs 60s | D/G | **P0** | CI → **Implemented** (bounded concurrency, durable wave, roster cache) | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f41) · [F41 doc](./F41_WORKFORCE_SCHEDULER.md) |
| F42 | Punch success notifies every HR portal user (sequential inserts) | C/B | **P0** | CI → **Implemented** (bulk insertMany + dedupe) | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f42) · [F42 doc](./F42_ATTENDANCE_NOTIFICATIONS.md) |
| F43 | Serverless skips auto tenant provisioning → index drift risk | A/E/G | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f43) |
| F44 | Provisioning `createIndexes` incomplete vs models in use | A/E | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f44) |
| F45 | No Mongo TTL on sessions/tokens/challenges (soft expiry only) | A | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f45) |
| F46 | Chat `listConversations` N+1 previews/unreads | A/B | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f46) |
| F47 | Employee-role directory: load all then filter/slice in memory | A/E | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f47) |
| F48 | Organization hierarchy returns full company employee set | A/F | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f48) |
| F49 | Auth middleware: sequential company + tenant + user + session lookups | B/E | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f49) |
| F50 | Payroll cycle calculation loads full ACTIVE workforce + month rows | B/A | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f50) |
| F51 | Announcement publish-due: not in Vercel crons; O(users) notification writes | D/B | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f51) |
| F52 | Bulk employee import: up to 500 sequential provisions in one HTTP request | B/G | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f52) |
| F53 | Cross-tenant jobs lack per-tenant time budget (noisy neighbor) | D/E | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f53) |
| F54 | Live location: high-frequency client posts + RMW `session.save()` | C | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f54) |
| F55 | Dual-write `Employee.customFields.attendanceLogs` on punch | C/A | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f55) |
| F56 | Desktop/mobile employees “pool” hard-capped at 300 | F | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f56) |
| F57 | Durable upload paths must not depend on Vercel `/tmp` alone | B/G | **P1** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f57) |
| F58 | Case-insensitive `$regex` employee/offer search without Atlas Search | A | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f58) |
| F59 | Overlapping / redundant compound indexes (write amplification) | A | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f59) |
| F60 | Large documents: offer HTML, Mixed `customFields`, onboarding docs | A | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f60) |
| F61 | Payslip reads load full cycle then filter in memory (scoped HR) | A/B | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f61) |
| F62 | HR intelligence insights: multiple full active-employee scans | B | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f62) |
| F63 | `getEmployeeSummary` loads all active IDs + compensations | A/B | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f63) |
| F64 | Leave/onboarding SSE heartbeats vs serverless maxDuration | B/G | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f64) |
| F65 | Rate limits: login/email only; in-memory store across instances | B/G | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f65) |
| F66 | Chat React Query polling every 10s (web + mobile) | F | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f66) |
| F67 | AuthedAvatar = per-face authenticated blob fetch (cache ≤50) | F | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f67) |
| F68 | Mobile `App.jsx` statically imports all portal routes | F | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f68) |
| F69 | Attendance history legacy path: unbounded `Attendance.find` merge | C/A | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f69) |
| F70 | Attendance map clears/rebuilds markers + fitBounds every poll | F/C | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f70) |
| F71 | Client-side pagination after full fetch (onboarding, impact, some history) | F | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f71) |
| F72 | `express.json` 15mb + base64 face/chat bodies under concurrency | B/G | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f72) |
| F73 | LiveTrackingSession ACTIVE start not partial-unique | C | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f73) |
| F74 | Admin tracking loads full breadcrumbs then uses count/last only | C/A | **P2** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f74) |
| F75 | `NotificationReadState.find({userId})` loads all keys per GET | A | **P3** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f75) |
| F76 | Process-local caches (Gemini explanations, SMTP transporters) | B/E | **P3** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f76) |
| F77 | `provisionAllTenantDatabases` serial over all companies on boot | A/G | **P3** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f77) |
| F78 | Most multi-doc mutations non-transactional | A | **P3** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f78) |
| F79 | Mobile: limited offline query persistence / status-aware retry | F | **P3** | CI | [PHASE2](./SCALABILITY_AUDIT_PHASE2.md#f79) |

---

## Status summary

| Bucket | IDs |
|--------|-----|
| Done (code) | F30–F34 (impl reviewed); **F35**–**F42** P0 implemented (see [PHASE2_P0_INTEGRATION_REVIEW.md](./PHASE2_P0_INTEGRATION_REVIEW.md)) |
| Pending ops | F33 migrate/prune + prod verify; F31/F34 index explain on prod tenants |
| Next P0 | F43+ (F38–F42 implemented) |
| Next P1 | F43–F57 |
| Later | F58–F79 |

Full narrative, architecture, top-10, fix order, and validation commands: [`SCALABILITY_AUDIT_PHASE2.md`](./SCALABILITY_AUDIT_PHASE2.md).
