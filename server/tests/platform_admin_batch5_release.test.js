process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "tenant-jwt-secret-for-platform-batch5-tests!!";
process.env.PLATFORM_JWT_SECRET = "platform-jwt-secret-batch5-tests-32ch!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_admin_batch5";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.PLATFORM_AUTH_COOKIE_NAME = "hrms_platform_auth";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import PlatformAdmin from "../models/PlatformAdmin.js";
import PlatformPlan from "../models/PlatformPlan.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { getPlatformAuthCookieName } from "../utils/platformAuthCookie.js";
import { decryptSecret } from "../utils/platformSecretCrypto.js";
import { ensureDefaultPlansSeeded } from "../services/platformPlanService.js";

function cookieFrom(response, name) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${name}=`));
}

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

async function platformSession(app) {
  const login = await request(app).post("/api/platform/auth/login").send({
    email: "platform@batch5.test",
    password: "PlatformPass123!",
  });
  if (login.body.requiresMfaSetup) {
    const start = await request(app)
      .post("/api/platform/auth/mfa/setup/start")
      .send({ mfaToken: login.body.mfaToken });
    const confirm = await request(app)
      .post("/api/platform/auth/mfa/setup/confirm")
      .send({ mfaToken: login.body.mfaToken, code: totpNow(start.body.secret) });
    return cookieFrom(confirm, getPlatformAuthCookieName());
  }
  const admin = await PlatformAdmin.findOne({ email: "platform@batch5.test" })
    .select("+mfaSecretEncrypted")
    .lean();
  const verify = await request(app)
    .post("/api/platform/auth/mfa/verify")
    .send({
      mfaToken: login.body.mfaToken,
      code: totpNow(decryptSecret(admin.mfaSecretEncrypted)),
    });
  return cookieFrom(verify, getPlatformAuthCookieName());
}

describe("Platform Admin Batch 5 — release validation fixes", () => {
  let mongo;
  let app;
  let platformCookie;
  let company;
  let hrCookie;
  let empCookie;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();
    await ensureDefaultPlansSeeded();
    const trial = await PlatformPlan.findOne({ code: "TRIAL" }).lean();

    await PlatformAdmin.create({
      singletonKey: "default",
      email: "platform@batch5.test",
      passwordHash: await hashPassword("PlatformPass123!"),
      fullName: "Platform Admin",
      isActive: true,
      mfaEnabled: false,
    });

    company = await Company.create({
      companyName: "Release Co",
      slug: "release-co",
      databaseName: "company_release_co",
      status: COMPANY_STATUSES.ACTIVE,
      primaryContact: { fullName: "Owner", email: "owner@release-co.test", phoneNumber: "" },
      subscription: {
        plan: "TRIAL",
        planId: trial._id,
        maxEmployeeSeats: 5,
        seatUsage: 0,
        status: "ACTIVE",
      },
    });

    const models = await getCompanyModels(company, { provision: true });
    await models.User.create({
      email: "hr@release-co.test",
      passwordHash: await hashPassword("HrPass123!"),
      role: USER_ROLES.HR_ADMIN,
      fullName: "HR",
      isActive: true,
    });
    await models.User.create({
      email: "emp@release-co.test",
      passwordHash: await hashPassword("EmpPass123!"),
      role: USER_ROLES.EMPLOYEE,
      fullName: "Employee",
      isActive: true,
    });

    const loginHr = await request(app).post("/api/auth/login").send({
      email: "hr@release-co.test",
      password: "HrPass123!",
      companyCode: "release-co",
    });
    hrCookie = cookieFrom(loginHr, getAuthCookieName());

    const loginEmp = await request(app).post("/api/auth/login").send({
      email: "emp@release-co.test",
      password: "EmpPass123!",
      companyCode: "release-co",
    });
    empCookie = cookieFrom(loginEmp, getAuthCookieName());
    platformCookie = await platformSession(app);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("rejects platform cookie requests from non-allowlisted Origins", async () => {
    const res = await request(app)
      .get("/api/platform/overview")
      .set("Cookie", platformCookie)
      .set("Origin", "https://evil-preview.vercel.app");
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "PLATFORM_ORIGIN_DENIED");
  });

  it("allows platform requests from CLIENT_URL origin", async () => {
    const res = await request(app)
      .get("/api/platform/overview")
      .set("Cookie", platformCookie)
      .set("Origin", "http://localhost:5173");
    assert.equal(res.status, 200);
  });

  it("requires primary contact email when creating a company", async () => {
    const res = await request(app)
      .post("/api/platform/companies")
      .set("Cookie", platformCookie)
      .send({
        companyName: "No Contact Co",
        slug: "no-contact-co",
        primaryContact: { fullName: "Someone" },
      });
    assert.equal(res.status, 400);
  });

  it("blocks setup-initial-admin without matching primary contact", async () => {
    const orphan = await Company.create({
      companyName: "Orphan Setup",
      slug: "orphan-setup",
      databaseName: "company_orphan_setup",
      status: COMPANY_STATUSES.TRIAL,
      primaryContact: { fullName: "", email: "", phoneNumber: "" },
      subscription: { plan: "TRIAL", status: "TRIAL" },
    });
    await getCompanyModels(orphan, { provision: true });

    const res = await request(app).post("/api/auth/setup-initial-admin").send({
      companyCode: "orphan-setup",
      email: "attacker@example.com",
      password: "AttackerPass1!",
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "PRIMARY_CONTACT_REQUIRED");
  });

  it("gates payroll self-service payslips by platform payroll entitlement", async () => {
    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { payroll: false }, confirm: true });

    const blocked = await request(app)
      .get("/api/payroll/employee/payslips")
      .set("Cookie", empCookie);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, "PLATFORM_MODULE_DISABLED");

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { payroll: true }, confirm: true });
  });

  it("gates attendance self-service by platform attendance entitlement", async () => {
    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { attendance: false }, confirm: true });

    const blocked = await request(app)
      .get("/api/employees/me/attendance/status")
      .set("Cookie", empCookie);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, "PLATFORM_MODULE_DISABLED");

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { attendance: true }, confirm: true });
  });

  it("rejects duplicate manual invoice payment", async () => {
    const inv = await request(app)
      .post(`/api/platform/companies/${company._id}/invoices`)
      .set("Cookie", platformCookie)
      .send({ amount: 500, currency: "INR" });
    assert.equal(inv.status, 201);

    const pay1 = await request(app)
      .post(`/api/platform/invoices/${inv.body.invoice.id}/payments`)
      .set("Cookie", platformCookie)
      .send({ confirm: true, method: "MANUAL" });
    assert.equal(pay1.status, 200);

    const pay2 = await request(app)
      .post(`/api/platform/invoices/${inv.body.invoice.id}/payments`)
      .set("Cookie", platformCookie)
      .send({ confirm: true, method: "MANUAL" });
    assert.equal(pay2.status, 409);
    assert.equal(pay2.body.code, "INVOICE_ALREADY_PAID");
    assert.equal(pay1.body.invoice.payment.gatewayConfirmed, false);
  });

  it("tenant settings PUT does not leak subscription history or seatUsage", async () => {
    await Company.updateOne(
      { _id: company._id },
      {
        $push: {
          "subscription.history": {
            action: "CHANGED",
            byEmail: "platform@batch5.test",
            note: "secret-ish",
          },
        },
        $set: { "subscription.seatUsage": 3 },
      }
    );

    const res = await request(app)
      .put("/api/settings/company")
      .set("Cookie", hrCookie)
      .send({ companyName: "Release Co" });
    assert.equal(res.status, 200);
    const sub = res.body?.company?.subscription || {};
    assert.equal(sub.history, undefined);
    assert.equal(sub.seatUsage, undefined);
    assert.equal(sub.amount, undefined);
    assert.ok(sub.plan);
  });
});
