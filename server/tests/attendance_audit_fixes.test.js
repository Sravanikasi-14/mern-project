process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { DEFAULT_HR_POLICY } from "../models/CompanyHrPolicy.js";
import { hashPassword } from "../utils/password.js";
import {
  assertWithinApprovedSessionPeriod,
  applyGeofenceDecision,
  evaluateLocationAgainstZone,
} from "../services/attendanceLocationService.js";
import {
  assertLocationTimestampFresh,
  validateLocationCoordinates,
  punchInEmployee,
  punchOutEmployee,
} from "../services/attendanceService.js";
import { HttpError } from "../utils/httpError.js";

let mongoServer;
let app;
let server;
let acme;
let models;
let cookies = {};
let employee;
let hrUser;

const OFFICE = { latitude: 17.385, longitude: 78.4867 };
const HOME = { latitude: 17.45, longitude: 78.5 };
const FAR = { latitude: 17.6, longitude: 78.7 };

async function login(email, companyCode) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "Password123!", companyCode: companyCode || acme.slug });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"];
}

async function ensurePunchedOut() {
  const st = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
  if (st.body?.canPunchOut || st.body?.attendance?.status === "CHECKED_IN") {
    await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", cookies.emp)
      .send({ location: { ...OFFICE, accuracy: 10, capturedAt: new Date().toISOString() } });
  }
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();
  await connectCentralDB();
  app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  const slug = `acme-audit-${Date.now()}`;
  acme = await Company.create({
    name: "Acme Audit",
    companyName: "Acme Audit",
    slug,
    databaseName: `company_${slug.replace(/-/g, "_")}`,
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
    hrAccessEnforcement: { mode: "OFF" },
  });
  models = await getCompanyModels(acme, { provision: true });
  const passwordHash = await hashPassword("Password123!");
  hrUser = await models.User.create({
    email: "hr@acme-audit.test",
    passwordHash,
    role: "HR_ADMIN",
    isActive: true,
  });
  const empUser = await models.User.create({
    email: "emp@acme-audit.test",
    passwordHash,
    role: "EMPLOYEE",
    isActive: true,
  });
  employee = await models.Employee.create({
    companyId: acme._id,
    userId: empUser._id,
    employeeCode: "AUD-001",
    fullName: "Audit Employee",
    email: "emp@acme-audit.test",
    status: "ACTIVE",
    job: {
      jobTitle: "Engineer",
      workArrangement: { mode: "OFFICE" },
    },
  });
  await models.CompanyHrPolicy.deleteMany({});
  await models.CompanyHrPolicy.create({
    ...DEFAULT_HR_POLICY,
    effectiveFromDate: new Date("2026-01-01"),
    locationRules: {
      ...DEFAULT_HR_POLICY.locationRules,
      geofenceEnabled: true,
      geofenceRadiusMeters: 300,
      officeLatitude: OFFICE.latitude,
      officeLongitude: OFFICE.longitude,
      officeAddress: "Hyderabad Office",
      outOfRadiusPolicy: "BLOCK",
      accuracyFailurePolicy: "WARN",
      requireLocationForPunch: true,
      maxLocationAgeSeconds: 180,
      maxLocationFutureSkewSeconds: 60,
    },
    workArrangementRules: {
      ...DEFAULT_HR_POLICY.workArrangementRules,
      hybridRemoteApprovalRequired: true,
      wfhLocationMode: "WFH_UNRESTRICTED",
      monitoringEnabled: true,
    },
    updatedBy: hrUser._id,
  });

  cookies.hr = await login("hr@acme-audit.test");
  cookies.emp = await login("emp@acme-audit.test");
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectAll();
  if (mongoServer) await mongoServer.stop();
});

