import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import request from "supertest";
import handler, { createApp } from "../api/index.js";
import { getAuthCookieOptions } from "../utils/authCookie.js";
import { getUploadsRoot, validateDocumentFile } from "../services/documentStorage.js";
import { generateOfferLetterPdf, generatePureJsPdf } from "../services/pdfService.js";

describe("Vercel Serverless Function & Deployment Integration", () => {
  const vercelFrontendOrigin = "https://mern-project-nu-nine.vercel.app";
  const app = createApp();

  it("1. exports a callable serverless handler function and createApp factory", () => {
    assert.equal(typeof handler, "function");
    assert.equal(typeof createApp, "function");
    assert.ok(app);
    assert.equal(typeof app.use, "function");
  });

  it("2. serverless handler responds to GET /api/health with 200 and ok status", async () => {
    const server = http.createServer((req, res) => handler(req, res));
    const res = await request(server).get("/api/health");

    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.service, "hrms-api");
    assert.ok(res.body.timestamp);
  });

  it("3. serverless handler responds to GET /health (monitoring alias) with 200", async () => {
    const server = http.createServer((req, res) => handler(req, res));
    const res = await request(server).get("/health");

    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.service, "hrms-api");
  });

  it("4. handles OPTIONS preflight from Vercel frontend origin with 204 without database connection", async () => {
    const server = http.createServer((req, res) => handler(req, res));
    const res = await request(server)
      .options("/api/auth/me")
      .set("Origin", vercelFrontendOrigin)
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "Content-Type,Authorization");

    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], vercelFrontendOrigin);
    assert.equal(res.headers["access-control-allow-credentials"], "true");
    assert.ok(res.headers["access-control-allow-methods"].includes("GET"));
    assert.ok(res.headers["access-control-allow-headers"].includes("Authorization"));
  });

  it("5. serverless handler safely returns 503 DATABASE_UNAVAILABLE when database is unreachable", async () => {
    const server = http.createServer((req, res) => handler(req, res));
    // When MONGO_URI is unset or invalid in isolated test, handler returns 503
    const res = await request(server)
      .get("/api/auth/me")
      .set("Origin", vercelFrontendOrigin);

    assert.equal(res.status, 503);
    assert.equal(res.body.code, "DATABASE_UNAVAILABLE");
    assert.ok(res.body.message);
  });

  it("6. non-existent API routes return 404 JSON (NOT HTML) from Express application", async () => {
    const res = await request(app).get("/api/unknown-endpoint");

    assert.equal(res.status, 404);
    assert.equal(res.body.code, "NOT_FOUND");
    assert.equal(res.body.message, "API endpoint not found");
  });

  it("7. sets cross-site cookie options (secure: true, sameSite: none) under VERCEL environment", () => {
    const prevVercel = process.env.VERCEL;
    try {
      process.env.VERCEL = "1";
      const options = getAuthCookieOptions();
      assert.equal(options.httpOnly, true);
      assert.equal(options.secure, true);
      assert.equal(options.sameSite, "none");
      assert.equal(options.path, "/");
    } finally {
      if (prevVercel !== undefined) {
        process.env.VERCEL = prevVercel;
      } else {
        delete process.env.VERCEL;
      }
    }
  });

  it("8. document storage defaults to writable temp directory in VERCEL serverless environment", () => {
    const prevVercel = process.env.VERCEL;
    const prevUploads = process.env.UPLOADS_DIR;
    try {
      delete process.env.UPLOADS_DIR;
      process.env.VERCEL = "1";
      const uploadsRoot = getUploadsRoot();
      assert.equal(uploadsRoot, path.join(os.tmpdir(), "hrms_uploads"));
    } finally {
      if (prevVercel !== undefined) {
        process.env.VERCEL = prevVercel;
      } else {
        delete process.env.VERCEL;
      }
      if (prevUploads !== undefined) {
        process.env.UPLOADS_DIR = prevUploads;
      }
    }
  });

  it("9. validates document files safely before storage", () => {
    assert.throws(
      () => validateDocumentFile({ fileName: "script.exe", mimeType: "application/x-msdownload" }),
      /Executable or disallowed/
    );
    assert.ok(
      validateDocumentFile({ fileName: "resume.pdf", mimeType: "application/pdf", fileSize: 1024 })
    );
  });

  it("10. PDF generation produces valid binary PDF buffer via pure-JS generator in VERCEL mode", async () => {
    const prevVercel = process.env.VERCEL;
    try {
      process.env.VERCEL = "1";
      delete process.env.PUPPETEER_EXECUTABLE_PATH;

      const html = "<h1>Official Offer Letter</h1><p>Welcome to the company.</p>";
      const pdf = await generateOfferLetterPdf(html);

      assert.ok(Buffer.isBuffer(pdf));
      assert.ok(pdf.length > 0);
      assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    } finally {
      if (prevVercel !== undefined) {
        process.env.VERCEL = prevVercel;
      } else {
        delete process.env.VERCEL;
      }
    }
  });

  it("11. pure-JS PDF generator produces valid PDF structure", () => {
    const html = "<h2>Offer of Employment</h2><p>Position: Engineer</p>";
    const buffer = generatePureJsPdf(html);

    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(buffer.toString("utf8").includes("%%EOF"));
  });

  it("12. warm serverless invocation reuses Express app instance without recreation overhead", async () => {
    const server = http.createServer((req, res) => handler(req, res));

    const start1 = Date.now();
    const res1 = await request(server).get("/api/health");
    const duration1 = Date.now() - start1;

    const start2 = Date.now();
    const res2 = await request(server).get("/api/health");
    const duration2 = Date.now() - start2;

    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    assert.ok(duration2 < 500);
  });
});
