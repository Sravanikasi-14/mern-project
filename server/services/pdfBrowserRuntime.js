/**
 * F40 — Puppeteer / Chromium lifecycle for HTML→PDF.
 *
 * - One browser per warm process (no unbounded pool)
 * - Coalesced launch (concurrent first requests share one promise)
 * - Bounded concurrent page jobs
 * - Every page closed after success/failure
 * - Launch failures clear state so a later request can retry
 *
 * PDFs remain synchronous on the request path (callers still await the buffer).
 */

import { HttpError } from "../utils/httpError.js";

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/** Max HTML characters accepted for PDF generation. */
export const PDF_MAX_HTML_CHARS = Math.max(
  50_000,
  Number(process.env.PDF_MAX_HTML_CHARS) || 4_000_000
);

/** Parallel page.pdf jobs per process. Default 1 on serverless, 2 locally. */
export const PDF_GENERATION_CONCURRENCY = Math.max(
  1,
  Math.min(
    4,
    Number(process.env.PDF_GENERATION_CONCURRENCY) || (isServerlessRuntime() ? 1 : 2)
  )
);

/** Max wait for a generation slot (ms). */
export const PDF_GENERATION_QUEUE_MS = Math.max(
  1000,
  Number(process.env.PDF_GENERATION_QUEUE_MS) || 45_000
);

/** Close idle shared browser after this many ms (0 = keep until process exit). */
export const PDF_BROWSER_IDLE_MS = Math.max(
  0,
  Number(process.env.PDF_BROWSER_IDLE_MS) || (isServerlessRuntime() ? 30_000 : 120_000)
);

/**
 * @typedef {object} PdfBrowserState
 * @property {Promise<object>|null} launchPromise
 * @property {import("puppeteer").Browser|null} browser
 * @property {object|null} puppeteer
 * @property {object|null} launchOptions
 * @property {number} launchAttempts
 * @property {number} launchSuccessCount
 * @property {Error|null} lastLaunchError
 * @property {number} activeJobs
 * @property {number} peakActiveJobs
 * @property {number} pagesOpened
 * @property {number} pagesClosed
 * @property {number} browsersLaunched
 * @property {number} browsersClosed
 * @property {Array<{ resolve: Function, reject: Function, timer: NodeJS.Timeout }>} waitQueue
 * @property {NodeJS.Timeout|null} idleTimer
 */

/** @type {PdfBrowserState} */
let state = createFreshState();

/** Test-only launcher override. */
let testLauncher = null;

function createFreshState() {
  return {
    launchPromise: null,
    browser: null,
    puppeteer: null,
    launchOptions: null,
    launchAttempts: 0,
    launchSuccessCount: 0,
    lastLaunchError: null,
    activeJobs: 0,
    peakActiveJobs: 0,
    pagesOpened: 0,
    pagesClosed: 0,
    browsersLaunched: 0,
    browsersClosed: 0,
    waitQueue: [],
    idleTimer: null,
  };
}

export function getPdfBrowserDiagnostics() {
  return {
    hasBrowser: Boolean(state.browser),
    launchInFlight: Boolean(state.launchPromise) && !state.browser,
    launchAttempts: state.launchAttempts,
    launchSuccessCount: state.launchSuccessCount,
    lastLaunchError: state.lastLaunchError
      ? String(state.lastLaunchError.message || state.lastLaunchError)
      : null,
    activeJobs: state.activeJobs,
    peakActiveJobs: state.peakActiveJobs,
    waitQueueLength: state.waitQueue.length,
    pagesOpened: state.pagesOpened,
    pagesClosed: state.pagesClosed,
    browsersLaunched: state.browsersLaunched,
    browsersClosed: state.browsersClosed,
    concurrency: PDF_GENERATION_CONCURRENCY,
    maxHtmlChars: PDF_MAX_HTML_CHARS,
    idleMs: PDF_BROWSER_IDLE_MS,
    serverless: isServerlessRuntime(),
  };
}

/**
 * @param {null|(() => Promise<{ browser: object, puppeteer?: object, launchOptions?: object }>)} fn
 */
export function setPdfBrowserLauncherForTests(fn) {
  testLauncher = typeof fn === "function" ? fn : null;
}

