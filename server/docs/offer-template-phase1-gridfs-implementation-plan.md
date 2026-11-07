# Phase 1 — GridFS implementation plan (M0 Atlas)

**Status:** plan for approval — **no code or DB changes in this step.**  
**Cluster:** MongoDB Atlas Free (M0), AWS Mumbai · **~7.7 MB / 512 MB** logical used → **~504 MB free**.  
**Prior art:** `offer-template-phase1-mongodb-storage-investigation.md`

---

## 1. Storage estimates (typical Phase 1 payloads)

| Asset | Typical size | Worst case (current code caps) | Notes |
|-------|--------------|--------------------------------|-------|
| DOCX template (text + light branding) | **80–400 KB** | **10 MB** (`MAX_DOCX_BYTES`) | Logos embedded in Word dominate size |
| DOCX with heavy images | **1–3 MB** | 10 MB | Discourage via lower limit (below) |
| Issued offer PDF (DEFAULT_BUILDER, ~8–12 pages, logo) | **80–250 KB** | ~1–2 MB unusual | Puppeteer HTML/CSS; mostly text |
| Pure-JS fallback PDF | **20–80 KB** | small | Layout-poor; still stored if issued |

### GridFS byte overhead (approx.)

- Default **chunkSize = 255 KiB** (261,120 bytes).
- Per chunk document: payload + `_id` + `files_id` + `n` + BSON framing ≈ **+50–150 B** metadata (small vs payload).
- Per file: one `offer_docs.files` doc (~0.5–2 KB with custom metadata) + driver indexes.
- Rule of thumb for planning: **logical size ≈ file_bytes × 1.05–1.15** plus index growth on `chunks`/`files`.

**Worked examples (single tenant):**

| Scenario | Approx. GridFS logical |
|----------|-------------------------|
| 3 unique DOCX templates × 300 KB | ~1 MB |
| 100 issued PDFs × 150 KB | ~16 MB |
| 500 issued PDFs × 150 KB | ~80 MB |
| 2,000 issued PDFs × 200 KB | ~420 MB → **approaches M0 ceiling** with app data |

**Cluster-wide headroom (today):**

| Bucket | MB |
|--------|----|
| Used now | 7.7 |
| M0 hard limit | 512 |
| Remaining | ~504 |
| Reserve for app growth / indexes / other tenants (recommended) | **150–200** |
| Practical budget for all companies’ `offer_docs` | **~300–350 MB** |

At ~150 KB/issued PDF, that is roughly **2,000–2,300 issued PDFs cluster-wide** before pressure, plus a small number of templates — **comfortable for early Phase 1**, tight if unchecked growth or many 10 MB DOCX versions.

---

## 2. Indexes & GridFS overhead

### Existing app indexes (tenant DB — unchanged role)

**`offer_templates`:** `status`, `type`, `source+masterCode`, unique partial `isSystemDefault`/`masterCode`, unique partial `isDefault`.  
**`offer_letters`:** existing status/date/email indexes + `templateId`.

These are small relative to binaries.

### GridFS auto-indexes (per company DB, bucket `offer_docs`)

Created by the Node driver on first use (when bucket empty):

| Collection | Index | Purpose |
|------------|-------|---------|
| `offer_docs.chunks` | unique `{ files_id: 1, n: 1 }` | Reassemble file in order |
| `offer_docs.files` | `{ filename: 1, uploadDate: 1 }` | Filename listing |

### Additional indexes we should create (implementation)

| Collection | Index | Purpose |
|------------|-------|---------|
| `offer_docs.files` | `{ "metadata.checksumSha256": 1, "metadata.purpose": 1 }` | Template-source dedupe lookup |
| `offer_docs.files` | `{ "metadata.purpose": 1, uploadDate: -1 }` | GC / ops listing |

**Index storage risk on M0:** each company that ever uploads a file gets **2 collections + ≥2 indexes**. With many empty tenants this adds collection count toward the **M0 max 500 collections** (2 GridFS cols × N companies that use uploads). Plan: **create bucket lazily on first write** (driver default) — companies that never upload DOCX / never persist issued PDF do not get GridFS collections.

---

## 3. M0 storage & performance risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Hard **512 MB** stop (writes fail) | High if growth unchecked | Caps, retention, Atlas alerts at 70%/85% |
| Large DOCX versions retained forever | High | Cap upload size; limit retained versions; GC |
| Shared WiredTiger cache with OLTP | Medium | Keep files small; stream downloads; avoid bulk PDF re-gen |
| M0 **500 connections / 100 DBs** | Low–medium for tenancy scale | Unrelated to GridFS bytes; still plan company count |
| Orphan chunks after aborted upload | Medium | Abort upload stream; GC orphans |
| Email path buffers full PDF | Low at ≤2 MB | Acceptable; still stream HTTP downloads |
| 10 MB DOCX × many versions | High | **Lower Phase 1 DOCX cap** (see §4) |

---

## 4. Proposed upload size limits & retention

### Size limits (Phase 1 on M0)

| Limit | Proposed | Rationale |
|-------|----------|-----------|
| DOCX template upload | **2 MB** (down from 10 MB) | Fits logos lightly; blocks multi‑MB photo DOCX eating quota |
| Stored issued PDF | **5 MB** soft reject if larger | Far above typical offer PDFs; safety valve |
| Express JSON body | Keep **15 MB** (decode overhead) | Upload still base64; 2 MB binary ≈ ~2.7 MB base64 |
| Template versions kept with bytes | **Last 5** DOCX versions per template | Older version metadata kept without files optional, or drop fileIds only |

Env overrides later: `OFFER_DOCX_MAX_BYTES`, `OFFER_PDF_MAX_BYTES`.

### Retention rules

