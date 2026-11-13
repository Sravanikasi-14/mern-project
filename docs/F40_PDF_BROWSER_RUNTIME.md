# F40 — Puppeteer PDF generation performance

## Audit summary

| Finding | Detail |
|---------|--------|
| Before | Every `generateOfferLetterPdf` call launched a **new** Chromium, never reused a warm browser, never closed pages explicitly, no concurrency cap, no HTML size bound. |
| Hot paths | Offer PDF download/send/sign (GridFS miss), payslip downloads (**always** regenerate). |
| Vercel | `api/index.js` — **1024 MB** / **60 s**; cold start unpacks `@sparticuz/chromium` inside the request. |

## Browser lifecycle (after F40)

```
ensurePdfBrowser()              ← coalesced launch promise per warm process
  └─ resolveBrowserLaunch()     (puppeteer vs puppeteer-core + @sparticuz/chromium)
  └─ puppeteer.launch once
  └─ on failure: clear promise → next request may retry
  └─ on disconnect / idle: drop handle (optional idle close)

generateOfferLetterPdf(html)
  └─ assertPdfHtmlBounds
  └─ renderHtmlWithPuppeteer
       └─ withPdfGenerationSlot (bounded concurrency)
            └─ browser.newPage()
            └─ setContent(waitUntil: load) + page.pdf(...)
            └─ finally page.close()
  └─ on Chromium failure: generatePureJsPdf fallback (layout not preserved)
```

**No unbounded browser pool** — at most one shared browser per process.

PDFs remain **synchronous** on the request path (APIs still await the buffer). Document workflow is unchanged.

## Resource limits & configuration

| Env / constant | Default | Role |
|----------------|---------|------|
| `PDF_MAX_HTML_CHARS` | `4_000_000` | Reject oversized HTML (**413**) |
| `PDF_GENERATION_CONCURRENCY` | `1` (serverless) / `2` (local) | Max parallel `page.pdf` jobs |
| `PDF_GENERATION_QUEUE_MS` | `45000` | Wait for slot; then **503** `PDF_GENERATION_BUSY` |
| `PDF_BROWSER_IDLE_MS` | `30000` (serverless) / `120000` (local) | Close idle shared browser (`0` = keep until exit) |
| `PUPPETEER_EXECUTABLE_PATH` | — | Override Chromium binary |
| `CHROMIUM_REMOTE_EXECUTABLE_PATH` | — | Sparticuz remote pack (serverless) |

Letter vs A4 options, margins, header/footer, and `preferCSSPageSize` are preserved. `waitUntil` is `load` (HTML is inlined); visual parity target unchanged for offer/payslip templates.

## Cold vs warm (Vercel)

| Instance | Behavior |
|----------|----------|
| **Cold** | First PDF pays Chromium resolve + launch inside the 60s budget; subsequent jobs on the same isolate reuse the browser. |
| **Warm** | Coalesced ensure + `newPage` only; idle timer may close the browser to free memory until the next PDF. |
| **Scale-to-zero** | No long-lived daemon — each new isolate is a cold start again. |

If Chromium cannot run safely under memory pressure, the existing pure-JS fallback may still return a `%PDF-` buffer **without** CSS layout. That limitation is documented, not silently redesigned into an async job.

## Files

| File | Change |
|------|--------|
| `server/services/pdfBrowserRuntime.js` | **New** — launch coalesce, reuse, slots, page close, bounds |
| `server/services/pdfService.js` | Uses runtime; keeps pure-JS fallback |
| `server/tests/f40_pdf_browser.test.js` | Lifecycle / concurrency / bounds / content markers |
| `docs/F40_PDF_BROWSER_RUNTIME.md` | This doc |

## Structural vs measured

| Improvement | Type |
|-------------|------|
| One Chromium per warm process; coalesced init | **Structural** |
| Concurrency cap + queue timeout | **Structural** |
| `page.close` always; idle browser close | **Structural** |
| HTML size rejection | **Structural** |

No production latency/RSS benchmarks are claimed in CI. Expected on warm instances: far fewer Chromium launches under concurrent offer/payslip downloads.

## Remaining limitations

- Payslips still regenerate on every download (no PDF cache) — store-once would be a separate change.
- Offer GridFS issued/signed reuse was already present; F40 does not alter immutability semantics.
- Pure-JS fallback can still satisfy `%PDF-` smoke tests when Chromium fails.
- Vercel 1024 MB / 60 s remains the hard ceiling for cold Chromium + large HTML.
- Do not call OfferLetter `syncIndexes()`.

## Tests

- `server/tests/f40_pdf_browser.test.js`
- Re-run: `vercel_serverless.test.js`, offer PDF / payslip download suites as available
