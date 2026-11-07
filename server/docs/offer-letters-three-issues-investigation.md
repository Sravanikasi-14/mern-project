# Offer Letters — four-issue root-cause investigation

**Status:** investigation only — no code changes.  
**Date:** 2026-11-04 (updated with issue 4)  
**Constraints preserved:** DB-per-company, GridFS, template versions, issued-document immutability, default template layout unchanged.

---

## 1. Duplicate candidate error during electronic signing

### Exact root cause

On accept/sign, the server looks up a `User` with the offer’s candidate email. If that user is role `CANDIDATE` and already has `onboarding.offerLetterId` pointing at a **different** offer, accept returns **409** with:

> “This candidate account is already linked to another offer letter in this company.”

**HR create/send never checks this.** Multiple SENT offers for the same email are allowed. The candidate only fails at signing the second offer — after HR already emailed them.

### Relevant files / functions / APIs

| Layer | Location |
|-------|----------|
| Validation | `server/controllers/candidateOfferController.js` — accept handler (~lines 199–220) |
| Proven intent | `server/tests/candidate_onboarding_hardening.test.js` — “Rejects overwriting an active candidate onboarding with a different offer” |
| Create/send gap | `server/controllers/offerLetterController.js` — `createOfferLetter`, `sendOfferLetterEmail` — **no** lookup of existing CANDIDATE/`onboarding.offerLetterId` or open offers by email |
| Index available | `OfferLetter` has `{ "candidate.email": 1 }` |

Trigger relationship:

```text
User(email=E, role=CANDIDATE, onboarding.offerLetterId=OfferA)
  + Candidate signs OfferB (same email E)
  → 409
```

OfferA may be ACCEPTED (or in progress). OfferB was still sendable.

### Current vs expected workflow

| Step | Current | Expected |
|------|---------|----------|
| Create offer (same email as prior active/signed offer) | Allowed silently | Warn / block with clear conflict details |
| Send offer | Allowed silently | Re-check before send; warn HR |
| Candidate sign | 409 late | Should not reach candidate if unresolved |
| Multiple offers same email | De facto allowed until sign | Intentionally **not** for concurrent onboarding — protection exists only at accept |

**Intentional design:** Duplicate protection at accept is deliberate (test covers it). Gap is **when** it fires (too late) and lack of HR visibility.

### Proposed minimal fixes

1. Shared helper `findCandidateOfferConflicts(email, excludeOfferId)`:
   - Existing `User` CANDIDATE with `onboarding.offerLetterId` ≠ this offer (and not terminal abandoned if you define that)
   - Optional: other non-terminal offers (`DRAFT`/`SENT`/`ACCEPTED`) with same email
2. Call from `createOfferLetter` and `sendOfferLetterEmail` → **409** with structured payload (`conflictType`, `existingOfferId`, `status`, `candidateUserId`) — keep accept check.
3. Desktop/mobile: on create/send error, show warning + link to inspect existing offer / onboarding review (`/admin/onboarding` or offer detail). Do not auto-unlink.
4. Optional HR action later: “supersede” flow that archives prior offer and rebinds onboarding — **out of minimal fix** unless required.

### Regression risks / tests

- Keep hardening test that second accept still 409.
- Add: create/send with same email as signed candidate → 409 before mail.
- Add: resend same offer (same `offerLetterId` on user) still allowed.
- Rejected/withdrawn prior offers: define whether email can be reused (recommend allow if prior ACCEPTED+employee exists → different error; if prior REJECTED → allow).

---

## 2. Onboard button redirects to Employees

### Exact root cause

Accepted-offer **Onboard** navigates to:

```js
navigate(`/admin?onboardOfferId=${offer._id}`)
```

`/admin` is **`AdminHome`** (People / Employees directory), not Onboarding Review.

`AdminHome` reads `onboardOfferId`, loads the offer, and opens the **Add Employee** modal prefilled with offer fields (`offerLetterId` set). That is the **legacy “create employee from offer”** path — not the candidate-portal onboarding → HR review → approve → employee activation pipeline.

### Relevant files / functions / APIs