| Object | Rule |
|--------|------|
| **Issued PDF** | Retain for lifetime of offer letter record; **never overwrite**; delete GridFS file only if offer is hard-deleted (draft delete only today — **do not delete issued files** when archiving) |
| **Active/current DOCX** | Retain while template exists |
| **Prior DOCX versions** | Keep files for last **5** versions; older `versions[].storage.fileId` → delete GridFS if unreferenced |
| **Draft template deleted** | Delete all GridFS files referenced only by that template |
| **Archived template** | Keep current + last 5 version files until GC policy / manual purge |
| **Failed upload** | See §5 — no lasting orphan if cleanup succeeds |
| **Checksum dedupe (templates only)** | Reuse existing `files_id` when `metadata.purpose === "template_source"` and same `checksumSha256` in **same tenant DB**; bump refcount in metadata or rely on reference scan |

**Issued PDFs:** always new GridFS file per offer (`metadata.purpose: "issued_pdf"`, `metadata.offerId`). **No checksum sharing across offers.**

---

## 5. Cleanup: failed uploads & unreferenced drafts

### Failed upload (ordered write)

1. `openUploadStream` → write chunks.  
2. On stream error / abort → `abort()` so driver drops incomplete upload.  
3. Only after upload completes, patch `OfferTemplate.storage` / `versions[]`.  
4. If metadata save fails after successful upload → **`delete(fileId)`** immediately (compensating delete).  
5. Periodic **orphan GC** (optional script): chunks with no parent `files` doc; `files` with `purpose: template_source|issued_pdf` whose `fileId` is not referenced by any template/offer in that DB.

### Unreferenced draft templates

| Event | Cleanup |
|-------|---------|
| `DELETE` draft company template | Collect all `storage.fileId` + `versions[].storage.fileId` → delete each GridFS file **after** checking no other template shares the fileId (dedupe) → then delete Mongo template doc |
| Replace DOCX on draft | Upload new (or reuse by checksum); if old fileId refcount/references == 0 → delete |
| System / HRMS default builder | No GridFS (HTML only) unless an issued PDF is stored on an offer |

**Refcount for deduped template sources:** store `metadata.refCount` incremented on reuse, decremented when a template version drops the fileId; delete GridFS when refCount hits 0. Alternative: always scan references (simpler, fine at low volume).

---

## 6. Target architecture (approved shape)

```text
Tenant DB (per company)
├── offer_templates / offer_letters   (metadata only; existing models)
└── GridFS bucket name: offer_docs
    ├── offer_docs.files
    └── offer_docs.chunks

files.metadata = {
  purpose: "template_source" | "issued_pdf",
  checksumSha256,
  contentType,
  templateId? | offerId?,
  version?,
  refCount?          // template_source dedupe
}
```

**StorageRef on models** (evolve R2-shaped fields without breaking reads):

```text
{
  provider: "gridfs",
  bucket: "offer_docs",
  fileId: ObjectId,      // primary locator (maps conceptually from former "key")
  filename: string,
  contentType, byteSize, checksumSha256,
  uploadedAt / generatedAt
}
```

- **No R2.**  
- **No** change to employee `documentStorage` or `Company.logoData`.  
- Legacy offer routes without `templateId` unchanged.  
- Downloads: authz → verify fileId on the tenant document → `openDownloadStream(fileId).pipe(res)`.  
- Uploads: existing base64 JSON path with new size cap.

---

## 7. Implementation stages (when approved)

| Stage | Work | Test focus |
|-------|------|------------|
| **A** | `offerGridFsStorageService.js`: put (buffer→upload stream), openDownloadStream, delete, findByChecksum(purpose), ensureIndexes; bucket `offer_docs` on `connection.db` | Unit + memory-server |
| **B** | Generalise storage behind thin adapter; switch template upload / issued PDF persist off R2; `isStorageConfigured()` always true when Mongo tenant conn exists | Template upload/download |
| **C** | Metadata schema: `fileId`; streaming download routes; remove presigned-URL dependency for GridFS | Authz + tenant isolation |
| **D** | Template checksum dedupe + refcount/GC; issued PDF immutability unchanged | Dedupe + immutability tests |
| **E** | Lower DOCX cap to 2 MB; version retention (keep 5); orphan cleanup helper/script | Caps + cleanup |
| **F** | Update docs/env (R2 optional/removed); keep LibreOffice convert optional | Docs only |

**Do not:** migrate logos/employee files; introduce paid storage; share issued PDF fileIds across offers.

---

## 8. Authorization & isolation (must preserve)

1. Open GridFS **only** via `req.auth.models.connection` (tenant).  
2. Never accept raw `fileId` from the client without loading the OfferTemplate/OfferLetter that owns it in that DB.  
3. HR_ADMIN for template CRUD; existing offer download rules unchanged.  
4. Candidate download paths (if any) only for their offer’s `generatedPdf.fileId`.

---

## 9. Success criteria

- DOCX upload/download works with zero R2 env vars.  
- Issued PDF stored once; second store reuses same `fileId`.  
- Identical DOCX re-upload same tenant → same GridFS `fileId` (template_source only).  
- Cross-tenant fileId guess returns 404/403.  
- Legacy create/send/download without templates still green.  
- Atlas logical size growth matches estimates within ~15%.

---

## 10. Approval checklist

Please confirm:

1. **DOCX max 2 MB** (vs current 10 MB) for M0 safety.  
2. **Retain last 5** DOCX version binaries per template.  
3. **Checksum dedupe** for template sources only; issued PDFs always unique files.  
4. **Lazy** `offer_docs` bucket creation per company.  
5. Proceed with stages A→F as above (replace R2 path with GridFS).

No implementation until you approve this plan.
