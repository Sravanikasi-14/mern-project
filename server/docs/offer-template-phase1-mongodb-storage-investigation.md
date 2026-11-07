# Phase 1 — MongoDB Atlas document storage investigation (no R2)

**Status:** inspection only — no code changes implemented for this decision.  
**Constraint:** No Cloudflare R2; no new paid object-storage vendor. Reuse existing MongoDB Atlas + DB-per-company tenancy.

---

## 1. Current MongoDB Atlas connection & architecture

| Item | Finding |
|------|---------|
| Connection | Single cluster URI `MONGO_URI` (`mongodb+srv://…mongodb.net/…`) in `server/config/db.js` |
| Central DB | `CENTRAL_DB_NAME` (default `platform`) via `mongoose.connect(..., { dbName })` |
| Tenant DBs | `mongoose.createConnection(MONGO_URI, { dbName: company.databaseName })` — **one database per company** on the **same Atlas cluster** |
| Company registry | `Company` lives in central DB; each has `slug`, `databaseName`, status |
| Models | Tenant models (`OfferLetter`, `OfferTemplate`, `User`, …) are registered **per tenant connection** |

This is already a hard tenancy boundary at the database name level: Acme never reads Globex collections unless a bug opens the wrong connection.

**Offer template Phase 1 today** still assumes R2 for DOCX/issued PDF bytes (`r2StorageService`, `StorageRef.provider` default `"r2"`). Metadata already lives in the tenant Mongo DB.

---

## 2. Isolation for document storage

| Approach | Isolation | Fit |
|----------|-----------|-----|
| **GridFS (or Buffer docs) inside each tenant DB** | Strong — files physically in `company_acme` vs `company_globex` | **Recommended** |
| GridFS in central `platform` with `databaseName` metadata | Weaker — must never forget tenant filter; blast radius if bug | Avoid |
| Shared R2 prefix `tenants/{databaseName}/…` | Soft isolation by key convention | Rejected (no R2) |

**Preserve isolation by:** opening GridFS only on `req.auth.models.connection` (or `getTenantConnection(company.databaseName)`), never accepting a client-supplied DB name, and never resolving file IDs across connections.

---

## 3. Atlas storage usage & limits (from project config)

| Source | Discoverable? |
|--------|----------------|
| Current cluster tier / used GB | **No** — not in repo env examples or code. Only Atlas UI / billing API can show this. |
| Configured storage limit | **No** project-level cap in code. Atlas tier determines hard/soft limits. |
| Known Atlas free (M0) | **512 MB** total logical storage (data + indexes) — hard limit, no auto-expand. Max **100 databases** / **500 collections** on free. |
| Paid / Flex / dedicated | Higher storage; often already in use if production HRMS runs multi-tenant today. |

**Action before implementation:** In Atlas → Cluster → Metrics / Overview, record **logical data size** and **tier**. If the cluster is near a hard cap, offer binaries will accelerate upgrades.

---

## 4. Is GridFS used today?

**No.** Repo-wide search finds **zero** `GridFS` / `GridFSBucket` usage.

Existing binary patterns:

| Asset | Where bytes live | Notes |
|-------|------------------|-------|
| Company logo | Central `Company.branding.logoData` (`Buffer`, `select: false`) | Proven Vercel-safe; ≤ 2 MB |
| Employee / task docs | Local disk via `documentStorage.js` (`UPLOADS_DIR` or `/tmp` on Vercel) | Ephemeral on serverless — known limitation |
| Offer DOCX / issued PDF (Phase 1) | Designed for R2 | Not usable without R2 secrets |

---

## 5. Suitability of GridFS for offer documents

| Document | Typical size (Phase 1) | BSON 16 MB single-doc | GridFS |
|----------|------------------------|----------------------|--------|
| Uploaded DOCX template | Cap **10 MB** (`MAX_DOCX_BYTES`) | Fits in one doc | Excellent |
| Generated / issued PDF | Usually ≪ 10 MB (multi-page HTML→PDF) | Usually fits | Excellent |
| Version history of sources | N × template size | Bloats OfferTemplate if embedded | GridFS + metadata refs |