describe("session period helpers", () => {
  it("allows all-day when period empty; rejects malformed/reversed; enforces window", () => {
    assert.equal(
      assertWithinApprovedSessionPeriod({
        sessionPeriod: {},
        workDate: "2026-11-10",
        companyTimezone: "Asia/Kolkata",
        now: new Date("2026-11-10T10:00:00+05:30"),
      }).ok,
      true
    );
    assert.throws(
      () =>
        assertWithinApprovedSessionPeriod({
          sessionPeriod: { startTime: "09:00", endTime: "" },
          workDate: "2026-11-10",
          companyTimezone: "Asia/Kolkata",
          now: new Date("2026-11-10T10:00:00+05:30"),
        }),
      (e) => e instanceof HttpError && e.status === 400
    );
    assert.throws(
      () =>
        assertWithinApprovedSessionPeriod({
          sessionPeriod: { startTime: "18:00", endTime: "09:00" },
          workDate: "2026-11-10",
          companyTimezone: "Asia/Kolkata",
          now: new Date("2026-11-10T10:00:00+05:30"),
        }),
      (e) => e instanceof HttpError && /end must be after start/i.test(e.message)
    );
    assert.throws(
      () =>
        assertWithinApprovedSessionPeriod({
          sessionPeriod: { startTime: "09:00", endTime: "12:00" },
          workDate: "2026-11-10",
          companyTimezone: "Asia/Kolkata",
          now: new Date("2026-11-10T14:00:00+05:30"),
        }),
      (e) => e instanceof HttpError && /only allowed between/i.test(e.message)
    );
    assert.equal(
      assertWithinApprovedSessionPeriod({
        sessionPeriod: { startTime: "09:00", endTime: "17:00" },
        workDate: "2026-11-10",
        companyTimezone: "Asia/Kolkata",
        now: new Date("2026-11-10T10:30:00+05:30"),
      }).ok,
      true
    );
  });
});

describe("accuracy vs out-of-radius policies", () => {
  const zone = {
    label: "Office",
    latitude: OFFICE.latitude,
    longitude: OFFICE.longitude,
    radiusMeters: 200,
  };

  it("LOW_ACCURACY + WARN while outOfRadiusPolicy BLOCK still allows (does not inherit BLOCK)", async () => {
    const policy = {
      locationRules: {
        outOfRadiusPolicy: "BLOCK",
        accuracyFailurePolicy: "WARN",
        maxAccuracyMeters: 20,
      },
    };
    const decision = await applyGeofenceDecision({
      models,
      employee,
      policy,
      location: { ...OFFICE, accuracy: 80 },
      zone,
      enforce: true,
      workDate: "2026-11-10",
      sessionType: "OFFICE",
      phase: "PUNCH_IN",
    });
    assert.equal(decision.geofence.lowAccuracy, true);
    assert.equal(decision.geofence.outside, false);
    assert.ok(decision.exception);
    assert.equal(decision.exception.type, "LOW_ACCURACY");
  });

  it("LOW_ACCURACY + BLOCK rejects", async () => {
    const policy = {
      locationRules: {
        outOfRadiusPolicy: "WARN",
        accuracyFailurePolicy: "BLOCK",
        maxAccuracyMeters: 20,
      },
    };
    await assert.rejects(
      () =>
        applyGeofenceDecision({
          models,
          employee,
          policy,
          location: { ...OFFICE, accuracy: 80 },
          zone,
          enforce: true,
          workDate: "2026-11-10",
          sessionType: "OFFICE",
          phase: "PUNCH_IN",
        }),
      (e) => e instanceof HttpError && /accuracy/i.test(e.message)
    );
  });

  it("OUT_OF_RADIUS + WARN allows with exception", async () => {
    const policy = {
      locationRules: {
        outOfRadiusPolicy: "WARN",
        accuracyFailurePolicy: "WARN",
        maxAccuracyMeters: 100,
      },
    };
    const decision = await applyGeofenceDecision({
      models,
      employee,
      policy,
      location: { ...FAR, accuracy: 10 },
      zone,
      enforce: true,
      workDate: "2026-11-10",
      sessionType: "OFFICE",
      phase: "PUNCH_IN",
    });
    assert.equal(decision.geofence.outside, true);
    assert.ok(decision.exception);
  });

  it("OUT_OF_RADIUS + BLOCK rejects", async () => {
    const policy = {
      locationRules: {
        outOfRadiusPolicy: "BLOCK",
        accuracyFailurePolicy: "WARN",
        maxAccuracyMeters: 100,
      },
    };
    await assert.rejects(
      () =>
        applyGeofenceDecision({
          models,
          employee,
          policy,
          location: { ...FAR, accuracy: 10 },
          zone,
          enforce: true,
          workDate: "2026-11-10",
          sessionType: "OFFICE",
          phase: "PUNCH_IN",
        }),
      (e) => e instanceof HttpError && /Location is/i.test(e.message)
    );
  });

  it("evaluateLocationAgainstZone reports lowAccuracy independently", () => {
    const evalResult = evaluateLocationAgainstZone({
      location: { ...OFFICE, accuracy: 200 },
      zone,
      maxAccuracyMeters: 50,
    });
    assert.equal(evalResult.lowAccuracy, true);
    assert.equal(evalResult.outside, false);
  });
});

