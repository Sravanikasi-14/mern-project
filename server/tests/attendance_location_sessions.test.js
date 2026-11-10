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
import { haversineDistanceMeters, isInsideGeofence } from "../utils/geo.js";

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

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();
  await connectCentralDB();
  app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  const slug = `acme-loc-${Date.now()}`;
  acme = await Company.create({
    name: "Acme Loc",
    companyName: "Acme Loc",
    slug,
    databaseName: `company_${slug.replace(/-/g, "_")}`,
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
    hrAccessEnforcement: { mode: "OFF" },
  });
  models = await getCompanyModels(acme, { provision: true });
  const passwordHash = await hashPassword("Password123!");
  hrUser = await models.User.create({
    email: "hr@acme-loc.test",
    passwordHash,
    role: "HR_ADMIN",
    isActive: true,
  });
  const empUser = await models.User.create({
    email: "emp@acme-loc.test",
    passwordHash,
    role: "EMPLOYEE",
    isActive: true,
  });
  employee = await models.Employee.create({
    companyId: acme._id,
    userId: empUser._id,
    employeeCode: "LOC-001",
    fullName: "Loc Employee",
    email: "emp@acme-loc.test",
    status: "ACTIVE",
    job: {
      jobTitle: "Engineer",
      workArrangement: { mode: "OFFICE" },
    },
  });
  await models.CompanyHrPolicy.deleteMany({});
  await models.CompanyHrPolicy.create({
    ...DEFAULT_HR_POLICY,
    // Must be the newest effective policy so it wins over any auto-seeded defaults.
    effectiveFromDate: new Date("2026-01-01"),
    locationRules: {
      ...DEFAULT_HR_POLICY.locationRules,
      geofenceEnabled: true,
      geofenceRadiusMeters: 300,
      officeLatitude: OFFICE.latitude,
      officeLongitude: OFFICE.longitude,
      officeAddress: "Hyderabad Office",
      outOfRadiusPolicy: "BLOCK",
      requireLocationForPunch: true,
    },
    workArrangementRules: {
      ...DEFAULT_HR_POLICY.workArrangementRules,
      hybridRemoteApprovalRequired: true,
      wfhLocationMode: "WFH_APPROVED_LOCATION",
      monitoringEnabled: true,
    },
    updatedBy: hrUser._id,
  });

  cookies.hr = await login("hr@acme-loc.test");
  cookies.emp = await login("emp@acme-loc.test");
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectAll();
  if (mongoServer) await mongoServer.stop();
});

describe("geo helpers", () => {
  it("computes haversine and geofence membership", () => {
    const d = haversineDistanceMeters(OFFICE.latitude, OFFICE.longitude, OFFICE.latitude, OFFICE.longitude);
    assert.equal(d, 0);
    const inside = isInsideGeofence({
      latitude: OFFICE.latitude,
      longitude: OFFICE.longitude,
      centerLatitude: OFFICE.latitude,
      centerLongitude: OFFICE.longitude,
      radiusMeters: 200,
    });
    assert.equal(inside.ok, true);
    const outside = isInsideGeofence({
      latitude: FAR.latitude,
      longitude: FAR.longitude,
      centerLatitude: OFFICE.latitude,
      centerLongitude: OFFICE.longitude,
      radiusMeters: 200,
    });
    assert.equal(outside.ok, false);
  });
});

describe("office multi-session attendance", () => {
  it("allows office punch-in inside radius and blocks outside", async () => {
    const blocked = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: { ...FAR, accuracy: 10 }, sessionType: "OFFICE" });
    assert.equal(blocked.status, 400);

    const ok = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: { ...OFFICE, accuracy: 10 }, sessionType: "OFFICE" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.session.sessionType, "OFFICE");
    assert.ok(ok.body.attendance.openSessionId);

    const dup = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: { ...OFFICE, accuracy: 10 }, sessionType: "OFFICE" });
    assert.ok([400, 409].includes(dup.status), JSON.stringify(dup.body));
    assert.match(dup.body.message || "", /active attendance session/i);
  });

  it("closes session on punch-out and allows a second session the same day", async () => {
    const out = await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", cookies.emp)
      .send({ location: { ...OFFICE, accuracy: 12 } });
    assert.equal(out.status, 200);
    assert.equal(out.body.session.status, "COMPLETED");
    assert.equal(out.body.attendance.openSessionId, null);

    const second = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: { ...OFFICE, accuracy: 10 }, sessionType: "OFFICE" });
    assert.equal(second.status, 200);
    assert.equal(second.body.attendance.sessions.length >= 2, true);

    const status = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    assert.equal(status.status, 200);
    assert.equal(status.body.attendance.canPunchOut, true);
    assert.equal(status.body.attendance.canPunchIn, false);

    await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", cookies.emp)
      .send({ location: { ...OFFICE, accuracy: 10 } });
  });
});

