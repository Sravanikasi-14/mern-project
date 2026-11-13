# F38 — Attendance and live-tracking full-roster loading

## Audit summary

| Layer | Finding |
|-------|---------|
| Admin overview | `getAdminAttendanceOverview` loaded every non-terminated employee with `customFields`, full Attendance docs, and full LiveTrackingSession docs (incl. breadcrumbs), then polled every 60s. |
| Live tracking | `getAdminTrackingSessions` loaded the **entire** employee roster first, then `$in` today’s attendance + ACTIVE sessions. `AdminLiveTracking` ran **two** 60s polls (live + history). |
| Mobile HR | `LiveTrackingPage` / Home hint called `/admin/attendance/overview` (full roster) instead of the slim tracking API. |
| History / range | Overview `rangeRecords` and tracking history were unbounded or roster-scoped; breadcrumbs loaded then discarded. |

## Endpoints

| Method | Path | Role after F38 |
|--------|------|----------------|
| `GET` | `/api/admin/attendance/overview` | Slim employee projection; Attendance day projection; legacy `attendanceLogs` only for employees missing an Attendance row; optional `page`/`limit`/`search` for **range** records; max **62** civil days. |
| `GET` | `/api/admin/attendance/tracking-sessions` | **Punch/session-first** live list; history session-first with `-breadcrumbs`; optional `historyPage`/`historyLimit`; max **62** days. |
| `GET` | `/api/admin/attendance/employee/:id` | Existing pagination; date range bounded (62 days); day-field projection. |

Response contracts for summary counts / live row shapes are preserved.

## Polling changes

| Client | Before | After |
|--------|--------|-------|
| `AdminAttendanceOverview` | 60s always (roster workspace) | 60s only when tab **visible**; **off** in multi-day range mode |
| `AdminLiveTracking` live query | 60s | 60s when visible + eligible rows; **180s** when live list empty |
| `AdminLiveTracking` history query | 60s (duplicate) | **No** interval — refetch on filter change only |
| Mobile live page | overview once per date | `tracking-sessions`; 60s poll for **today** while visible |
| Mobile HR home hint | overview summary | `tracking-sessions` summary (`liveCount` / `withLocationCount`) |

Helper: `client/src/lib/attendancePollInterval.js`.

## Query optimizations

1. **Overview roster** — `ADMIN_ATTENDANCE_EMPLOYEE_SELECT` (no `customFields`); attendance via `ADMIN_ATTENDANCE_DAY_SELECT`.
2. **Legacy fallback** — `loadLegacyAttendanceLogsForMissing` only for IDs without an Attendance row that day.
3. **Live tracking** — query open punches + ACTIVE non-expired sessions first; hydrate only those employees (department/HR scope uses `_id` list only when needed).
4. **History / tracking reads** — `ADMIN_TRACKING_SESSION_SELECT` excludes `breadcrumbs`; `breadcrumbCount` returns `0` on admin list payloads.
5. **Range lists** — `assertBoundedAttendanceRange` (62 days); server pagination when `page`/`limit` provided; hard cap 500 when unpaged.
6. **Employee history** — same day projection + range bound.

## Indexes / migration

| Change | Notes |
|--------|-------|
| `live_tracking_sessions`: `{ startedAt: -1, status: 1 }` | Additive; created via model + `LiveTrackingSession.createIndexes()` in tenant provisioning. |
| Existing | Attendance `(employeeId, date)`, `(date, …)`, sparse `openSessionId`; tracking `(status, expiresAt)`, `(employeeId, status)`. |

**Migration:** run `node scripts/provisionAllTenants.js` (or per-company provision) so existing tenants get the new startedAt index. **Do not** call OfferLetter `syncIndexes()`.

## Tests

- `server/tests/f38_attendance_live_tracking.test.js` — counts, live punch lifecycle, logout stop, eligibility, expiry, tenant isolation, range pagination/bounds, explain structural checks, location required on punch.
- `client/src/hooks/attendancePollInterval.test.js` — visibility / empty slowdown / no duplicate live poller.
- Re-run: `attendance_geolocation_tracking`, `live_tracking_privacy_lifecycle`, related multi-tenant suites.

## Structural vs measured

Improvements are **structural** (narrower documents, punch-first live, less polling, bounded ranges). `explain("executionStats")` in tests confirms queries are executable — not production latency.

## Remaining limitations

- Single-day overview still returns the full scoped roster (needed for NOT_CHECKED_IN + map filters); slim fields reduce payload but N employees remain.
- Department/HR-scoped live still loads scoped `_id`s when filters are applied.
- Admin list APIs no longer expose breadcrumb arrays/counts (trail remains on the session document for employee updates).
- Mobile historical date picker lists tracking **history** sessions for that day, not the full attendance roster.
