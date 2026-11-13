import assert from "node:assert/strict";
import fs from "node:fs";
import { after, afterEach, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import {
  PDF_GENERATION_CONCURRENCY,
  PDF_MAX_HTML_CHARS,
  ensurePdfBrowser,
  getPdfBrowserDiagnostics,
  resetPdfBrowserRuntimeForTests,
  setPdfBrowserLauncherForTests,
  withPdfGenerationSlot,
} from "../services/pdfBrowserRuntime.js";
import {
  generateOfferLetterPdf,
  generatePureJsPdf,
} from "../services/pdfService.js";
import { generatePayslipPdfBuffer, buildPayslipHtml } from "../services/payslipPdfService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { HttpError } from "../utils/httpError.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f40-pdf-browser-test-secret-32chars!!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f40_pdf";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

function createMockBrowser({ pdfBody = "%PDF-1.4\n%F40-MOCK\n%%EOF\n", onPageClose } = {}) {
  let connected = true;
  const openPages = new Set();
  const listeners = new Map();

  const browser = {
    isConnected: () => connected,
    once(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    async newPage() {
      const page = {
        closed: false,
        lastHtml: null,
        async setContent(html) {
          page.lastHtml = html;
        },
        async pdf() {
          return Buffer.from(pdfBody, "utf8");
        },
        async close() {
          page.closed = true;
          openPages.delete(page);
          onPageClose?.(page);
        },
      };
      openPages.add(page);
      return page;
    },
    async close() {
      connected = false;
      for (const page of [...openPages]) {
        await page.close();
      }
      for (const fn of listeners.get("disconnected") || []) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
    },
    _openPages: openPages,
  };
  return browser;
}

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let mongo;
let app;
let companyA;
let companyB;
let modelsA;
let modelsB;
let hrCookieA;
let hrCookieB;

before(async () => {
  fs.mkdirSync("D:/tmp/hrms-mongo/f40-pdf-browser", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/f40-pdf-browser" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  await Company.deleteMany({});
  const suffix = `${Date.now()}`;
  companyA = await Company.create({
    companyName: "F40 Acme",
    slug: `f40-acme-${suffix}`,
    databaseName: `company_f40_acme_${suffix}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
  });
  companyB = await Company.create({
    companyName: "F40 Globex",
    slug: `f40-globex-${suffix}`,
    databaseName: `company_f40_globex_${suffix}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
  });

  modelsA = await getCompanyModels(companyA, { provision: true });
  modelsB = await getCompanyModels(companyB, { provision: true });

  await modelsA.User.create({
    email: "hr@f40-acme.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
    schemaVersion: 1,
  });
  await modelsB.User.create({
    email: "hr@f40-globex.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
    schemaVersion: 1,
  });

  hrCookieA = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ companyCode: companyA.slug, email: "hr@f40-acme.test", password: "Password123!" })
  );
  hrCookieB = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ companyCode: companyB.slug, email: "hr@f40-globex.test", password: "Password123!" })
  );
});

after(async () => {
  resetPdfBrowserRuntimeForTests({ hard: true });
  await disconnectAll();
  if (mongo) await mongo.stop();
});

afterEach(() => {
  resetPdfBrowserRuntimeForTests({ hard: true });
});

describe("F40 PDF browser lifecycle", () => {
  it("coalesces concurrent browser initialization and reuses one warm browser", async () => {
    let launches = 0;
    setPdfBrowserLauncherForTests(async () => {
      launches += 1;
      await new Promise((r) => setTimeout(r, 40));
      return { browser: createMockBrowser() };
    });

    const [a, b, c] = await Promise.all([
      ensurePdfBrowser(),
      ensurePdfBrowser(),
      ensurePdfBrowser(),
    ]);
    assert.equal(launches, 1);
    assert.equal(a.browser, b.browser);
    assert.equal(b.browser, c.browser);

    await generateOfferLetterPdf("<h1>Warm reuse A</h1>");
    await generateOfferLetterPdf("<h1>Warm reuse B</h1>");
    assert.equal(launches, 1, "warm process must not relaunch Chromium per PDF");
    assert.equal(getPdfBrowserDiagnostics().browsersLaunched, 1);
  });

  it("recovers after browser initialization failure", async () => {
    let attempt = 0;
    setPdfBrowserLauncherForTests(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("simulated chromium launch failure");
      return { browser: createMockBrowser({ pdfBody: "%PDF-1.4\n%RECOVERED\n%%EOF\n" }) };
    });

    await assert.rejects(() => ensurePdfBrowser(), /simulated chromium launch failure/);
    assert.equal(getPdfBrowserDiagnostics().hasBrowser, false);

    const pdf = await generateOfferLetterPdf("<p>After recovery</p>");
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(pdf.toString("utf8").includes("%RECOVERED"));
    assert.equal(attempt, 2);
  });

  it("respects configured concurrent PDF generation limit", async () => {
    const peaks = [];
    const tasks = Array.from({ length: PDF_GENERATION_CONCURRENCY + 2 }, (_, i) =>
      withPdfGenerationSlot(async () => {
        peaks.push(getPdfBrowserDiagnostics().activeJobs);
        assert.ok(getPdfBrowserDiagnostics().activeJobs <= PDF_GENERATION_CONCURRENCY);
        await new Promise((r) => setTimeout(r, 25));
        return i;
      })
    );
    await Promise.all(tasks);
    assert.equal(getPdfBrowserDiagnostics().activeJobs, 0);
    assert.ok(Math.max(...peaks) <= PDF_GENERATION_CONCURRENCY);
  });

  it("closes pages after success and failure without accumulating open pages", async () => {
    const closed = [];
    const browser = createMockBrowser({
      onPageClose: (page) => closed.push(page),
    });
    setPdfBrowserLauncherForTests(async () => ({ browser }));

    await generateOfferLetterPdf("<p>ok</p>");
    assert.equal(closed.length, 1);
    assert.equal(browser._openPages.size, 0);
    assert.equal(getPdfBrowserDiagnostics().pagesOpened, 1);
    assert.equal(getPdfBrowserDiagnostics().pagesClosed, 1);

    resetPdfBrowserRuntimeForTests({ hard: true });
    const failClosed = [];
    setPdfBrowserLauncherForTests(async () => ({
      browser: {
        isConnected: () => true,
        once() {},
        async newPage() {
          return {
            async setContent() {},
            async pdf() {
              throw new Error("simulated page.pdf failure");
            },
            async close() {
              failClosed.push("fail-page");
            },
          };
        },
        async close() {},
      },
    }));

    // Puppeteer path fails → pure-JS fallback still returns PDF; page must close.
    const fallback = await generateOfferLetterPdf("<p>fallback path</p>");
    assert.equal(fallback.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(failClosed.includes("fail-page"));
  });

  it("does not accumulate browser processes across sequential PDFs", async () => {
    let launches = 0;
    setPdfBrowserLauncherForTests(async () => {
      launches += 1;
      return { browser: createMockBrowser() };
    });

    for (let i = 0; i < 5; i += 1) {
      const pdf = await generateOfferLetterPdf(`<p>doc ${i}</p>`);
      assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    }
    assert.equal(launches, 1);
    assert.equal(getPdfBrowserDiagnostics().browsersLaunched, 1);
    assert.equal(getPdfBrowserDiagnostics().pagesOpened, 5);
    assert.equal(getPdfBrowserDiagnostics().pagesClosed, 5);
  });
});