**Recommendation:** Prefer **tenant GridFS** over embedding `Buffer` on `OfferTemplate` / `OfferLetter` because:

1. Versioned DOCX + issued PDFs multiply storage without bloating business documents.
2. Native **streaming** download (`openDownloadStream`) avoids loading full files into the function for downloads.
3. Same isolation model as collections (per tenant DB).
4. Still under BSON limits for Phase 1 sizes, but GridFS is the right abstraction as volume grows.

**Logo-style `Buffer` on the parent document** is acceptable only for rare tiny assets (already used for logos). Not ideal as the primary store for every offer PDF.

---

## 6. Secure streaming downloads (avoid full in-memory load)

**Target pattern (Node + mongoose connection):**

```text
auth → load OfferTemplate/OfferLetter in tenant DB
     → verify storage.fileId belongs to this tenant doc
     → GridFSBucket(connection.db, { bucketName: "offer_docs" })
         .openDownloadStream(fileId)
         .pipe(res)
```

| Concern | Guidance |
|---------|----------|
| AuthZ | Only after `authenticate` + HR/candidate rules; resolve file via Mongo metadata, not raw client `fileId` alone (or validate `fileId` matches the offer/template record) |
| Headers | `Content-Type`, `Content-Length` (from `files` doc), `Content-Disposition: attachment` |
| Upload path today | Base64 JSON (`express.json` **15 MB** limit) — **upload still buffers in memory** (same as logo/DOCX now). Streaming upload (multipart) can be a later hardening step. |
| Email attach | Still needs a Buffer (Nodemailer) — load once for send, or stream-to-buffer only for that path |

---

## 7. Deletion, replacement, versioning, duplicates

| Operation | Recommended behaviour |
|-----------|------------------------|
| **Template version bump** | Upload **new** GridFS file; append `versions[]` with new `storage.fileId`; keep prior version files while that version is referenced |
| **Replace draft source** | New fileId; optionally delete previous draft fileId if no version row still points at it |
| **Issued PDF** | Write **once**; never overwrite GridFS content or change `generatedPdf.fileId` (matches current immutability rule) |
| **Archive template** | Soft-archive metadata; retain GridFS until explicit GC |
| **Delete draft template** | Delete metadata + orphan GridFS files for that template only |
| **Duplicate uploads** | Compute `checksumSha256`; if an existing tenant GridFS file has the same hash **and** same purpose (e.g. template source), **reuse fileId** instead of storing again. Do **not** share issued-offer files across offers even if checksum matches (simpler audit trail), unless you explicitly adopt content-addressed issued storage later |
| **GC** | Periodic job: list GridFS fileIds not referenced by any `OfferTemplate.storage` / `versions[].storage` / `OfferLetter.generatedPdf` in that tenant DB → delete |

Logical metadata (unchanged shape, provider swap):

```text
storage: {
  provider: "gridfs",
  bucket: "offer_docs",          // GridFS bucket name
  fileId: ObjectId,              // replaces R2 key as primary locator
  filename: "...",
  contentType, byteSize, checksumSha256, uploadedAt
}
```

---

## 8. Vercel serverless fit

| Topic | Assessment |
|-------|------------|
| Can Functions talk to Atlas GridFS? | **Yes** — same `MONGO_URI` already used for all APIs |
| Upload | Current base64 JSON fits within **15 MB** body limit and **10 MB** DOCX cap; memory ≈ decoded size + overhead |
| Download | Stream from GridFS → response; lower peak memory than `getObjectBuffer` + `res.end(buffer)` |
| Cold start | Extra GridFS chunk reads; usually fine for ≤10 MB |
| Ephemeral disk | **Not required** (unlike employee `documentStorage` on `/tmp`) |
| Timeout / memory | PDF *generation* still dominates; storing/fetching GridFS is lighter than Puppeteer |
| Connection pooling | Existing per-tenant `createConnection` cache; GridFS uses same connection — no new host |

**Caveat:** Generating a PDF **and** reading a DOCX from GridFS **and** emailing in one invocation still needs enough function memory (already aiming at 1024 MB for Chromium).

---

## 9. Size, performance, backup, growth

