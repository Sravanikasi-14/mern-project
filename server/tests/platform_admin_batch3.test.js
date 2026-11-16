process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "tenant-jwt-secret-for-platform-batch3-tests!!";
process.env.PLATFORM_JWT_SECRET = "platform-jwt-secret-batch3-tests-32ch!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_admin_batch3";
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
import PlatformAuditLog, { PLATFORM_AUDIT_ACTIONS } from "../models/PlatformAuditLog.js";
import PlatformPlan from "../models/PlatformPlan.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { getPlatformAuthCookieName } from "../utils/platformAuthCookie.js";
import { decryptSecret } from "../utils/platformSecretCrypto.js";
import { ensureDefaultPlansSeeded } from "../services/platformPlanService.js";
import {
  getEffectiveEntitlementsForCompany,
} from "../services/platformEntitlementService.js";

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
    email: "platform@batch3.test",
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
  const admin = await PlatformAdmin.findOne({ email: "platform@batch3.test" })
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

describe("Platform Admin Batch 3 — plans & billing", () => {
  let mongo;
  let app;
  let platformCookie;
  let companyA;
  let companyB;
  let hrCookieA;
  let restrictedPlan;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();
    await ensureDefaultPlansSeeded();
    restrictedPlan = await PlatformPlan.findOne({ code: "RESTRICTED" }).lean();
    assert.ok(restrictedPlan);

    await PlatformAdmin.create({
      singletonKey: "default",
      email: "platform@batch3.test",
      passwordHash: await hashPassword("PlatformPass123!"),
      fullName: "Platform Admin",
      isActive: true,
      mfaEnabled: false,
    });

    const trial = await PlatformPlan.findOne({ code: "TRIAL" }).lean();
    companyA = await Company.create({
      companyName: "Plan Alpha",
      slug: "plan-alpha",
      databaseName: "company_plan_alpha",
      status: COMPANY_STATUSES.ACTIVE,
      subscription: {
        plan: "TRIAL",
        planId: trial._id,
        maxEmployeeSeats: 20,
        status: "ACTIVE",
      },
    });
    companyB = await Company.create({
      companyName: "Plan Beta",
      slug: "plan-beta",
      databaseName: "company_plan_beta",
      status: COMPANY_STATUSES.ACTIVE,
      subscription: {
        plan: "TRIAL",
        planId: trial._id,
        maxEmployeeSeats: 20,
        status: "ACTIVE",
      },
    });

    const modelsA = await getCompanyModels(companyA, { provision: true });
    await getCompanyModels(companyB, { provision: true });
    await modelsA.User.create({
      email: "hr@plan-alpha.test",
      passwordHash: await hashPassword("HrPass123!"),
      role: USER_ROLES.HR_ADMIN,
      fullName: "Alpha HR",
      isActive: true,
    });

    const loginA = await request(app).post("/api/auth/login").send({
      email: "hr@plan-alpha.test",
      password: "HrPass123!",
      companyCode: "plan-alpha",
    });
    assert.equal(loginA.status, 200);
    hrCookieA = cookieFrom(loginA, getAuthCookieName());
    platformCookie = await platformSession(app);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("lists seeded plans from central records", async () => {
    const res = await request(app).get("/api/platform/plans").set("Cookie", platformCookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.plans.some((p) => p.code === "TRIAL"));
    assert.ok(res.body.plans.some((p) => p.code === "RESTRICTED"));
  });

  it("tenant HR cannot access plan or billing APIs", async () => {
    const plans = await request(app).get("/api/platform/plans").set("Cookie", hrCookieA);
    assert.equal(plans.status, 401);
    const sub = await request(app)
      .get(`/api/platform/companies/${companyA._id}/subscription`)
      .set("Cookie", hrCookieA);
    assert.equal(sub.status, 401);
  });

  it("assigning RESTRICTED plan enforces entitlements for company A only", async () => {
    const change = await request(app)
      .patch(`/api/platform/companies/${companyA._id}/subscription`)
      .set("Cookie", platformCookie)
      .send({ planId: String(restrictedPlan._id), confirm: true });
    assert.equal(change.status, 200, JSON.stringify(change.body));
    assert.equal(change.body.subscription.planCode, "RESTRICTED");
    assert.ok(change.body.history.length >= 1);

    const refreshed = await Company.findById(companyA._id).lean();
    const { effective } = await getEffectiveEntitlementsForCompany(refreshed);
    assert.equal(effective.modules.people.allowed, true);
    assert.equal(effective.modules.payroll.allowed, false);

    const people = await request(app).get("/api/employees/summary").set("Cookie", hrCookieA);
    assert.equal(people.status, 200);

    // Company B still on TRIAL — unaffected
    const b = await Company.findById(companyB._id).lean();
    assert.equal(b.subscription.plan, "TRIAL");
    const effB = await getEffectiveEntitlementsForCompany(b);
    assert.equal(effB.effective.modules.payroll.allowed, true);

    const audit = await PlatformAuditLog.findOne({
      action: PLATFORM_AUDIT_ACTIONS.SUBSCRIPTION_CHANGED,
      targetId: String(companyA._id),
    }).lean();
    assert.ok(audit);
  });

  it("global OFF still wins over plan entitlement", async () => {
    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { people: false }, confirm: true });

    const blocked = await request(app).get("/api/employees/summary").set("Cookie", hrCookieA);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, "PLATFORM_MODULE_DISABLED");

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { people: true }, confirm: true });
  });

  it("deactivated plans cannot be newly assigned", async () => {
    const created = await request(app)
      .post("/api/platform/plans")
      .set("Cookie", platformCookie)
      .send({
        code: "TEMPPLAN",
        name: "Temp Plan",
        modulesAll: false,
        includedModules: ["dashboard", "people", "settings"],
        maxEmployeeSeats: 5,
      });
    assert.equal(created.status, 201);
    const planId = created.body.plan.id;

    await request(app)
      .patch(`/api/platform/plans/${planId}`)
      .set("Cookie", platformCookie)
      .send({ isActive: false, confirm: true });

    const assign = await request(app)
      .patch(`/api/platform/companies/${companyB._id}/subscription`)
      .set("Cookie", platformCookie)
      .send({ planId, confirm: true });
    assert.equal(assign.status, 400);
    assert.equal(assign.body.code, "PLAN_INACTIVE");
  });

  it("existing assignment remains usable after plan entitlement edit", async () => {
    // Company A is on RESTRICTED — editing RESTRICTED modules updates effective entitlements
    await request(app)
      .patch(`/api/platform/plans/${restrictedPlan._id}`)
      .set("Cookie", platformCookie)
      .send({
        modulesAll: false,
        includedModules: ["dashboard", "people", "settings", "leave"],
      });

    const refreshed = await Company.findById(companyA._id).lean();
    const { effective } = await getEffectiveEntitlementsForCompany(refreshed);
    assert.equal(effective.modules.leave.allowed, true);
    assert.equal(effective.modules.payroll.allowed, false);
  });

  it("creates invoice and records manual payment without claiming gateway success", async () => {
    const inv = await request(app)
      .post(`/api/platform/companies/${companyA._id}/invoices`)
      .set("Cookie", platformCookie)
      .send({ amount: 1999, currency: "INR" });
    assert.equal(inv.status, 201);
    assert.equal(inv.body.invoice.paymentStatus, "UNPAID");
    assert.equal(inv.body.invoice.payment.gatewayConfirmed, false);

    const pay = await request(app)
      .post(`/api/platform/invoices/${inv.body.invoice.id}/payments`)
      .set("Cookie", platformCookie)
      .send({ confirm: true, method: "MANUAL", reference: "CHK-1" });
    assert.equal(pay.status, 200);
    assert.equal(pay.body.invoice.status, "PAID");
    assert.equal(pay.body.invoice.paymentStatus, "MANUAL_RECORDED");
    assert.equal(pay.body.invoice.payment.gatewayConfirmed, false);

    const payAudit = await PlatformAuditLog.findOne({
      action: PLATFORM_AUDIT_ACTIONS.INVOICE_PAYMENT_RECORDED,
    }).lean();
    assert.equal(payAudit.metadata.gatewayConfirmed, false);
  });

  it("subscription suspension preserves company and tenant database metadata", async () => {
    const before = await Company.findById(companyA._id).lean();
    const res = await request(app)
      .patch(`/api/platform/companies/${companyA._id}/subscription`)
      .set("Cookie", platformCookie)
      .send({ status: "SUSPENDED", confirm: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.subscription.status, "SUSPENDED");

    const after = await Company.findById(companyA._id).lean();
    assert.equal(after.databaseName, before.databaseName);
    assert.equal(after.companyName, before.companyName);
    assert.ok(after.subscription.history.length >= before.subscription.history.length);
  });

  it("missing plan configuration fails closed", async () => {
    const orphan = await Company.create({
      companyName: "Orphan Plan Co",
      slug: "orphan-plan",
      databaseName: "company_orphan_plan",
      status: COMPANY_STATUSES.ACTIVE,
      subscription: { plan: "DOES_NOT_EXIST", planId: null, status: "ACTIVE" },
    });
    const { effective } = await getEffectiveEntitlementsForCompany(orphan);
    assert.equal(effective.modules.people.allowed, false);
    assert.equal(effective.modules.people.reason, "PLAN_MODULE_NOT_ENTITLED");
  });

  it("subscription responses never expose tenant HR PII or databaseName", async () => {
    const res = await request(app)
      .get(`/api/platform/companies/${companyA._id}/subscription`)
      .set("Cookie", platformCookie);
    assert.equal(res.status, 200);
    const raw = JSON.stringify(res.body);
    assert.equal(raw.includes("databaseName"), false);
    assert.equal(raw.includes("passwordHash"), false);
    assert.equal(raw.includes("hr@plan-alpha"), false);
    assert.equal(raw.includes("company_plan_alpha"), false);
  });
});