| Layer | Location |
|-------|----------|
| Button | `client/src/pages/OfferLettersManagement.jsx` ~1051–1058 |
| Route | `client/src/App.jsx` — `/admin` → `AdminHome`; `/admin/onboarding` → `AdminOnboardingReview` |
| Legacy handler | `client/src/pages/AdminHome.jsx` — `useEffect` on `onboardOfferId` (~148–192) → `setShowAddModal(true)` |
| Correct product surface | `AdminOnboardingReview.jsx` — `GET /api/onboarding/submissions`, approve/reject |
| Server lifecycle | Sign creates `User` CANDIDATE + onboarding (`candidateOfferController`); approve creates employee (`onboardingReviewController`) |

Same `OfferLettersManagement` UI is used on mobile viewport; Onboard uses the same Employees deep-link.

### Current vs expected workflow

| Current | Expected |
|---------|----------|
| Onboard → Employees page + Add Employee modal | Onboard → candidate onboarding **review** for that offer/candidate |
| Signing creates CANDIDATE + onboarding only (good) | Unchanged — no employee at sign |
| HR can skip portal review via Add Employee modal | HR reviews submission, then `POST .../approve` → employee |

### Proposed minimal fixes

1. Change Onboard navigation to `/admin/onboarding` with a query the review page understands (e.g. `?offerId=` or `?candidateUserId=` / email search). Prefer `offer.candidateUserId` if list API exposes it (add to list DTO).
2. In `AdminOnboardingReview`, on mount: if query present, select/filter that submission.
3. Stop using `/admin?onboardOfferId=` for this button (leave AdminHome handler for backward compat or deprecate).
4. Do **not** remove Add Employee workflow for non-offer hires.

### Regression risks / tests

- Accepted + unlinked offer Onboard opens onboarding review, not Add Employee.
- Offers without `candidateUserId` (legacy mark-accepted without sign) → clear message: “Candidate has not signed via portal.”
- Employee create-from-offer via People remains available if still needed for edge cases (document separately).

---

## 3. Offer sending and data retrieval are slow

### Measurements (architecture-derived; live timings need profiling in your env)

No production APM in repo. From code path analysis:

#### Send: `POST /api/offer-letters/:id/send` (sequential, blocking)

| Step | Code | Typical impact |
|------|------|----------------|
| Load offer + optional template | Mongo | Low (ms–tens ms) |
| **PDF generation** | `generateOfferLetterPdf` / Puppeteer or GridFS fill+convert | **High** — often **1–8+ s** cold Chromium; pure-JS fallback faster but poor fidelity |
| **GridFS upload** of issued PDF | `storeIssuedPdfIfNeeded` | Low–medium (tens–hundreds ms for ~100–250 KB) |
| Policy read for validity days | `getActiveCompanyHrPolicy` | Low |
| **SMTP `await emailService.sendOfferLetter`** | Nodemailer, attachment in-process | **High** — often **0.5–5+ s** depending on Gmail/SMTP |
| Save offer + audit | Mongo | Low |

**API response waits for entire chain** including SMTP. Failure reporting is accurate because of that await — trade-off vs speed.

Resend of already-issued PDF: skips Puppeteer if `generatedPdf.fileId` exists, still loads PDF into memory for attach + SMTP.

#### List / workspace load

**Desktop** `OfferLettersManagement.jsx` (no React Query):

| Call | When |
|------|------|
| `GET /offer-letters/summary` | Mount |
| `GET /offer-letters?…` | Mount + filter/page/search |
| `GET /offer-templates` | Mount **always** (even Offers tab) |
| Recipients | Open create modal |
| Preview debounce | Editor open — `POST /offer-letters/preview` |

**Client surface:** Desktop and mobile share `OfferLettersManagement.jsx` at `/admin/offers` (no separate mobile Offers page). On mount it always fires summary + templates + list (templates even when Offers tab is active). Recipients load when opening create. No React Query.

**List API** (`getOfferLetters`): JSON response omits `content` and PDF bytes — good for the wire to the browser. **However**, `OfferLetter.find(query)` has **no `.select()`**, so Mongo still loads full documents (including large HTML `content` / `issuedContent`) into Node before the DTO map strips them — unnecessary DB/memory cost on every list page. Populate employee + createdBy. Indexes on status/createdAt/email exist. List DTO also omits `candidateUserId` / onboarding id (needed for Onboard deep-link).

**Templates list**: runs `ensureCompanyDefaultTemplate` every request (extra Mongo writes/reads when missing; usually cheap when already provisioned). Returns metadata only (no GridFS bodies) — good.