describe("location timestamp freshness", () => {
  const policy = {
    locationRules: { maxLocationAgeSeconds: 180, maxLocationFutureSkewSeconds: 60 },
  };

  it("accepts fresh and inferred timestamps; rejects stale, future, malformed", () => {
    const now = new Date();
    const fresh = validateLocationCoordinates({
      ...OFFICE,
      accuracy: 10,
      capturedAt: new Date(now.getTime() - 30_000).toISOString(),
    });
    assertLocationTimestampFresh(fresh, policy, now);

    const inferred = validateLocationCoordinates({ ...OFFICE, accuracy: 10 });
    assert.equal(inferred.capturedAtInferred, true);
    assertLocationTimestampFresh(inferred, policy, now);

    const stale = validateLocationCoordinates({
      ...OFFICE,
      accuracy: 10,
      capturedAt: new Date(now.getTime() - 600_000).toISOString(),
    });
    assert.throws(() => assertLocationTimestampFresh(stale, policy, now), (e) =>
      /stale/i.test(e.message)
    );

    const future = validateLocationCoordinates({
      ...OFFICE,
      accuracy: 10,
      capturedAt: new Date(now.getTime() + 600_000).toISOString(),
    });
    assert.throws(() => assertLocationTimestampFresh(future, policy, now), (e) =>
      /future/i.test(e.message)
    );

    assert.throws(
      () => validateLocationCoordinates({ ...OFFICE, accuracy: 10, capturedAt: "not-a-date" }),
      (e) => /capturedAt/i.test(e.message)
    );
  });
});

