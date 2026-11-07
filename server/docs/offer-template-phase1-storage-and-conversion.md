# Phase 1 — R2 storage design & DOCX→PDF provider comparison

Status: **Superseded for conversion.** Phase 1 uses free-tier architecture — see `offer-template-phase1-free-architecture.md` and `offer-template-phase1-env-setup.md`. DOCX→PDF is optional via `LIBREOFFICE_CONVERT_URL` only (no ConvertAPI). R2 design below remains valid.

## 1. Cloudflare R2 storage design

### Bucket

- Single private bucket (e.g. `hrms-offer-documents`) — **no public access**, no public bucket URL.
- Access only via server credentials + short-lived **presigned GET** for authenticated downloads.

### Object key layout

```
platform/master/{masterId}/v{version}/{asset}.{ext}
tenants/{databaseName}/templates/{templateId}/v{version}/source.docx
tenants/{databaseName}/templates/{templateId}/v{version}/preview.pdf
tenants/{databaseName}/offers/{offerId}/v{templateVersionId}/issued.pdf
tenants/{databaseName}/offers/{offerId}/v{templateVersionId}/filled.docx   # optional intermediate
```

- `databaseName` is the existing tenant DB name (isolation key). Never accept client-supplied company paths without verifying against `req.auth.company.databaseName`.
- Platform master assets live under `platform/` and are never writable by tenant HR APIs.

### Mongo metadata (no large binaries)

Store on template / offer documents:

| Field | Purpose |
|-------|---------|
| `storage.provider` | `"r2"` |
| `storage.bucket` | bucket name |
| `storage.key` | object key |
| `storage.contentType` | MIME |
| `storage.byteSize` | size |
| `storage.etag` / `checksumSha256` | integrity |
| `storage.uploadedAt` | timestamp |

### Env vars (Vercel / server)

```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=hrms-offer-documents
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_PRESIGN_TTL_SECONDS=300
```

### Indicative R2 cost (Standard class)

| Item | Rate | Early HRMS estimate |
|------|------|---------------------|
| Storage | $0.015 / GB-month | Often within **10 GB free** tier |
| Class A (writes) | $4.50 / million | Negligible at offer volume |
| Class B (reads) | $0.36 / million | Negligible |
| Egress | **Free** | Important for PDF downloads |

Early production additive cost for offers/templates: typically **$0–5/mo** until multi-GB retention.

---

## 2. DOCX → PDF provider comparison (V1)

| Provider | Fidelity | Privacy / retention | Pricing (indicative) | Fit for confidential offers |
|----------|----------|---------------------|----------------------|-----------------------------|
| **ConvertAPI** | High Office→PDF, no MS Office license | `StoreFile=false` = **in-memory, zero persistence**; or temp encrypted ≤3h. SOC2, ISO 27001, HIPAA, GDPR | ~$35/mo for 1,000 conversions; trial ~250; overage ~$0.05 | **Best V1 fit** |
| **CloudConvert** | High; MS Office-quality claims; R2/S3 import/export | Files removed after job; security program / certification | ~$0.008–$0.01/file; ~$10/mo for 1,000 credits; 10 free/day | Strong; slightly more complex jobs API |
| **Adobe PDF Services** | Very high | Enterprise Adobe terms | 500 free tx/mo; paid often sales-led | Good if already on Adobe; slower to self-serve |
| **Aspose Words Cloud** | High | Direct convert may not retain; **Aspose Storage** can retain ≥30 days if used | Metered enterprise | Avoid Storage path for offers |
| **Self-host LibreOffice** | High if tuned | Full control | Always-on VM ~$7–50/mo | Better later; ops burden on Vercel era |

### Recommendation for V1: **ConvertAPI**

Reasons:

1. Explicit **zero-persistence** mode (`StoreFile=false`) matches offer confidentiality.
2. Simple synchronous DOCX→PDF REST call suitable for Express on Vercel (with timeout budget).
3. Clear compliance posture and predictable per-file pricing.
4. Easy to swap behind `docxConversionService` adapter if we later move to CloudConvert or LibreOffice.

**CloudConvert** is the runner-up (native R2 export). Prefer it if you already use CloudConvert or need many non-Office formats.

### Integration policy

- Only used for `UPLOADED_DOCX` templates (and optional filled-DOCX archive).
- `DEFAULT_BUILDER` templates continue to render via sanitised HTML/CSS → existing Puppeteer/`pdfService` (native builder path, not DOCX approximation).
- Env: `CONVERTAPI_SECRET=` (or `DOCX_PDF_PROVIDER=convertapi` + secret). When unset, DOCX PDF generation returns a clear configuration error (tests mock the adapter).

### Indicative conversion cost

| Volume | ConvertAPI ballpark |
|--------|---------------------|
| ≤250 trials | Free trial |
| 1,000 offers/mo | ~$35/mo plan |
| Low volume (&lt;100/mo) | Often stay on smallest paid tier or trial |

Combined R2 + ConvertAPI early estimate: roughly **$35–45/mo** at ~1k DOCX conversions; near **$0–5** if mostly DEFAULT_BUILDER (Puppeteer) with rare DOCX uploads.
