# Phase 1 — Zero / free-tier architecture investigation

Goal: minimise recurring cost while keeping Phase 1 functional requirements.  
**No paid conversion API or new paid host is integrated without approval.**

---

## 1. Default HRMS template + existing `pdfService`

| Question | Finding |
|----------|---------|
| Can existing Puppeteer path cover the reference-based default? | **Yes for the DEFAULT_BUILDER path.** Build sanitised HTML/CSS matching the reference; render with `pdfService.generatePdfFromHtml`. |
| Cost | **$0** incremental (reuse current stack). |
| Vercel caveat | On Vercel/Lambda without `PUPPETEER_EXECUTABLE_PATH`, code **skips Puppeteer** and uses `generatePureJsPdf` (text strip). That **will not** preserve letterhead/layout. Production fidelity needs Chrome-capable runtime (`@sparticuz/chromium` on Vercel, or generate PDF on a Node host that has Chromium). Still **no subscription** — packaging work only. |
| Recommendation | Treat HTML/CSS + Puppeteer as the **canonical** default-template PDF path. Fix Chromium-on-Vercel (or document that high-fidelity PDF requires Chromium) as part of Phase 1 for DEFAULT_BUILDER. |

---

## 2. DOCX placeholder replacement — docxtemplater

| Item | Free core | Paid modules |
|------|-----------|--------------|
| License | **MIT / GPLv3 dual** — free for SaaS when you run it | Image, HTML-in-DOCX, advanced tables, etc. ~€500+/module/year |
| Features | `{tag}` / `{{tag}}` text, conditions, loops | Dynamic image insert, rich HTML injection |
| npm | `docxtemplater` + `pizzip` | Separate commercial packages |

**Fit for Phase 1:** Free core is enough for listed placeholders (`{{company_name}}`, `{{candidate_name}}`, salary, dates, clauses as text loops).  

**Limitation:** Dynamic `{{company_logo}}` image injection needs the **paid Image module**, or HR embeds a static logo in the DOCX before upload (recommended free workaround).

**Cost:** **$0** if we stay on core + static logo in uploaded file.

---

## 3. DOCX → PDF — LibreOffice headless

| Topic | Finding |
|-------|---------|
| Can it run **on Vercel serverless**? | **No (practical).** LibreOffice image is hundreds of MB–1GB+; cold start / binary size / execution time exceed Functions limits. |
| Self-hosted Docker | Standard pattern: `soffice --headless --convert-to pdf` or **unoserver** daemon; warm ~0.5s, cold ~3s; needs ~512MB–1GB+ RAM; isolate UserInstallation dirs to avoid hangs. |
| Truly free hosting? | **Weak for production confidential docs.** |
| Render Free | Sleeps after ~15 min idle; ~1 min wake; 750 instance-hours/mo; **no persistent disk** on free; bad for always-on converter. |
| Railway Free | ~$1 credit/mo, **0.5 GB RAM cap** — often **too small** for LibreOffice. |
| Fly.io | Free tier largely gone for new orgs; smallest always-on ~**$2+/mo** (not zero). |
| Oracle Cloud Always Free | Possible always-on ARM VM at **$0**, but ops/security hardening is on you; not “no new infrastructure”. |
| Reliability risks | Hang without unique UserInstallation; font missing → layout drift; concurrency needs queue; must timeout + cleanup temp files. |
| Security | Confidential offers in converter RAM/disk: private VPC/network, no public bucket of temps, TLS, auth on convert endpoint, wipe temp files, no logging of document body. Sleeping free hosts increase attack window unpredictability and timeout failures. |

**Recommendation:** Do **not** depend on a sleeping free PaaS for production DOCX→PDF. Options without paid API:

1. **Phase 1A (preferred cost-min):** Full PDF for **DEFAULT_BUILDER** only; for **UPLOADED_DOCX** ship upload/mapping/fill + **download filled DOCX**; PDF conversion enabled only when `LIBREOFFICE_CONVERT_URL` (optional self-hosted worker) is set.  
2. **Phase 1B (ops):** Optional always-free Oracle VM / self-managed VPS running unoserver — **requires your approval** as new infrastructure (even if $0).  
3. Paid ConvertAPI later — **only with approval**.

---

