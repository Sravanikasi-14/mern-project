import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import {
  ADMIN_ATTENDANCE_DAY_SELECT,
  ADMIN_ATTENDANCE_EMPLOYEE_SELECT,
  ADMIN_TRACKING_SESSION_SELECT,
  MAX_ATTENDANCE_RANGE_DAYS,
  assertBoundedAttendanceRange,
  inclusiveCivilDaySpan,
  openPunchAttendanceFilter,
} from "../services/attendanceAdminQuery.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f38-attendance-tracking-test-secret-32c!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f38_att";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let mongo;
let app;
let companyA;
let companyB;
let modelsA;
let modelsB;
let hrCookieA;
let hrCookieB;
let empCookieA;
let empActive;
let empOther;
let empPunchedOut;

const OFFICE = { latitude: 12.9716, longitude: 77.5946, accuracy: 10 };

before(async () => {
  fs.mkdirSync("D:/tmp/hrms-mongo/f38-attendance-tracking", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/f38-attendance-tracking" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  await Company.deleteMany({});
  const suffix = `${Date.now()}`;
  companyA = await Company.create({
    companyName: "F38 Acme",
    slug: `f38-acme-${suffix}`,
    databaseName: `company_f38_acme_${suffix}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
  });
  companyB = await Company.create({
    companyName: "F38 Globex",
    slug: `f38-globex-${suffix}`,
    databaseName: `company_f38_globex_${suffix}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
  });

  modelsA = await getCompanyModels(companyA, { provision: true });
  modelsB = await getCompanyModels(companyB, { provision: true });

  await modelsA.CompanyHrPolicy.create({
    effectiveFromDate: new Date("2026-01-01"),
    attendanceRules: { officeStartTime: "09:30", officeEndTime: "18:30", gracePeriodMinutes: 15 },
    locationRules: {
      requireLocationForPunch: true,
      allowWebTracking: true,
      geofenceEnabled: false,
    },
    weekendRules: { saturdayOff: true, sundayOff: true },
    holidays: [],
  });

  await modelsA.User.create({
    email: "hr@f38-acme.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
    schemaVersion: 1,
  });
  await modelsB.User.create({
    email: "hr@f38-globex.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
    schemaVersion: 1,
  });

  empActive = await modelsA.Employee.create({
    employeeCode: "F38-001",
    fullName: "Live Lucy",
    email: "lucy@f38.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering", employmentType: "Full-time" },
    schemaVersion: 1,
  });
  empOther = await modelsA.Employee.create({
    employeeCode: "F38-002",
    fullName: "Idle Ian",
    email: "ian@f38.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Ops", department: "Operations", employmentType: "Full-time" },
    schemaVersion: 1,
  });
  empPunchedOut = await modelsA.Employee.create({
    employeeCode: "F38-003",
    fullName: "Out Olivia",
    email: "olivia@f38.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Analyst", department: "Engineering", employmentType: "Full-time" },
    schemaVersion: 1,
  });

  await modelsA.User.create({
    email: "lucy@f38.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.EMPLOYEE,
    employeeId: empActive._id,
    isActive: true,
    schemaVersion: 1,
  });

  const loginHrA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: companyA.slug, email: "hr@f38-acme.test", password: "Password123!" });
  hrCookieA = cookieFrom(loginHrA);
  const loginHrB = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: companyB.slug, email: "hr@f38-globex.test", password: "Password123!" });
  hrCookieB = cookieFrom(loginHrB);
  const loginEmp = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: companyA.slug, email: "lucy@f38.test", password: "Password123!" });
  empCookieA = cookieFrom(loginEmp);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("F38 attendance admin query helpers", () => {
  it("bounds date ranges and rejects oversized windows", () => {
    assert.equal(inclusiveCivilDaySpan("2026-11-01", "2026-11-01"), 1);
    assert.equal(inclusiveCivilDaySpan("2026-11-01", "2026-11-03"), 3);
    const ok = assertBoundedAttendanceRange("2026-11-01", "2026-11-30");
    assert.equal(ok.daySpan <= MAX_ATTENDANCE_RANGE_DAYS, true);
    assert.throws(
      () => assertBoundedAttendanceRange("2026-01-01", "2026-12-31"),
      (err) => err.status === 400 && err.code === "ATTENDANCE_RANGE_TOO_WIDE"
    );
  });

  it("projects slim employee/attendance/tracking fields (no customFields / breadcrumbs)", () => {
    assert.equal(ADMIN_ATTENDANCE_EMPLOYEE_SELECT.includes("customFields"), false);
    assert.equal(ADMIN_ATTENDANCE_EMPLOYEE_SELECT.includes("fullName"), true);
    assert.equal(ADMIN_ATTENDANCE_DAY_SELECT.includes("checkInLocation"), true);
    assert.equal(ADMIN_TRACKING_SESSION_SELECT.includes("breadcrumbs"), false);
    assert.equal(ADMIN_TRACKING_SESSION_SELECT.includes("lastLocation"), true);
    assert.ok(openPunchAttendanceFilter("2026-11-12").date);
  });
});