export function resetPdfBrowserRuntimeForTests({ hard = true } = {}) {
  clearIdleTimer();
  for (const waiter of state.waitQueue) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("PDF browser runtime reset"));
  }
  const browser = state.browser;
  state = createFreshState();
  if (hard) {
    testLauncher = null;
  }
  if (browser) {
    Promise.resolve()
      .then(() => browser.close?.())
      .catch(() => {});
  }
}

function clearIdleTimer() {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
}

function scheduleIdleClose() {
  clearIdleTimer();
  if (!PDF_BROWSER_IDLE_MS || !state.browser) return;
  state.idleTimer = setTimeout(() => {
    void closeSharedBrowser("idle");
  }, PDF_BROWSER_IDLE_MS);
  // Allow process to exit on local even if timer is pending.
  if (typeof state.idleTimer.unref === "function") {
    state.idleTimer.unref();
  }
}

function browserLooksConnected(browser) {
  if (!browser) return false;
  try {
    if (typeof browser.isConnected === "function") return browser.isConnected();
    if (typeof browser.connected === "boolean") return browser.connected;
    return true;
  } catch {
    return false;
  }
}

async function closeSharedBrowser(reason = "") {
  clearIdleTimer();
  const browser = state.browser;
  state.browser = null;
  state.launchPromise = null;
  state.puppeteer = null;
  state.launchOptions = null;
  if (!browser) return;
  try {
    await browser.close();
    state.browsersClosed += 1;
  } catch (err) {
    console.warn(
      `[pdfBrowserRuntime] Warning closing browser (${reason || "teardown"}):`,
      err?.message || err
    );
  }
}

/**
 * Resolve puppeteer + launch options (cached after first success via ensurePdfBrowser).
 */
export async function resolveBrowserLaunch() {
  const executableOverride = process.env.PUPPETEER_EXECUTABLE_PATH || "";

  if (isServerlessRuntime()) {
    const [{ default: puppeteerCore }, chromium] = await Promise.all([
      import("puppeteer-core"),
      import("@sparticuz/chromium"),
    ]);
    try {
      chromium.default.setGraphicsMode = false;
    } catch {
      /* older builds may not expose setGraphicsMode */
    }
    const remotePack = process.env.CHROMIUM_REMOTE_EXECUTABLE_PATH || "";
    const executablePath = executableOverride
      ? executableOverride
      : remotePack
        ? await chromium.default.executablePath(remotePack)
        : await chromium.default.executablePath();
    return {
      puppeteer: puppeteerCore,
      launchOptions: {
        args: chromium.default.args,
        defaultViewport: chromium.default.defaultViewport,
        executablePath,
        headless: chromium.default.headless ?? "shell",
        ignoreHTTPSErrors: true,
      },
    };
  }

  const { default: puppeteer } = await import("puppeteer");
  return {
    puppeteer,
    launchOptions: {
      headless: true,
      executablePath: executableOverride || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--disable-extensions",
      ],
    },
  };
}

async function launchBrowserFromDisk() {
  const { puppeteer, launchOptions } = await resolveBrowserLaunch();
  const browser = await puppeteer.launch(launchOptions);
  return { browser, puppeteer, launchOptions };
}

/**
 * Coalesced browser ensure. Concurrent callers share one launch promise.
 */
export async function ensurePdfBrowser() {
  if (browserLooksConnected(state.browser)) {
    return state;
  }
  // Drop a dead browser handle before relaunch.
  if (state.browser) {
    await closeSharedBrowser("disconnected");
  }
  if (state.launchPromise) {
    return state.launchPromise;
  }

  state.launchPromise = (async () => {
    state.launchAttempts += 1;
    try {
      const loaded = testLauncher ? await testLauncher() : await launchBrowserFromDisk();
      if (!loaded?.browser) {
        throw new Error("PDF browser launcher returned no browser instance.");
      }
      state.browser = loaded.browser;
      state.puppeteer = loaded.puppeteer || null;
      state.launchOptions = loaded.launchOptions || null;
      state.launchSuccessCount += 1;
      state.browsersLaunched += 1;
      state.lastLaunchError = null;

      try {
        state.browser.once?.("disconnected", () => {
          if (state.browser === loaded.browser) {
            state.browser = null;
            state.launchPromise = null;
          }
        });
      } catch {
        /* ignore */
      }

      return state;
    } catch (err) {
      state.lastLaunchError = err instanceof Error ? err : new Error(String(err));
      state.browser = null;
      state.puppeteer = null;
      state.launchOptions = null;
      state.launchPromise = null;
      throw state.lastLaunchError;
    }
  })();

  return state.launchPromise;
}

