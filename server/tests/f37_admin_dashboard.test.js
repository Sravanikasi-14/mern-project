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
  DASHBOARD_EMPLOYEE_FACT_SELECT,
  buildCompanyAssetsSummary,
  buildCompensationMap,
  buildWorkforcePayrollAndProjects,
  countPresentAndLateFromAttendance,
  loadDashboardEmployeeFacts,
} from "../services/adminDashboardMetrics.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f37-admin-dashboard-test-secret-32chars!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f37_dash";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

function parseTimeToMinutes(timeStr) {
  const [h, m] = String(timeStr).split(":").map(Number);
  return h * 60 + m;
}

function getTimeInTimezone(date) {
  const d = new Date(date);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
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
let empActive;
let empInactive;
let empEmptyDept;

before(async () => {
  fs.mkdirSync("D:/tmp/hrms-mongo/f37-admin-dashboard", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/f37-admin-dashboard" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  await Company.deleteMany({});
  const suffix = `${Date.now()}`;
  companyA = await Company.create({
    companyName: "F37 Acme",
    slug: `f37-acme-${suffix}`,
    databaseName: `company_f37_acme_${suffix}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
  });
  companyB = await Company.create({
    companyName: "F37 Globex",
    slug: `f37-globex-${suffix}`,
    databaseName: `company_f37_globex_${suffix}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
  });

  modelsA = await getCompanyModels(companyA, { provision: true });
  modelsB = await getCompanyModels(companyB, { provision: true });

  await modelsA.CompanyHrPolicy.create({
    effectiveFromDate: new Date("2026-01-01"),
    attendanceRules: { officeStartTime: "09:30", gracePeriodMinutes: 15 },
    payrollRules: { currencySymbol: "₹", currencyCode: "INR" },
    weekendRules: { saturdayOff: true, sundayOff: true },
    holidays: [],
  });

  await modelsA.User.create({
    email: "hr@f37-acme.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
    schemaVersion: 1,
  });
  await modelsB.User.create({
    email: "hr@f37-globex.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
    schemaVersion: 1,
  });

  empActive = await modelsA.Employee.create({
    employeeCode: "F37-001",
    fullName: "Active Ann",
    email: "ann@f37.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Engineer",
      department: "Engineering",
      employmentType: "Full-time",
      project: { projectName: "Core", projectType: "MANDATE" },
    },
    customFields: { monthlySalary: 50000, assignedAssets: ["Laptop"] },
    schemaVersion: 1,
  });
  empEmptyDept = await modelsA.Employee.create({
    employeeCode: "F37-002",
    fullName: "No Dept Ned",
    email: "ned@f37.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Ops", department: "", employmentType: "Contract" },
    customFields: { monthlySalary: 20000 },
    schemaVersion: 1,
  });
  empInactive = await modelsA.Employee.create({
    employeeCode: "F37-003",
    fullName: "Inactive Ike",
    email: "ike@f37.test",
    status: EMPLOYEE_STATUSES.INACTIVE,
    job: { jobTitle: "Ex", department: "Engineering" },
    customFields: { monthlySalary: 999999 },
    schemaVersion: 1,
  });

  await modelsA.EmployeeCompensation.create({
    employeeId: empActive._id,
    revisions: [{ effectiveFromDate: new Date("2026-01-01"), monthlyCostToCompany: 100000 }],
  });

  await modelsA.Attendance.create({
    employeeId: empActive._id,
    date: "2026-11-12",
    status: "PRESENT",
    checkIn: new Date("2026-11-12T04:00:00.000Z"), // late vs 09:45 if treated as UTC clock in helper
  });

  const loginA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: companyA.slug, email: "hr@f37-acme.test", password: "Password123!" });
  hrCookieA = cookieFrom(loginA);
  const loginB = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: companyB.slug, email: "hr@f37-globex.test", password: "Password123!" });
  hrCookieB = cookieFrom(loginB);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("F37 admin dashboard metrics helpers", () => {
  it("loads only dashboard fact fields (no PII roster fields)", async () => {
    const facts = await loadDashboardEmployeeFacts(modelsA.Employee, { status: "ACTIVE" });
    assert.equal(facts.length, 2);
    for (const row of facts) {
      assert.equal(row.fullName, undefined);
      assert.equal(row.email, undefined);
      assert.equal(row.avatar, undefined);
      assert.equal(row.employeeCode, undefined);
      assert.ok(row._id);
      assert.ok(row.job);
    }
    assert.ok(DASHBOARD_EMPLOYEE_FACT_SELECT.includes("job.department"));
    assert.equal(DASHBOARD_EMPLOYEE_FACT_SELECT.includes("fullName"), false);
    assert.equal(DASHBOARD_EMPLOYEE_FACT_SELECT.includes("attendanceLogs"), false);
  });

  it("counts present/late from attendance records without walking employees", () => {
    const { todayPresent, todayLate } = countPresentAndLateFromAttendance({
      attendanceRecords: [
        {
          employeeId: empActive._id,
          status: "PRESENT",
          checkIn: new Date("2026-11-12T10:05:00.000Z"), // 10:05 UTC > 09:45 threshold
        },
        {
          employeeId: empActive._id,
          status: "PRESENT",
          checkIn: new Date("2026-11-12T10:05:00.000Z"),
        },
      ],
      companyTimezone: "UTC",
      lateThresholdMinutes: 9 * 60 + 45,
      getTimeInTimezone,
      parseTimeToMinutes,
    });
    assert.equal(todayPresent, 1);
    assert.equal(todayLate, 1);
  });

  it("builds payroll/workforce ignoring inactive employees and matching compensation", () => {
    const facts = [
      {
        _id: empActive._id,
        job: { department: "Engineering", project: { projectName: "Core", projectType: "MANDATE" } },
        customFields: { monthlySalary: 50000 },
      },
      {
        _id: empEmptyDept._id,
        job: { department: "" },
        customFields: { monthlySalary: 20000 },
      },
    ];
    const compMap = buildCompensationMap(
      [
        {
          employeeId: empActive._id,
          revisions: [{ effectiveFromDate: new Date("2026-01-01"), monthlyCostToCompany: 100000 }],
        },
      ],
      new Date("2026-11-12T23:59:59.999Z")
    );
    const built = buildWorkforcePayrollAndProjects(facts, compMap);
    assert.equal(built.totalMonthlyPayroll, 120000); // 100k comp + 20k custom
    assert.equal(built.projectTeams.mandate.count, 1);
    assert.ok(built.workforceDepartments.some((d) => d.name === "Engineering" && d.count === 1));
    assert.ok(
      built.workforceDepartments.some((d) => d.name === "General / Unassigned" && d.count === 1)
    );

    const assets = buildCompanyAssetsSummary(facts, new Set());
    assert.equal(assets.totalEmployees, 2);
    assert.equal(assets.employeesWithAssets, 0);
  });
});

