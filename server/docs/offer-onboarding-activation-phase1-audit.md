# Phase 1 Audit — Offer → Onboarding → Approval → Activation

**Status:** read-only audit — no code changes.  
**Date:** 2026-11-04

Intended business path: offer send → candidate portal sign → same-portal onboarding → HR review → approve → employee + activation email → password → employee portal.

---

## 1. Current end-to-end workflow

```text
HR: Create/send offer
        │
        ▼
Candidate: /offers/review/:signingToken
        │  acceptAndSignOffer
        ├─ OfferLetter → ACCEPTED + signature
        ├─ User(role=CANDIDATE, isActive=false) + onboarding DRAFT
        ├─ NEW onboarding JWT + email invite (separate link)
        └─ API returns onboardingLink (UI shows CTA if present)
        │
        ▼
Candidate: /candidate/onboarding/:onboardingToken   ← separate token/route
        │  draft / documents / submit → SUBMITTED
        ▼
HR: /admin/onboarding  (sidebar)  OR  broken path below
        │  approve → Employee + User role EMPLOYEE + AuthToken invite
        │  (isActive still false until password set)
        ▼
Candidate: /activate?token=… → set password → employee portal

LEGACY BYPASS (Offer Letters "Onboard" button):
  /admin?onboardOfferId=<offerId>
        → AdminHome opens Add Employee modal (skips portal review)
```

Signing does **not** create an `Employee` record. Employee creation is in `approveOnboardingAndCreateEmployee`.

---

## 2. Existing files / APIs / models

### Frontend

| File | Role |
|------|------|
| `client/src/pages/OfferLettersManagement.jsx` | Offer CRUD/send; **Onboard** → `/admin?onboardOfferId=` |
| `client/src/pages/AdminHome.jsx` | Employees; `onboardOfferId` opens Add Employee |
| `client/src/pages/CandidateOfferReview.jsx` | `/offers/review/:token` sign/decline; CTA to onboardingLink |
| `client/src/pages/CandidateOnboardingPage.jsx` | `/candidate/onboarding/:token` draft/docs/submit |
| `client/src/pages/AdminOnboardingReview.jsx` | `/admin/onboarding` review/approve/reject/corrections/resend |
| `client/src/App.jsx` | Routes wired for all of the above |

### Backend routes / controllers

| Mount | Controller | Responsibility |
|-------|------------|----------------|
| `/api/candidate/offers` | `candidateOfferController` | Review, accept/sign, decline, PDF |
| `/api/candidate/onboarding` | `candidateOnboardingController` | Get, draft, documents, submit |
| `/api/onboarding` | `onboardingReviewController` | List/detail, corrections, approve, reject, resend activation |
| `/api/offer-letters` | `offerLetterController` | HR offer lifecycle / send email |

### Models (tenant DB)

| Model | Role |
|-------|------|
| `OfferLetter` | Offer + signature + `candidateUserId` / `employeeId` |
| `User` | CANDIDATE→EMPLOYEE; embedded `onboarding` subdoc |
| `Employee` | Created on approval only |
| `EmployeeCompensation` | Created on approval |
| `AuthToken` | Activation / invitation tokens (hashed) |

### Key functions

- `acceptAndSignOffer` — CANDIDATE + onboarding DRAFT; **no Employee**
- `submitOnboarding` — DRAFT/CHANGES_REQUESTED → SUBMITTED
- `approveOnboardingAndCreateEmployee` — atomic lock SUBMITTED→PROCESSING_APPROVAL; creates Employee; activation email
- `resendEmployeeActivationEmail` — invalidate old AuthTokens; new invite; no new Employee

---

## 3. Exact reason Onboard → Employees

In `OfferLettersManagement.jsx`, for `ACCEPTED && !employeeId`:

```js
navigate(`/admin?onboardOfferId=${offer._id}`)
```

`/admin` is **AdminHome** (People/Employees). Its `useEffect` on `onboardOfferId` loads the offer and opens the **Add Employee** modal prefilled with offer fields (`offerLetterId` set).

The intended HR surface already exists: **`/admin/onboarding`** (`AdminOnboardingReview`). It is in the sidebar/nav but **not** linked from the Offer Letters Onboard button. `AdminOnboardingReview` also has **no `offerId` query-param deep-link** today.

This is a legacy “create employee from offer” shortcut, not the candidate-portal → HR-approval pipeline.

---

## 4. Gaps vs intended workflow

