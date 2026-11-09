# Global Toolbar Layout Rebuild — Implementation Report

**Canonical tree:** `D:\HRMS\mern-project`  
**Dev server:** `http://127.0.0.1:5174`  
**Date:** 2026-11-09  
**Reference:** Screenshot 3 (horizontal toolbar: leading → expandable search → utilities; page title/tabs below)

## Verdict

The previous `1fr | 320px | 1fr` centered ModuleToolbar search grid is removed. All AppHeader pages now share one sticky Row‑1 toolbar with expandable GlobalSearch, PageIdentity (title/subtitle/nav) as Row‑2, and page tools/content as Row‑3. Client production build passes.

## Architecture

| Layer | Component | Role |
|---|---|---|
| Row 1 (sticky) | `AppHeader` → `.fernly-topbar` | `[leading]` · expandable `GlobalSearch` · `[actions + notifications + profile + logout]` |
| Row 2 | `PageIdentity` | Page title, subtitle, optional nav (tabs/chips/actions) |
| Row 3 tools | `ModuleToolbar` (flex) | `[actions]` · expandable local `ModuleSearch` · `[secondary + filters]` |
| Row 3 content | Page workspace | Tables, messages, dashboards, forms |

Slots are configurable (`leading`, `nav`, `actions`, ModuleToolbar slots). Page-specific controls were preserved; bulky CTAs moved from the sticky bar into PageIdentity nav or ModuleToolbar so GlobalSearch can expand.

## Key code changes

- **Added** `client/src/components/PageIdentity.jsx` + `.css`
- **Rebuilt** `AppHeader.jsx` — title no longer inside sticky bar; sticky = leading + expandable search + utilities
- **Rebuilt** `ModuleToolbar.css` — `display: flex` with `flex: 1` search; removed `--mt-search-w: 320px` centered grid
- **Updated** `GlobalSearch.css` — removed `max-width: 440px` / `margin: 0 auto` centering
- **Updated** `index.css` fernly-topbar regions for the flex toolbar
- **Migrated** Leave, Attendance, Messages, Employees, Hiring, Admin/Employee dashboards, Company HR Management, Employee Leave/Tasks/Impact to the hierarchy

## Search distinction (preserved)

- **GlobalSearch** — sticky toolbar, cross-module (`Search people, leave, offers…`)
- **ModuleSearch** — ModuleToolbar / page tools, filters the current list
- They never share the same toolbar row as competing peers

## Visual verification (5174)

Screenshots saved under `docs/toolbar-rebuild-screenshots/`:

| File | Page |
|---|---|
| `employees.png` | Employees |
| `payroll.png` | Payroll |
| `attendance.png` | Attendance (+ Live Tracking tabs in PageIdentity) |
| `leave.png` | Leave Management |
| `hiring.png` | Hiring & Onboarding |
| `messages.png` | Messages |
| `hr-dashboard.png` | HR Dashboard |

**Measured on Employees (post-fix):** GlobalSearch width ≈ **481px** (expands); ModuleToolbar `display: flex`; `gridTemplateColumns` no longer contains `320`; page title rendered in `.page-identity` below sticky bar; Import/Add Employee live in ModuleToolbar (not sticky).

Company Admin and Employee portals use the same `AppHeader` / `PageIdentity` / `ModuleToolbar` stack. Live CA/employee login screenshots were not captured in this pass (session remained HR Admin); those portals were code-migrated and share the same sticky chrome.

## Build

```
cd D:\HRMS\mern-project\client && npm run build
→ ✓ built successfully
```

## Acceptance checklist

1. Same fixed horizontal toolbar structure across AppHeader pages — **yes**
2. Search integrated into that toolbar, not an isolated centered 320px grid — **yes**
3. Page-specific controls in consistent regions — **yes**
4. Headings / secondary nav hierarchy — **yes**
5. Existing actions / filters / search workflows retained — **yes**
6. Competing centered-grid toolbar system removed — **yes**
7. Visual verification on HR Admin pages via screenshots — **yes** (CA/Employee share components)
8. Build passes — **yes**
