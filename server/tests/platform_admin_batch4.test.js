process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "tenant-jwt-secret-for-platform-batch4-tests!!";
process.env.PLATFORM_JWT_SECRET = "platform-jwt-secret-batch4-tests-32ch!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_admin_batch4";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.PLATFORM_AUTH_COOKIE_NAME = "hrms_platform_auth";
process.env.DOCUMENT_STORAGE = "disk";

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
import PlatformInvoice from "../models/PlatformInvoice.js";
import PlatformPlan from "../models/PlatformPlan.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { getPlatformAuthCookieName } from "../utils/platformAuthCookie.js";
import { decryptSecret } from "../utils/platformSecretCrypto.js";
import { ensureDefaultPlansSeeded } from "../services/platformPlanService.js";
import { reserveEmployeeSeat } from "../services/platformSeatService.js";
import { createInvoice } from "../services/platformPlanService.js";
import { invalidateMaintenanceCache } from "../services/platformSettingsService.js";

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
    email: "platform@batch4.test",
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
  const admin = await PlatformAdmin.findOne({ email: "platform@batch4.test" })
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

describe("Platform Admin Batch 4 — insights & settings", () => {
  let mongo;
  let app;
  let platformCookie;
  let companyA;
  let companyB;
  let hrCookieA;
  let trialPlan;
  let platformAdmin;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();
    await ensureDefaultPlansSeeded();
    trialPlan = await PlatformPlan.findOne({ code: "TRIAL" }).lean();

    platformAdmin = await PlatformAdmin.create({
      singletonKey: "default",
      email: "platform@batch4.test",
      passwordHash: await hashPassword("PlatformPass123!"),
      fullName: "Platform Admin",
      isActive: true,
      mfaEnabled: false,
    });

    companyA = await Company.create({
      companyName: "Insight Alpha",
      slug: "insight-alpha",
      databaseName: "company_insight_alpha",
      status: COMPANY_STATUSES.ACTIVE,
      subscription: {
        plan: "TRIAL",
        planId: trialPlan._id,
        maxEmployeeSeats: 2,
        seatUsage: 0,
        status: "ACTIVE",
      },
    });
    companyB = await Company.create({
      companyName: "Insight Beta",
      slug: "insight-beta",
      databaseName: "company_insight_beta",
      status: COMPANY_STATUSES.ACTIVE,
      subscription: {
        plan: "TRIAL",
        planId: trialPlan._id,
        maxEmployeeSeats: 20,
        seatUsage: 0,
        status: "ACTIVE",
      },
    });

    const modelsA = await getCompanyModels(companyA, { provision: true });
    await getCompanyModels(companyB, { provision: true });
    await modelsA.User.create({
      email: "hr@insight-alpha.test",
      passwordHash: await hashPassword("HrPass123!"),
      role: USER_ROLES.HR_ADMIN,
      fullName: "Alpha HR",
      isActive: true,
    });

    const loginA = await request(app).post("/api/auth/login").send({
      email: "hr@insight-alpha.test",
      password: "HrPass123!",
      companyCode: "insight-alpha",
    });
    assert.equal(loginA.status, 200);
    hrCookieA = cookieFrom(loginA, getAuthCookieName());
    platformCookie = await platformSession(app);
  });

  after(async () => {
    invalidateMaintenanceCache();
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("insights aggregates without tenant PII and marks unavailable metrics", async () => {
    const res = await request(app).get("/api/platform/insights").set("Cookie", platformCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.companies.total, 2);
    assert.ok(Array.isArray(res.body.unavailableMetrics));
    assert.ok(res.body.unavailableMetrics.some((m) => m.key === "employeeCounts"));
    assert.equal(res.body.usage.storageConsumption.available, false);
    assert.equal(res.body.usage.apiUsage.available, false);
    assert.equal(res.body.systemHealth.apiResponseTimes.available, false);
    assert.notEqual(res.body.usage.storageConsumption.value, 0);
    assert.equal(res.body.usage.storageConsumption.value, null);

    const raw = JSON.stringify(res.body);
    assert.equal(raw.includes("passwordHash"), false);
    assert.equal(raw.includes("hr@insight-alpha"), false);
    assert.equal(raw.includes("company_insight_alpha"), false);
  });

  it("tenant cannot access insights or settings APIs", async () => {
    const insights = await request(app).get("/api/platform/insights").set("Cookie", hrCookieA);
    assert.equal(insights.status, 401);
    const settings = await request(app).get("/api/platform/settings").set("Cookie", hrCookieA);
    assert.equal(settings.status, 401);
    const patch = await request(app)
      .patch("/api/platform/settings")
      .set("Cookie", hrCookieA)
      .send({ general: { platformName: "Hacked" } });
    assert.equal(patch.status, 401);
  });

  it("updates settings and lists append-only audit entries", async () => {
    const patch = await request(app)
      .patch("/api/platform/settings")
      .set("Cookie", platformCookie)
      .send({ general: { platformName: "HRMS Control Plane" } });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.settings.general.platformName, "HRMS Control Plane");

    const audit = await request(app)
      .get("/api/platform/audit")
      .query({ action: PLATFORM_AUDIT_ACTIONS.SETTINGS_UPDATED })
      .set("Cookie", platformCookie);
    assert.equal(audit.status, 200);
    assert.ok(audit.body.entries.length >= 1);

    await assert.rejects(
      () =>
        PlatformAuditLog.updateOne(
          { _id: audit.body.entries[0].id },
          { $set: { outcome: "FAILURE" } }
        ),
      /append-only/i
    );
  });

  it("maintenance mode blocks tenant login but not platform admin", async () => {
    const enable = await request(app)
      .patch("/api/platform/settings")
      .set("Cookie", platformCookie)
      .send({
        maintenance: { enabled: true, message: "Batch4 maintenance window" },
        confirm: true,
      });
    assert.equal(enable.status, 200);
    invalidateMaintenanceCache();

    const blockedLogin = await request(app).post("/api/auth/login").send({
      email: "hr@insight-alpha.test",
      password: "HrPass123!",
      companyCode: "insight-alpha",
    });
    assert.equal(blockedLogin.status, 503);
    assert.equal(blockedLogin.body.code, "PLATFORM_MAINTENANCE");

    const me = await request(app).get("/api/platform/auth/me").set("Cookie", platformCookie);
    assert.equal(me.status, 200);

    await request(app)
      .patch("/api/platform/settings")
      .set("Cookie", platformCookie)
      .send({ maintenance: { enabled: false }, confirm: true });
    invalidateMaintenanceCache();
  });

  it("seat reservation resists concurrent oversubscription", async () => {
    await Company.updateOne(
      { _id: companyA._id },
      { $set: { "subscription.maxEmployeeSeats": 2, "subscription.seatUsage": 0 } }
    );

    const results = await Promise.allSettled([
      reserveEmployeeSeat(companyA._id, { knownEmployeeCount: 0 }),
      reserveEmployeeSeat(companyA._id, { knownEmployeeCount: 0 }),
      reserveEmployeeSeat(companyA._id, { knownEmployeeCount: 0 }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 2);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason?.code, "SEAT_LIMIT_REACHED");

    const refreshed = await Company.findById(companyA._id).lean();
    assert.equal(refreshed.subscription.seatUsage, 2);
  });

  it("subscription suspension blocks login while company stays ACTIVE", async () => {
    const suspend = await request(app)
      .patch(`/api/platform/companies/${companyA._id}/subscription`)
      .set("Cookie", platformCookie)
      .send({ status: "SUSPENDED", confirm: true });
    assert.equal(suspend.status, 200);

    const company = await Company.findById(companyA._id).lean();
    assert.equal(company.status, COMPANY_STATUSES.ACTIVE);
    assert.equal(company.subscription.status, "SUSPENDED");
    assert.equal(company.databaseName, "company_insight_alpha");

    const login = await request(app).post("/api/auth/login").send({
      email: "hr@insight-alpha.test",
      password: "HrPass123!",
      companyCode: "insight-alpha",
    });
    assert.equal(login.status, 403);
    assert.equal(login.body.code, "SUBSCRIPTION_INACTIVE");

    // Company B unaffected
    const b = await Company.findById(companyB._id).lean();
    assert.equal(b.subscription.status, "ACTIVE");

    await request(app)
      .patch(`/api/platform/companies/${companyA._id}/subscription`)
      .set("Cookie", platformCookie)
      .send({ status: "ACTIVE", confirm: true });
  });

  it("legacy company PATCH plan mutation is blocked", async () => {
    const res = await request(app)
      .patch(`/api/platform/companies/${companyB._id}`)
      .set("Cookie", platformCookie)
      .send({ subscription: { plan: "RESTRICTED" } });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "USE_SUBSCRIPTION_API");

    const still = await Company.findById(companyB._id).lean();
    assert.equal(still.subscription.plan, "TRIAL");
  });

  it("invoice numbering is unique under concurrency", async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, () =>
        createInvoice({
          companyId: companyB._id,
          payload: { amount: 100, currency: "INR" },
          admin: platformAdmin,
          req: null,
        })
      )
    );
    const numbers = created.map((c) => c.invoice.invoiceNumber);
    assert.equal(new Set(numbers).size, numbers.length);

    const dbNumbers = await PlatformInvoice.find({ companyId: companyB._id })
      .select("invoiceNumber")
      .lean();
    assert.equal(new Set(dbNumbers.map((d) => d.invoiceNumber)).size, dbNumbers.length);
  });

  it("storage enforcement documents unavailable usage on disk mode", async () => {
    const { assertStorageAllowsUpload } = await import("../services/platformStorageService.js");
    await PlatformPlan.updateOne({ _id: trialPlan._id }, { $set: { maxStorageMb: 1 } });
    const result = await assertStorageAllowsUpload({
      company: await Company.findById(companyB._id).lean(),
      connection: null,
      incomingBytes: 5 * 1024 * 1024,
    });
    assert.equal(result.enforced, false);
    assert.equal(result.usageUnavailable, true);
    await PlatformPlan.updateOne({ _id: trialPlan._id }, { $set: { maxStorageMb: 0 } });
  });
});
