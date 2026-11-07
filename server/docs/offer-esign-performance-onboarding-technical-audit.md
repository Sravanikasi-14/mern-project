# Technical Audit — Offer Resend, Deletion, E-Sign, Performance, Onboarding

**Status:** AUDIT ONLY — no code, schema, route, UI or config changes.  
**Date:** 2026-11-04  
**Scope:** Desktop web + Android Capacitor (mobile app).

---

## 1. Exact resend failure root cause

### Trace

| Step | Location | Behaviour |
|------|----------|-----------|
| Button | `OfferLettersManagement.jsx` — menu “Resend email” when `status===SENT` | `setConfirmModal({ type: "SEND_EMAIL", offer })` |
| Confirm | `handleExecuteStatusChange` | `POST /offer-letters/${offer._id}/send` (same as first send) |
| Mobile | `mobile/.../OffersPage.jsx` | Same `POST .../send` |
| API | `POST /api/offer-letters/:id/send` + `emailSendLimiter` | `sendOfferLetterEmail` |
| SMTP | Tenant `emailSettings` via `resolveCompanySmtpConfig` | Awaited Nodemailer |
| Token | Reuse unexpired encrypted token if present; else mint; commit hash only after SMTP accept | |
| PDF | Prefer GridFS issued PDF; else regenerate | |
| Client timeout | **axios `timeout: 30000`** (web + mobile) | |

Offer ID / recipient / company: correct — live logs show tenant + masked candidate + offerId.

### Live evidence (server logs, not assumptions)

Recent resends:

- SMTP `250 OK`, `durationMs` often **~5–13.4 s** (e.g. 12044, 12083, 13388).
- Controller reports `success: true` after SMTP accept.
- Not blocked by ACCEPTED/REJECTED when status is SENT.
- Not a wrong-ID / wrong-company bug in current traces.

### Exact user-facing failure cause (ranked)

**Primary (code + timing):**  
End-to-end send/resend frequently spends **11–13+ seconds in SMTP alone**. With PDF load/regen and DB work, total response time can approach or exceed the **hard 30s Axios timeout**. When the client aborts:

1. UI shows failure / network error.
2. Server may still finish and mark delivery `SENT`.
3. User concludes “resend failed” even though SMTP accepted (or retries and creates duplicate inbox messages).

**Secondary (product, not SMTP reject):**  
When the API returns 200, Gmail has accepted the message (`responseCode: 250`). Inbox non-delivery is then spam/filter/mailbox — outside the app. Do **not** treat that as “resend blocked by validation.”

**Not the cause in current logs:** missing recipient, wrong offer id, ACCEPTED block on SENT offers, or missing company SMTP (tenant configured; decrypt OK).

### Proposed minimal fix (for later approval)

1. Raise timeout only for `/offer-letters/:id/send` (e.g. 90–120s) on web + mobile.  
2. Keep await-SMTP; surface server `message` / `emailDelivery.error` clearly.  
3. Optional: progress copy “Sending may take up to a minute…”  
4. Do not change SMTP credentials/provider.

---

## 2. Offer deletion / withdrawal design

### Current

- `DELETE /offer-letters/:id` → **DRAFT only** (`deleteOfferLetter`).  
- UI Delete only for drafts (desktop + mobile).  
- No WITHDRAWN / VOID / ARCHIVE status.  
- SENT offers: can Mark rejected / Resend; cannot remove from active list without reject.  
- ACCEPTED: no delete; Onboard / review paths.

### Recommended safe matrix

| State | Allowed action | Effect |
|-------|----------------|--------|
| DRAFT | Hard delete | Keep as today |
| SENT, unsigned, no candidate user / no onboarding | **Withdraw** (soft) | Status → `WITHDRAWN` or `VOIDED`; invalidate signing token; hide from default list; retain row + audit |
| SENT, unsigned, candidate opened but not signed | Withdraw | Same + audit note |
| ACCEPTED / signed | **No hard delete** | Optional “Superseded” / archive flag only; keep issued PDF + signature immutable |
| REJECTED | Archive / hide | Soft; retain audit |
| Onboarding started (CANDIDATE + onboarding) | Withdraw offer only with HR confirm | Do not auto-delete User/onboarding; mark offer withdrawn; onboarding may be rejected separately |
| Employee already created | No withdraw-of-offer-as-delete | Employee lifecycle owns the record; offer stays linked |

### Principles

- Soft-withdraw SENT unsigned so HR can clear the active list.  
- Preserve audit + issued documents.  
- Never hard-delete signed employment PDFs.  
- Withdrawal ≠ approval bypass; does not create/delete employees.  
- Separate ops: **Withdraw** (pre-sign) vs **Void/Supersede** (post-sign, rare, legal).

### Suggested model/API (later)

- Status enum add: `WITHDRAWN` (and optionally `SUPERSEDED`).  
- `POST /offer-letters/:id/withdraw` with reason.  
- List default filter excludes WITHDRAWN; “Show withdrawn” toggle.  
- AuditLog on withdraw.

---

## 3. HR signature-before-send — design

### Current

