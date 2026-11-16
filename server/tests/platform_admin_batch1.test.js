process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "tenant-jwt-secret-for-platform-batch1-tests!!";
process.env.PLATFORM_JWT_SECRET = "platform-jwt-secret-batch1-tests-32ch!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_admin_batch1";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.PLATFORM_AUTH_COOKIE_NAME = "hrms_platform_auth";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import PlatformAdmin from "../models/PlatformAdmin.js";
import PlatformAdminSession from "../models/PlatformAdminSession.js";
import PlatformAuditLog, { PLATFORM_AUDIT_ACTIONS } from "../models/PlatformAuditLog.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { getPlatformAuthCookieName } from "../utils/platformAuthCookie.js";
import { verifyTotpCode, generateTotpSecret, buildOtpAuthUrl } from "../utils/platformTotp.js";
import { encryptSecret, decryptSecret } from "../utils/platformSecretCrypto.js";

function cookieFrom(response, name) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${name}=`));
}

import crypto from "node:crypto";

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const str = String(input || "").toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpNow(secret) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i -= 1) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

describe("Platform Admin Batch 1", () => {
  let mongo;
  let app;
  let platformCookie;
  let tenantCompany;
  let hrCookie;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    // Smoke TOTP helpers
    const secret = generateTotpSecret();
    assert.ok(buildOtpAuthUrl({ secret, email: "a@b.co" }).startsWith("otpauth://"));
    assert.equal(verifyTotpCode(secret, totpNow(secret)), true);
    const enc = encryptSecret(secret);
    assert.equal(decryptSecret(enc), secret);

    await PlatformAdmin.create({
      singletonKey: "default",
      email: "platform@hrms.test",
      passwordHash: await hashPassword("PlatformPass123!"),
      fullName: "Platform Admin",
      isActive: true,
      mfaEnabled: false,
    });

    tenantCompany = await Company.create({
      companyName: "Tenant Co",
      slug: "tenant-co",
      databaseName: "company_tenant_co",
      status: COMPANY_STATUSES.ACTIVE,
      subscription: { plan: "TRIAL", maxEmployeeSeats: 10 },
    });
    const models = await getCompanyModels(tenantCompany, { provision: true });
    await models.User.create({
      email: "hr@tenant-co.test",
      passwordHash: await hashPassword("HrPass123!"),
      role: USER_ROLES.HR_ADMIN,
      fullName: "HR Admin",
      isActive: true,
    });
    const login = await request(app).post("/api/auth/login").send({
      email: "hr@tenant-co.test",
      password: "HrPass123!",
      companyCode: "tenant-co",
    });
    assert.equal(login.status, 200);
    hrCookie = cookieFrom(login, getAuthCookieName());
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("rejects unauthenticated platform overview", async () => {
    const res = await request(app).get("/api/platform/overview");
    assert.equal(res.status, 401);
  });

  it("rejects tenant HR cookie on platform APIs", async () => {
    const res = await request(app).get("/api/platform/overview").set("Cookie", hrCookie);
    assert.equal(res.status, 401);
  });

  it("login alone does not grant a platform session (MFA mandatory)", async () => {
    const res = await request(app).post("/api/platform/auth/login").send({
      email: "platform@hrms.test",
      password: "PlatformPass123!",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.requiresMfaSetup, true);
    assert.ok(res.body.mfaToken);
    assert.equal(res.body.token, undefined);
    assert.equal(cookieFrom(res, getPlatformAuthCookieName()), undefined);

    const me = await request(app).get("/api/platform/auth/me");
    assert.equal(me.status, 401);
  });

  it("completes MFA enrollment and issues a session; secrets never exposed on me", async () => {
    const login = await request(app).post("/api/platform/auth/login").send({
      email: "platform@hrms.test",
      password: "PlatformPass123!",
    });
    const mfaToken = login.body.mfaToken;

    const start = await request(app)
      .post("/api/platform/auth/mfa/setup/start")
      .send({ mfaToken });
    assert.equal(start.status, 200);
    assert.ok(start.body.secret);
    assert.ok(start.body.otpauthUrl);

    const confirm = await request(app)
      .post("/api/platform/auth/mfa/setup/confirm")
      .send({ mfaToken, code: totpNow(start.body.secret) });
    assert.equal(confirm.status, 200);
    assert.ok(confirm.body.token);
    assert.ok(Array.isArray(confirm.body.recoveryCodes));
    assert.ok(confirm.body.recoveryCodes.length >= 8);
    platformCookie = cookieFrom(confirm, getPlatformAuthCookieName());
    assert.ok(platformCookie);

    const me = await request(app)
      .get("/api/platform/auth/me")
      .set("Cookie", platformCookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.admin.email, "platform@hrms.test");
    assert.equal(me.body.admin.mfaEnabled, true);
    assert.equal(me.body.admin.passwordHash, undefined);
    assert.equal(me.body.admin.mfaSecretEncrypted, undefined);
    assert.equal(me.body.admin.mfaRecoveryCodeHashes, undefined);

    const body = JSON.stringify(me.body);
    assert.equal(body.includes(start.body.secret), false);
  });

  it("enforces singleton Platform Admin identity", async () => {
    const passwordHash = await hashPassword("OtherPass123456");
    await assert.rejects(
      () =>
        PlatformAdmin.create({
          singletonKey: "default",
          email: "other@hrms.test",
          passwordHash,
          fullName: "Other",
          isActive: true,
        }),
      /duplicate key|E11000/i
    );
  });


  it("serves overview from central metadata without inventing employee counts", async () => {
    const res = await request(app)
      .get("/api/platform/overview")
      .set("Cookie", platformCookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.companies.total >= 1);
    assert.ok(Array.isArray(res.body.unavailableMetrics));
    assert.ok(res.body.unavailableMetrics.some((m) => m.key === "employeeCounts"));
    assert.equal(res.body.employeeCount, undefined);
    assert.equal(res.body.employees, undefined);
  });

  it("creates a company, provisions tenant, and records audit without tenant PII", async () => {
    const res = await request(app)
      .post("/api/platform/companies")
      .set("Cookie", platformCookie)
      .send({
        companyName: "Batch One Co",
        slug: "batch-one",
        primaryContact: { fullName: "Ops", email: "ops@batch-one.test" },
        subscription: { plan: "GROWTH", maxEmployeeSeats: 25 },
        status: "ACTIVE",
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.company.slug, "batch-one");
    assert.equal(res.body.company.databaseName, undefined);
    assert.ok(res.body.company.provisioning);
    assert.equal(res.body.company.employees, undefined);

    const detail = await request(app)
      .get(`/api/platform/companies/${res.body.company.id}`)
      .set("Cookie", platformCookie);
    assert.equal(detail.status, 200);
    const raw = JSON.stringify(detail.body);
    assert.equal(raw.includes("databaseName"), false);
    assert.equal(raw.includes("passwordHash"), false);
    assert.equal(raw.includes("appPasswordEncrypted"), false);

    const createdAudit = await PlatformAuditLog.findOne({
      action: PLATFORM_AUDIT_ACTIONS.COMPANY_CREATED,
      targetId: res.body.company.id,
    }).lean();
    assert.ok(createdAudit);

    // Suspend / activate
    const suspended = await request(app)
      .post(`/api/platform/companies/${res.body.company.id}/status`)
      .set("Cookie", platformCookie)
      .send({ status: "SUSPENDED", confirm: true });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.company.status, "SUSPENDED");

    const companyDoc = await Company.findById(res.body.company.id).lean();
    assert.equal(companyDoc.status, COMPANY_STATUSES.SUSPENDED);
    assert.ok(companyDoc.databaseName); // data retained

    const activated = await request(app)
      .post(`/api/platform/companies/${res.body.company.id}/status`)
      .set("Cookie", platformCookie)
      .send({ status: "ACTIVE", confirm: true });
    assert.equal(activated.status, 200);
    assert.equal(activated.body.company.status, "ACTIVE");
  });

  it("status change without confirm is rejected", async () => {
    const listed = await request(app)
      .get("/api/platform/companies")
      .query({ search: "batch-one" })
      .set("Cookie", platformCookie);
    const id = listed.body.companies[0].id;
    const res = await request(app)
      .post(`/api/platform/companies/${id}/status`)
      .set("Cookie", platformCookie)
      .send({ status: "SUSPENDED" });
    assert.equal(res.status, 400);
  });

  it("revoked platform session is rejected", async () => {
    await PlatformAdminSession.updateMany({}, { $set: { isActive: false } });
    const res = await request(app).get("/api/platform/overview").set("Cookie", platformCookie);
    assert.equal(res.status, 401);

    // Re-login with MFA verify for later tests
    const login = await request(app).post("/api/platform/auth/login").send({
      email: "platform@hrms.test",
      password: "PlatformPass123!",
    });
    assert.equal(login.body.requiresMfa, true);
    const admin = await PlatformAdmin.findOne({ email: "platform@hrms.test" })
      .select("+mfaSecretEncrypted")
      .lean();
    const { decryptSecret: dec } = await import("../utils/platformSecretCrypto.js");
    const secret = dec(admin.mfaSecretEncrypted);
    const verify = await request(app)
      .post("/api/platform/auth/mfa/verify")
      .send({ mfaToken: login.body.mfaToken, code: totpNow(secret) });
    assert.equal(verify.status, 200);
    platformCookie = cookieFrom(verify, getPlatformAuthCookieName());
  });

  it("platform token cannot access tenant HR employee list", async () => {
    const res = await request(app)
      .get("/api/employees")
      .set("Cookie", platformCookie);
    assert.ok(res.status === 401 || res.status === 403);
  });

  it("logout revokes session", async () => {
    const res = await request(app)
      .post("/api/platform/auth/logout")
      .set("Cookie", platformCookie);
    assert.equal(res.status, 200);
    const me = await request(app).get("/api/platform/auth/me").set("Cookie", platformCookie);
    assert.equal(me.status, 401);
  });
});
