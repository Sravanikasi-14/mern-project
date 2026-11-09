# HRMS Landing — Stitch Design Approval Pack

**Date:** 2026-11-09  
**Mode:** Design-first only (no React / backend implementation in this phase)  
**Product identity:** HRMS

---

## 1. Google Stitch project

| Item | Value |
|------|--------|
| Project title | **HRMS Landing — Editorial Premium Design** |
| Project id | `13035443890716715628` |
| Project link | https://stitch.withgoogle.com/project/13035443890716715628 |
| Design system | `assets/11364064890826093327` — HRMS Editorial Premium |
| Primary | Forest green `#1B4332` |
| Secondary / accent | Sage `#52796F`, restrained lime `#A3B18A` |
| Backgrounds | Cream `#F7F4EF` / charcoal `#141816` |
| Typography | Plus Jakarta Sans (+ Public Sans labels in Stitch tokens) |

---

## 2. Desktop designs

| Screen | Title | Screen id | Role |
|--------|--------|-----------|------|
| 1 (refined) | **HRMS · Refined Hero** | `30cf0d47495540aa87f73ed81570a292` | Nav + exceptional layered hero |
| 2 | **HRMS · Value Pillars & Product Showcase** | `92e07293b20e4adc976ea31a6c5383be` | Trust/value + lifecycle showcase |
| 3 | **HRMS · Feature Storytelling** | `2cc7a2e9ff674b7bba3cac60ca9fa80a` | Three varied feature bands |
| 4 | **HRMS · Workflow, Roles & Closing** | `c7c68e1bfcb049efb612535f22bc4ca7` | How it works, roles, CTA, footer |
| Prior draft | HRMS · Hero & Navigation | `edca35ad79de4b7e8cd1a8c2ba093f90` | Superseded by refined hero |

**Desktop preview assets (local):**

- `docs/stitch-editorial-hero.png` (initial hero)
- `docs/stitch-editorial-hero-refined.png` (approved refinement)

Open each screen inside the Stitch project link above for interactive preview / HTML.

---

## 3. Mobile design

| Screen | Title | Screen id |
|--------|--------|-----------|
| Mobile full page | **HRMS · Mobile Landing Page** | `1fb1bdd40ca44184a38e19cda7374a1b` |

**Mobile preview asset:** `docs/stitch-editorial-mobile.png`

Intentional mobile structure (not a shrunk desktop): sticky compact nav, stacked hero CTAs, vertical value pillars, charcoal lifecycle stepper, three feature bands, vertical how-it-works, role panels, forest CTA, charcoal footer.

---

## 4. Sections covered

1. Navigation — Product · Features · How it works · Login · Get started  
2. Hero — editorial headline + layered realistic dashboard + floating operational chips  
3. Trust / value — editorial pillars (not identical feature-card grids)  
4. Product showcase — dark lifecycle workspace with Hire→Grow  
5. Feature storytelling — three visually distinct bands covering all major HRMS modules without ten clone cards  
6. How HRMS works — connected three-step flow  
7. Roles — Company Admin / HR Admin / Employee with distinct panels  
8. Final CTA — forest green conversion  
9. Footer — HRMS + verified-style nav links + © 2026 HRMS (no invented contact/social)

---

## 5. Proposed animations / interactions (for later implementation)

| Area | Proposal |
|------|----------|
| Hero | Floating chips via CSS transform; layered mock parallax on scroll |
| Sections | Scroll-triggered opacity/translate reveals; stagger within bands |
| Product showcase | Subtle stepper/progress line draw or fade-in |
| CTAs / nav | Soft hover lift; sticky nav elevation |
| Role panels | Light hover elevation; optional panel focus swap |
| Accessibility | Honor `prefers-reduced-motion` |

No new animation libraries recommended for v1 — CSS + IntersectionObserver.

---

## 6. Quality review notes

**Strengths**

- Hero is product-forward and layered (not a flat left-copy / small-screenshot template).  
- Layout variation across value, showcase, and feature bands.  
- Role panels are visually differentiated.  
- Mobile is a full intentional long-scroll composition.  
- Brand name remains **HRMS**.

**Refinements already applied**

- Removed fabricated hero marketing metrics (`99.98%`, “Zero sync delay”).  
- Nav normalized to Product / Features / How it works / Login / Get started.  
- Replaced invented “CORE RELEASE · 3.4” badge with “Human Resource Management System”.

**Remaining Stitch limitations / watch-outs for approval**

- Mock UI still may show sample operational labels (employee names, leave days, mock payroll figures) inside interface previews — treat as illustrative UI content, not marketing claims; strip vanity claims during React implementation.  
- Some desktop screens were generated as section groups (not one infinite canvas) because long single-page generates often time out in Stitch MCP. Visual language is shared via the design system.  
- Closing screens may still show occasional Stitch-invented nav labels in drafts; refined hero is the source of truth for nav wording.  
- Previous React landing work from an earlier session still exists on disk but was **not modified in this design-only phase**.

---

## 7. Confirmation — no implementation this phase

| Area | Modified in this design-first task? |
|------|--------------------------------------|
| React landing components / CSS | **No** |
| Routing / login / registration | **No** |
| Backend / APIs / schemas / auth | **No** |
| Internal HRMS modules | **No** |
| Deployment | **No** |
| Stitch project + local preview PNGs under `docs/` | **Yes** |

---

## 8. Ask for approval

Please review the Stitch project and confirm whether to proceed to React implementation of this editorial design (replacing the current landing visuals while preserving `/login` CTAs and existing app behavior).
