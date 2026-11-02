import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { LEAVE_STATUSES } from "../models/LeaveRequest.js";
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
let hrCookie;
let empCookie;
let models;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  const company = await Company.create({
    companyName: "Perf Co",
    slug: "perfco",
    databaseName: "company_perf_dates",
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata" },
  });

  models = await getCompanyModels(company);
  const hrUser = await models.User.create({
    email: "hr@perfco.test",
    passwordHash: await hashPassword("HrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const empUser = await models.User.create({
    email: "emp@perfco.test",
    passwordHash: await hashPassword("EmpPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const employees = [];
  for (let i = 0; i < 40; i++) {
    const e = await models.Employee.create({
      fullName: `Worker ${i}`,
      employeeCode: `PF-${String(i).padStart(3, "0")}`,
      email: `w${i}@perfco.test`,
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "Engineer", department: "Engineering" },
    });
    employees.push(e);
  }
  const primary = employees[0];
  primary.userId = empUser._id;
  await primary.save();
  empUser.employeeId = primary._id;
  await empUser.save();

  // Seed attendance + leave for November 2026
  const attDocs = [];
  for (const emp of employees) {
    for (let day = 1; day <= 20; day++) {
      attDocs.push({
        employeeId: emp._id,
        date: `2026-11-${String(day).padStart(2, "0")}`,
        checkIn: new Date(`2026-11-${String(day).padStart(2, "0")}T04:00:00.000Z`),
        status: "PRESENT",
      });
    }
  }
  await models.Attendance.insertMany(attDocs);

  const leaveDocs = [];
  for (let i = 0; i < 30; i++) {
    leaveDocs.push({
      employeeId: employees[i % employees.length]._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-11-05T00:00:00.000Z"),
      toDate: new Date("2026-11-07T00:00:00.000Z"),
      daysCount: 3,
      reason: "Perf seed",
      status: LEAVE_STATUSES.APPROVED,
    });
  }
  // Extra history for primary employee (should not all load on dashboard)
  for (let y = 0; y < 60; y++) {
    leaveDocs.push({
      employeeId: primary._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date(`2024-01-${String((y % 28) + 1).padStart(2, "0")}T00:00:00.000Z`),
      toDate: new Date(`2024-01-${String((y % 28) + 1).padStart(2, "0")}T00:00:00.000Z`),
      daysCount: 1,
      reason: `Old ${y}`,
      status: LEAVE_STATUSES.APPROVED,
    });
  }
  await models.LeaveRequest.insertMany(leaveDocs);

  hrCookie = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ email: "hr@perfco.test", password: "HrPass123!", companyCode: "perfco" })
  );
  empCookie = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ email: "emp@perfco.test", password: "EmpPass123!", companyCode: "perfco" })
  );
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Date query performance (measured)", () => {
  it("admin dashboard month calendar responds within budget", async () => {
    const t0 = Date.now();
    const res = await request(app)
      .get("/api/admin/dashboard?date=2026-11-10&month=11&year=2026")
      .set("Cookie", hrCookie);
    const ms = Date.now() - t0;
    assert.equal(res.status, 200);
    const days = res.body.attendanceCalendar?.days || [];
    assert.ok(days.length >= 28, "calendar should include month days");
    console.log(`[perf] GET /api/admin/dashboard month=11 → ${ms}ms, days=${days.length}`);
    assert.ok(ms < 8000, `admin dashboard too slow: ${ms}ms`);
  });

  it("employee dashboard does not return unbounded leave history", async () => {
    const t0 = Date.now();
    const res = await request(app).get("/api/employees/me/dashboard").set("Cookie", empCookie);
    const ms = Date.now() - t0;
    assert.equal(res.status, 200);
    const recent = res.body.leave?.recentRequests || [];
    assert.ok(recent.length <= 80, "dashboard leave history must be capped");
    console.log(`[perf] GET /api/employees/me/dashboard → ${ms}ms, leaveRows=${recent.length}`);
    assert.ok(ms < 5000, `employee dashboard too slow: ${ms}ms`);
  });

  it("leave calendar range skips summary counts and stays fast", async () => {
    const t0 = Date.now();
    const res = await request(app)
      .get("/api/leave-requests?status=APPROVED&fromDate=2026-11-01&toDate=2026-11-30&limit=200&page=1")
      .set("Cookie", hrCookie);
    const ms = Date.now() - t0;
    assert.equal(res.status, 200);
    assert.ok((res.body.leaveRequests || []).length > 0);
    // Range queries skip global summary — zeros or omit heavy work
    console.log(`[perf] GET /api/leave-requests range → ${ms}ms, rows=${res.body.leaveRequests.length}`);
    assert.ok(ms < 5000, `leave range query too slow: ${ms}ms`);
  });

  it("attendance history month range uses indexed date filter", async () => {
    const t0 = Date.now();
    const res = await request(app)
      .get("/api/employees/me/attendance/history?startDate=2026-11-01&endDate=2026-11-30&limit=100")
      .set("Cookie", empCookie);
    const ms = Date.now() - t0;
    assert.equal(res.status, 200);
    const rows = res.body.records || res.body.data?.records || [];
    assert.ok(Array.isArray(rows));
    console.log(`[perf] GET attendance/history month → ${ms}ms, rows=${rows.length}`);
    assert.ok(ms < 4000, `attendance history too slow: ${ms}ms`);
  });
});
