import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
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

let mongo;
let app;
let companyA;
let companyB;
let hrCookieA;
let hrCookieB;
let employeeCookieA;
let employeeRecordA;
let employeeCookieA2;
let employeeRecordA2;
let platformAdminCookie;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  // 1. Company A
  companyA = await Company.create({
    companyName: "Alpha Corp",
    slug: "alpha",
    databaseName: "company_alpha_att_test",
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata" },
  });

  const modelsA = await getCompanyModels(companyA);

  // HR Admin for Alpha
  await modelsA.User.create({
    email: "hr@alpha.test",
    passwordHash: await hashPassword("AlphaPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Employee 1 for Alpha
  const empUserA1 = await modelsA.User.create({
    email: "john@alpha.test",
    passwordHash: await hashPassword("AlphaPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  employeeRecordA = await modelsA.Employee.create({
    userId: empUserA1._id,
    companyId: companyA._id,
    employeeCode: "ALP-001",
    fullName: "John Doe",
    email: "john@alpha.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { department: "Engineering", jobTitle: "Software Engineer" },
  });

  // Employee 2 for Alpha
  const empUserA2 = await modelsA.User.create({
    email: "jane@alpha.test",
    passwordHash: await hashPassword("AlphaPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  employeeRecordA2 = await modelsA.Employee.create({
    userId: empUserA2._id,
    companyId: companyA._id,
    employeeCode: "ALP-002",
    fullName: "Jane Smith",
    email: "jane@alpha.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { department: "Product", jobTitle: "Product Designer" },
  });

  // 2. Company B (for multi-tenant isolation testing)
  companyB = await Company.create({
    companyName: "Beta Corp",
    slug: "beta",
    databaseName: "company_beta_att_test",
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata" },
  });

  const modelsB = await getCompanyModels(companyB);

  await modelsB.User.create({
    email: "hr@beta.test",
    passwordHash: await hashPassword("BetaPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Authenticate users
  const loginResHrA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "alpha", email: "hr@alpha.test", password: "AlphaPass123!" });
  hrCookieA = cookieFrom(loginResHrA);

  const loginResEmpA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "alpha", email: "john@alpha.test", password: "AlphaPass123!" });
  employeeCookieA = cookieFrom(loginResEmpA);

  const loginResEmpA2 = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "alpha", email: "jane@alpha.test", password: "AlphaPass123!" });
  employeeCookieA2 = cookieFrom(loginResEmpA2);

  const loginResHrB = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "beta", email: "hr@beta.test", password: "BetaPass123!" });
  hrCookieB = cookieFrom(loginResHrB);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("Complete Attendance, Geolocation, Permissions & Live Tracking Suite", () => {
  const validLocationA = {
    latitude: 12.9716,
    longitude: 77.5946,
    accuracy: 14.5,
    capturedAt: new Date().toISOString(),
    address: "Bengaluru Tech Park",
  };

  const validLocationOut = {
    latitude: 12.9718,
    longitude: 77.5948,
    accuracy: 10.2,
    capturedAt: new Date().toISOString(),
    address: "Bengaluru Tech Park Exit",
  };

  it("1. Rejects punch-in when location payload is missing or invalid", async () => {
    // Missing location
    const resNoLoc = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", employeeCookieA)
      .send({});
    assert.equal(resNoLoc.status, 400);
    assert.match(resNoLoc.body.message, /Location coordinates/);

    // Invalid latitude (> 90)
    const resBadLat = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", employeeCookieA)
      .send({ location: { latitude: 95.5, longitude: 77.59 } });
    assert.equal(resBadLat.status, 400);
    assert.match(resBadLat.body.message, /Invalid latitude/);

    // Invalid longitude (< -180)
    const resBadLng = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", employeeCookieA)
      .send({ location: { latitude: 12.97, longitude: -195.0 } });
    assert.equal(resBadLng.status, 400);
    assert.match(resBadLng.body.message, /Invalid longitude/);

    // Negative accuracy
    const resBadAcc = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", employeeCookieA)
      .send({ location: { latitude: 12.97, longitude: 77.59, accuracy: -5 } });
    assert.equal(resBadAcc.status, 400);
    assert.match(resBadAcc.body.message, /Invalid location accuracy/);

    // Partial coordinates (latitude without longitude)
    const resPartialCoords = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", employeeCookieA)
      .send({ latitude: 12.97 });
    assert.equal(resPartialCoords.status, 400);
    assert.match(resPartialCoords.body.message, /Both latitude and longitude are required/);

    // Non-object location
    const resNonObjLoc = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", employeeCookieA)
      .send({ location: "12.97,77.59" });
    assert.equal(resNonObjLoc.status, 400);
    assert.match(resNonObjLoc.body.message, /Location payload must be an object/);

    // Legacy check-in route also rejects partial coordinates
    const resCheckInPartial = await request(app)
      .post("/api/employees/me/attendance/check-in")
      .set("Cookie", employeeCookieA)
      .send({ latitude: 12.97 });
    assert.equal(resCheckInPartial.status, 400);
    assert.match(resCheckInPartial.body.message, /Both latitude and longitude are required/);
  });

  it("2. Rejects punch-out before punching in", async () => {
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", employeeCookieA)
      .send({ location: validLocationOut });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /must punch in before checking out|must punch in before punching out/i);
  });

  it("3. Successfully records punch-in with validated browser coordinates", async () => {
    const beforeTime = new Date();
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", employeeCookieA)
      .send({ location: validLocationA });

    const afterTime = new Date();

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.today.status, "CHECKED_IN");
    assert.ok(res.body.today.checkInTime);

    // Check server timestamp is authoritative (between beforeTime and afterTime)
    const serverTimestamp = new Date(res.body.today.checkInTime);
    assert.ok(serverTimestamp >= new Date(beforeTime.getTime() - 2000));
    assert.ok(serverTimestamp <= new Date(afterTime.getTime() + 2000));

    // Verify stored in tenant database
    const { Attendance } = await getCompanyModels(companyA);
    const saved = await Attendance.findOne({ employeeId: employeeRecordA._id });
    assert.ok(saved, "Attendance document must exist in company A tenant database");
    assert.equal(saved.status, "PRESENT");
    assert.equal(saved.checkInLocation.latitude, validLocationA.latitude);
    assert.equal(saved.checkInLocation.longitude, validLocationA.longitude);
    assert.equal(saved.checkInLocation.accuracy, validLocationA.accuracy);
  });

  it("4. Prevents duplicate punch-in on the same day", async () => {
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", employeeCookieA)
      .send({ location: validLocationA });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /already punched in for today/i);
  });

  it("5. Handles concurrent duplicate punch-in requests safely", async () => {
    // For employee 2 who hasn't punched in yet
    const requests = [
      request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", employeeCookieA2)
        .send({ location: validLocationA }),
      request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", employeeCookieA2)
        .send({ location: validLocationA }),
    ];

    const results = await Promise.all(requests);
    const statuses = results.map((r) => r.status).sort();

    // Exactly one should succeed with 200, the other rejected with 400 or 409
    assert.equal(statuses[0], 200);
    assert.ok(statuses[1] === 400 || statuses[1] === 409);

    // Verify only 1 record exists in DB for employee A2
    const { Attendance } = await getCompanyModels(companyA);
    const count = await Attendance.countDocuments({ employeeId: employeeRecordA2._id });
    assert.equal(count, 1, "Only 1 attendance record must be created despite concurrent calls");
  });

  it("6. Successfully records punch-out with validated coordinates", async () => {
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", employeeCookieA)
      .send({ location: validLocationOut });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.today.status, "CHECKED_OUT");
    assert.ok(res.body.today.checkOutTime);
    assert.ok(res.body.today.workingHours);

    // Verify tenant DB record has checkOutLocation
    const { Attendance } = await getCompanyModels(companyA);
    const saved = await Attendance.findOne({ employeeId: employeeRecordA._id });
    assert.ok(saved.checkOut);
    assert.equal(saved.checkOutLocation.latitude, validLocationOut.latitude);
    assert.equal(saved.checkOutLocation.longitude, validLocationOut.longitude);
  });

  it("7. Prevents duplicate punch-out once session is closed", async () => {
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", employeeCookieA)
      .send({ location: validLocationOut });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /already checked out for today|already punched out for today/i);
  });

  it("8. Returns current attendance state via GET /me/attendance/status", async () => {
    const res = await request(app)
      .get("/api/employees/me/attendance/status")
      .set("Cookie", employeeCookieA);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.attendance.status, "CHECKED_OUT");
    assert.ok(res.body.attendance.checkInTime);
    assert.ok(res.body.attendance.checkOutTime);
    assert.equal(res.body.attendance.canPunchIn, false);
    assert.equal(res.body.attendance.canPunchOut, false);
  });

  it("9. Returns attendance history with date filtering via GET /me/attendance/history", async () => {
    const todayStr = new Date().toISOString().split("T")[0];

    const res = await request(app)
      .get("/api/employees/me/attendance/history")
      .query({ startDate: todayStr, endDate: todayStr })
      .set("Cookie", employeeCookieA);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.records));
    assert.ok(res.body.records.length >= 1);
    assert.equal(res.body.records[0].date, todayStr);
    assert.ok(res.body.records[0].checkInLocation);
  });

  it("10. Live Tracking lifecycle: start session, update coordinates, throttle, and stop", async () => {
    // 10a. Start tracking session
    const startRes = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", employeeCookieA)
      .send({ durationMinutes: 30 });

    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.success, true);
    assert.equal(startRes.body.session.status, "ACTIVE");
    assert.ok(startRes.body.session.expiresAt);

    // 10b. Check status
    const statusRes = await request(app)
      .get("/api/employees/me/tracking/status")
      .set("Cookie", employeeCookieA);

    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.isTrackingActive, true);

    // 10c. Send first location update
    const updateRes1 = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", employeeCookieA)
      .send({ location: { latitude: 12.9720, longitude: 77.5950, accuracy: 8.5 } });

    assert.equal(updateRes1.status, 200);
    assert.equal(updateRes1.body.success, true);
    assert.equal(updateRes1.body.throttled, false);

    // 10d. Immediate second update should be throttled safely
    const updateRes2 = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", employeeCookieA)
      .send({ location: { latitude: 12.9721, longitude: 77.5951, accuracy: 8.5 } });

    assert.equal(updateRes2.status, 200);
    assert.equal(updateRes2.body.throttled, true);

    // 10e. Stop tracking session
    const stopRes = await request(app)
      .post("/api/employees/me/tracking/stop")
      .set("Cookie", employeeCookieA)
      .send({});

    assert.equal(stopRes.status, 200);
    assert.equal(stopRes.body.session.status, "STOPPED");

    // 10f. Update after stop must be rejected
    const updateAfterStop = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", employeeCookieA)
      .send({ location: { latitude: 12.9722, longitude: 77.5952 } });

    assert.equal(updateAfterStop.status, 400);
    assert.match(updateAfterStop.body.message, /No active tracking session found/);
  });

  it("11. HR Admin Overview: fetches authorized company attendance map data", async () => {
    const todayStr = new Date().toISOString().split("T")[0];

    const res = await request(app)
      .get("/api/admin/attendance/overview")
      .query({ date: todayStr })
      .set("Cookie", hrCookieA);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.summary);
    assert.ok(res.body.summary.totalEmployees >= 2);
    assert.ok(res.body.summary.presentCount >= 1);
    assert.ok(Array.isArray(res.body.employees));

    // Verify employee record has location details
    const john = res.body.employees.find((e) => e.employeeCode === "ALP-001");
    assert.ok(john);
    assert.equal(john.attendanceStatus, "CHECKED_OUT");
    assert.ok(john.checkInLocation);
    assert.equal(john.checkInLocation.latitude, validLocationA.latitude);
  });

  it("12. Role-based security & tenant isolation enforcement", async () => {
    // 12a. Employee cannot access HR Admin Overview
    const empAccessAdmin = await request(app)
      .get("/api/admin/attendance/overview")
      .set("Cookie", employeeCookieA);
    assert.equal(empAccessAdmin.status, 403);

    // 12b. Unauthenticated caller cannot access employee location overview
    const unauthAccess = await request(app)
      .get("/api/admin/attendance/overview");
    assert.equal(unauthAccess.status, 401);

    // 12c. Company B HR Admin cannot see Company A employee records
    const resB = await request(app)
      .get("/api/admin/attendance/overview")
      .set("Cookie", hrCookieB);
    assert.equal(resB.status, 200);
    // Beta Corp has 0 employees currently
    assert.equal(resB.body.summary.totalEmployees, 0);
    const foundJohnInBeta = resB.body.employees.some((e) => e.email === "john@alpha.test");
    assert.equal(foundJohnInBeta, false, "Company A employees must not be visible to Company B");

    // 12d. Verify central platform database has ZERO attendance or tracking documents
    const centralDb = mongoose.connection.useDb("platform");
    const centralCollections = await centralDb.db.listCollections().toArray();
    const centralColNames = centralCollections.map((c) => c.name);
    assert.equal(centralColNames.includes("attendances"), false, "Platform DB must NOT store company attendances");
    assert.equal(centralColNames.includes("live_tracking_sessions"), false, "Platform DB must NOT store tracking sessions");
  });
});
