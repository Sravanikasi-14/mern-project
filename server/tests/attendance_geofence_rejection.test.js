process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.FACE_BIOMETRIC_KEY = "test-face-biometric-key-32chars!!";

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { DEFAULT_HR_POLICY } from "../models/CompanyHrPolicy.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { hashPassword } from "../utils/password.js";
import { isInsideGeofence } from "../utils/geo.js";

const OFFICE = { latitude: 17.448293, longitude: 78.374628 };
const FAR = { latitude: 17.55, longitude: 78.45 };

function nearOffice(overrides = {}) {
  return {
    latitude: OFFICE.latitude + 0.0002,
    longitude: OFFICE.longitude + 0.0002,
    accuracy: 15,
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

function farFromOffice(overrides = {}) {
  return {
    ...FAR,
    accuracy: 20,
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("attendance geofence rejection (desktop + notifications)", () => {
  let mongoServer;
  let app;
  let server;
  let models;
  let otherModels;
  let company;
  let otherCompany;
  let employee;
  let hrUser;
  let companyAdminUser;
  let otherHrUser;
  let cookies = {};

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    await connectCentralDB();
    app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));

    const slug = `geo-rej-${Date.now()}`;
    company = await Company.create({
      name: "Geo Reject Co",
      companyName: "Geo Reject Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
      hrAccessEnforcement: { mode: "OFF" },
    });
    models = await getCompanyModels(company, { provision: true });
    const passwordHash = await hashPassword("Password123!");
    hrUser = await models.User.create({
      email: "hr.georej@example.com",
      passwordHash,
      role: "HR_ADMIN",
      isActive: true,
      fullName: "HR Admin",
    });
    companyAdminUser = await models.User.create({
      email: "ca.georej@example.com",
      passwordHash,
      role: "COMPANY_ADMIN",
      isActive: true,
      fullName: "Company Admin",
    });
    const empUser = await models.User.create({
      email: "emp.georej@example.com",
      passwordHash,
      role: "EMPLOYEE",
      isActive: true,
    });
    employee = await models.Employee.create({
      companyId: company._id,
      userId: empUser._id,
      email: empUser.email,
      fullName: "Geo Reject Emp",
      employeeCode: "GR-1",
      status: "ACTIVE",
      job: { jobTitle: "Engineer", workArrangement: { mode: "OFFICE" } },
    });

    const otherSlug = `geo-rej-other-${Date.now()}`;
    otherCompany = await Company.create({
      name: "Other Geo Co",
      companyName: "Other Geo Co",
      slug: otherSlug,
      databaseName: `company_${otherSlug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
      hrAccessEnforcement: { mode: "OFF" },
    });
    otherModels = await getCompanyModels(otherCompany, { provision: true });
    otherHrUser = await otherModels.User.create({
      email: "hr.othergeo@example.com",
      passwordHash,
      role: "HR_ADMIN",
      isActive: true,
      fullName: "Other HR",
    });

    await models.CompanyHrPolicy.deleteMany({});
    await models.CompanyHrPolicy.create({
      ...DEFAULT_HR_POLICY,
      effectiveFromDate: new Date("2020-01-01"),
      locationRules: {
        ...DEFAULT_HR_POLICY.locationRules,
        requireLocationForPunch: true,
        geofenceEnabled: true,
        geofenceRadiusMeters: 300,
        officeLatitude: OFFICE.latitude,
        officeLongitude: OFFICE.longitude,
        officeName: "HQ",
        outOfRadiusPolicy: "BLOCK",
        maxAccuracyMeters: 80,
        accuracyFailurePolicy: "BLOCK",
        gpsFailurePolicy: "BLOCK",
        maxLocationAgeSeconds: 180,
      },
      attendanceVerification: {
        verificationRequired: false,
        gps: { enabled: false, mandatory: true },
        wifi: { enabled: false, mandatory: true },
        face: { enabled: false, mandatory: true, matchThreshold: 0.55, requireLiveness: true },
        wifiNetworks: [],
      },
      schemaVersion: 2,
    });

    const hrLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "hr.georej@example.com", password: "Password123!", companyCode: company.slug });
    cookies.hr = hrLogin.headers["set-cookie"];
    const caLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "ca.georej@example.com", password: "Password123!", companyCode: company.slug });
    cookies.ca = caLogin.headers["set-cookie"];
    const empLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "emp.georej@example.com", password: "Password123!", companyCode: company.slug });
    cookies.emp = empLogin.headers["set-cookie"];
    const otherHrLogin = await request(app)
      .post("/api/auth/login")
      .send({
        email: "hr.othergeo@example.com",
        password: "Password123!",
        companyCode: otherCompany.slug,
      });
    cookies.otherHr = otherHrLogin.headers["set-cookie"];
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectAll();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await models.Attendance.deleteMany({});
    await models.Notification.deleteMany({});
    await models.AuditLog.deleteMany({});
    await models.LocationException.deleteMany({});
    await models.CompanyHrPolicy.updateMany(
      {},
      {
        $set: {
          "locationRules.geofenceEnabled": true,
          "locationRules.outOfRadiusPolicy": "BLOCK",
          "locationRules.accuracyFailurePolicy": "BLOCK",
          "attendanceVerification.gps.enabled": false,
          "attendanceVerification.gps.mandatory": true,
        },
      }
    );
  });

  it("inflated GPS accuracy cannot shrink distance to pass the geofence", () => {
    const result = isInsideGeofence({
      latitude: FAR.latitude,
      longitude: FAR.longitude,
      centerLatitude: OFFICE.latitude,
      centerLongitude: OFFICE.longitude,
      radiusMeters: 300,
      accuracyMeters: 999999,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "OUTSIDE_RADIUS");
    assert.ok(result.distanceMeters > 300);
  });

  it("1. desktop punch-in inside office radius succeeds", async () => {
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: nearOffice(), sessionType: "OFFICE", clientPlatform: "web" });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(await models.Attendance.countDocuments({}), 1);
  });

  it("2. desktop punch-in outside office radius is rejected with notifications + audit", async () => {
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), sessionType: "OFFICE", clientPlatform: "web" });
    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /outside|radius|rejected/i);
    assert.equal(await models.Attendance.countDocuments({}), 0);

    const empNotes = await models.Notification.find({ userId: employee.userId }).lean();
    assert.ok(empNotes.length >= 1);
    assert.match(empNotes[0].message, /outside the permitted office location/i);
    assert.equal(empNotes[0].metadata?.latitude, undefined);

    const hrPersonal = await models.Notification.find({ userId: hrUser._id }).lean();
    const caPersonal = await models.Notification.find({ userId: companyAdminUser._id }).lean();
    assert.ok(hrPersonal.length >= 1, "HR Admin must receive a personal notification");
    assert.ok(caPersonal.length >= 1, "Company Admin must receive a personal notification");
    assert.match(hrPersonal[0].message, /Attendance rejected: Geo Reject Emp/i);
    assert.match(hrPersonal[0].message, /outside the permitted office location/i);
    assert.equal(hrPersonal[0].metadata?.latitude, undefined);

    const audits = await models.AuditLog.find({ action: AUDIT_ACTIONS.ATTENDANCE_PUNCH_REJECTED }).lean();
    assert.ok(audits.length >= 1);
    assert.equal(audits[0].changes?.reason, "OUTSIDE_RADIUS");
    assert.equal(audits[0].changes?.geofenceDecision, "BLOCK");
    assert.ok(audits[0].changes?.distanceMeters > 300);
    assert.equal(audits[0].changes?.radiusMeters, 300);
    assert.equal(audits[0].changes?.latitude, undefined);
  });

  it("HR and Company Admin notification bells list the rejection and update unread count", async () => {
    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), sessionType: "OFFICE" });
    assert.equal(punch.status, 400);

    const empFeed = await request(app).get("/api/notifications").set("Cookie", cookies.emp);
    assert.equal(empFeed.status, 200);
    assert.ok(empFeed.body.unreadCount >= 1);
    assert.ok(
      (empFeed.body.notifications || []).some((n) =>
        /outside the permitted office location/i.test(n.message || "")
      )
    );

    const hrFeed = await request(app).get("/api/notifications").set("Cookie", cookies.hr);
    assert.equal(hrFeed.status, 200);
    assert.ok(hrFeed.body.unreadCount >= 1);
    assert.ok(
      (hrFeed.body.notifications || []).some((n) =>
        /Attendance rejected: Geo Reject Emp/i.test(n.message || "")
      )
    );

    const caFeed = await request(app).get("/api/notifications").set("Cookie", cookies.ca);
    assert.equal(caFeed.status, 200);
    assert.ok(caFeed.body.unreadCount >= 1);
    assert.ok(
      (caFeed.body.notifications || []).some((n) =>
        /Attendance rejected: Geo Reject Emp/i.test(n.message || "")
      )
    );
  });

  it("other company HR never receives this tenant's geofence rejection", async () => {
    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), sessionType: "OFFICE" });
    assert.equal(punch.status, 400);

    const leaked = await otherModels.Notification.find({}).lean();
    assert.equal(leaked.length, 0);

    const otherHrFeed = await request(app).get("/api/notifications").set("Cookie", cookies.otherHr);
    assert.equal(otherHrFeed.status, 200);
    assert.equal(
      JSON.stringify(otherHrFeed.body).includes("Geo Reject Emp"),
      false
    );
  });

  it("notification service failure does not allow a rejected punch to succeed", async () => {
    const originalCreate = models.Notification.create.bind(models.Notification);
    models.Notification.create = async () => {
      throw new Error("simulated notification failure");
    };
    try {
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({ location: farFromOffice(), sessionType: "OFFICE" });
      assert.equal(res.status, 400);
      assert.equal(await models.Attendance.countDocuments({}), 0);
      const audits = await models.AuditLog.find({
        action: AUDIT_ACTIONS.ATTENDANCE_PUNCH_REJECTED,
      }).lean();
      assert.ok(audits.length >= 1);
    } finally {
      models.Notification.create = originalCreate;
    }
  });

  it("3. desktop punch-out outside office radius is rejected", async () => {
    const inn = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: nearOffice(), sessionType: "OFFICE" });
    assert.equal(inn.status, 200, inn.body.message);

    const out = await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), clientPlatform: "web" });
    assert.equal(out.status, 400);
    assert.match(out.body.message || "", /outside|radius|rejected/i);

    const attendance = await models.Attendance.findOne({}).lean();
    assert.ok(attendance);
    const open = (attendance.sessions || []).find((s) => !s.checkOut);
    assert.ok(open, "session must remain open after rejected punch-out");
  });

  it("4. missing desktop coordinates are rejected", async () => {
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ sessionType: "OFFICE" });
    assert.equal(res.status, 400);
    assert.equal(await models.Attendance.countDocuments({}), 0);
  });

  it("5. stale and inaccurate GPS are rejected under BLOCK policies", async () => {
    const stale = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: nearOffice({
          capturedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        }),
        sessionType: "OFFICE",
      });
    assert.equal(stale.status, 400);

    const inaccurate = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: nearOffice({ accuracy: 500 }),
        sessionType: "OFFICE",
      });
    assert.equal(inaccurate.status, 400);
    assert.match(inaccurate.body.message || "", /accuracy/i);
    assert.equal(await models.Attendance.countDocuments({}), 0);
  });

  it("6. mandatory GPS via attendanceVerification enforces even when legacy geofenceEnabled is false", async () => {
    await models.CompanyHrPolicy.updateMany(
      {},
      {
        $set: {
          "locationRules.geofenceEnabled": false,
          "attendanceVerification.gps.enabled": true,
          "attendanceVerification.gps.mandatory": true,
        },
      }
    );
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), sessionType: "OFFICE" });
    assert.equal(res.status, 400);
    assert.equal(await models.Attendance.countDocuments({}), 0);
  });

  it("7. optional GPS verification with outOfRadiusPolicy WARN allows outside punch", async () => {
    await models.CompanyHrPolicy.updateMany(
      {},
      {
        $set: {
          "locationRules.outOfRadiusPolicy": "WARN",
          "locationRules.accuracyFailurePolicy": "WARN",
          "attendanceVerification.gps.enabled": true,
          "attendanceVerification.gps.mandatory": false,
        },
      }
    );
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), sessionType: "OFFICE" });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(await models.Attendance.countDocuments({}), 1);
    assert.equal(await models.LocationException.countDocuments({}), 1);
  });

  it("8. outOfRadiusPolicy OFF skips outside-radius blocking", async () => {
    await models.CompanyHrPolicy.updateMany(
      {},
      {
        $set: {
          "locationRules.outOfRadiusPolicy": "OFF",
          "locationRules.accuracyFailurePolicy": "WARN",
        },
      }
    );
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), sessionType: "OFFICE" });
    assert.equal(res.status, 200, res.body.message);
  });

  it("9. authorized WFH unrestricted remote punch is not office-geofence blocked", async () => {
    await models.Employee.updateOne(
      { _id: employee._id },
      { $set: { "job.workArrangement.mode": "WFH" } }
    );
    await models.CompanyHrPolicy.updateMany(
      {},
      { $set: { "workArrangementRules.wfhLocationMode": "WFH_UNRESTRICTED" } }
    );
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), sessionType: "REMOTE" });
    assert.equal(res.status, 200, res.body.message);
    await models.Employee.updateOne(
      { _id: employee._id },
      { $set: { "job.workArrangement.mode": "OFFICE" } }
    );
  });

  it("10-11. repeated outside punch-in does not duplicate notifications within the same minute", async () => {
    const first = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), sessionType: "OFFICE" });
    assert.equal(first.status, 400);
    const second = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), sessionType: "OFFICE" });
    assert.equal(second.status, 400);

    const empNotes = await models.Notification.find({ userId: employee.userId }).lean();
    const hrNotes = await models.Notification.find({ userId: hrUser._id }).lean();
    const caNotes = await models.Notification.find({ userId: companyAdminUser._id }).lean();
    assert.equal(empNotes.length, 1);
    assert.equal(hrNotes.length, 1);
    assert.equal(caNotes.length, 1);
    // Audit still records each attempt
    const audits = await models.AuditLog.find({ action: AUDIT_ACTIONS.ATTENDANCE_PUNCH_REJECTED }).lean();
    assert.equal(audits.length, 2);
  });

  it("12. rejected attempts never create attendance sessions", async () => {
    await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), sessionType: "OFFICE" });
    assert.equal(await models.Attendance.countDocuments({}), 0);
    assert.equal(await models.Attendance.countDocuments({ "sessions.0": { $exists: true } }), 0);
  });

  it("client gpsVerified flag cannot override outside rejection", async () => {
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: farFromOffice(),
        sessionType: "OFFICE",
        gpsVerified: true,
        clientPlatform: "web",
      });
    assert.equal(res.status, 400);
    assert.equal(await models.Attendance.countDocuments({}), 0);
  });
});