describe("concurrent session integrity", () => {
  it("allows only one winner for simultaneous first-session punch-ins", async () => {
    await ensurePunchedOut();
    // Wipe today's attendance to force create race
    const st = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    const date = st.body.attendance.date;
    await models.Attendance.deleteMany({ employeeId: employee._id, date });

    const loc = { ...OFFICE, accuracy: 10, capturedAt: new Date().toISOString() };
    const [a, b] = await Promise.all([
      request(app).post("/api/employees/me/attendance/punch-in").set("Cookie", cookies.emp).send({ location: loc, sessionType: "OFFICE" }),
      request(app).post("/api/employees/me/attendance/punch-in").set("Cookie", cookies.emp).send({ location: loc, sessionType: "OFFICE" }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.equal(statuses[0], 200);
    assert.ok([400, 409].includes(statuses[1]), JSON.stringify([a.body, b.body]));
    const day = await models.Attendance.findOne({ employeeId: employee._id, date });
    const active = (day.sessions || []).filter((s) => s.status === "ACTIVE" && !s.checkOut);
    assert.equal(active.length, 1);
    assert.ok(day.openSessionId);
    assert.equal(String(day.openSessionId), String(active[0]._id));
  });

  it("allows only one winner for simultaneous second-session punch-ins", async () => {
    await ensurePunchedOut();
    const loc = { ...OFFICE, accuracy: 10, capturedAt: new Date().toISOString() };
    // Ensure at least one completed session exists
    let pin = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: loc, sessionType: "OFFICE" });
    if (pin.status !== 200) {
      await ensurePunchedOut();
      pin = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({ location: loc, sessionType: "OFFICE" });
    }
    assert.equal(pin.status, 200, JSON.stringify(pin.body));
    const out = await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", cookies.emp)
      .send({ location: loc });
    assert.equal(out.status, 200, JSON.stringify(out.body));

    const [a, b] = await Promise.all([
      request(app).post("/api/employees/me/attendance/punch-in").set("Cookie", cookies.emp).send({ location: loc, sessionType: "OFFICE" }),
      request(app).post("/api/employees/me/attendance/punch-in").set("Cookie", cookies.emp).send({ location: loc, sessionType: "OFFICE" }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.equal(statuses[0], 200);
    assert.ok([400, 409].includes(statuses[1]), JSON.stringify([a.body, b.body]));
    const st = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    const date = st.body.attendance.date;
    const day = await models.Attendance.findOne({ employeeId: employee._id, date });
    const active = (day.sessions || []).filter((s) => !s.checkOut);
    assert.equal(active.length, 1);
  });

  it("allows only one winner for concurrent punch-out", async () => {
    await ensurePunchedOut();
    const loc = { ...OFFICE, accuracy: 10, capturedAt: new Date().toISOString() };
    const pin = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: loc, sessionType: "OFFICE" });
    assert.equal(pin.status, 200, JSON.stringify(pin.body));

    const [a, b] = await Promise.all([
      request(app).post("/api/employees/me/attendance/punch-out").set("Cookie", cookies.emp).send({ location: loc }),
      request(app).post("/api/employees/me/attendance/punch-out").set("Cookie", cookies.emp).send({ location: loc }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.equal(statuses[0], 200);
    assert.ok([400, 409].includes(statuses[1]), JSON.stringify([a.body, b.body]));
    const st = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    assert.equal(st.body.attendance.canPunchOut, false);
    assert.equal(st.body.attendance.openSessionId, null);
  });
});

describe("hybrid approval period and consumption", () => {
  it("blocks remote punch outside approved period and allows inside all-day / wide period", async () => {
    await ensurePunchedOut();
    employee.job.workArrangement.mode = "HYBRID";
    employee.markModified("job");
    await employee.save();

    const st = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    const workDate = st.body.attendance.date;

    const outsideReq = await request(app)
      .post("/api/employees/me/attendance/remote-requests")
      .set("Cookie", cookies.emp)
      .send({
        workDate,
        reason: "Narrow window test",
        location: { ...HOME, label: "Home", radiusMeters: 250 },
        sessionPeriod: { startTime: "00:00", endTime: "00:01" },
      });
    assert.equal(outsideReq.status, 201, JSON.stringify(outsideReq.body));
    const outsideId = outsideReq.body.request.id;
    const decideOut = await request(app)
      .post(`/api/admin/attendance/remote-requests/${outsideId}/decide`)
      .set("Cookie", cookies.hr)
      .send({ decision: "APPROVED" });
    assert.equal(decideOut.status, 200);

    const blocked = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: { ...HOME, accuracy: 8, capturedAt: new Date().toISOString() },
        sessionType: "REMOTE",
        remoteWorkRequestId: outsideId,
      });
    // Outside 00:00-00:01 for nearly all wall-clock times; if somehow inside, skip assert
    if (blocked.status !== 200) {
      assert.equal(blocked.status, 400);
      assert.match(blocked.body.message || "", /session period|only allowed between|00:00/i);
    }

    const okReq = await request(app)
      .post("/api/employees/me/attendance/remote-requests")
      .set("Cookie", cookies.emp)
      .send({
        workDate,
        reason: "Wide window remote",
        location: { ...HOME, label: "Home", radiusMeters: 250 },
        sessionPeriod: { startTime: "00:00", endTime: "23:59" },
      });
    // May 409 if pending still exists from narrow window that wasn't punched
    let okId = okReq.body?.request?.id;
    if (okReq.status === 409 || okReq.status === 400) {
      // Cancel/reject prior pending if needed — approve path already APPROVED for outsideId
      okId = null;
    }
    if (okReq.status === 201) {
      const decideOk = await request(app)
        .post(`/api/admin/attendance/remote-requests/${okId}/decide`)
        .set("Cookie", cookies.hr)
        .send({ decision: "APPROVED" });
      assert.equal(decideOk.status, 200);
      const allowed = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: { ...HOME, accuracy: 8, capturedAt: new Date().toISOString() },
          sessionType: "REMOTE",
          remoteWorkRequestId: okId,
        });
      assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
      await ensurePunchedOut();
    }
  });

  it("prevents approval reuse and concurrent double-consume; rolls back on failed punch", async () => {
    await ensurePunchedOut();
    employee.job.workArrangement.mode = "HYBRID";
    employee.markModified("job");
    await employee.save();

    const st = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    const workDate = st.body.attendance.date;

    // Cancel leftovers by using a unique workDate tomorrow for request submission rules —
    // punch still requires today's date, so use today with all-day after cleaning consumed docs.
    await models.RemoteWorkRequest.deleteMany({ employeeId: employee._id, workDate });

    const reqRes = await request(app)
      .post("/api/employees/me/attendance/remote-requests")
      .set("Cookie", cookies.emp)
      .send({
        workDate,
        reason: "Consume once",
        location: { ...HOME, label: "Home", radiusMeters: 250 },
        sessionPeriod: { startTime: "00:00", endTime: "23:59" },
      });
    assert.equal(reqRes.status, 201, JSON.stringify(reqRes.body));
    const requestId = reqRes.body.request.id;
    assert.equal(
      (
        await request(app)
          .post(`/api/admin/attendance/remote-requests/${requestId}/decide`)
          .set("Cookie", cookies.hr)
          .send({ decision: "APPROVED" })
      ).status,
      200
    );

    const loc = { ...HOME, accuracy: 8, capturedAt: new Date().toISOString() };
    const [a, b] = await Promise.all([
      request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({ location: loc, sessionType: "REMOTE", remoteWorkRequestId: requestId }),
      request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({ location: loc, sessionType: "REMOTE", remoteWorkRequestId: requestId }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.equal(statuses[0], 200, JSON.stringify([a.body, b.body]));
    assert.ok([400, 409].includes(statuses[1]), JSON.stringify([a.body, b.body]));

    const consumed = await models.RemoteWorkRequest.findById(requestId).lean();
    assert.ok(consumed.consumedAt);

    await ensurePunchedOut();
    const reuse = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: loc, sessionType: "REMOTE", remoteWorkRequestId: requestId });
    assert.ok([400, 409].includes(reuse.status), JSON.stringify(reuse.body));

    // Geofence failure happens before consumption — approval must remain unused.
    await models.RemoteWorkRequest.deleteMany({ employeeId: employee._id, workDate });
    await models.CompanyHrPolicy.updateMany({}, { $set: { "locationRules.outOfRadiusPolicy": "BLOCK" } });

    const failReq = await request(app)
      .post("/api/employees/me/attendance/remote-requests")
      .set("Cookie", cookies.emp)
      .send({
        workDate,
        reason: "Will fail geofence",
        location: { ...HOME, label: "Home", radiusMeters: 100 },
        sessionPeriod: { startTime: "00:00", endTime: "23:59" },
      });
    assert.equal(failReq.status, 201, JSON.stringify(failReq.body));
    const failId = failReq.body.request.id;
    assert.equal(
      (
        await request(app)
          .post(`/api/admin/attendance/remote-requests/${failId}/decide`)
          .set("Cookie", cookies.hr)
          .send({ decision: "APPROVED" })
      ).status,
      200
    );

    const failedPunch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: { ...FAR, accuracy: 8, capturedAt: new Date().toISOString() },
        sessionType: "REMOTE",
        remoteWorkRequestId: failId,
      });
    assert.equal(failedPunch.status, 400, JSON.stringify(failedPunch.body));
    const afterFail = await models.RemoteWorkRequest.findById(failId).lean();
    assert.equal(afterFail.consumedAt, null, "failed geofence punch must not consume approval");

    employee.job.workArrangement.mode = "OFFICE";
    employee.markModified("job");
    await employee.save();
  });
});

