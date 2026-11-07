# Phase 1 — GridFS migration notes

## What changed

Offer template DOCX sources and issued offer PDFs now use **MongoDB GridFS** bucket `offer_docs` inside each **company tenant database**. **Cloudflare R2 is not required.**

## Migration requirements

| Situation | Action |
|-----------|--------|
| R2 never activated (this deployment) | **None** — greenfield GridFS |
| Existing issued PDFs only in Mongo metadata without bytes | Legacy offers still generate PDF on download from HTML; no automatic rewrite of historical issued docs |
| Any future R2 objects | Do **not** auto-delete or migrate in this release; leave untouched |

**Do not modify or delete existing issued documents during this migration.** New issued PDFs written after deploy get unique GridFS `fileId`s.

## Configurable limits

| Env | Default | Meaning |
|-----|---------|---------|
| `OFFER_DOCX_MAX_BYTES` | `2097152` (2 MB) | Max DOCX upload |
| `OFFER_PDF_MAX_BYTES` | `5242880` (5 MB) | Max stored issued PDF |
| `OFFER_TEMPLATE_VERSION_RETENTION` | `5` | DOCX version binaries kept per template |

## Remaining risks

- Atlas M0 **512 MB** hard cap — monitor logical size as offers grow  
- Base64 uploads still buffer in memory (≤2 MB DOCX)  
- Rare race on concurrent first-issue of the same offer may leave an unused GridFS PDF (issued files are never auto-deleted)  
- Employee disk docs and company logos unchanged (out of scope)
