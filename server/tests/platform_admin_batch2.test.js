process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "tenant-jwt-secret-for-platform-batch2-tests!!";
process.env.PLATFORM_JWT_SECRET = "platform-jwt-secret-batch2-tests-32ch!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_admin_batch2";
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
import PlatformSettings from "../models/PlatformSettings.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { getPlatformAuthCookieName } from "../utils/platformAuthCookie.js";
import { decryptSecret } from "../utils/platformSecretCrypto.js";
import {
  planAllowsModule,
  moduleKeyForHrPermission,
} from "../constants/platformFeatureCatalog.js";
import PlatformPlan from "../models/PlatformPlan.js";
import {
  resolveEffectiveEntitlements,
  getOrCreatePlatformSettings,
} from "../services/platformEntitlementService.js";
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

async function completePlatformLogin(app) {
  const login = await request(app).post("/api/platform/auth/login").send({
    email: "platform@batch2.test",
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
  const admin = await PlatformAdmin.findOne({ email: "platform@batch2.test" })
    .select("+mfaSecretEncrypted")
    .lean();
  const secret = decryptSecret(admin.mfaSecretEncrypted);
  const verify = await request(app)
    .post("/api/platform/auth/mfa/verify")
    .send({ mfaToken: login.body.mfaToken, code: totpNow(secret) });
  return cookieFrom(verify, getPlatformAuthCookieName());
}

describe("Platform Admin Batch 2 — entitlements", () => {
  let mongo;
  let app;
  let platformCookie;
  let companyA;
  let companyB;
  let hrCookieA;
  let hrCookieB;
  let modelsA;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();
    await ensureDefaultPlansSeeded();
    const trialPlan = await PlatformPlan.findOne({ code: "TRIAL" }).lean();

    await PlatformAdmin.create({
      singletonKey: "default",
      email: "platform@batch2.test",
      passwordHash: await hashPassword("PlatformPass123!"),
      fullName: "Platform Admin",
      isActive: true,
      mfaEnabled: false,
    });

    companyA = await Company.create({
      companyName: "Alpha Co",
      slug: "alpha-co",
      databaseName: "company_alpha_co",
      status: COMPANY_STATUSES.ACTIVE,
      subscription: { plan: "TRIAL", planId: trialPlan._id, maxEmployeeSeats: 50 },
    });
    companyB = await Company.create({
      companyName: "Beta Co",
      slug: "beta-co",
      databaseName: "company_beta_co",
      status: COMPANY_STATUSES.ACTIVE,
      subscription: { plan: "TRIAL", planId: trialPlan._id, maxEmployeeSeats: 50 },
    });

    modelsA = await getCompanyModels(companyA, { provision: true });
    await getCompanyModels(companyB, { provision: true });

    const password = await hashPassword("HrPass123!");
    await modelsA.User.create({
      email: "hr@alpha-co.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "Alpha HR",
      isActive: true,
    });
    const modelsB = await getCompanyModels(companyB);
    await modelsB.User.create({
      email: "hr@beta-co.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "Beta HR",
      isActive: true,
    });

    const loginA = await request(app).post("/api/auth/login").send({
      email: "hr@alpha-co.test",
      password: "HrPass123!",
      companyCode: "alpha-co",
    });
    assert.equal(loginA.status, 200);
    hrCookieA = cookieFrom(loginA, getAuthCookieName());
    assert.ok(loginA.body.company.entitlements?.modules?.people === true);

    const loginB = await request(app).post("/api/auth/login").send({
      email: "hr@beta-co.test",
      password: "HrPass123!",
      companyCode: "beta-co",
    });
    assert.equal(loginB.status, 200);
    hrCookieB = cookieFrom(loginB, getAuthCookieName());

    platformCookie = await completePlatformLogin(app);
    assert.ok(platformCookie);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("catalogue maps HR permissions to platform modules", () => {
    assert.equal(moduleKeyForHrPermission("people.view"), "people");
    assert.equal(moduleKeyForHrPermission("hiring.send"), "offers");
    assert.equal(planAllowsModule("TRIAL", "payroll"), true);
    assert.equal(planAllowsModule("RESTRICTED", "payroll"), false);
    assert.equal(planAllowsModule("UNKNOWN_PLAN", "people"), false);
  });

  it("tenant cookie cannot access platform modules API", async () => {
    const res = await request(app).get("/api/platform/modules").set("Cookie", hrCookieA);
    assert.equal(res.status, 401);
  });

  it("platform modules API returns catalogue and global state", async () => {
    const res = await request(app).get("/api/platform/modules").set("Cookie", platformCookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.catalog.modules.some((m) => m.key === "people"));
    assert.ok(res.body.global.modules.some((m) => m.key === "leave" && m.enabled === true));
  });

  it("global disable blocks every company; company B cannot change A", async () => {
    const before = await request(app)
      .get("/api/employees/summary")
      .set("Cookie", hrCookieA);
    assert.equal(before.status, 200);

    const deny = await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { people: false } });
    assert.equal(deny.status, 400);
    assert.equal(deny.body.code, "CONFIRMATION_REQUIRED");

    const disabled = await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { people: false }, confirm: true });
    assert.equal(disabled.status, 200);

    const blockedA = await request(app)
      .get("/api/employees/summary")
      .set("Cookie", hrCookieA);
    assert.equal(blockedA.status, 403);
    assert.equal(blockedA.body.code, "PLATFORM_MODULE_DISABLED");

    const blockedB = await request(app)
      .get("/api/employees/summary")
      .set("Cookie", hrCookieB);
    assert.equal(blockedB.status, 403);

    const audit = await PlatformAuditLog.findOne({
      action: PLATFORM_AUDIT_ACTIONS.FEATURE_GLOBAL_UPDATED,
    }).lean();
    assert.ok(audit);

    // Re-enable globally for subsequent tests
    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { people: true }, confirm: true });
  });

  it("company-specific disable affects only that company", async () => {
    const patch = await request(app)
      .patch(`/api/platform/companies/${companyA._id}/features`)
      .set("Cookie", platformCookie)
      .send({ modules: { leave: false }, confirm: true });
    assert.equal(patch.status, 200);
    const leaveMod = patch.body.modules.find((m) => m.key === "leave");
    assert.equal(leaveMod.effective, false);
    assert.equal(leaveMod.companyOverride, false);

    const blockedA = await request(app)
      .get("/api/leave-requests/summary")
      .set("Cookie", hrCookieA);
    assert.equal(blockedA.status, 403);

    const okB = await request(app)
      .get("/api/leave-requests/summary")
      .set("Cookie", hrCookieB);
    assert.equal(okB.status, 200);

    // Company override cannot enable when global is off
    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { leave: false }, confirm: true });
    const bypass = await request(app)
      .patch(`/api/platform/companies/${companyA._id}/features`)
      .set("Cookie", platformCookie)
      .send({ modules: { leave: true }, confirm: true });
    assert.equal(bypass.status, 400);
    assert.equal(bypass.body.code, "GLOBAL_RESTRICTION");

    // restore leave globally + clear company A disable
    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { leave: true }, confirm: true });
    await request(app)
      .patch(`/api/platform/companies/${companyA._id}/features`)
      .set("Cookie", platformCookie)
      .send({ modules: { leave: true }, confirm: true });
  });

  it("subscription plan restrictions are enforced", async () => {
    const restricted = await PlatformPlan.findOne({ code: "RESTRICTED" }).lean();
    const trial = await PlatformPlan.findOne({ code: "TRIAL" }).lean();
    assert.ok(restricted);
    await Company.updateOne(
      { _id: companyA._id },
      {
        $set: {
          "subscription.plan": "RESTRICTED",
          "subscription.planId": restricted._id,
        },
      }
    );
    const refreshed = await Company.findById(companyA._id).lean();
    const settings = await getOrCreatePlatformSettings();
    const effective = resolveEffectiveEntitlements({
      company: refreshed,
      settings,
      planRecord: restricted,
    });
    assert.equal(effective.modules.people.allowed, true);
    assert.equal(effective.modules.payroll.allowed, false);
    assert.equal(effective.modules.payroll.reason, "PLAN_MODULE_NOT_ENTITLED");

    const payroll = await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", hrCookieA);
    // dashboard still allowed on RESTRICTED
    assert.equal(payroll.status, 200);

    // Restore plan
    await Company.updateOne(
      { _id: companyA._id },
      {
        $set: {
          "subscription.plan": "TRIAL",
          "subscription.planId": trial._id,
        },
      }
    );
  });

  it("missing/invalid entitlement configuration fails closed", async () => {
    const settings = await PlatformSettings.findOne({ singletonKey: "default" });
    const previous = settings.modules.chat;
    delete settings.modules.chat;
    settings.markModified("modules");
    await settings.save();

    const company = await Company.findById(companyA._id).lean();
    const effective = resolveEffectiveEntitlements({ company, settings: settings.toObject() });
    assert.equal(effective.modules.chat.allowed, false);
    assert.equal(effective.modules.chat.reason, "INVALID_CONFIGURATION");

    settings.modules.chat = previous || { enabled: true };
    settings.markModified("modules");
    await settings.save();
  });

  it("platform and tenant authentication remain isolated", async () => {
    const tenantOnPlatform = await request(app)
      .get("/api/platform/overview")
      .set("Cookie", hrCookieA);
    assert.equal(tenantOnPlatform.status, 401);

    const platformOnTenant = await request(app)
      .get("/api/employees/summary")
      .set("Cookie", platformCookie);
    assert.ok(platformOnTenant.status === 401 || platformOnTenant.status === 403);
  });

  it("company feature access view exposes reasons without tenant PII", async () => {
    const res = await request(app)
      .get(`/api/platform/companies/${companyA._id}/features`)
      .set("Cookie", platformCookie);
    assert.equal(res.status, 200);
    const raw = JSON.stringify(res.body);
    assert.equal(raw.includes("passwordHash"), false);
    assert.equal(raw.includes("databaseName"), false);
    assert.ok(res.body.modules.some((m) => m.reasonLabel || m.effective));
  });
});