**Not** downloading PDFs on list — confirmed.

### Bottlenecks summary

1. Send latency dominated by **Puppeteer PDF** (first issue) + **synchronous SMTP**.  
2. Frontend: **extra `/offer-templates` on offers page mount**; mobile always loads clauses/recipients/templates.  
3. No React Query caching on desktop offers → refetch on navigation.  
4. Live preview debounce still hits server HTML render repeatedly while editing.

### Proposed minimal fixes (performance)

**Send (preserve delivery accuracy):**

1. Prefer reuse of stored issued PDF (already partially done).  
2. Keep SMTP awaited for Phase 1 reliability **or** optional later: mark `emailDelivery: QUEUED`, respond 202, background send — needs durable queue (Redis) = new infra → **defer** under your no-new-infra rule; alternative: `setImmediate`/fire-and-forget weak on Vercel.  
3. Safer free wins: parallelize independent reads (policy + template); avoid regenerating HTML when content present; ensure Chromium warm / memory on Vercel.  
4. Don’t GridFS-read then re-upload on resend.

**List / UI:**

1. In `getOfferLetters`, `.select()` fields needed for the DTO (exclude `content`, `issuedContent`, signature blobs, token hashes).  
2. Load `/offer-templates` only when Templates workspace opens (or when opening create with template picker).  
3. Introduce React Query (or SWR) for list+summary with sensible `staleTime` — optional but high value; invalidate on send/create.  
4. Add `candidateUserId` to list DTO for Onboard deep-link without extra GET.  
5. Keep summary + list parallel on mount; do not fetch PDF/`GET :id` for list rows.

### Regression risks / tests

- Send still returns delivery success/failure correctly if SMTP stays awaited.  
- List payload must not grow to include `content`.  
- Template workspace still loads templates when opened.  
- Timing test or log spans optional for CI.

---

## 4. Resend Email is not delivering emails

### Exact root cause (primary)

There is **no separate resend endpoint**. “Resend email” calls the same `POST /api/offer-letters/:id/send` as first send.

Before SMTP runs, `sendOfferLetterEmail` **always mints a new signing JWT**, overwrites `signingTokenHash` / `signingTokenExpiresAt`, and only **then** calls `emailService.sendOfferLetter`. On SMTP failure the controller still **`save()`s that new hash** while returning **502** — so a failed resend of an already-SENT offer:

1. Does **not** deliver a new email to the candidate.
2. **Invalidates** the previously emailed review/sign link (`signingTokenHash` mismatch → accept/reject reject the old token).
3. Leaves status `SENT` but `emailDelivery.status = DELIVERY_FAILED`.
4. Leaves the only valid token **in the DB**, never emailed.

That matches “Resend does not result in the candidate receiving [a usable] email” and can strand candidates after a flaky SMTP attempt.

Secondary contributors (delivery / UX, not separate code paths):

| Factor | Effect |
|--------|--------|
| Expected: reuse valid token unless expired/revoked | **Not implemented** — every send/resend rotates token |
| `CLIENT_URL` / `APP_BASE_URL` unset | Review URL falls back to API `host` → mail may “send” but link is wrong |
| Axios `timeout: 30000` on client | Long PDF+SMTP can abort UI with network error while server may still finish (or fail after token rotate) |
| No dedicated “resend already SENT” automated test | Gap; only first-send + retry-from-DRAFT-after-fail covered |
| Rate limits | `emailSendLimiter` 10/min HTTP + in-process 20/min — unlikely for one click; would return 429 with clear message |

SMTP itself is tenant-scoped correctly when company `emailSettings` are set (`resolveCompanySmtpConfig` — **no env fallback** for company sends). API does **not** report HTTP 200 on SMTP failure (returns 502). Nodemailer “success” means SMTP **accepted** the message, not inbox placement.

### Point-by-point flow answers

