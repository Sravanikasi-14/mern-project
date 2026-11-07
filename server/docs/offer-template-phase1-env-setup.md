# Phase 1 — Required secrets, env vars & manual dashboard setup

**Status:** architecture approved; values must be configured in Cloudflare + Vercel before production deployment is claimed ready.  
Code can run locally/tests with in-memory storage adapters when R2 is unset.

---

## 1. Cloudflare R2 (private bucket)

### Dashboard steps (manual)

1. Cloudflare Dashboard → **R2** → Create bucket (e.g. `hrms-offer-documents`).
2. Keep the bucket **private** (do **not** enable public access / custom domain for public reads).
3. R2 → **Manage R2 API Tokens** → Create API token with **Object Read & Write** on that bucket only.
4. Note: Account ID, Access Key ID, Secret Access Key.

### Server / Vercel environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `R2_ACCOUNT_ID` | Yes* | Cloudflare account id (used to build endpoint) |
| `R2_ACCESS_KEY_ID` | Yes | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 API token secret |
| `R2_BUCKET` | Yes | Bucket name (e.g. `hrms-offer-documents`) |
| `R2_ENDPOINT` | Optional | Defaults to `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com` |
| `R2_PRESIGN_TTL_SECONDS` | Optional | Presigned GET TTL (default `300`) |

\*Either `R2_ACCOUNT_ID` **or** an explicit `R2_ENDPOINT` is required.

### Privacy rules enforced in code

- Keys are always under `tenants/{databaseName}/...` (or `platform/...` for masters).
- Downloads use **short-lived presigned GET** only — no public object URLs.
- Cross-company access is blocked by deriving `databaseName` from `req.auth.company`, never from the client.

### Deployment readiness

R2 is **not** deployment-ready until the bucket exists, the API token works, and the six variables above are set in Vercel (Production + Preview as needed). Until then, UPLOADED_DOCX upload and issued-document persistence return `STORAGE_NOT_CONFIGURED` (503).

---

## 2. Vercel Chromium / Puppeteer (DEFAULT_BUILDER PDF fidelity)

### Current code behaviour (before packaging)

On `VERCEL` / Lambda **without** a Chromium binary, `pdfService` previously skipped Puppeteer and used a text-only pure-JS PDF. That does **not** preserve letterhead/layout.

### Packages

| Package | Role |
|---------|------|
| `puppeteer` | Local/dev launches bundled Chrome |
| `puppeteer-core` | Serverless launch without bundling Chrome |
| `@sparticuz/chromium` | Serverless Chromium binary for Vercel/Lambda |

### Env / config

| Variable | Required | Purpose |
|----------|----------|---------|
| `PUPPETEER_EXECUTABLE_PATH` | Optional | Override Chrome path (CI / custom host) |
| `CHROMIUM_REMOTE_EXECUTABLE_PATH` | Optional | Remote pack URL for `@sparticuz/chromium-min` if you switch to min + hosted tarball |

### Vercel project settings (manual)

1. Server API project (`mern-hrms-api` or equivalent) → Settings → **Environment Variables**: set R2 vars; optionally Chromium overrides.
2. Function resources: increase memory for PDF routes (recommend **1024 MB**, maxDuration ≥ **30s** where plan allows) via `server/vercel.json` `functions` config.
3. Confirm Node.js **≥ 20** (matches `package.json` engines).
4. Redeploy after adding `@sparticuz/chromium` — first cold start downloads/decompresses Chromium; verify one DEFAULT_BUILDER PDF visually.

### Deployment readiness

DEFAULT_BUILDER visual PDF on Vercel is **not** claimed ready until a production smoke test shows a Chromium-rendered PDF (letterhead/layout), not the pure-JS text fallback. Local Puppeteer remains the fidelity path for development.

---

## 3. Optional LibreOffice convert worker

| Variable | Required | Purpose |
|----------|----------|---------|
| `LIBREOFFICE_CONVERT_URL` | No | Base URL of a self-hosted convert endpoint (`POST` with DOCX → PDF). When unset, DOCX templates remain usable (preview + filled DOCX download); PDF conversion returns a clear `CONVERSION_NOT_CONFIGURED` message. **No paid fallback.** |
| `LIBREOFFICE_CONVERT_TOKEN` | No | Bearer token if the worker requires auth |

Oracle Always Free VM is **deferred** — do not provision for Phase 1.

---

## 4. Explicitly not used in Phase 1

- `CONVERTAPI_SECRET` — removed; do not set.
- Public R2 URLs / custom domains for offer objects.
- Electronic signing / onboarding transitions (existing flows unchanged; not extended here).