describe("hybrid remote approval workflow", () => {
  it("blocks remote punch without approval and allows after HR approval", async () => {
    employee.job.workArrangement.mode = "HYBRID";
    employee.markModified("job");
    await employee.save();

    const denied = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: { ...HOME, accuracy: 8 }, sessionType: "REMOTE" });
    assert.equal(denied.status, 400);

    const st = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    const workDate = st.body.attendance.date;
    const reqRes = await request(app)
      .post("/api/employees/me/attendance/remote-requests")
      .set("Cookie", cookies.emp)
      .send({
        workDate,
        reason: "Client workshop from home",
        location: { ...HOME, label: "Home", radiusMeters: 250 },
        // All-day period — dedicated period tests cover HH:mm enforcement.
        sessionPeriod: { startTime: "", endTime: "" },
      });
    assert.equal(reqRes.status, 201, JSON.stringify(reqRes.body));
    const requestId = reqRes.body.request.id;

    const pendingPunch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: { ...HOME, accuracy: 8 },
        sessionType: "REMOTE",
        remoteWorkRequestId: requestId,
      });
    assert.equal(pendingPunch.status, 400);

    const decide = await request(app)
      .post(`/api/admin/attendance/remote-requests/${requestId}/decide`)
      .set("Cookie", cookies.hr)
      .send({ decision: "APPROVED", remarks: "Approved for afternoon" });
    assert.equal(decide.status, 200, JSON.stringify(decide.body));

    const remoteIn = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: { ...HOME, accuracy: 8 },
        sessionType: "REMOTE",
        remoteWorkRequestId: requestId,
      });
    assert.equal(remoteIn.status, 200, JSON.stringify(remoteIn.body));
    assert.equal(remoteIn.body.session.sessionType, "REMOTE");

    const wrongPlace = await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", cookies.emp)
      .send({ location: { ...FAR, accuracy: 8 } });
    // WARN/BLOCK depending on policy; default BLOCK on outside may reject punch-out
    assert.ok([200, 400].includes(wrongPlace.status));
    if (wrongPlace.status === 400) {
      const remoteOut = await request(app)
        .post("/api/employees/me/attendance/punch-out")
        .set("Cookie", cookies.emp)
        .send({ location: { ...HOME, accuracy: 8 } });
      assert.equal(remoteOut.status, 200);
    }
  });

  it("blocks employee from approving their own remote request", async () => {
    const st = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    const workDate = st.body.attendance.date;
    // Use a future date to avoid duplicate-pending conflicts with prior test day
    const parts = workDate.split("-").map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1));
    const nextDate = d.toISOString().slice(0, 10);

    const reqRes = await request(app)
      .post("/api/employees/me/attendance/remote-requests")
      .set("Cookie", cookies.emp)
      .send({
        workDate: nextDate,
        reason: "Self-approve attempt",
        location: { ...HOME, label: "Home", radiusMeters: 250 },
      });
    assert.equal(reqRes.status, 201, JSON.stringify(reqRes.body));
    const requestId = reqRes.body.request.id;

    const selfDecide = await request(app)
      .post(`/api/admin/attendance/remote-requests/${requestId}/decide`)
      .set("Cookie", cookies.emp)
      .send({ decision: "APPROVED" });
    assert.ok([401, 403].includes(selfDecide.status), JSON.stringify(selfDecide.body));
  });
});

