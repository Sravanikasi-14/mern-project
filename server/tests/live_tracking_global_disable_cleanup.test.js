process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "tenant-jwt-secret-live-tracking-global-disable!!";
process.env.PLATFORM_JWT_SECRET = "platform-jwt-secret-live-track-disable-32!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "live_tracking_global_disable";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.PLATFORM_AUTH_COOKIE_NAME = "hrms_platform_auth";
process.env.FACE_BIOMETRIC_KEY = "test-face-biometric-key-32chars-min!!";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import PlatformAdmin from "../models/PlatformAdmin.js";
import PlatformPlan from "../models/PlatformPlan.js";
import { USER_ROLES } from "../models/User.js";
import { ensureDefaultPlansSeeded } from "../services/platformPlanService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { getPlatformAuthCookieName } from "../utils/platformAuthCookie.js";
import { hashPassword } from "../utils/password.js";
import { decryptSecret } from "../utils/platformSecretCrypto.js";

function cookieFrom(response, name) {
  const cookies = response.headers["set-cookie"] || [];
  const live = cookies.find(
    (val) =>
      val.startsWith(`${name}=`) &&
      !/; *Max-Age=0/i.test(val) &&
      !/; *Expires=Thu, 01 Jan 1970/i.test(val) &&
      !new RegExp(`^${name}=;`).test(val)
  );
  return live || cookies.find((val) => val.startsWith(`${name}=`));
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
    email: "platform@lt-disable.test",
    password: "PlatformPass123!",
  });
  assert.equal(login.status, 200, login.body?.message || "platform login failed");
  if (login.body?.tokenType === "mfa_setup" || login.body?.requiresMfaSetup) {
    const start = await request(app)
      .post("/api/platform/auth/mfa/setup/start")
      .send({ mfaToken: login.body.mfaToken });
    const confirm = await request(app)
      .post("/api/platform/auth/mfa/setup/confirm")
      .send({ mfaToken: login.body.mfaToken, code: totpNow(start.body.secret) });
    return cookieFrom(confirm, getPlatformAuthCookieName());
  }
  const admin = await PlatformAdmin.findOne({ email: "platform@lt-disable.test" })
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

async function loginTenant(app, { email, password, companyCode }) {
  const res = await request(app).post("/api/auth/login").send({ email, password, companyCode });
  assert.equal(res.status, 200, res.body?.message || "login failed");
  return cookieFrom(res, getAuthCookieName());
}

async function provisionTenant(company) {
  const models = await getCompanyModels(company, { provision: true });
  const passwordHash = await hashPassword("EmpPass123!");
  const user = await models.User.create({
    email: `emp@${company.slug}.test`,
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Tracker",
    isActive: true,
  });
  const employee = await models.Employee.create({
    userId: user._id,
    companyId: company._id,
    employeeCode: `E-${company.slug}`,
    fullName: "Tracker",
    email: `emp@${company.slug}.test`,
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { department: "Field", jobTitle: "Field Agent" },
  });
  await models.User.findByIdAndUpdate(user._id, { employeeId: employee._id });
  await models.CompanyHrPolicy.create({
    effectiveFromDate: new Date("2026-01-01"),
    locationRules: {
      requireLocationForPunch: true,
      allowWebTracking: true,
      geofenceEnabled: false,
    },
  });
  return { models, employee };
}