| Risk | Detail |
|------|--------|
| **Atlas capacity** | Every DOCX version + issued PDF counts toward cluster storage. On **M0 (512 MB)** this is a hard stop; multi-tenant production likely needs dedicated/Flex capacity already for app data alone |
| **Indexes** | GridFS `files`/`chunks` collections + indexes add overhead beyond raw file bytes |
| **Performance** | Many small chunk reads vs one S3 GET; acceptable at HR offer volumes; watch for large concurrent downloads |
| **Backup** | Atlas continuous backup / snapshots include GridFS automatically with the tenant DB — **good** for confidential offers; restores are DB-scoped |
| **Growth** | Linear with offers × PDF size + template versions. Prefer: one issued PDF per offer, checksum reuse for identical template re-uploads, GC unreferenced drafts |
| **16 MB BSON** | Not a blocker for Phase 1 caps; GridFS still preferred for streaming and hygiene |
| **Free-tier DB count** | Each company = 1 DB; M0 max 100 DBs — unrelated to GridFS but relevant to tenancy scale |

---

## Recommended architecture (for approval)

```text
┌─ Atlas cluster (existing MONGO_URI) ─────────────────────────┐
│  platform (central)     Company, OfferTemplateMaster, …      │
│  tenant_{company}       OfferTemplate, OfferLetter, …        │
│                         GridFS bucket "offer_docs"             │
│                           *.files / *.chunks                   │
└──────────────────────────────────────────────────────────────┘

Upload DOCX  → validate → put GridFS (tenant conn) → metadata on OfferTemplate
Issue PDF    → generate → put GridFS once → OfferLetter.generatedPdf (immutable)
Download     → authz → openDownloadStream(fileId) → pipe response
DEFAULT_BUILDER HTML master stays in Mongo (already); PDF bytes optional in GridFS when issued
```

**Adapter approach:** Keep a small storage interface (put / getStream / delete / exists) currently backed by R2; swap implementation to GridFS so controllers stay thin. When R2 env is absent, GridFS becomes the only backend (no paid fallback).

**Out of scope for this storage swap:** LibreOffice VM, ConvertAPI, changing legacy clause-builder offers, e-sign.

---

## Required changes (when approved — not done yet)

1. Implement `mongoGridFsStorageService` (or rename generic `objectStorageService`) using tenant `connection.db`.
2. Point `offerTemplateController` / `offerDocumentService` at GridFS; stop requiring R2 env.
3. Update `StorageRefSchema` (`provider: "gridfs"`, `fileId`; deprecate R2 `key`/`bucket` meaning).
4. Stream downloads for template source + issued PDF routes.
5. Checksum-based dedupe for template sources; immutability for issued PDFs.
6. Provision GridFS indexes via tenant provisioning (idempotent).
7. Retarget Phase 1 tests to GridFS (Memory Server supports it).
8. Docs/env: remove R2 as required; document Atlas capacity watch.
9. Optional later: multipart streaming uploads; orphan GC script.

---

## Limitations & risks

1. **Atlas bill / tier** — binaries accelerate storage growth; free M0 is especially risky. Confirm current usage in Atlas UI before large-scale DOCX retention.
2. **Upload still memory-bound** on Vercel if using base64 JSON (acceptable at 10 MB; not ideal at scale).
3. **Employee document `/tmp` problem is separate** — this proposal does not fix HR employee file uploads.
4. **No multi-document transactions with GridFS** — use careful ordered writes (file then metadata; orphan GC on failure).
5. **Backup restores** bring files back with DB — good for privacy/compliance; plan retention intentionally.
6. **Dual-write / migration** — no production R2 data expected if R2 was never activated; greenfield GridFS is straightforward.

---

## Verdict

**Yes — reuse MongoDB Atlas with per-tenant GridFS** as the Phase 1 document store under your constraints (no R2, no new paid object store, DB-per-company, private, no cross-tenant access). It aligns with the proven logo-in-Mongo serverless pattern while fixing R2’s payment-method blocker and avoiding ephemeral disk.

**Do not implement until you confirm:** (1) Atlas tier / free storage headroom, (2) approval of GridFS over embedding Buffers on offer docs, (3) checksum dedupe rules as above.