| Intended step | Current | Gap |
|---------------|---------|-----|
| 1–2 Offer create/send + email | Working | — |
| 3 Sign in candidate portal | Working | — |
| 4 Onboarding in **same** portal automatically | Separate `/candidate/onboarding/:token`; email invite; CTA only after fresh sign (`signSuccess.onboardingLink`) | Not same continuous portal/session; revisiting offer page without `signSuccess` only says “check inbox” |
| 5 Complete onboarding + docs | `CandidateOnboardingPage` + APIs exist | UX continuity / token handoff |
| 6–7 HR review approve/reject/corrections | `/admin/onboarding` + APIs exist | Offer Letters **Onboard** bypasses this |
| 8 Employee only after approval | True for approval path | Manual Add Employee from Onboard can create employee **without** submitted onboarding |
| 9 Activation email + password | On approve + `/activate` | Resend route ID mismatch risk (below) |
| 10 Employee portal | After activation | — |
| No separate registration | Mostly token-based | Still sends separate onboarding invite email (extra step vs “same portal”) |
| Idempotent approval | Atomic lock + 409 if already approved | Strong for approval path |
| Resend activation w/o duplicate employee | Intended | See risk on `:id` meaning |

**Already good:** signing ≠ employee; portal pages exist; approval creates employee; tenant DB-per-company.

---

## 5. Risks to existing data

| Risk | Detail |
|------|--------|
| Manual Onboard bypass | Employees created without `User.onboarding` SUBMITTED/APPROVED trail; documents never collected |
| Dual paths | Same ACCEPTED offer could be “onboarded” via Add Employee while a CANDIDATE onboarding also exists → email/employee conflicts |
| Resend activation ID | Route `POST /submissions/:id/resend-activation` but handler does `Employee.findById(id)`. UI may pass **submission (User) id** → 404 or wrong record. Verify before changing. |
| Onboarding email fail on sign | Caught and logged; candidate may only get CTA if UI still holds `signSuccess` |
| Legacy ACCEPTED offers | May lack `candidateUserId` / onboarding if marked accepted without portal sign |
| Existing employees | Approval checks email/`employeeId`; manual create has weaker guarantees than approval lock |

---

## 6. Recommended implementation phases (dependency order)

**Phase A — Wire HR path (smallest, unblocks product)**  
1. Change Offer Letters Onboard → `/admin/onboarding?offerId=` (or `candidateUserId`).  
2. Teach `AdminOnboardingReview` to filter/select that submission.  
3. Stop using `/admin?onboardOfferId=` for this button (keep Add Employee for non-offer hires).  
4. Clear empty/missing-submission messaging for unsigned/legacy offers.

**Phase B — Same candidate portal continuity**  
1. After sign, navigate/open onboarding in-portal using returned `onboardingToken` (not email-only).  
2. Optionally allow offer-review page to resume onboarding when already signed (derive/reissue token carefully).  
3. Keep email invite as backup; do not require separate registration.

**Phase C — Approval / activation hardening**  
1. Confirm/fix resend-activation ID (User vs Employee).  
2. Surface `activationEmailSent` / resend UX.  
3. Regression: no employee on sign; no duplicate on double-approve; resend does not clone Employee.

**Phase D — Data cleanup (only if needed)**  
1. Inventory ACCEPTED offers without `candidateUserId`.  
2. Inventory employees linked via `offerLetterId` without onboarding APPROVED.  
3. Migration scripts only after product decisions — not required to start A–C.

Do **not** redesign offer templates, SMTP provider, or employee directory wholesale in these phases.

---

## 7. Focused test plan

| Area | Tests |
|------|--------|
| Sign | Accept creates CANDIDATE + DRAFT onboarding; **zero** Employee rows |
| Portal | Accept response includes `onboardingLink`; onboarding GET/draft/submit with that token |
| Corrections | CHANGES_REQUESTED → resubmit → SUBMITTED |
| Approve | Creates one Employee + compensation; User→EMPLOYEE; offer.`employeeId` set; second approve → 409 |
| Reject | No employee; token invalidated as designed |
| Activation | Approve sends invite; resend rotates AuthToken, same employee; already-active blocked |
| Onboard CTA | Navigates to onboarding review for offer’s candidate; does **not** open Add Employee |
| Tenancy | Company A cannot approve/list Company B submissions |
| Legacy | ACCEPTED without candidate user → clear HR message, no crash |

---

## Audit notes (corrections vs earlier assumptions)

- Candidate onboarding **UI exists** (`CandidateOnboardingPage.jsx`); it is not missing.
- Approval path **has** idempotency locks; the weak path is the Employees Add-modal bypass.
- Primary product break for HR is the **Onboard button target**, not absence of onboarding stack.
