process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "tenant-jwt-secret-for-entitlement-enforce!!";
process.env.PLATFORM_JWT_SECRET = "platform-jwt-secret-entitlement-enf!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_entitlement_enforce";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.PLATFORM_AUTH_COOKIE_NAME = "hrms_platform_auth";
process.env.COMPANY_METADATA_CACHE_TTL_MS = "60000";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import {
  connectCentralDB,
  disconnectAll,
  getCompanyModels,
  findCompanyById,
  setCachedCompanyMetadata,
  getCachedCompanyMetadata,
} from "../config/db.js";
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
  const str = String(input || "")
    .toUpperCase()
    .replace(/=+$/, "")
    .replace(/\s+/g, "");
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
    email: "platform@enforce.test",
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
  const admin = await PlatformAdmin.findOne({ email: "platform@enforce.test" })
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

describe("Platform entitlement enforcement matrix", () => {
  let mongo;
  let app;
  let platformCookie;
  let companyA;
  let companyB;
  let hrCookieA;
  let hrCookieB;
  let empCookieA;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();
    await ensureDefaultPlansSeeded();
    const trialPlan = await PlatformPlan.findOne({ code: "TRIAL" }).lean();

    await PlatformAdmin.create({
      singletonKey: "default",
      email: "platform@enforce.test",
      passwordHash: await hashPassword("PlatformPass123!"),
      fullName: "Platform Admin",
      isActive: true,
      mfaEnabled: false,
    });

    companyA = await Company.create({
      companyName: "Enforce Alpha",
      slug: "enforce-alpha",
      databaseName: "company_enforce_alpha",
      status: COMPANY_STATUSES.ACTIVE,
      subscription: { plan: "TRIAL", planId: trialPlan._id, maxEmployeeSeats: 50 },
    });
    companyB = await Company.create({
      companyName: "Enforce Beta",
      slug: "enforce-beta",
      databaseName: "company_enforce_beta",
      status: COMPANY_STATUSES.ACTIVE,
      subscription: { plan: "TRIAL", planId: trialPlan._id, maxEmployeeSeats: 50 },
    });

    const modelsA = await getCompanyModels(companyA, { provision: true });
    const modelsB = await getCompanyModels(companyB, { provision: true });
    const password = await hashPassword("HrPass123!");

    await modelsA.User.create({
      email: "hr@enforce-alpha.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "Alpha HR",
      isActive: true,
    });
    await modelsA.User.create({
      email: "emp@enforce-alpha.test",
      passwordHash: password,
      role: USER_ROLES.EMPLOYEE,
      fullName: "Alpha Emp",
      isActive: true,
    });
    await modelsB.User.create({
      email: "hr@enforce-beta.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "Beta HR",
      isActive: true,
    });

    const loginA = await request(app).post("/api/auth/login").send({
      email: "hr@enforce-alpha.test",
      password: "HrPass123!",
      companyCode: "enforce-alpha",
    });
    assert.equal(loginA.status, 200);
    hrCookieA = cookieFrom(loginA, getAuthCookieName());

    const loginEmp = await request(app).post("/api/auth/login").send({
      email: "emp@enforce-alpha.test",
      password: "HrPass123!",
      companyCode: "enforce-alpha",
    });
    assert.equal(loginEmp.status, 200);
    empCookieA = cookieFrom(loginEmp, getAuthCookieName());

    const loginB = await request(app).post("/api/auth/login").send({
      email: "hr@enforce-beta.test",
      password: "HrPass123!",
      companyCode: "enforce-beta",
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

  it("global work OFF blocks tasks API for all companies; re-enable restores", async () => {
    const before = await request(app).get("/api/tasks").set("Cookie", hrCookieA);
    assert.notEqual(before.status, 403);

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { work: false }, confirm: true });

    const blockedA = await request(app).get("/api/tasks").set("Cookie", hrCookieA);
    assert.equal(blockedA.status, 403);
    assert.equal(blockedA.body.code, "PLATFORM_MODULE_DISABLED");

    const blockedB = await request(app).get("/api/tasks").set("Cookie", hrCookieB);
    assert.equal(blockedB.status, 403);

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { work: true }, confirm: true });

    const restored = await request(app).get("/api/tasks").set("Cookie", hrCookieA);
    assert.notEqual(restored.status, 403);
  });

  it("company-specific assets OFF blocks only that company", async () => {
    const patch = await request(app)
      .patch(`/api/platform/companies/${companyA._id}/features`)
      .set("Cookie", platformCookie)
      .send({ modules: { assets: false }, confirm: true });
    assert.equal(patch.status, 200);

    const blockedA = await request(app).get("/api/assets/my-assets").set("Cookie", empCookieA);
    assert.equal(blockedA.status, 403);
    assert.equal(blockedA.body.code, "PLATFORM_MODULE_DISABLED");

    const okB = await request(app).get("/api/assets").set("Cookie", hrCookieB);
    assert.notEqual(okB.status, 403);

    await request(app)
      .patch(`/api/platform/companies/${companyA._id}/features`)
      .set("Cookie", platformCookie)
      .send({ modules: { assets: true }, confirm: true });

    const restored = await request(app).get("/api/assets/my-assets").set("Cookie", empCookieA);
    assert.notEqual(restored.status, 403);
  });

  it("face capability OFF blocks face enrollment while attendance module stays on", async () => {
    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ capabilities: { "attendance.faceVerification": false }, confirm: true });

    const attendanceOk = await request(app)
      .get("/api/employees/me/attendance/status")
      .set("Cookie", empCookieA);
    assert.notEqual(attendanceOk.status, 403);
    // Status must not present face as an enabled/required verification method when capability is OFF.
    const faceMethod =
      attendanceOk.body.attendance?.verificationRequirements?.methods?.face || {};
    assert.notEqual(faceMethod.enabled, true);
    assert.notEqual(faceMethod.mandatory, true);
    const faceEnrollment = attendanceOk.body.attendance?.faceEnrollment || {};
    assert.notEqual(faceEnrollment.platformCapabilityAllowed, true);
    assert.notEqual(faceEnrollment.enrolled, true);

    const faceBlocked = await request(app)
      .get("/api/employees/me/face-enrollment")
      .set("Cookie", empCookieA);
    assert.equal(faceBlocked.status, 403);
    assert.equal(faceBlocked.body.code, "PLATFORM_FEATURE_DISABLED");

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ capabilities: { "attendance.faceVerification": true }, confirm: true });

    const faceRestored = await request(app)
      .get("/api/employees/me/face-enrollment")
      .set("Cookie", empCookieA);
    assert.notEqual(faceRestored.status, 403);
  });

  it("company feature update invalidates metadata cache so company OFF is not stale", async () => {
    const lean = await findCompanyById(companyA._id);
    assert.ok(lean);
    setCachedCompanyMetadata(companyA._id, {
      ...lean,
      config: {
        ...(lean.config || {}),
        featureAccess: { modules: { leave: true }, capabilities: {} },
      },
    });
    assert.ok(getCachedCompanyMetadata(companyA._id));

    const patch = await request(app)
      .patch(`/api/platform/companies/${companyA._id}/features`)
      .set("Cookie", platformCookie)
      .send({ modules: { leave: false }, confirm: true });
    assert.equal(patch.status, 200);
    assert.equal(getCachedCompanyMetadata(companyA._id), null);

    const blocked = await request(app)
      .get("/api/leave-requests/summary")
      .set("Cookie", hrCookieA);
    assert.equal(blocked.status, 403);

    await request(app)
      .patch(`/api/platform/companies/${companyA._id}/features`)
      .set("Cookie", platformCookie)
      .send({ modules: { leave: true }, confirm: true });
  });

  it("global module update clears metadata cache", async () => {
    const lean = await findCompanyById(companyB._id);
    setCachedCompanyMetadata(companyB._id, lean);
    assert.ok(getCachedCompanyMetadata(companyB._id));

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { chat: false }, confirm: true });

    assert.equal(getCachedCompanyMetadata(companyB._id), null);

    const blocked = await request(app).get("/api/conversations").set("Cookie", hrCookieB);
    assert.equal(blocked.status, 403);

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { chat: true }, confirm: true });
  });

  it("global impact OFF blocks impact APIs; settlements company OFF is isolated", async () => {
    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { impact: false }, confirm: true });

    const impactBlocked = await request(app)
      .get("/api/impact-points/rules")
      .set("Cookie", hrCookieA);
    assert.equal(impactBlocked.status, 403);
    assert.equal(impactBlocked.body.code, "PLATFORM_MODULE_DISABLED");

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { impact: true }, confirm: true });

    await request(app)
      .patch(`/api/platform/companies/${companyA._id}/features`)
      .set("Cookie", platformCookie)
      .send({ modules: { settlements: false }, confirm: true });

    const blockedA = await request(app)
      .get("/api/settlements/my-settlement")
      .set("Cookie", empCookieA);
    assert.equal(blockedA.status, 403);

    const okB = await request(app).get("/api/settlements").set("Cookie", hrCookieB);
    assert.notEqual(okB.status, 403);

    await request(app)
      .patch(`/api/platform/companies/${companyA._id}/features`)
      .set("Cookie", platformCookie)
      .send({ modules: { settlements: true }, confirm: true });
  });

  it("liveTracking OFF blocks tracking while attendance stays available", async () => {
    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { liveTracking: false }, confirm: true });

    const attendanceOk = await request(app)
      .get("/api/employees/me/attendance/status")
      .set("Cookie", empCookieA);
    assert.notEqual(attendanceOk.status, 403);

    // start/update remain entitlement-gated after global disable
    const trackingStartBlocked = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .send({ durationMinutes: 30 });
    assert.equal(trackingStartBlocked.status, 403);
    assert.equal(trackingStartBlocked.body.code, "PLATFORM_MODULE_DISABLED");

    // stop/status stay authenticate-only so clients can observe/cleanup after disable
    const trackingStatus = await request(app)
      .get("/api/employees/me/tracking/status")
      .set("Cookie", empCookieA);
    assert.notEqual(trackingStatus.status, 403);

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { liveTracking: true }, confirm: true });
  });

  it("existing session sees updated entitlements on /auth/me after global disable", async () => {
    const before = await request(app).get("/api/auth/me").set("Cookie", hrCookieA);
    assert.equal(before.status, 200);
    assert.equal(before.body.company.entitlements.modules.organization, true);

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { organization: false }, confirm: true });

    const after = await request(app).get("/api/auth/me").set("Cookie", hrCookieA);
    assert.equal(after.status, 200);
    assert.equal(after.body.company.entitlements.modules.organization, false);

    const designations = await request(app).get("/api/designations").set("Cookie", hrCookieA);
    assert.equal(designations.status, 403);

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { organization: true }, confirm: true });
  });

  it("Ask-AI chatbot remains available when messaging chat module is disabled", async () => {
    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { chat: false }, confirm: true });

    const messaging = await request(app).get("/api/conversations").set("Cookie", hrCookieA);
    assert.equal(messaging.status, 403);

    const askAi = await request(app).get("/api/chat/status").set("Cookie", hrCookieA);
    assert.notEqual(askAi.status, 403);

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { chat: true }, confirm: true });
  });

  it("announcements remain tenant-permission gated, not platform-module gated", async () => {
    const res = await request(app).get("/api/announcements").set("Cookie", hrCookieA);
    // Authenticated access is allowed; platform module codes must not appear.
    assert.notEqual(res.body?.code, "PLATFORM_MODULE_DISABLED");
    assert.ok(res.status === 200 || res.status === 403);
    if (res.status === 403) {
      assert.notEqual(res.body?.code, "PLATFORM_MODULE_DISABLED");
    }
  });

  it("plan OFF blocks payroll for company A only while global stays on", async () => {
    const restricted = await PlatformPlan.findOne({ code: "RESTRICTED" }).lean();
    const trial = await PlatformPlan.findOne({ code: "TRIAL" }).lean();
    assert.ok(restricted && trial);

    await Company.updateOne(
      { _id: companyA._id },
      { $set: { "subscription.plan": "RESTRICTED", "subscription.planId": restricted._id } }
    );
    const { invalidateCompanyMetadataCache } = await import("../config/db.js");
    invalidateCompanyMetadataCache(companyA._id);

    const blocked = await request(app)
      .get("/api/payroll/employee/payslips")
      .set("Cookie", empCookieA);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, "PLATFORM_MODULE_DISABLED");

    // RESTRICTED seed includes people (not attendance/payroll); profile remains reachable.
    const profileOk = await request(app).get("/api/employees/me").set("Cookie", empCookieA);
    assert.equal(profileOk.status, 200);

    await Company.updateOne(
      { _id: companyA._id },
      { $set: { "subscription.plan": "TRIAL", "subscription.planId": trial._id } }
    );
    invalidateCompanyMetadataCache(companyA._id);

    const restored = await request(app)
      .get("/api/payroll/employee/payslips")
      .set("Cookie", empCookieA);
    assert.notEqual(restored.body?.code, "PLATFORM_MODULE_DISABLED");
  });
});