describe("geofence monitoring during active session", () => {
  it("records a single outside exception then return, without ending the session", async () => {
    employee.job.workArrangement.mode = "OFFICE";
    employee.markModified("job");
    await employee.save();

    await models.CompanyHrPolicy.updateMany(
      {},
      {
        $set: {
          "locationRules.geofenceEnabled": true,
          "locationRules.outOfRadiusPolicy": "WARN",
          "workArrangementRules.monitoringEnabled": true,
        },
      }
    );

    const status = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    if (status.body?.attendance?.status === "CHECKED_IN" || status.body?.canPunchOut) {
      await request(app)
        .post("/api/employees/me/attendance/punch-out")
        .set("Cookie", cookies.emp)
        .send({ location: { ...OFFICE, accuracy: 10 } });
    }

    const punchIn = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: { ...OFFICE, accuracy: 10 }, sessionType: "OFFICE" });
    assert.equal(punchIn.status, 200, JSON.stringify(punchIn.body));

    const startTrack = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", cookies.emp)
      .send({ durationMinutes: 30, location: { ...OFFICE, accuracy: 10 } });
    assert.ok([200, 201].includes(startTrack.status), JSON.stringify(startTrack.body));

    const outside1 = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", cookies.emp)
      .send({ location: { ...FAR, accuracy: 12 } });
    assert.equal(outside1.status, 200, JSON.stringify(outside1.body));

    const outside2 = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", cookies.emp)
      .send({ location: { ...FAR, accuracy: 14 } });
    assert.equal(outside2.status, 200);

    const exceptions = await request(app)
      .get("/api/admin/attendance/location-exceptions?status=OPEN")
      .set("Cookie", cookies.hr);
    assert.equal(exceptions.status, 200);
    const openOutside = (exceptions.body.exceptions || []).filter((e) => e.type === "OUTSIDE_GEOFENCE");
    assert.ok(openOutside.length >= 1);

    const back = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", cookies.emp)
      .send({ location: { ...OFFICE, accuracy: 10 } });
    assert.equal(back.status, 200);

    const stillIn = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    assert.equal(stillIn.body.attendance.status, "CHECKED_IN");
    assert.equal(stillIn.body.attendance.canPunchOut, true);

    await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", cookies.emp)
      .send({ location: { ...OFFICE, accuracy: 10 } });
  });
});

describe("HR regularization", () => {
  it("closes an open session with an audit trail without granting remote rights", async () => {
    employee.job.workArrangement.mode = "OFFICE";
    employee.markModified("job");
    await employee.save();

    const status = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    if (!status.body?.canPunchOut) {
      const pin = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({ location: { ...OFFICE, accuracy: 10 }, sessionType: "OFFICE" });
      assert.equal(pin.status, 200, JSON.stringify(pin.body));
    }

    const workDate = (await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp))
      .body.attendance.date;

    const reg = await request(app)
      .post(`/api/admin/attendance/employees/${employee._id}/regularize`)
      .set("Cookie", cookies.hr)
      .send({
        workDate,
        reason: "Forgot to punch out after client visit",
        closeOpenSession: true,
      });
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    assert.equal(reg.body.attendance.regularization.decision, "APPROVED");
    assert.ok(Array.isArray(reg.body.attendance.regularization.auditTrail));
    assert.ok(reg.body.attendance.regularization.auditTrail.length >= 1);
    assert.equal(reg.body.attendance.openSessionId, null);

    const empDenied = await request(app)
      .post(`/api/admin/attendance/employees/${employee._id}/regularize`)
      .set("Cookie", cookies.emp)
      .send({ workDate, reason: "Self regularize", closeOpenSession: true });
    assert.ok([401, 403].includes(empDenied.status));
  });
});

describe("WFH unrestricted mode", () => {
  it("allows remote punch from any location when WFH validation is disabled", async () => {
    employee.job.workArrangement.mode = "WFH";
    employee.markModified("job");
    await employee.save();

    await models.CompanyHrPolicy.updateMany(
      {},
      {
        $set: {
          "workArrangementRules.wfhLocationMode": "WFH_UNRESTRICTED",
          "workArrangementRules.hybridRemoteApprovalRequired": false,
        },
      }
    );

    // Close any leftover open session from prior tests
    const status = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    if (status.body?.canPunchOut || status.body?.attendance?.status === "CHECKED_IN") {
      await request(app)
        .post("/api/employees/me/attendance/punch-out")
        .set("Cookie", cookies.emp)
        .send({ location: { ...HOME, accuracy: 10 } });
    }

    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: { ...FAR, accuracy: 20 }, sessionType: "REMOTE" });
    assert.equal(punch.status, 200, JSON.stringify(punch.body));
    assert.equal(punch.body.session.sessionType, "REMOTE");

    const out = await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", cookies.emp)
      .send({ location: { ...FAR, accuracy: 20 } });
    assert.equal(out.status, 200);
  });
});
