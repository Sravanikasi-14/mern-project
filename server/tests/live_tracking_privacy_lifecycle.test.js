import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import {
  buildNativeClientProof,
  CLIENT_PLATFORM_HEADERS,
  CLIENT_PLATFORMS,
} from "../utils/clientPlatform.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.HRMS_NATIVE_CLIENT_SECRET = "test-native-client-secret-key";

let mongo;
let app;
let companyA;
let companyB;
let modelsA;
let modelsB;
let empCookieA;
let empCookieB;
let empA;
let empB;
let locationA;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  const name = getAuthCookieName();
  // Prefer a live session cookie (ignore logout clear cookies).
  const live = cookies.find(
    (val) =>
      val.startsWith(`${name}=`) &&
      !/; *Max-Age=0/i.test(val) &&
      !/; *Expires=Thu, 01 Jan 1970/i.test(val) &&
      !new RegExp(`^${name}=;`).test(val)
  );
  return live || cookies.find((val) => val.startsWith(`${name}=`));
}

function nativeProofHeaders(platform = CLIENT_PLATFORMS.ANDROID) {
  const timestamp = Date.now();
  const proof = buildNativeClientProof(platform, timestamp);
  return {
    [CLIENT_PLATFORM_HEADERS.PLATFORM]: platform,
    [CLIENT_PLATFORM_HEADERS.TIMESTAMP]: String(timestamp),
    [CLIENT_PLATFORM_HEADERS.PROOF]: proof,
  };
}

