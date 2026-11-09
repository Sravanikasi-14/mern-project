# HRMS Phase 4 — UI Consistency & Polish Report

**Canonical tree:** `D:\HRMS\mern-project`  
**Frontend:** `http://127.0.0.1:5174`  
**Backend:** `http://127.0.0.1:5000`  
**Date:** 2026-11-09  
**Baseline preserved:** Sticky AppHeader + expandable GlobalSearch → PageIdentity → ModuleToolbar flex search (no `1fr|320|1fr` grid)

## 1. Pages audited

HR Admin: Dashboard, Employees, Attendance/Live Tracking, Leave (+ review), Payroll, Hiring & Onboarding, Messages, Organization, Work Management, Impact Points, Employee Profile.  
Shared chrome also covers Company Admin / Employee pages that already use `AppHeader` (Company HR Management, Employee Leave/Tasks/Impact/Dashboard).  
Candidate-facing flows left on existing local styling (out of portal shell).

## 2. Inconsistencies discovered

| Area | Issue |
|---|---|
| Buttons | Competing families (`wm-*`, `hw-*`, `ol-*`, `btn--emp-*`, `btn--primary-fern`) with 32–42px heights, 6–999px radii, slate/blue accents |
| Forms | Search/select shells at 38px / 8–10px radius; WM form focus used blue |
| Modals | Legacy `.modal-overlay` z-index 50 and 16px radius vs AppModal |
| Tables | Attendance used unclassed inline tables; WM/HW/OL header colors were slate |
| Cards | Aggressive hover lift/shadow on People & Leave cards |
| Layout | Work/Impact sticky CTAs crowded GlobalSearch; Profile lacked AppHeader; Hiring CSS hid `.app-header` and used 28px titles |
| Messages | Confirmed healthy (200) — **not modified** |

## 3. Shared components / tokens improved

- Canonical button geometry (`--hit` 40px, `--r-md` 12px, forest focus) applied to WM / HW / OL / emp / fern button families  
- Shared `.search-input`, alerts, `.btn-sm`, legacy modal overlay/card tokens  
- Attendance controls aligned to 40px / 12px  
- WM form inputs/selects: forest focus, 40px / `--r-md`  
- Table chrome tokens for WM / HW / OL; Attendance wrapped in `.data-table`  
- Card hover stacks toned down (People, Leave)

## 4. Pages corrected

- **Work Management / Impact Points** — SoftRefresh in sticky actions; Board/List + Create/Recognize under PageIdentity `nav`  
- **Employee Profile** — AppHeader + PageIdentity (title/subtitle/breadcrumb/actions)  
- **Attendance** — `.data-table-container` / `.data-table`  
- **Hiring** — removed dead `.hw-page .app-header { display:none }`; title size tokens  
- Module CSS for Leave / Payroll-related button/table families via shared aliases above  

## 5. Files changed

**Updated:**  
`client/src/index.css`  
`client/src/pages/WorkManagement.css`  
`client/src/pages/HiringOnboarding.css`  
`client/src/pages/OfferLetters.css`  
`client/src/pages/EmployeeDashboard.css`  
`client/src/pages/AdminDashboard.css`  
`client/src/pages/Attendance.css`  
`client/src/pages/PeopleManagement.css`  
`client/src/pages/LeaveManagement.css`  
`client/src/pages/AdminWorkManagement.jsx`  
`client/src/pages/AdminImpactPoints.jsx`  
`client/src/pages/AdminAttendanceOverview.jsx`  
`client/src/pages/EmployeeProfile.jsx`  

**Created:**  
`docs/phase4-screenshots/*`  
`docs/phase4-ui-consistency-report.md`  

**Removed:** none (obsolete Hiring hide-header rule neutralized in CSS)

## 6. Responsive / Android

- Desktop verified on 5174 with screenshots  
- Existing mobile tap targets (`min-height: 44/48` in `index.css` / `mobile.css`) left intact  
- No Capacitor / native config changes  
- No horizontal-overflow fixes beyond shared control widths  

## 7. Build & regression

- `npm run build` (client) — **passed**  
- Messages API authenticated: `GET /api/conversations` **200**, `GET /api/conversations/unread-count` **200**  
- Toolbar grid check: ModuleToolbar **not** using 320px centered grid  
- Work Management Create Task measured **40px / 12px radius**; GlobalSearch ~**527px** expandable  

## 8. Visual evidence

Screenshots in `D:\HRMS\mern-project\docs\phase4-screenshots\`:

| File | Page |
|---|---|
| `employees.png` | Employee list |
| `payroll.png` | Payroll |
| `attendance.png` | Attendance |
| `leave.png` | Leave |
| `leave-review.png` | Leave review workflow |
| `hiring.png` | Hiring & Onboarding |
| `messages.png` | Messages |
| `employee-profile.png` | Employee Profile |
| `organization.png` | Organization (admin workspace) |
| `work-management.png` | Work Management |
| `hr-dashboard.png` | HR Dashboard |

## 9. Remaining issues / exceptions

1. **Company Admin live screenshot** — HR Admin session redirects away from `/admin/hr-management`; CA pages already share AppHeader/PageIdentity (code-aligned).  
2. **Employee portal live screenshot** — same session cannot render `/app/*`; Employee pages already on AppHeader (Leave/Tasks/Impact/Dashboard standardized for buttons).  
3. **Full AppModal JSX migration** for legacy `.modal-card` consumers (Home/Leave/Profile) deferred; CSS tokens now match AppModal.  
4. **HiringCandidateModal** still uses custom `.hw-modal` shell (workflow preserved).  
5. **Status badge families** (`.ol-pill`, dashboard pills) partially aligned via tables/buttons; deeper badge merge can be a follow-up.  
6. Candidate portals intentionally keep lightweight local chrome.

## Acceptance summary

Equivalent buttons/inputs/tables now share **40px / 12px / forest** treatment across major modules without changing APIs, auth, tenant isolation, or Messages. The approved global toolbar hierarchy remains intact.
