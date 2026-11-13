# F37 — Admin Dashboard full-roster loading

## Audit summary

| Layer | Finding |
|-------|---------|
| Client | `AdminDashboard.jsx` → `useAdminDashboardQuery` → `GET /api/admin/dashboard` (single aggregated payload). Fallback `buildAdminDashboardFallback` only when 404. |
| Backend | `getAdminDashboard` in `adminController.js` previously `Employee.find(ACTIVE)` with a wide select including `fullName`, `email`, `avatar`, `customFields.attendanceLogs`, then walked **every** employee for present/late, payroll, assets, workforce, projects. |
| Why full roster | In-memory loops for today’s attendance (incl. legacy logs), CTC sum, dept headcount, project mix, assets %. Response never returned the roster, but the server loaded it. |

Live attendance overview / tracking polling is **out of scope** (F38).

## Implementation

### Endpoint (unchanged contract)

`GET /api/admin/dashboard?date&month&year&department`

Response shape preserved (`meta`, `summary`, `recruitmentFunnel`, calendars, payroll widgets, `workforce`, `projectTeams`, etc.).

### Query changes

1. **Employee facts** — `loadDashboardEmployeeFacts` selects only:
   `_id job.department job.project customFields.monthlySalary|salary|assignedAssets`  
   No `fullName` / `email` / `avatar` / `attendanceLogs`.
2. **Today present/late** — counted from `Attendance` rows (`employeeId`, `checkIn`, `status`); legacy `attendanceLogs` loaded **only** for active employees missing an Attendance row that day.
3. **Compensation** — `EmployeeCompensation` projected to `employeeId` + `revisions`; payroll allocation / workforce built via `buildWorkforcePayrollAndProjects`.
4. **Company assets** — assignment query restricted to `currentAssignment.employeeId ∈ activeIds`.
5. **Custom-HR payslips** — `Payslip.find({ payrollCycleId, employeeId: { $in: activeIds } })` before scope filter.

Helpers live in `server/services/adminDashboardMetrics.js`.

## Indexes / migration

- No new indexes; no migrations; no OfferLetter `syncIndexes()`.
- Relies on existing Employee `status` / department indexes and Attendance `(employeeId, date)` as already defined.

## Tests

- `server/tests/f37_admin_dashboard.test.js` — fact projection, attendance counting, empty tenant, department filter, explain structural check.
- Existing `server/tests/admin_dashboard.test.js` — behavior parity.

## Structural vs measured

Improvements are **structural** (narrower documents, attendance counted from attendance rows, scoped payslip/asset queries). Explain in tests validates query executability only — not production latency.

## Remaining limitations

- Still loads one lean fact document per active employee (needed for dept/project/salary fallback). Fully ID-only + separate aggregations could go further later.
- Month attendance calendar still loads attendance/leave rows for the date range for scoped IDs (unchanged pattern).
- Client fallback path may still over-fetch if `/admin/dashboard` is missing (pre-existing).
