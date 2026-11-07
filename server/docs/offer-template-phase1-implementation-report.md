# Phase 1 Offer Template System — Implementation report

## Decisions applied

| Area | Implementation |
|------|----------------|
| DEFAULT_BUILDER | Reference-based HTML/CSS master (`hrms-default-master.js`) → `pdfService` + Puppeteer; `@sparticuz/chromium` on Vercel |
| UPLOADED_DOCX | docxtemplater + pizzip; preview/download filled DOCX; PDF only if `LIBREOFFICE_CONVERT_URL` |
| Storage | Private Cloudflare R2 via `r2StorageService`; Mongo metadata only |
| LibreOffice VM | Deferred — no new infra |
| Tenancy | DB-per-company; keys under `tenants/{databaseName}/…` |
| Master updates | Seed script; never rewrites existing master versions or company customisations |
| Issued docs | `generatedPdf` stored once; subsequent downloads reuse stored object |

## Environment / dashboard (not deployment-ready until done)

See **`offer-template-phase1-env-setup.md`**.

Required for DOCX + issued PDF persistence:

- Cloudflare R2 private bucket + API token
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (+ optional endpoint / TTL)

Required for visual DEFAULT_BUILDER PDFs on Vercel:

- Deploy with `puppeteer-core` + `@sparticuz/chromium`
- Prefer function memory ≥ 1024 MB (`server/vercel.json`)
- Smoke-test one production PDF (must not be pure-JS text fallback)

Optional:

- `LIBREOFFICE_CONVERT_URL` / `LIBREOFFICE_CONVERT_TOKEN`

**Do not claim production readiness** until R2 secrets are set and a Chromium PDF smoke test passes on Vercel.

## Changed / added files (high level)

- `server/services/pdfService.js` — Sparticuz Chromium on serverless
- `server/services/docxConversionService.js` — LibreOffice URL only (no ConvertAPI)
- `server/services/r2StorageService.js`, `offerDocxTemplateService.js`, `offerTemplateRenderService.js`, `offerDocumentService.js`, `offerTemplateProvisioningService.js`
- `server/models/OfferTemplate.js`, `OfferTemplateMaster.js`; OfferLetter template fields
- `server/controllers/offerTemplateController.js`, `routes/offerTemplateRoutes.js`
- `server/controllers/offerLetterController.js`, `services/emailService.js` — template-aware create/preview/download/send; DOCX attach when PDF convert unavailable
- `server/config/db.js`, `tenantProvisioningService.js` — OfferTemplate + auto-provision default
- `server/scripts/seedOfferTemplateMaster.js`, `assets/offer-templates/hrms-default-master.js`
- `server/middleware/errorHandler.js` — preserve `CONVERSION_NOT_CONFIGURED` / `STORAGE_NOT_CONFIGURED`
- `server/vercel.json`, `server/.env.example`, docs
- `client/src/components/OfferTemplatesPanel.jsx`, `OfferLettersManagement.jsx`
- `mobile/src/pages/hr/OffersPage.jsx`
- `server/tests/offer_templates_phase1.test.js`

## Tests

`node --test --test-concurrency=1 tests/offer_templates_phase1.test.js` — **6/6 pass** covering:

- Master + company provisioning / no overwrite of customisations or master versions
- Tenant isolation of template lists
- Placeholder validation / DOCX fill
- R2 upload + filled DOCX without PDF; clear 503 when convert unset
- DEFAULT_BUILDER HTML + PDF buffer
- Issued PDF immutability; no ConvertAPI

## Remaining limitations

1. R2 and Vercel Chromium must be configured manually before production DOCX/issued-PDF and high-fidelity serverless PDFs.
2. DOCX→PDF unavailable until a LibreOffice worker URL is provided (by design).
3. Dynamic logo injection into DOCX requires paid docxtemplater Image module — embed logo in the uploaded Word file instead.
4. E-sign / onboarding transitions unchanged and out of Phase 1 scope.
5. First Vercel cold start with Chromium may be slow; monitor memory/timeouts.