/**
 * Acquire a bounded PDF generation slot. Queue timeout → 503 (never skips silently).
 */
export async function withPdfGenerationSlot(fn) {
  clearIdleTimer();

  if (state.activeJobs >= PDF_GENERATION_CONCURRENCY) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = state.waitQueue.findIndex((w) => w.timer === timer);
        if (idx >= 0) state.waitQueue.splice(idx, 1);
        reject(
          new HttpError(503, "PDF generation is busy. Please retry in a moment.", {
            code: "PDF_GENERATION_BUSY",
          })
        );
      }, PDF_GENERATION_QUEUE_MS);
      state.waitQueue.push({ resolve, reject, timer });
    });
  }

  state.activeJobs += 1;
  if (state.activeJobs > state.peakActiveJobs) {
    state.peakActiveJobs = state.activeJobs;
  }
  try {
    return await fn();
  } finally {
    state.activeJobs = Math.max(0, state.activeJobs - 1);
    const next = state.waitQueue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
    } else if (state.activeJobs === 0) {
      scheduleIdleClose();
    }
  }
}

export function assertPdfHtmlBounds(htmlContent) {
  if (!htmlContent || typeof htmlContent !== "string") {
    throw new HttpError(400, "HTML content is required to generate PDF.");
  }
  if (htmlContent.length > PDF_MAX_HTML_CHARS) {
    throw new HttpError(
      413,
      `HTML content is too large for PDF generation (max ${PDF_MAX_HTML_CHARS} characters).`,
      { code: "PDF_HTML_TOO_LARGE" }
    );
  }
}

/**
 * Render HTML to a PDF buffer using the shared warm browser.
 * Always closes the page; does not close the shared browser (idle timer may).
 */
export async function renderHtmlWithPuppeteer(htmlContent) {
  assertPdfHtmlBounds(htmlContent);

  return withPdfGenerationSlot(async () => {
    let runtime = await ensurePdfBrowser();
    if (!browserLooksConnected(runtime.browser)) {
      await closeSharedBrowser("stale");
      runtime = await ensurePdfBrowser();
    }

    let page = null;
    try {
      page = await runtime.browser.newPage();
      state.pagesOpened += 1;

      // Offer/payslip HTML is fully inlined (data URLs); "load" is enough and avoids
      // hanging on networkidle when no external subresources exist.
      await page.setContent(htmlContent, {
        waitUntil: ["load"],
        timeout: 30_000,
      });

      const isLetterLayout = /data-offer-layout=["']letter["']/.test(htmlContent);
      const rawPdf = isLetterLayout
        ? await page.pdf({
            format: "Letter",
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: "0", bottom: "0", left: "0", right: "0" },
            displayHeaderFooter: false,
          })
        : await page.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: "16mm", bottom: "18mm", left: "16mm", right: "16mm" },
            displayHeaderFooter: true,
            headerTemplate: "<div></div>",
            footerTemplate: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 8.5px; color: #94a3b8; width: 100%; display: flex; justify-content: flex-end; padding-right: 16mm;">
          Page&nbsp;<span class="pageNumber"></span>&nbsp;of&nbsp;<span class="totalPages"></span>
        </div>
      `,
          });

      const pdfBuffer = Buffer.isBuffer(rawPdf) ? rawPdf : Buffer.from(rawPdf);
      if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
        throw new HttpError(500, "Failed to generate PDF document: generated buffer is empty.");
      }
      return pdfBuffer;
    } finally {
      if (page) {
        try {
          await page.close();
          state.pagesClosed += 1;
        } catch (closeErr) {
          console.warn("[pdfBrowserRuntime] Warning closing page:", closeErr?.message || closeErr);
        }
      }
    }
  });
}