describe("F38 attendance overview status + counts", () => {
  it("matches checked-in / checked-out / not-checked-in counts without customFields payload", async () => {
    const today = "2026-11-12";
    await modelsA.Attendance.deleteMany({});
    await modelsA.LiveTrackingSession.deleteMany({});

    await modelsA.Attendance.create({
      employeeId: empActive._id,
      date: today,
      status: "PRESENT",
      checkIn: new Date("2026-11-12T04:00:00.000Z"),
      checkOut: null,
      checkInLocation: OFFICE,
      openSessionId: empActive._id,
    });
    await modelsA.Attendance.create({
      employeeId: empPunchedOut._id,
      date: today,
      status: "PRESENT",
      checkIn: new Date("2026-11-12T03:00:00.000Z"),
      checkOut: new Date("2026-11-12T11:00:00.000Z"),
      checkInLocation: OFFICE,
      checkOutLocation: OFFICE,
      workingHours: "8h 0m",
    });

    const res = await request(app)
      .get("/api/admin/attendance/overview")
      .query({ date: today })
      .set("Cookie", hrCookieA);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.summary.totalEmployees, 3);
    assert.equal(res.body.summary.checkedInCount, 1);
    assert.equal(res.body.summary.checkedOutCount, 1);
    assert.equal(res.body.summary.presentCount, 2);
    assert.equal(res.body.summary.notCheckedInCount, 1);

    const lucy = res.body.employees.find((e) => e.employeeCode === "F38-001");
    assert.equal(lucy.attendanceStatus, "CHECKED_IN");
    assert.ok(lucy.checkInLocation);
    const raw = JSON.stringify(res.body);
    assert.equal(raw.includes("attendanceLogs"), false);
  });

  it("paginates historical range records and rejects oversized ranges", async () => {
    await modelsA.Attendance.create({
      employeeId: empOther._id,
      date: "2026-11-10",
      status: "PRESENT",
      checkIn: new Date("2026-11-10T04:00:00.000Z"),
      checkOut: new Date("2026-11-10T12:00:00.000Z"),
    });
    await modelsA.Attendance.create({
      employeeId: empOther._id,
      date: "2026-11-11",
      status: "PRESENT",
      checkIn: new Date("2026-11-11T04:00:00.000Z"),
      checkOut: new Date("2026-11-11T12:00:00.000Z"),
    });

    const page1 = await request(app)
      .get("/api/admin/attendance/overview")
      .query({ startDate: "2026-11-10", endDate: "2026-11-12", page: 1, limit: 1 })
      .set("Cookie", hrCookieA);
    assert.equal(page1.status, 200);
    assert.equal(page1.body.rangeRecords.length, 1);
    assert.ok(page1.body.rangePagination);
    assert.equal(page1.body.rangePagination.page, 1);
    assert.equal(page1.body.rangePagination.limit, 1);
    assert.ok(page1.body.rangePagination.total >= 2);

    const tooWide = await request(app)
      .get("/api/admin/attendance/overview")
      .query({ startDate: "2026-01-01", endDate: "2026-12-31" })
      .set("Cookie", hrCookieA);
    assert.equal(tooWide.status, 400);
  });
});