1. **Frontend handler:** Menu “Resend email” (SENT only) → `setConfirmModal({ type: "SEND_EMAIL", offer })` → confirm → `handleExecuteStatusChange` → `api.post(\`/offer-letters/${offer._id}/send\`)`. Same path as draft “Send”. Files: `OfferLettersManagement.jsx` ~1120–1131, ~737–740, ~2007.
2. **Backend:** `offerLetterRoutes.js` `POST /:id/send` + `emailSendLimiter` → `sendOfferLetterEmail` → `emailService.sendOfferLetter` → `sendMail` with `company: req.auth.company`.
3. **PDF:** Prefers existing issued GridFS PDF (`getIssuedPdfDownload`); regenerates only if missing. Issued document not duplicated on resend when `generatedPdf.fileId` present. **No new OfferLetter / employee created.**
4. **Recipient:** `offerLetter.candidate.email` (trimmed); normalized again in `sendOfferLetter`. Correct unless the stored offer email is wrong.
5. **Tenant SMTP:** Loaded from `req.auth.company.emailSettings` via `authenticate` → `findCompanyById` (full doc including `appPasswordEncrypted`). Missing config → soft fail `{ success: false, code: COMPANY_EMAIL_NOT_CONFIGURED }` → controller 502. Platform env SMTP is **not** used when `company` is passed.
6. **Auth/delivery failures:** Caught in `sendMail` catch → `success: false` + sanitized error; recorded on offer.
7. **False success:** HTTP 200 only after `emailResult.success`. UI sets success toast from 200 body. **Does not** treat 502 as success. Caveat: SMTP accept ≠ guaranteed inbox.
8. **emailDelivery:** On fail: `status=DELIVERY_FAILED`, `error`, `attempts++`, history entry, `sentTo` set; offer `status` unchanged (stays DRAFT or SENT). On success: `SENT`, `sentAt`, `messageId`, clears error, `emailedAt` updated.
9. **Review URL/token:** Always **new** JWT + hash; `reviewLink = ${CLIENT_URL\|\|APP_BASE_URL\|\|apiHost}/offers/review/${signingToken}`. Diverges from expected reuse-if-valid.
10. **Duplicates / rate limits:** Same offer reused (no duplicate offer). Rate limit can block bursts (429). Concurrent double-click possible but both hit same offer id.

### First-time send vs resend

| | First send (DRAFT) | Resend (SENT) |
|--|-------------------|----------------|
| Endpoint | Same `POST …/send` | Same |
| Status gate | Allowed | Allowed (ACCEPTED/REJECTED blocked) |
| PDF | Generate + GridFS store | Prefer reuse issued PDF |
| Token | New (expected for first) | New again (**unexpected** vs reuse) |
| Fail SMTP | Stay DRAFT + DELIVERY_FAILED + **new hash saved** | Stay SENT + DELIVERY_FAILED + **old link dead** |
| Success | SENT + email with new link | SENT + email with new link; old email link dies |

### Current vs expected

| Current | Expected |
|---------|----------|
| Always rotate token before SMTP; persist hash even if SMTP fails | Reuse valid token/link unless expired/revoked; rotate only when needed; **do not** persist new hash until SMTP accepts (or roll back) |
| Resend = full send pipeline | Resend must actually deliver; clear success only after provider accept; record attempts/errors |
| Issued PDF reused when present | Preserve issued document/version (already mostly true) |

### Proposed minimal fixes

1. **Token safety (minimal):** Keep previous `signingTokenHash` / expiry in locals; build email with a new token in memory; **on SMTP failure restore previous hash before save**; on success save new hash. Failed resend no longer strands the candidate. (Still rotates on *successful* resend unless reuse is added.)
2. **Token reuse (align with expected):** If unexpired hash exists, reuse the same review token for resend (requires storing recoverable token ciphertext, or a deterministic token without new `jti`). Prefer after (1).
3. Raise client timeout for `/offer-letters/:id/send` (e.g. 90–120s).
4. Surface `emailDelivery.error` clearly in UI; keep 502 messaging.
5. Ensure `CLIENT_URL` is set in every deploy env (ops; no credential change).
6. Tests: resend SENT → 200 + history attempt ≥2; resend SENT + simulated SMTP fail → prior `signingTokenHash` unchanged + DELIVERY_FAILED; accept still works with original token after failed resend.

### Regression risks / tests

- First send still issues token + email + SENT.
- Successful resend updates history; issued PDF fileId unchanged.
- ACCEPTED still cannot resend.
- Unconfigured company SMTP still 502 with clear Settings message.
- No SMTP credential or paid-provider changes.

---

## Cross-cutting regression checklist