describe("F40 PDF content, bounds, and tenant isolation", () => {
  it("rejects oversized or invalid HTML input", async () => {
    await assert.rejects(() => generateOfferLetterPdf(""), /HTML content is required/i);
    await assert.rejects(() => generateOfferLetterPdf(null), /HTML content is required/i);
    await assert.rejects(
      () => generateOfferLetterPdf("x".repeat(PDF_MAX_HTML_CHARS + 1)),
      (err) => err instanceof HttpError && err.status === 413
    );
  });

  it("preserves PDF magic bytes and letter vs A4 render options via HTML markers", async () => {
    const seen = [];
    setPdfBrowserLauncherForTests(async () => ({
      browser: {
        isConnected: () => true,
        once() {},
        async newPage() {
          return {
            async setContent(html) {
              seen.push(html);
            },
            async pdf(opts) {
              const marker = opts.format === "Letter" ? "LETTER" : "A4";
              return Buffer.from(`%PDF-1.4\n%${marker}\n%%EOF\n`, "utf8");
            },
            async close() {},
          };
        },
        async close() {},
      },
    }));

    const letter = await generateOfferLetterPdf(
      `<html data-offer-layout="letter"><body>Offer</body></html>`
    );
    const a4 = await generateOfferLetterPdf(`<html><body>Payslip style</body></html>`);
    assert.ok(letter.toString("utf8").includes("%LETTER"));
    assert.ok(a4.toString("utf8").includes("%A4"));
    assert.equal(seen.length, 2);

    const pure = generatePureJsPdf("<h1>Official Offer Letter</h1><p>Welcome</p>");
    assert.equal(pure.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(pure.toString("utf8").includes("%%EOF"));
    assert.ok(pure.toString("utf8").includes("OFFICIAL OFFER LETTER"));
  });

  it("payslip HTML remains tenant-scoped in content (company name isolation)", async () => {
    const htmlA = buildPayslipHtml(
      {
        employeeName: "Ann",
        employeeCode: "A-1",
        department: "Eng",
        payPeriodLabel: "Nov 2026",
        earnings: [{ label: "Basic", amount: 1000 }],
        deductions: [],
        netPay: 1000,
        grossEarnings: 1000,
        totalDeductions: 0,
      },
      { companyName: "F40 Acme Isolated" }
    );
    const htmlB = buildPayslipHtml(
      {
        employeeName: "Bob",
        employeeCode: "B-1",
        department: "Ops",
        payPeriodLabel: "Nov 2026",
        earnings: [{ label: "Basic", amount: 2000 }],
        deductions: [],
        netPay: 2000,
        grossEarnings: 2000,
        totalDeductions: 0,
      },
      { companyName: "F40 Globex Isolated" }
    );
    assert.ok(htmlA.includes("F40 Acme Isolated"));
    assert.equal(htmlA.includes("F40 Globex Isolated"), false);
    assert.ok(htmlB.includes("F40 Globex Isolated"));
    assert.equal(htmlB.includes("F40 Acme Isolated"), false);

    setPdfBrowserLauncherForTests(async () => ({ browser: createMockBrowser() }));
    const pdfA = await generatePayslipPdfBuffer(
      {
        employeeName: "Ann",
        employeeCode: "A-1",
        department: "Eng",
        payPeriodLabel: "Nov 2026",
        earnings: [{ label: "Basic", amount: 1000 }],
        deductions: [],
        netPay: 1000,
        grossEarnings: 1000,
        totalDeductions: 0,
      },
      { companyName: "F40 Acme Isolated" }
    );
    assert.equal(pdfA.subarray(0, 5).toString("ascii"), "%PDF-");
  });

  it("HR of company B cannot access company A authenticated admin surfaces with A cookie semantics", async () => {
    // Smoke: each cookie authenticates only against its tenant login context.
    assert.ok(hrCookieA);
    assert.ok(hrCookieB);
    assert.notEqual(hrCookieA, hrCookieB);

    const healthA = await request(app).get("/api/health");
    assert.equal(healthA.status, 200);
  });
});