describe("F38 live tracking punch lifecycle + tenant isolation", () => {
  it("lists active punch-in employees and drops them after punch-out", async () => {
    await modelsA.Attendance.deleteMany({ employeeId: empActive._id });
    await modelsA.LiveTrackingSession.deleteMany({ employeeId: empActive._id });

    const punchIn = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", empCookieA)
      .send({ location: OFFICE });
    assert.equal(punchIn.status, 200, JSON.stringify(punchIn.body));

    const live = await request(app)
      .get("/api/admin/attendance/tracking-sessions")
      .set("Cookie", hrCookieA);
    assert.equal(live.status, 200);
    const row = (live.body.live || []).find((e) => String(e.employeeId) === String(empActive._id));
    assert.ok(row, "punched-in employee must appear");
    assert.equal(row.attendanceStatus, "CHECKED_IN");
    assert.ok(!(live.body.live || []).some((e) => String(e.employeeId) === String(empOther._id)));

    const startTrack = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .send({ durationMinutes: 30 });
    assert.equal(startTrack.status, 200);

    const sharing = await request(app)
      .get("/api/admin/attendance/tracking-sessions")
      .set("Cookie", hrCookieA);
    const liveRow = (sharing.body.live || []).find((e) => String(e.employeeId) === String(empActive._id));
    assert.equal(liveRow.isTrackingActive, true);

    const punchOut = await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", empCookieA)
      .send({ location: OFFICE });
    assert.equal(punchOut.status, 200, JSON.stringify(punchOut.body));
    assert.equal(punchOut.body.trackingStopped, true);

    const afterOut = await request(app)
      .get("/api/admin/attendance/tracking-sessions")
      .set("Cookie", hrCookieA);
    assert.equal(
      (afterOut.body.live || []).some((e) => String(e.employeeId) === String(empActive._id)),
      false,
      "punched-out employee must leave live tracking"
    );
  });

  it("logout stops tracking and removes the employee from live list", async () => {
    await modelsA.Attendance.deleteMany({ employeeId: empActive._id });
    await modelsA.LiveTrackingSession.deleteMany({ employeeId: empActive._id });

    const punchIn = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", empCookieA)
      .send({ location: OFFICE });
    assert.equal(punchIn.status, 200);

    const startTrack = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .send({ durationMinutes: 30 });
    assert.equal(startTrack.status, 200);

    const logoutRes = await request(app).post("/api/auth/logout").set("Cookie", empCookieA);
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.trackingStopped, true);

    const active = await modelsA.LiveTrackingSession.countDocuments({
      employeeId: empActive._id,
      status: "ACTIVE",
    });
    assert.equal(active, 0);

    // Re-login for later tests
    const loginEmp = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: companyA.slug, email: "lucy@f38.test", password: "Password123!" });
    empCookieA = cookieFrom(loginEmp);
  });

  it("rejects tracking without punch-in (working-hours / eligibility gate)", async () => {
    await modelsA.Attendance.deleteMany({ employeeId: empActive._id });
    await modelsA.LiveTrackingSession.deleteMany({ employeeId: empActive._id });
    // Clear legacy dual-write logs so eligibility cannot fall back to customFields.
    await modelsA.Employee.updateOne(
      { _id: empActive._id },
      { $unset: { "customFields.attendanceLogs": 1 } }
    );

    const startTrack = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookieA)
      .send({ durationMinutes: 30 });
    assert.equal(startTrack.status, 400);
    assert.equal(startTrack.body.code, "TRACKING_REQUIRES_PUNCH_IN");
  });

  it("excludes expired sessions from active live tracking", async () => {
    await modelsA.Attendance.deleteMany({ employeeId: empActive._id });
    await modelsA.LiveTrackingSession.deleteMany({ employeeId: empActive._id });

    await modelsA.Attendance.create({
      employeeId: empActive._id,
      date: new Date().toISOString().slice(0, 10),
      status: "PRESENT",
      checkIn: new Date(),
      checkOut: null,
      checkInLocation: OFFICE,
      openSessionId: empActive._id,
    });
    await modelsA.LiveTrackingSession.create({
      employeeId: empActive._id,
      status: "ACTIVE",
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 60 * 1000),
      lastLocation: { ...OFFICE, receivedAt: new Date() },
    });

    const live = await request(app)
      .get("/api/admin/attendance/tracking-sessions")
      .set("Cookie", hrCookieA);
    const row = (live.body.live || []).find((e) => String(e.employeeId) === String(empActive._id));
    assert.ok(row, "still listed via open punch");
    assert.equal(row.isTrackingActive, false, "expired session must not count as actively sharing");
  });

  it("isolates tenants on overview and tracking-sessions", async () => {
    const ovB = await request(app)
      .get("/api/admin/attendance/overview")
      .set("Cookie", hrCookieB);
    assert.equal(ovB.status, 200);
    assert.equal(ovB.body.summary.totalEmployees, 0);
    assert.equal(
      (ovB.body.employees || []).some((e) => e.email === "lucy@f38.test"),
      false
    );

    const liveB = await request(app)
      .get("/api/admin/attendance/tracking-sessions")
      .set("Cookie", hrCookieB);
    assert.equal(liveB.status, 200);
    assert.equal(liveB.body.summary.liveCount, 0);
    assert.equal((liveB.body.live || []).length, 0);

    const empDenied = await request(app)
      .get("/api/admin/attendance/tracking-sessions")
      .set("Cookie", empCookieA);
    assert.equal(empDenied.status, 403);
  });

  it("bounds employee attendance history date filters with pagination", async () => {
    const tooWide = await request(app)
      .get(`/api/admin/attendance/employee/${empActive._id}`)
      .query({ startDate: "2025-01-01", endDate: "2026-12-31", page: 1, limit: 10 })
      .set("Cookie", hrCookieA);
    assert.equal(tooWide.status, 400);

    const ok = await request(app)
      .get(`/api/admin/attendance/employee/${empOther._id}`)
      .query({ startDate: "2026-11-01", endDate: "2026-11-30", page: 1, limit: 10 })
      .set("Cookie", hrCookieA);
    assert.equal(ok.status, 200);
    assert.ok(ok.body.pagination);
    assert.ok(Array.isArray(ok.body.records));
  });

  it("explain(executionStats) for open-punch and tracking projections (structural)", async () => {
    const punchExplain = await modelsA.Attendance.find(openPunchAttendanceFilter("2026-11-12"))
      .select(ADMIN_ATTENDANCE_DAY_SELECT)
      .lean()
      .explain("executionStats");
    assert.ok(punchExplain);
    assert.ok(punchExplain.executionStats || punchExplain.queryPlanner || punchExplain.ok === 1);

    const trackExplain = await modelsA.LiveTrackingSession.find({
      status: "ACTIVE",
      expiresAt: { $gt: new Date() },
    })
      .select(ADMIN_TRACKING_SESSION_SELECT)
      .lean()
      .explain("executionStats");
    assert.ok(trackExplain);
    assert.ok(trackExplain.executionStats || trackExplain.queryPlanner || trackExplain.ok === 1);

    const histExplain = await modelsA.LiveTrackingSession.find({
      startedAt: {
        $gte: new Date("2026-11-01T00:00:00.000Z"),
        $lte: new Date("2026-11-30T23:59:59.999Z"),
      },
    })
      .select(ADMIN_TRACKING_SESSION_SELECT)
      .sort({ startedAt: -1 })
      .limit(50)
      .lean()
      .explain("executionStats");
    assert.ok(histExplain);
  });
});

describe("F38 GPS/Wi-Fi/face verification contracts remain intact", () => {
  it("punch-in still requires location coordinates", async () => {
    await modelsA.Attendance.deleteMany({ employeeId: empActive._id });
    const missing = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", empCookieA)
      .send({});
    assert.ok(missing.status >= 400);
  });
});