- Candidate-only `OfferLetter.signature` (name, email, signedAt, ip, ua, documentHash, legalStatement).  
- Template already has **employer + candidate** blocks (`hrms-default-master.js` cover + execution).  
- Employer side today is **text placeholders** (`signatoryName` / `signatoryTitle`), not a captured HR signature image.  
- No saved HR signature store on Company/User.  
- Send is allowed for DRAFT without any employer signature gate.

### Proposed workflow

```text
Create/edit offer → Preview final version → HR signs (draw/upload/type)
  → Bind signature to document version hash → Enable Send
  → Send emails PDF that already shows employer signature
  → Candidate later adds candidate signature on accept
```

### Design points

| Concern | Proposal |
|---------|----------|
| Models | `Company.hrSignatureDefaults` and/or `User.savedSignatures[]` (encrypted/image GridFS + metadata). Per-offer: `employerSignature { method, imageFileId\|dataRef, typedName, signedAt, signerUserId, documentHash, ip, ua }` |
| Gate | `sendOfferLetterEmail` rejects if `employerSignature.signedAt` missing or `documentHash` ≠ current content/snapshot hash |
| Edit invalidation | Any content/salary/clause/template change clears `employerSignature` and disables Send until re-sign |
| Placement | Extend `buildMasterOfferHtml` / render context to inject employer signature image into existing employer sign blocks (layout structure stays; typography/signature asset only) |
| Methods | Draw (canvas), upload (PNG/SVG constrained), typed name fallback; “Use saved default” |
| Reuse | Saved default is a template for new signs; each offer stores its own bound signature + hash |
| Security | Store images in tenant GridFS; never log image blobs; authorize HR_ADMIN only |

Not certificate/Aadhaar eSign — intentional advanced electronic signature with audit fields.

---

## 4. Candidate handwritten e-signature — design

### Current

- Typed legal name + consent checkbox only (desktop `CandidateOfferReview.jsx`, mobile `OfferReviewPage.jsx`).  
- Accept records metadata + text name; HTML/PDF updated with typed name, not stroke image.  
- `documentHash` of content at sign time; issued content preserved on accept path.

### Proposed addition (desktop + Android)

1. Shared signature pad component (pointer events: mouse/touch/stylus).  
2. Preview / Clear / Redraw; optional typed fallback.  
3. Explicit consent remains mandatory.  
4. Persist signature image (GridFS or controlled data URL → GridFS) on offer.  
5. Re-render final HTML/PDF with visible candidate signature in existing candidate blocks.  
6. Keep: signer name, email, timestamp, IP (where collected), UA, document version/hash.  
7. Store immutable issued PDF after sign (already partially via GridFS issued PDF / issuedContent).  
8. Same UX in Capacitor WebView (touch) and desktop.

Label clearly as electronic signature, not Aadhaar/DSC.

---

## 5. Performance bottleneck measurements

### Offer list (matches ~6.19s “waiting” report)

Local probe against live Acme tenant DB (**9 offers**):

| Query | Time | Notes |
|-------|------|-------|
| Current `find` **without** `.select()` + populate + sort/limit 10 | **~9782 ms** | Loads full docs |
| Same with projection excluding content/issuedContent/clauses/snapshot | **~90 ms** | |
| Summary `$group` by status | **~100 ms** | Fine |
| Explain sort/limit | index used; `executionTimeMillis: 0` at engine | Bottleneck is **payload weight**, not missing index |

Heavy fields loaded today then discarded in DTO:

- Several SENT/ACCEPTED docs have **`content` ≈ 948 KB** each (likely embedded logo data-URLs).  
- One ACCEPTED also has **`issuedContent` ≈ 948 KB**.  
- **~4.9 MB** heavy field bytes for 10-doc page; sample full JSON ≈ **978 KB/doc**.

Indexes for list/sort/status/email exist (`createdAt_-1`, `status_1_createdAt_-1`, etc.).

### Frontend load pattern

Desktop `OfferLettersManagement` (no React Query):

- Mount: summary + **templates** + list (templates even on Offers tab).  
- Mobile `OffersPage`: parallel list + summary + clauses + recipients + templates.

### Save & Send (architecture + live SMTP timings)

| Stage | Observed / expected |
|-------|---------------------|
| Validation + load | Low |
| HTML render if missing | Medium |
| PDF (Puppeteer) cold | High (seconds) |
| GridFS read/write | Low–medium |
| **SMTP** | **Live: ~5–13.4 s** per accept |
| DB update | Low |
| Client Axios timeout | **30 s** — conflict risk |

Do **not** strip required business fields from list DTO beyond excluding unused HTML/PDF bodies; projection is the correct fix.

---

## 6. Onboarding improvements + diagram

Builds on `offer-onboarding-activation-phase1-audit.md`.

```text
[Proposed]
HR create → HR sign → Send
  → Candidate review/sign (handwritten + consent)  [same portal]
  → Onboarding forms/docs in same portal session     [use accept’s onboardingToken; email backup]
  → Submit → HR /admin/onboarding review
  → Corrections / reject / approve (idempotent)
  → Employee + activation email → /activate → employee portal

[Remove bypass]
Offer Letters "Onboard" must NOT open Employees Add modal
```