| Area | Test |
|------|------|
| Duplicate email | Create/send blocked; accept still blocked; same-offer resign/resend OK |
| Onboard CTA | Goes to onboarding review; Add Employee not opened |
| Legacy mark-accepted without portal user | Clear HR message |
| Send / resend | Delivery history; issued PDF immutability; failed resend must not invalidate prior token |
| List | No GridFS/PDF on list; templates not required for Offers tab |
| Default template HTML/CSS | Untouched |

---

## 5. Email delivery diagnosis (2026-11-04) — highest priority

### Exact cause (current)

**Recent offer emails are accepted by Gmail SMTP.** They are **not** failing with auth (535/534), quota (550 5.4.5), or missing tenant credentials.

Evidence:

| Source | Finding |
|--------|---------|
| Server log `terminals/1.txt` | Multiple `[EmailService] Email accepted by SMTP … Message ID: <…@gmail.com>` |
| Acme `OfferLetter.emailDelivery` | Recent rows `status: SENT` with real Gmail `messageId`s; `error: null` |
| Company docs | Acme/Globex: `fromEmail=editcomediaofficial@gmail.com`, `smtp.gmail.com:587`, encrypted password present, **decrypt OK** via `JWT_SECRET` |
| Env | **No** `SMTP_USER` / `SMTP_PASS` — tenant path only (correct; Vercel/platform env not used for offer sends) |
| Controller | `await emailService.sendOfferLetter(...)` — SMTP is awaited before HTTP 200 |

`emailDelivery.status = SENT` is therefore **correct** under the rule “SMTP provider accepted the message.” This is **not** a false-success bug for the current Nodemailer path.

### Historical failures (same tenant history — not current)

From offer `6ad8be58…` delivery history:

1. **`Connection timeout`** (Oct 21) — transport could not complete SMTP.
2. **Resend.com sandbox restriction** — error text: only allow sending to `sravanikasi14@gmail.com` until a domain is verified. That was a **previous provider** limitation; current stack is Nodemailer → Gmail.

One older row has `messageId: sim_…` (simulated) — legacy/test path; not representative of today’s Gmail accepts.

### If candidates still do not see mail

Post-accept (outside app control once SMTP returns 250):

1. Check **Sent** folder of **`editcomediaofficial@gmail.com`** (tenant sender) for the Message-IDs above.
2. Candidate **Spam/Promotions**; ask them to search sender + subject “Your Employment Offer”.
3. After **resend**, prior review links are invalidated (token rotate) — candidate may open an old email and think delivery failed.
4. Confirm recipient address on the offer record matches the inbox they check.

### Settings → Email (B)

- Saves to `Company.emailSettings` after `verifyConnection`; offer send uses `req.auth.company` → `resolveCompanySmtpConfig` (no env fallback).
- **Code defect:** `settingsController.js` calls `decryptSecret` when updating without a new password but **does not import** it → `ReferenceError` on “keep existing password” saves. New-password saves still work. Fix: add `decryptSecret` to the import (does not change credentials).

### Diagnostics added

Safe structured logs in `emailService.sendMail` + offer send controller: tenantId, from, masked to, host/port/secure, attempt, durationMs, messageId, responseCode, response/command on error. **Never** logs passwords/tokens.

### Proposed fixes (email only)

1. Confirm Sent-folder presence for a known Message-ID (ops verification).
2. Fix `decryptSecret` import in settings controller.
3. Resend token safety (issue 4): do not invalidate prior hash on SMTP failure; consider reuse-if-valid.
4. Keep awaiting SMTP; keep 502 on failure; optionally treat `info.rejected` with empty `accepted` as failure (logging now flags this).
5. Do **not** switch to a paid provider; do **not** change stored SMTP credentials unless HR re-enters them in Settings after verify.

---

## Approval gates before implementation

1. Confirm conflict policy: block create+send when CANDIDATE already linked to another offer (recommended).  
2. Confirm Onboard → `/admin/onboarding` (+ query), deprecate Employees modal for this button.  
3. Confirm send keeps **await SMTP** for now (reliability over latency) vs deferred background (needs infra discussion).  
4. Confirm UI deferral of template/clauses/recipients fetches.  
5. Confirm resend token policy: restore prior hash on SMTP failure (minimal) and/or reuse unexpired token on resend (expected behaviour).  
6. Confirm next step for “not in inbox”: Sent-folder check on `editcomediaofficial@gmail.com` + spam check before changing mail stack.