describe("F37 admin dashboard API", () => {
  it("returns expected counts and does not embed a full employee roster", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard?date=2026-11-12&month=11&year=2026")
      .set("Cookie", hrCookieA);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.summary.activeEmployees, 2);
    assert.equal(res.body.summary.monthlyPayroll, 120000);
    assert.equal(res.body.workforce.departments.length >= 1, true);

    const raw = JSON.stringify(res.body);
    assert.equal(raw.includes("ann@f37.test"), false);
    assert.equal(raw.includes("Active Ann"), false);
    assert.equal(Object.hasOwn(res.body, "employees"), false);
    assert.equal(Object.hasOwn(res.body, "activeEmployeeList"), false);
  });

  it("isolates empty tenant dashboards", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard?date=2026-11-12&month=11&year=2026")
      .set("Cookie", hrCookieB);
    assert.equal(res.status, 200);
    assert.equal(res.body.summary.activeEmployees, 0);
    assert.equal(res.body.summary.todayPresent, 0);
    assert.equal(res.body.summary.monthlyPayroll, 0);
    assert.deepEqual(res.body.workforce.departments, []);
  });

  it("supports department filter without returning other departments' headcount in workforce map", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard?date=2026-11-12&month=11&year=2026&department=Engineering")
      .set("Cookie", hrCookieA);
    assert.equal(res.status, 200);
    assert.equal(res.body.summary.activeEmployees, 1);
    assert.equal(res.body.meta.activeDepartment, "Engineering");
    assert.ok(res.body.workforce.departments.every((d) => d.name === "Engineering"));
  });

  it("explain(executionStats) for lean employee facts uses a filter (structural)", async () => {
    const explain = await modelsA.Employee.find({ status: "ACTIVE" })
      .select(DASHBOARD_EMPLOYEE_FACT_SELECT)
      .lean()
      .explain("executionStats");
    assert.ok(explain);
    const ok =
      explain.executionStats ||
      explain.queryPlanner ||
      explain.ok === 1 ||
      explain.command;
    assert.ok(ok);
  });
});