### Improvements (reuse, don’t replace)

1. Retarget Onboard → `/admin/onboarding?offerId=`.  
2. Deep-link filter in `AdminOnboardingReview`.  
3. Post-sign auto-navigate with `onboardingToken` (desktop + mobile).  
4. Fix activation resend ID (Employee vs submission User id).  
5. Keep existing onboarding page/APIs/approval lock.

---

## 7. Existing files to reuse

| Area | Reuse |
|------|--------|
| Send/resend | `offerLetterController.sendOfferLetterEmail`, `emailService` |
| List | `getOfferLetters` / `getOfferSummary` — add `.select()` |
| Template dual sign blocks | `hrms-default-master.js`, `offerTemplateRenderService` |
| Candidate sign API | `acceptAndSignOffer` — extend payload |
| Issued PDF | GridFS `storeIssuedPdfIfNeeded` / `getIssuedPdfDownload` |
| Onboarding | `CandidateOnboardingPage`, `candidateOnboardingController`, `AdminOnboardingReview`, `approveOnboardingAndCreateEmployee` |
| Mobile | `OffersPage.jsx`, `OfferReviewPage.jsx` |

---

## 8. Likely new files / models / APIs (after approval)

| New | Purpose |
|-----|---------|
| `HrSignaturePad` / shared canvas component | Desktop + mobile |
| Company/User saved signature fields or small collection | Default HR signature |
| `OfferLetter.employerSignature` (+ candidate image refs) | Bound signatures |
| `POST /offer-letters/:id/employer-sign` | Capture HR sign + hash |
| `POST /offer-letters/:id/withdraw` | Soft withdraw SENT |
| Status `WITHDRAWN` | List filtering |
| Optional `GET /offer-letters` field projection already via select | No new endpoint required |

---

## 9. Migration & backward compatibility

| Risk | Mitigation |
|------|------------|
| Legacy SENT without employer signature | Grandfather: allow send until feature flag; or require sign only for new sends |
| Huge HTML `content` with embedded logos | Projection on list; separate task to stop embedding logos in stored HTML |
| Legacy SENT without `signingTokenEncrypted` | Already handled: mint on successful resend; failed resend keeps hash |
| WITHDRAWN status | Additive enum; old clients ignore |
| Candidate image signatures | Old typed-only signatures remain valid |
| Employees created via Onboard bypass | Inventory; don’t auto-delete |

---

## 10. Implementation phases (dependency order)

1. **P0 Perf:** `getOfferLetters` `.select()` exclude content/issuedContent/clauses/snapshot; defer templates fetch; optional React Query later.  
2. **P0 Resend UX:** Per-request timeout for send; clearer errors; keep token safety.  
3. **P1 Withdraw:** Soft-withdraw SENT unsigned + audit; list filters.  
4. **P1 Onboard CTA + portal continuity + activation resend id.**  
5. **P2 HR sign-before-send** (models, gate, template inject, saved default).  
6. **P2 Candidate handwritten pad** shared component + PDF bind.  
7. **P3** Logo-in-content cleanup / issued PDF size hygiene (separate from list projection).

---

## 11. Test plan

### Automated

- List response time / no content field in JSON.  
- Resend success under mock slow SMTP; client long timeout path.  
- Failed resend preserves token.  
- Withdraw SENT; reject delete on ACCEPTED.  
- Send blocked without employer signature (when feature on).  
- Edit offer clears employer signature.  
- Candidate accept with image + typed fallback; hash mismatch rejected.  
- Approve idempotent; resend activation no duplicate employee.  
- Onboard navigation target.

### Manual

- Desktop + Android Capacitor: resend with real SMTP; verify Sent folder + inbox.  
- List load Network waterfalls before/after projection.  
- Draw signature finger/stylus on Android.  
- Withdraw appears removed from default list, retained in audit.  
- Full path: HR sign → send → candidate draw-sign → onboard → approve → activate.

---

## Cross-platform matrix

| Change | Desktop web | Android Capacitor | Shared backend |
|--------|-------------|-------------------|----------------|
| List projection / send timeout | client api | mobile api | `getOfferLetters`, send |
| Withdraw UI | OfferLettersManagement | OffersPage | withdraw API |
| HR signature pad | new shared or web component | mobile webview component | employer-sign API + GridFS |
| Candidate pad | CandidateOfferReview | OfferReviewPage | accept payload + PDF |
| Onboarding CTA / continuity | both portals | OfferReviewPage gap today | accept response already has link |
| Template signature placement | — | — | `hrms-default-master` / render |

---

## Summary verdicts

1. **Resend:** SMTP is accepting; primary app bug is **client 30s timeout vs slow send path (SMTP often 11–13s)** causing false UI failures; secondary is inbox/spam after 250.  
2. **List slowness (~6s):** **`getOfferLetters` loads multi‑MB HTML content without projection** (~9.8s measured vs ~90ms with select).  
3. **Delete:** drafts only; need soft **withdraw** for SENT unsigned.  
4. **HR/candidate e-sign:** template blocks exist; capture/bind/gate missing — design above.  
5. **Onboarding:** stack exists; fix bypass + same-portal handoff + resend-activation id.