describe("Live Tracking global disable cleanup", () => {
  let mongo;
  let app;
  let platformCookie;
  let companyA;
  let companyB;
  let modelsA;
  let modelsB;
  let empA;
  let empCookieA;
  let empCookieB;
  const location = { latitude: 17.4, longitude: 78.4, accuracy: 12 };

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();
    await ensureDefaultPlansSeeded();
    const trialPlan = await PlatformPlan.findOne({ code: "TRIAL" }).lean();

    await PlatformAdmin.create({
      singletonKey: "default",
      email: "platform@lt-disable.test",
      passwordHash: await hashPassword("PlatformPass123!"),
      fullName: "Platform Admin",
      isActive: true,
      mfaEnabled: false,
    });

    companyA = await Company.create({
      companyName: "Alpha Tracking Co",
      slug: "alpha-lt",
      databaseName: "company_alpha_lt",
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata" },
      subscription: { plan: "TRIAL", planId: trialPlan._id, maxEmployeeSeats: 20 },
    });
    companyB = await Company.create({
      companyName: "Beta Tracking Co",
      slug: "beta-lt",
      databaseName: "company_beta_lt",
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata" },
      subscription: { plan: "TRIAL", planId: trialPlan._id, maxEmployeeSeats: 20 },
    });

    ({ models: modelsA, employee: empA } = await provisionTenant(companyA));
    ({ models: modelsB } = await provisionTenant(companyB));

    platformCookie = await completePlatformLogin(app);
    assert.ok(platformCookie);

    empCookieA = await loginTenant(app, {
      email: "emp@alpha-lt.test",
      password: "EmpPass123!",
      companyCode: "alpha-lt",
    });
    empCookieB = await loginTenant(app, {
      email: "emp@beta-lt.test",
      password: "EmpPass123!",
      companyCode: "beta-lt",
    });

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { liveTracking: true }, confirm: true });
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("global liveTracking disable stops ACTIVE sessions across tenants; stop/status stay auth-only", async () => {
    for (const cookie of [empCookieA, empCookieB]) {
      const punch = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookie)
        .send({ location });
      assert.equal(punch.status, 200, punch.body?.message || JSON.stringify(punch.body));

      const start = await request(app)
        .post("/api/employees/me/tracking/start")
        .set("Cookie", cookie)
        .send({ durationMinutes: 30 });
      assert.equal(start.status, 200, start.body?.message || JSON.stringify(start.body));
      assert.equal(start.body.session.status, "ACTIVE");
    }

    assert.equal(await modelsA.LiveTrackingSession.countDocuments({ status: "ACTIVE" }), 1);
    assert.equal(await modelsB.LiveTrackingSession.countDocuments({ status: "ACTIVE" }), 1);

    // Snapshot attendance so cleanup cannot silently rewrite punch rows.
    const attendanceBeforeA = await modelsA.Attendance.find({ employeeId: empA._id }).lean();
    assert.ok(attendanceBeforeA.length >= 1);

    // Non-ACTIVE sentinel must not be rewritten by global cleanup.
    const sentinel = await modelsA.LiveTrackingSession.create({
      employeeId: empA._id,
      status: "STOPPED",
      startedAt: new Date(Date.now() - 3_600_000),
      expiresAt: new Date(Date.now() - 1_800_000),
      stoppedAt: new Date(Date.now() - 1_800_000),
    });
    const sentinelStoppedAt = new Date(sentinel.stoppedAt).toISOString();

    const disabled = await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { liveTracking: false }, confirm: true });
    assert.equal(disabled.status, 200, disabled.body?.message || JSON.stringify(disabled.body));
    assert.ok(
      disabled.body.liveTrackingSessionsStopped >= 2,
      `expected >=2 stopped, got ${disabled.body.liveTrackingSessionsStopped}`
    );

    assert.equal(await modelsA.LiveTrackingSession.countDocuments({ status: "ACTIVE" }), 0);
    assert.equal(await modelsB.LiveTrackingSession.countDocuments({ status: "ACTIVE" }), 0);

    const sentinelAfter = await modelsA.LiveTrackingSession.findById(sentinel._id).lean();
    assert.equal(new Date(sentinelAfter.stoppedAt).toISOString(), sentinelStoppedAt);

    const attendanceAfterA = await modelsA.Attendance.find({ employeeId: empA._id }).lean();
    assert.equal(attendanceAfterA.length, attendanceBeforeA.length);
    assert.equal(
      JSON.stringify(attendanceAfterA.map((r) => ({ id: String(r._id), status: r.status, updatedAt: r.updatedAt }))),
      JSON.stringify(attendanceBeforeA.map((r) => ({ id: String(r._id), status: r.status, updatedAt: r.updatedAt })))
    );

    const updateBlocked = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", empCookieA)
      .send({ location });
    assert.equal(updateBlocked.status, 403);
    assert.equal(updateBlocked.body.code, "PLATFORM_MODULE_DISABLED");

    const startBlocked = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .send({ durationMinutes: 30 });
    assert.equal(startBlocked.status, 403);

    const stopOk = await request(app)
      .post("/api/employees/me/tracking/stop")
      .set("Cookie", empCookieA);
    assert.equal(stopOk.status, 200);

    const stopUnauth = await request(app).post("/api/employees/me/tracking/stop");
    assert.equal(stopUnauth.status, 401);

    const statusOk = await request(app)
      .get("/api/employees/me/tracking/status")
      .set("Cookie", empCookieA);
    assert.equal(statusOk.status, 200);

    // Duplicate disable is idempotent (no ACTIVE left; still 200).
    const disableAgain = await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { liveTracking: false }, confirm: true });
    assert.equal(disableAgain.status, 200);
    assert.equal(disableAgain.body.unchanged, true);

    await request(app)
      .patch("/api/platform/modules")
      .set("Cookie", platformCookie)
      .send({ modules: { liveTracking: true }, confirm: true });
  });
});