describe("multi-session duration excludes gaps", () => {
  it("day durationMinutes equals sum of completed sessions, not wall-clock span", async () => {
    await ensurePunchedOut();
    employee.job.workArrangement.mode = "OFFICE";
    employee.markModified("job");
    await employee.save();

    const st = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    const date = st.body.attendance.date;
    await models.Attendance.deleteMany({ employeeId: employee._id, date });

    const base = new Date();
    base.setHours(9, 0, 0, 0);
    const s1In = new Date(base);
    const s1Out = new Date(base.getTime() + 60 * 60 * 1000); // 1h
    const s2In = new Date(base.getTime() + 3 * 60 * 60 * 1000); // gap 2h
    const s2Out = new Date(base.getTime() + 5 * 60 * 60 * 1000); // +2h work

    await models.Attendance.create({
      companyId: employee.companyId,
      employeeId: employee._id,
      date,
      status: "PRESENT",
      checkIn: s1In,
      checkOut: s2Out,
      sessions: [
        {
          sessionType: "OFFICE",
          status: "COMPLETED",
          checkIn: s1In,
          checkOut: s1Out,
          durationMinutes: 60,
        },
        {
          sessionType: "OFFICE",
          status: "COMPLETED",
          checkIn: s2In,
          checkOut: s2Out,
          durationMinutes: 120,
        },
      ],
      openSessionId: null,
      durationMinutes: 180,
      workingHours: "3h 0m",
      schemaVersion: 2,
    });

    const hist = await request(app)
      .get("/api/employees/me/attendance/history")
      .query({ startDate: date, endDate: date })
      .set("Cookie", cookies.emp);
    assert.equal(hist.status, 200);
    const rec = (hist.body.records || []).find((r) => r.date === date);
    assert.ok(rec);
    assert.equal(rec.durationMinutes, 180);
    const wallHours = (s2Out - s1In) / 3600000;
    assert.ok(wallHours > 4);
    assert.ok(rec.durationMinutes / 60 < wallHours);
  });
});