async function loginEmployee(email, password, companyCode, extraHeaders = {}) {
  const res = await request(app)
    .post("/api/auth/login")
    .set(extraHeaders)
    .send({ email, password, companyCode });
  assert.equal(res.status, 200, res.body?.message || "login failed");
  return cookieFrom(res);
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  companyA = await Company.create({
    companyName: "Gamma Corp",
    slug: "gamma",
    databaseName: "company_gamma_track_priv",
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata" },
  });
  modelsA = await getCompanyModels(companyA);

  const userA = await modelsA.User.create({
    email: "tracker@gamma.test",
    passwordHash: await hashPassword("GammaPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  empA = await modelsA.Employee.create({
    userId: userA._id,
    companyId: companyA._id,
    employeeCode: "GAM-001",
    fullName: "Tracker One",
    email: "tracker@gamma.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { department: "Field", jobTitle: "Field Agent" },
  });
  await modelsA.User.findByIdAndUpdate(userA._id, { employeeId: empA._id });

  await modelsA.CompanyHrPolicy.create({
    effectiveFromDate: new Date("2026-01-01"),
    locationRules: {
      requireLocationForPunch: true,
      allowWebTracking: true,
      geofenceEnabled: false,
    },
  });

  companyB = await Company.create({
    companyName: "Delta Corp",
    slug: "delta",
    databaseName: "company_delta_track_priv",
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata" },
  });
  modelsB = await getCompanyModels(companyB);
  const userB = await modelsB.User.create({
    email: "other@delta.test",
    passwordHash: await hashPassword("DeltaPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  empB = await modelsB.Employee.create({
    userId: userB._id,
    companyId: companyB._id,
    employeeCode: "DEL-001",
    fullName: "Other Tenant",
    email: "other@delta.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { department: "Ops", jobTitle: "Operator" },
  });
  await modelsB.User.findByIdAndUpdate(userB._id, { employeeId: empB._id });

  locationA = { latitude: 12.9716, longitude: 77.5946, accuracy: 10 };

  empCookieA = await loginEmployee("tracker@gamma.test", "GammaPass123!", "gamma");
  empCookieB = await loginEmployee("other@delta.test", "DeltaPass123!", "delta");
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Live tracking privacy & lifecycle", () => {
  it("1. rejects tracking start without an active punch-in", async () => {
    const res = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .send({ durationMinutes: 30 });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /punch-in/i);
    assert.equal(res.body.code, "TRACKING_REQUIRES_PUNCH_IN");
  });

  it("2. allows tracking start after a valid punch-in", async () => {
    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", empCookieA)
      .send({ location: locationA });
    assert.equal(punch.status, 200);

    const start = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .send({ durationMinutes: 30 });
    assert.equal(start.status, 200);
    assert.equal(start.body.session.status, "ACTIVE");
  });

  it("3–4. punch-out stops active tracking; start rejected after punch-out", async () => {
    const activeBefore = await modelsA.LiveTrackingSession.findOne({
      employeeId: empA._id,
      status: "ACTIVE",
    });
    assert.ok(activeBefore, "expected active session from prior test");

    const punchOut = await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", empCookieA)
      .send({ location: locationA });
    assert.equal(punchOut.status, 200);
    assert.equal(punchOut.body.trackingStopped, true);
    assert.ok(punchOut.body.trackingSessionsStopped >= 1);

    const stillActive = await modelsA.LiveTrackingSession.findOne({
      employeeId: empA._id,
      status: "ACTIVE",
    });
    assert.equal(stillActive, null);

    const startAfter = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .send({ durationMinutes: 30 });
    assert.equal(startAfter.status, 400);
    assert.match(startAfter.body.message, /punch-in/i);
  });

  it("5. logout stops an active tracking session", async () => {
    // Fresh day state: clear attendance + create checked-in record for logout test
    await modelsA.Attendance.deleteMany({ employeeId: empA._id });
    await modelsA.LiveTrackingSession.deleteMany({ employeeId: empA._id });

    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", empCookieA)
      .send({ location: locationA });
    assert.equal(punch.status, 200);

    const start = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .send({ durationMinutes: 30 });
    assert.equal(start.status, 200);

    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", empCookieA);
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.trackingStopped, true);

    const stillActive = await modelsA.LiveTrackingSession.findOne({
      employeeId: empA._id,
      status: "ACTIVE",
    });
    assert.equal(stillActive, null);

    // Re-login for subsequent tests
    empCookieA = await loginEmployee("tracker@gamma.test", "GammaPass123!", "gamma");
  });

  it("6. web tracking blocked when allowWebTracking=false", async () => {
    empCookieA = await loginEmployee("tracker@gamma.test", "GammaPass123!", "gamma");
    await modelsA.Attendance.deleteMany({ employeeId: empA._id });
    await modelsA.LiveTrackingSession.deleteMany({ employeeId: empA._id });
    await modelsA.CompanyHrPolicy.updateOne(
      {},
      { $set: { "locationRules.allowWebTracking": false } }
    );

    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", empCookieA)
      .send({ location: locationA });
    assert.equal(punch.status, 200, punch.body?.message || JSON.stringify(punch.body));

    const start = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .send({ durationMinutes: 30 });
    assert.equal(start.status, 403, start.body?.message || JSON.stringify(start.body));
    assert.equal(start.body.code, "WEB_TRACKING_DISABLED");
  });

  it("7. android session can start tracking when allowWebTracking=false", async () => {
    // Bind android platform at login with valid native proof
    empCookieA = await loginEmployee(
      "tracker@gamma.test",
      "GammaPass123!",
      "gamma",
      nativeProofHeaders(CLIENT_PLATFORMS.ANDROID)
    );

    const session = await modelsA.AuthSession.findOne({
      userId: empA.userId,
      isActive: true,
    }).sort({ createdAt: -1 });
    assert.ok(session);
    assert.equal(session.clientPlatform, CLIENT_PLATFORMS.ANDROID);

    // Ensure active punch-in still present (or recreate)
    const punchedIn = await modelsA.Attendance.findOne({
      employeeId: empA._id,
      checkIn: { $ne: null },
      checkOut: null,
    });
    if (!punchedIn) {
      await modelsA.Attendance.deleteMany({ employeeId: empA._id });
      const punch = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", empCookieA)
        .send({ location: locationA });
      assert.equal(punch.status, 200, punch.body?.message);
    }

    const start = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .send({ durationMinutes: 30 });
    assert.equal(start.status, 200, start.body?.message || JSON.stringify(start.body));
    assert.equal(start.body.session.status, "ACTIVE");
  });

  it("8. spoofed android headers on web session cannot bypass web restriction", async () => {
    await modelsA.LiveTrackingSession.updateMany(
      { employeeId: empA._id, status: "ACTIVE" },
      { $set: { status: "STOPPED", stoppedAt: new Date() } }
    );

    // Fresh web login (no native proof) — platform bound as web
    empCookieA = await loginEmployee("tracker@gamma.test", "GammaPass123!", "gamma");
    const webSession = await modelsA.AuthSession.findOne({ isActive: true }).sort({
      createdAt: -1,
    });
    assert.equal(webSession.clientPlatform, CLIENT_PLATFORMS.WEB);

    // Spoof android headers only on tracking start (not bound at login)
    const spoofed = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .set(nativeProofHeaders(CLIENT_PLATFORMS.ANDROID))
      .send({ durationMinutes: 30, clientPlatform: "android", platform: "android" });
    assert.equal(spoofed.status, 403);
    assert.equal(spoofed.body.code, "WEB_TRACKING_DISABLED");
  });

  it("9. employees only see/update their own tracking status", async () => {
    // Restore web tracking for ownership checks
    await modelsA.CompanyHrPolicy.updateOne(
      {},
      { $set: { "locationRules.allowWebTracking": true } }
    );

    const peerUser = await modelsA.User.create({
      email: "peer@gamma.test",
      passwordHash: await hashPassword("GammaPass123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
    });
    const peerEmp = await modelsA.Employee.create({
      userId: peerUser._id,
      companyId: companyA._id,
      employeeCode: "GAM-002",
      fullName: "Peer Two",
      email: "peer@gamma.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { department: "Field", jobTitle: "Agent" },
    });
    await modelsA.User.findByIdAndUpdate(peerUser._id, { employeeId: peerEmp._id });
    const peerCookie = await loginEmployee("peer@gamma.test", "GammaPass123!", "gamma");

    await modelsA.Attendance.deleteMany({ employeeId: empA._id });
    const punchA = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", empCookieA)
      .send({ location: locationA });
    assert.equal(punchA.status, 200);

    const startA = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .send({ durationMinutes: 30, employeeId: String(peerEmp._id) });
    assert.equal(startA.status, 200);

    const peerStatus = await request(app)
      .get("/api/employees/me/tracking/status")
      .set("Cookie", peerCookie)
      .query({ employeeId: String(empA._id) });
    assert.equal(peerStatus.status, 200);
    assert.equal(peerStatus.body.isTrackingActive, false);

    const peerUpdate = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", peerCookie)
      .send({
        employeeId: String(empA._id),
        location: { latitude: 13.0, longitude: 77.0, accuracy: 5 },
      });
    assert.equal(peerUpdate.status, 400);

    const ownerStill = await modelsA.LiveTrackingSession.findOne({
      employeeId: empA._id,
      status: "ACTIVE",
    });
    assert.ok(ownerStill);
  });

  it("10. cross-tenant tracking access is rejected", async () => {
    const foreignStatus = await request(app)
      .get("/api/employees/me/tracking/status")
      .set("Cookie", empCookieB);
    assert.equal(foreignStatus.status, 200);
    assert.equal(foreignStatus.body.isTrackingActive, false);

    const foreignUpdate = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", empCookieB)
      .send({
        employeeId: String(empA._id),
        location: { latitude: 12.97, longitude: 77.59 },
      });
    assert.equal(foreignUpdate.status, 400);

    const aStill = await modelsA.LiveTrackingSession.findOne({
      employeeId: empA._id,
      status: "ACTIVE",
    });
    assert.ok(aStill);
  });

  it("11. STOPPED sessions reject further location updates", async () => {
    const stop = await request(app)
      .post("/api/employees/me/tracking/stop")
      .set("Cookie", empCookieA);
    assert.equal(stop.status, 200);

    const update = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", empCookieA)
      .send({ location: locationA });
    assert.equal(update.status, 400);
    assert.match(update.body.message, /No active tracking session found/);
  });

  it("12. repeated stop and logout operations are safe", async () => {
    const stop1 = await request(app)
      .post("/api/employees/me/tracking/stop")
      .set("Cookie", empCookieA);
    assert.equal(stop1.status, 200);

    const stop2 = await request(app)
      .post("/api/employees/me/tracking/stop")
      .set("Cookie", empCookieA);
    assert.equal(stop2.status, 200);

    const logout1 = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", empCookieA);
    assert.equal(logout1.status, 200);

    const logout2 = await request(app).post("/api/auth/logout");
    assert.equal(logout2.status, 200);

    empCookieA = await loginEmployee("tracker@gamma.test", "GammaPass123!", "gamma");
  });
});
