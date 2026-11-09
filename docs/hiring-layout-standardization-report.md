# Hiring & Onboarding — Layout Standardization Report

**Date:** 2026-11-09  
**Scope:** `D:\HRMS\mern-project\client` only (Hiring page chrome)  
**Dev URL:** `http://127.0.0.1:5174/admin/hiring`

## Files changed

- `client/src/pages/HiringOnboardingPage.jsx`
- `client/src/pages/HiringOnboarding.css`

No shared component APIs, other pages, backend routes, schemas, or hiring workflows were modified.

## Shared components reused

| Row | Component | Usage |
|-----|-----------|--------|
| 1 | `AppHeader` | Sticky global bar (GlobalSearch, notifications, profile, logout) + live status in `actions` |
| 2 | `PageIdentity` (via AppHeader) | Title, subtitle, stage filter chips in `nav` |
| 3 | `ModuleToolbar` + `ModuleSearch` | Local candidate search + primary `+ New offer` action |
| — | Shared `dept-chip` / `dept-chip-row` | Stage/status filters with counts (Employees pattern) |
| — | Shared `btn-primary` | New offer control (replaces isolated `hw-btn-primary` under title) |

## Old layout elements removed or repositioned

| Before | After |
|--------|--------|
| Full-width `hw-counters` summary bar | Removed as competing chrome; counts remain on stage chips |
| Standalone `hw-chips` row between title and search | Moved into `PageIdentity` `nav` as `dept-chip-row` |
| `+ New offer` isolated in AppHeader `nav` | Moved to `ModuleToolbar` `actions` |
| Module search alone under chips | Kept as the sole page-local search inside `ModuleToolbar` |

Preserved below the toolbar: candidate table, offer/onboarding/stage badges, updated date, row actions, pagination, URL stage params, compose/modal flows.

## Workflow confirmation

Verified in browser on `127.0.0.1:5174`:

- Stage chip filter updates URL (`?stage=OFFERS`) and table rows (2 offer candidates)
- Module search control present once (no duplicate local search)
- Global search remains only in AppHeader
- Candidate row actions still rendered (View / Send offer / Resend)
- Pagination intact
- No API, route, schema, offer/onboarding/signature, or permission changes

## Build results

```
npm run build  (D:\HRMS\mern-project\client)
✓ built successfully
```

## Browser verification

Compared against Attendance at the same viewport:

| Metric | Attendance | Hiring (after) |
|--------|------------|----------------|
| ModuleToolbar height | 40px | 40px |
| Gap identity → toolbar | 14px | 14px |
| Hierarchy | AppHeader → PageIdentity → ModuleToolbar → workspace | Same |

Also confirmed: no `hw-counters`, no legacy `hw-chips`, New offer in toolbar, 8 stage chips with counts in identity nav.

## Screenshot

`docs/screenshots/hiring-onboarding-layout-standardized.png`
