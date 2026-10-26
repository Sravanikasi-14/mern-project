process.env.NODE_ENV = "test";
process.env.MONGOMS_MD5_CHECK = "0";

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { getCentralDbName, getCompanyModels, disconnectAll } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import { emailService } from "../services/emailService.js";
import { encryptSecret, decryptSecret } from "../utils/secretCrypto.js";

let mongod;
let app;
let companyA;
let companyB;
let hrCookieA;
let hrCookieB;

function cookieFrom(res) {
  const cookieHeader = res.headers["set-cookie"];
  if (!cookieHeader) return "";
  return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
}

describe("Tenant-Specific Email Configuration & Settings Verification Suite", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "company_email_config_test_jwt_secret_32chars!";
    process.env.COOKIE_SECRET = "company_email_config_test_cookie_secret_32chars!";
    process.env.CENTRAL_DB_NAME = "central_company_email_test";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    // 1. Create Company A (initially configured)
    companyA = await Company.create({
      companyName: "Alpha Corp",
      slug: "alpha",
      databaseName: "tenant_alpha_email",
      status: COMPANY_STATUSES.ACTIVE,
      emailSettings: {
        fromName: "Alpha HR",
        fromEmail: "hr@alpha.test",
        smtpHost: "smtp.alpha.test",
        smtpPort: 587,
        smtpSecure: false,
        appPasswordEncrypted: encryptSecret("alpha-smtp-pass-1234"),
        isConfigured: true,
        lastVerifiedAt: new Date(),
      },
    });

    // 2. Create Company B (initially unconfigured)
    companyB = await Company.create({
      companyName: "Beta Solutions",
      slug: "beta",
      databaseName: "tenant_beta_email",
      status: COMPANY_STATUSES.ACTIVE,
    });

    // Setup HR Admin for Company A
    const { User: UserA } = await getCompanyModels(companyA);
    await UserA.create({
      email: "hr@alpha.test",
      passwordHash: await hashPassword("AlphaPass123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    // Setup HR Admin for Company B
    const { User: UserB } = await getCompanyModels(companyB);
    await UserB.create({
      email: "hr@beta.test",
      passwordHash: await hashPassword("BetaPass123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    // Login Alpha HR
    const loginA = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "alpha", email: "hr@alpha.test", password: "AlphaPass123!" });
    assert.equal(loginA.status, 200);
    hrCookieA = cookieFrom(loginA);

    // Login Beta HR
    const loginB = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "beta", email: "hr@beta.test", password: "BetaPass123!" });
    assert.equal(loginB.status, 200);
    hrCookieB = cookieFrom(loginB);

    // Provide mock transporter so tests never require real network sockets
    emailService.setTransporter({
      sendMail: async (options) => ({ messageId: `msg_${Date.now()}` }),
      verify: async () => true,
    });
  });

  after(async () => {
    emailService.setTransporter(null);
    await disconnectAll();
    if (mongod) {
      await mongod.stop();
    }
  });

  beforeEach(() => {
    emailService.setSimulateFailure(false);
  });

  it("1. GET /api/settings/email returns configured settings without exposing plaintext or encrypted passwords", async () => {
    const res = await request(app)
      .get("/api/settings/email")
      .set("Cookie", hrCookieA);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.emailSettings);

    const s = res.body.emailSettings;
    assert.equal(s.fromName, "Alpha HR");
    assert.equal(s.fromEmail, "hr@alpha.test");
    assert.equal(s.smtpHost, "smtp.alpha.test");
    assert.equal(s.smtpPort, 587);
    assert.equal(s.smtpSecure, false);
    assert.equal(s.hasAppPassword, true);
    assert.equal(s.isConfigured, true);

    // Security check: neither plaintext nor encrypted password should be returned
    assert.equal(s.appPassword, undefined);
    assert.equal(s.appPasswordEncrypted, undefined);
    assert.equal(s.pass, undefined);
    assert.equal(s.password, undefined);
  });

  it("2. GET /api/settings/email reports unconfigured state accurately for Company B", async () => {
    const res = await request(app)
      .get("/api/settings/email")
      .set("Cookie", hrCookieB);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const s = res.body.emailSettings;
    assert.equal(s.hasAppPassword, false);
    assert.equal(s.isConfigured, false);
  });

  it("3. PUT /api/settings/email rejects invalid email address", async () => {
    const res = await request(app)
      .put("/api/settings/email")
      .set("Cookie", hrCookieA)
      .send({
        fromEmail: "invalid-email-format",
        appPassword: "newpassword1234",
      });

    assert.equal(res.status, 400);
    assert.ok(res.body.message.toLowerCase().includes("email"));
  });

  it("4. PUT /api/settings/email rejects invalid SMTP port", async () => {
    const res = await request(app)
      .put("/api/settings/email")
      .set("Cookie", hrCookieA)
      .send({
        fromEmail: "valid@alpha.test",
        smtpPort: 99999,
        appPassword: "newpassword1234",
      });

    assert.equal(res.status, 400);
    assert.ok(res.body.message.toLowerCase().includes("port"));
  });

  it("5. PUT /api/settings/email rejects password shorter than 6 characters", async () => {
    const res = await request(app)
      .put("/api/settings/email")
      .set("Cookie", hrCookieA)
      .send({
        fromEmail: "valid@alpha.test",
        appPassword: "123",
      });

    assert.equal(res.status, 400);
    assert.ok(res.body.message.toLowerCase().includes("password"));
  });

  it("6. PUT /api/settings/email does NOT overwrite previously saved credentials if verification fails", async () => {
    // Inject a failing verification mock
    emailService.setTransporter({
      sendMail: async () => ({ messageId: "fail" }),
      verify: async () => {
        throw new Error("Invalid SMTP credentials (535 Authentication Failed)");
      },
    });

    const res = await request(app)
      .put("/api/settings/email")
      .set("Cookie", hrCookieA)
      .send({
        fromEmail: "hacker@alpha.test",
        smtpHost: "smtp.badhost.test",
        smtpPort: 2525,
        appPassword: "wrongpassword1234",
      });

    assert.equal(res.status, 400);
    assert.ok(res.body.message.includes("535 Authentication Failed") || res.body.message.includes("verify"));

    // Verify database state: Company A settings MUST remain untouched
    const freshCompanyA = await Company.findById(companyA._id);
    assert.equal(freshCompanyA.emailSettings.fromEmail, "hr@alpha.test");
    assert.equal(freshCompanyA.emailSettings.smtpHost, "smtp.alpha.test");
    assert.equal(freshCompanyA.emailSettings.smtpPort, 587);
    const decryptedPass = decryptSecret(freshCompanyA.emailSettings.appPasswordEncrypted);
    assert.equal(decryptedPass, "alpha-smtp-pass-1234");
  });

  it("7. PUT /api/settings/email successfully saves verified settings and invalidates transporter cache", async () => {
    // Inject a succeeding verification mock
    emailService.setTransporter({
      sendMail: async () => ({ messageId: `msg_${Date.now()}` }),
      verify: async () => true,
    });

    const res = await request(app)
      .put("/api/settings/email")
      .set("Cookie", hrCookieA)
      .send({
        fromName: "Alpha Updated HR",
        fromEmail: "updated-hr@alpha.test",
        smtpHost: "smtp.alpha-updated.test",
        smtpPort: 465,
        smtpSecure: true,
        appPassword: "new-super-secure-pass-456",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.emailSettings.fromName, "Alpha Updated HR");
    assert.equal(res.body.emailSettings.fromEmail, "updated-hr@alpha.test");
    assert.equal(res.body.emailSettings.smtpHost, "smtp.alpha-updated.test");
    assert.equal(res.body.emailSettings.smtpPort, 465);
    assert.equal(res.body.emailSettings.smtpSecure, true);
    assert.equal(res.body.emailSettings.hasAppPassword, true);

    // Verify DB
    const freshCompanyA = await Company.findById(companyA._id);
    assert.equal(freshCompanyA.emailSettings.fromEmail, "updated-hr@alpha.test");
    assert.equal(decryptSecret(freshCompanyA.emailSettings.appPasswordEncrypted), "new-super-secure-pass-456");
  });

  it("8. POST /api/settings/email/test rejects when company has no configured email", async () => {
    const res = await request(app)
      .post("/api/settings/email/test")
      .set("Cookie", hrCookieB)
      .send({ to: "test@example.test" });

    assert.equal(res.status, 400);
    assert.ok(res.body.message.toLowerCase().includes("configure"));
  });

  it("9. POST /api/settings/email/test succeeds when company email is properly configured", async () => {
    let captured = null;
    emailService.setTransporter({
      sendMail: async (options) => {
        captured = options;
        return { messageId: "smtp_test_sent_456" };
      },
      verify: async () => true,
    });

    const res = await request(app)
      .post("/api/settings/email/test")
      .set("Cookie", hrCookieA)
      .send({ to: "recipient@example.test" });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.recipient, "recipient@example.test");
    assert.equal(res.body.messageId, "smtp_test_sent_456");
    assert.ok(captured);
    assert.equal(captured.to, "recipient@example.test");
    assert.equal(captured.from, "Alpha Updated HR <updated-hr@alpha.test>");
  });

  it("10. Tenant Isolation: Company B never falls back to platform environment credentials", async () => {
    // Set global platform credentials
    process.env.SMTP_USER = "platform-global@example.test";
    process.env.SMTP_APP_PASSWORD = "global-secret-password-123";
    process.env.EMAIL_FROM = "Platform Global <platform-global@example.test>";

    // Remove custom mock transporter so real resolution takes place
    emailService.setTransporter(null);

    const freshCompanyB = await Company.findById(companyB._id);
    assert.equal(emailService.isConfigured(freshCompanyB), false);

    const sendResult = await emailService.sendMail({
      to: "candidate@example.test",
      subject: "Company B Test",
      text: "Test content",
      company: freshCompanyB,
    });

    assert.equal(sendResult.success, false);
    assert.equal(sendResult.code, "COMPANY_EMAIL_NOT_CONFIGURED");
    assert.ok(sendResult.error.toLowerCase().includes("not configured for this company"));
  });
});