## 4. Cloudflare R2 free allowance & privacy

| Free tier (Standard) | Amount |
|----------------------|--------|
| Storage | **10 GB-month / month** |
| Class A (writes) | **1M / month** |
| Class B (reads) | **10M / month** |
| Egress | **Free** |

Early offer/template volume fits free tier easily (metadata in Mongo; objects are DOCX/PDF only).

**Privacy / security fit:**

- Private bucket, no public access  
- Server-side credentials only; short-lived **presigned GET** for authenticated downloads  
- No egress fee pressure to open public URLs  
- Meets “durable private storage” better than Vercel `/tmp` or ephemeral disk  

**Cost:** **$0** within free tier. Beyond 10 GB → $0.015/GB-month.

**Alternative with zero new vendor:** Mongo `Buffer` / GridFS (logo pattern). You previously preferred R2 for binaries; R2 free tier still satisfies “minimise cost” without a paid plan.

---

## 5–6. Mongo metadata + master seed

Reuse existing Atlas + DB-per-company:

- **Central:** `offer_template_masters` (+ immutable versions)  
- **Tenant:** `offer_templates`, offer refs (`templateId`, `templateVersion`, `generatedPdf` key metadata)  
- **Script:** `seedOfferTemplateMaster.js` + hook in `provisionTenantDatabase` / `provisionAllTenants`  

**Cost:** **$0** incremental beyond current Atlas.

---

## Comparison summary

| Capability | Free approach | Limitation | Recurring $ |
|------------|---------------|------------|-------------|
| Default template PDF | HTML/CSS + existing Puppeteer `pdfService` | Need Chromium on Vercel for visual fidelity | $0 |
| DOCX fill | docxtemplater core + pizzip | No free dynamic image module | $0 |
| DOCX→PDF | LibreOffice outside Vercel | Not on serverless; free PaaS sleeps / undersized | $0 only if deferred or Always-Free VM |
| Object storage | R2 free tier | Soft 10 GB cap | $0 in tier |
| Versioning / tenancy | Mongo + seed script | — | $0 |
| Paid ConvertAPI / paid host | — | Not used without approval | N/A |

---

## Recommended architecture (cost-minimised Phase 1)

```
┌─────────────────────────────────────────────────────────┐
│  DEFAULT_BUILDER (every company auto-provisioned)       │
│  Sanitised HTML/CSS master → pdfService (Puppeteer)     │
│  Mongo: master versions + tenant template copies        │
│  R2 (free tier): optional store of issued PDF bytes     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  UPLOADED_DOCX                                          │
│  Upload → R2 · detect {{tags}} · map · docxtemplater    │
│  Preview: filled DOCX download + HTML mapping preview   │
│  PDF: only if LIBREOFFICE_CONVERT_URL configured        │
│       else clear “PDF conversion not configured” UX     │
└─────────────────────────────────────────────────────────┘
```

### What ships at $0 incremental (typical)

1. Global master HTML/CSS + seed/provision to all companies  
2. Template CRUD, default selection, versioning, immutability of issued offers  
3. DOCX upload, placeholder mapping, filled DOCX generation  
4. R2 private storage within free tier  
5. High-fidelity PDF for **default builder** via Puppeteer (after Chromium-on-Vercel fix if needed)

### What stays optional / approval-gated

- Always-on LibreOffice worker (Oracle Always Free or paid host)  
- Any paid DOCX→PDF API  

### Security notes (confidential offers)

- Never log offer body / salary / DOCX contents  
- R2 private + authz on download routes  
- If LibreOffice added later: private network, authenticated convert endpoint, per-job temp dirs, wipe after response, size/timeout limits  

---

## Decision needed from you

To proceed with implementation under this free architecture, please confirm:

1. **DEFAULT_BUILDER PDF** via HTML/CSS + Puppeteer as the primary product path — **yes**  
2. **UPLOADED_DOCX PDF** deferred unless `LIBREOFFICE_CONVERT_URL` is set — **yes / no**  
3. **R2 free tier** for DOCX + issued PDF objects — **yes** (vs Mongo buffers)  
4. Optional later: approve Oracle Always Free / other $0 VM for LibreOffice — **defer / explore**

No paid ConvertAPI or paid host will be integrated without explicit approval.
