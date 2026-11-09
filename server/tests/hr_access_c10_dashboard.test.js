process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { createCompanyAdmin } from "../services/companyAdminService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

const PASSWORD = "HrC10DashboardPass1!";
const FULL = ["dashboard.view", "payroll.view", "leave.view", "attendance.view"];
const SECRET_AMOUNTS = ["50000", "80000", "130000", "111", "654321", "999001"];
const ALICE_LEAVE = "alice-leave-c10";
const BOB_LEAVE = "bob-leave-secret-c10";

let mongo;
let app;
let server;
let acme;
let legacy;
let models;
let cookies;

function cookieFrom(response) {
  const cookiesHeader = response.headers["set-cookie"] || [];
  return cookiesHeader.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

async function login(companyCode, email) {
  const res = await request(app).post("/api/auth/login").send({ companyCode, email, password: PASSWORD });
  assert.equal(res.status, 200, res.body?.message || "login failed");
  return cookieFrom(res);
}

function hrAccessDoc(permissions, scope) {
  return {
    version: 1,
    configuredAt: new Date(),
    updatedAt: new Date(),
    permissions,
    employeeScope: scope,
  };
}

function payslipFields(netPayable) {
  return {
    monthlyCostToCompany: netPayable,
    grossEarnings: netPayable,
    totalDeductions: 0,
    daysBreakdown: { totalDaysInMonth: 30, workingDays: 22, payableDays: 22 },
    netPayable,
  };
}

async function dashboard(cookie, year = 2026) {
  const res = await request(app).get(`/api/admin/dashboard?year=${year}`).set("Cookie", cookie);
  assert.equal(res.status, 200, res.body?.message);
  return res.body;
}

before(async () => {
  fs.rmSync("D:/tmp/hrms-mongo/ca4c10-dashboard", { recursive: true, force: true });
  fs.mkdirSync("D:/tmp/hrms-mongo/ca4c10-dashboard", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/ca4c10-dashboard", storageEngine: "wiredTiger" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  acme = await Company.create({
    companyName: "Acme CA4C10",
    slug: "acme-ca4c10",
    databaseName: "company_acme_ca4c10",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { hrAccessEnforcement: { mode: "OFF" } },
  });
  legacy = await Company.create({
    companyName: "Legacy CA4C10",
    slug: "legacy-ca4c10",
    databaseName: "company_legacy_ca4c10",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });
  models = await getCompanyModels(acme);
  const legacyModels = await getCompanyModels(legacy);
  const passwordHash = await hashPassword(PASSWORD);
  const eng = await models.Department.create({ name: "Engineering", isActive: true });
  const design = await models.Department.create({ name: "Design", isActive: true });

  const alice = await models.Employee.create({
    employeeCode: "C10-001",
    fullName: "Alice Engineer",
    email: "alice@acme-ca4c10.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering", departmentId: eng._id },
  });
  const bob = await models.Employee.create({
    employeeCode: "C10-002",
    fullName: "Bob Designer",
    email: "bob@acme-ca4c10.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Designer", department: "Design", departmentId: design._id },
  });
  await models.EmployeeCompensation.create({
    employeeId: alice._id,
    revisions: [{ effectiveFromDate: new Date("2020-01-01"), monthlyCostToCompany: 50000 }],
  });
  await models.EmployeeCompensation.create({
    employeeId: bob._id,
    revisions: [{ effectiveFromDate: new Date("2020-01-01"), monthlyCostToCompany: 80000 }],
  });
  await models.LeaveRequest.create({
    employeeId: alice._id,
    leaveTypeCode: "CL",
    fromDate: new Date("2026-06-04"),
    toDate: new Date("2026-06-05"),
    reason: ALICE_LEAVE,
    status: "PENDING",
  });
  await models.LeaveRequest.create({
    employeeId: bob._id,
    leaveTypeCode: "CL",
    fromDate: new Date("2026-06-02"),
    toDate: new Date("2026-06-03"),
    reason: BOB_LEAVE,
    status: "PENDING",
  });
  const cycle = await models.PayrollCycle.create({
    periodMonth: 6,
    periodYear: 2026,
    periodStartDate: new Date("2026-06-01"),
    periodEndDate: new Date("2026-06-30"),
    status: "FINALIZED",
    employeeCount: 2,
    totalNetPayable: 999001,
  });
  await models.Payslip.create({
    payrollCycleId: cycle._id,
    employeeId: alice._id,
    payslipNumber: "C10-ALICE",
    periodMonth: 6,
    periodYear: 2026,
    periodStartDate: new Date("2026-06-01"),
    periodEndDate: new Date("2026-06-30"),
    status: "FINALIZED",
    ...payslipFields(111),
  });
  await models.Payslip.create({
    payrollCycleId: cycle._id,
    employeeId: bob._id,
    payslipNumber: "C10-BOB",
    periodMonth: 6,
    periodYear: 2026,
    periodStartDate: new Date("2026-06-01"),
    periodEndDate: new Date("2026-06-30"),
    status: "FINALIZED",
    ...payslipFields(654321),
  });

  const customScope = { mode: "CUSTOM", departmentIds: [eng._id], employeeIds: [] };
  const companyScope = { mode: "COMPANY", departmentIds: [], employeeIds: [] };
  const makeHr = (email, name, permissions, scope) =>
    models.User.create({
      email,
      passwordHash,
      role: USER_ROLES.HR_ADMIN,
      fullName: name,
      isActive: true,
      hrAccess: hrAccessDoc(permissions, scope),
    });
  await makeHr("hr.dash@acme-ca4c10.test", "Dash Only", ["dashboard.view"], customScope);
  await makeHr("hr.noleave@acme-ca4c10.test", "No Leave", ["dashboard.view", "payroll.view", "attendance.view"], customScope);
  await makeHr("hr.noatt@acme-ca4c10.test", "No Attendance", ["dashboard.view", "payroll.view", "leave.view"], customScope);
  await makeHr("hr.full@acme-ca4c10.test", "Full HR", FULL, customScope);
  await makeHr("hr.company@acme-ca4c10.test", "Company HR", FULL, companyScope);
  const aliceUser = await models.User.create({
    email: "alice@acme-ca4c10.test",
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Alice Engineer",
    isActive: true,
    employeeId: alice._id,
  });
  alice.userId = aliceUser._id;
  await alice.save();
  await createCompanyAdmin(models.User, {
    email: "ca@acme-ca4c10.test",
    passwordHash,
    fullName: "Acme CA",
  });

  const legacyEmp = await legacyModels.Employee.create({
    employeeCode: "LEG-010",
    fullName: "Legacy Employee",
    email: "legacy.emp@legacy-ca4c10.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering" },
  });
  await legacyModels.EmployeeCompensation.create({
    employeeId: legacyEmp._id,
    revisions: [{ effectiveFromDate: new Date("2020-01-01"), monthlyCostToCompany: 22000 }],
  });
  await legacyModels.LeaveRequest.create({
    employeeId: legacyEmp._id,
    leaveTypeCode: "CL",
    fromDate: new Date("2026-07-01"),
    toDate: new Date("2026-07-02"),
    reason: "legacy-leave-c10",
    status: "PENDING",
  });
  await legacyModels.User.create({
    email: "hr@legacy-ca4c10.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Legacy HR",
    isActive: true,
  });

  await Company.findByIdAndUpdate(acme._id, {
    $set: { "config.hrAccessEnforcement.mode": "ENFORCED" },
  });

  cookies = {
    dash: await login("acme-ca4c10", "hr.dash@acme-ca4c10.test"),
    noLeave: await login("acme-ca4c10", "hr.noleave@acme-ca4c10.test"),
    noAttendance: await login("acme-ca4c10", "hr.noatt@acme-ca4c10.test"),
    full: await login("acme-ca4c10", "hr.full@acme-ca4c10.test"),
    company: await login("acme-ca4c10", "hr.company@acme-ca4c10.test"),
    employee: await login("acme-ca4c10", "alice@acme-ca4c10.test"),
    ca: await login("acme-ca4c10", "ca@acme-ca4c10.test"),
    legacy: await login("legacy-ca4c10", "hr@legacy-ca4c10.test"),
  };
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("CA4-C.10 dashboard permission gating", () => {
  it("hides salary and payroll amounts from dashboard.view alone", async () => {
    const body = await dashboard(cookies.dash);
    const blob = JSON.stringify(body);
    for (const amount of SECRET_AMOUNTS) {
      assert.equal(blob.includes(amount), false, `leaked amount ${amount}`);
    }
    assert.equal(body.summary.monthlyPayroll, null);
    assert.equal(body.summary.payrollStatus, null);
    assert.equal(body.summary.payrollCycle.restricted, true);
    assert.equal(body.salaryExpenses.restricted, true);
    assert.equal(body.payrollAllocation.restricted, true);
    assert.equal(body.payrollCycleSummary.restricted, true);
    assert.equal(body.payrollActionCentre.restricted, true);
    assert.equal(body.lastCompletedCycle, null);
    assert.equal(body.summary.activeEmployees > 0, true);
  });

  it("hides leave identities and leave counts without leave.view", async () => {
    const body = await dashboard(cookies.noLeave);
    const blob = JSON.stringify(body);
    assert.equal(body.recentLeaves.restricted, true);
    assert.equal(body.summary.onLeave, null);
    assert.equal(body.summary.pendingLeaveRequests, null);
    assert.equal(body.insightMetrics.pendingLeaveRequests, null);
    assert.equal(body.monthlyAttendanceMix.leave, null);
    assert.equal(blob.includes(ALICE_LEAVE), false);
    assert.equal(blob.includes(BOB_LEAVE), false);
    assert.equal(blob.includes("Alice Engineer"), false);
    assert.equal(typeof body.summary.todayPresent, "number");
    assert.equal(body.summary.monthlyPayroll, 50000);
  });

  it("hides attendance counts and calendar without attendance.view", async () => {
    const body = await dashboard(cookies.noAttendance);
    const blob = JSON.stringify(body);
    assert.equal(body.summary.todayPresent, null);
    assert.equal(body.summary.todayAbsent, null);
    assert.equal(body.summary.todayLate, null);
    assert.equal(body.insightMetrics.lateArrivalsToday, null);
    assert.equal(body.attendanceCalendar.restricted, true);
    assert.equal(body.attendanceOverview.restricted, true);
    assert.equal(body.monthlyAttendanceMix.restricted, true);
    assert.equal(blob.includes("presentCount"), false);
    assert.equal(Array.isArray(body.recentLeaves), true);
    assert.equal(blob.includes(ALICE_LEAVE), true);
    assert.equal(blob.includes(BOB_LEAVE), false);
  });

  it("returns scoped dashboard data when all four permissions are granted", async () => {
    const body = await dashboard(cookies.full);
    const blob = JSON.stringify(body);
    assert.equal(body.summary.monthlyPayroll, 50000);
    assert.equal(body.payrollAllocation.totalMonthly, 50000);
    assert.equal(body.payrollAllocation.restricted, undefined);
    const june = body.salaryExpenses.months.find((row) => row.monthNumber === 6);
    assert.equal(june.amount, 111);
    assert.equal(blob.includes("654321"), false);
    assert.equal(blob.includes("999001"), false);
    assert.equal(blob.includes(BOB_LEAVE), false);
    assert.equal(blob.includes("Bob Designer"), false);
    assert.equal(blob.includes(ALICE_LEAVE), true);
    assert.equal(typeof body.summary.todayPresent, "number");
    assert.equal(typeof body.summary.onLeave, "number");
    assert.equal(Array.isArray(body.attendanceCalendar.days), true);
    assert.equal(Array.isArray(body.attendanceOverview.days), true);
    assert.ok(body.payrollCycleSummary);
    assert.equal(body.payrollCycleSummary.restricted, undefined);
  });

  it("keeps company-wide HR data for COMPANY scope", async () => {
    const body = await dashboard(cookies.company);
    const blob = JSON.stringify(body);
    assert.equal(body.summary.monthlyPayroll, 130000);
    assert.equal(blob.includes(ALICE_LEAVE), true);
    assert.equal(blob.includes(BOB_LEAVE), true);
    assert.equal(blob.includes("Bob Designer"), true);
    const june = body.salaryExpenses.months.find((row) => row.monthNumber === 6);
    assert.equal(june.amount, 999001);
  });

  it("leaves the Company Admin dashboard and employee self-service unchanged", async () => {
    // Approved design: Company Admin may use same-tenant HR dashboard modules.
    // Dedicated company-admin dashboard remains CA-only.
    const hrDashboard = await request(app).get("/api/admin/dashboard").set("Cookie", cookies.ca);
    assert.equal(hrDashboard.status, 200, hrDashboard.body?.message);

    const companyDashboard = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", cookies.ca);
    assert.equal(companyDashboard.status, 200, companyDashboard.body?.message);

    const hrOversight = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", cookies.full);
    assert.equal(hrOversight.status, 403);

    const me = await request(app).get("/api/employees/me").set("Cookie", cookies.employee);
    assert.equal(me.status, 200, me.body?.message);
    assert.equal(me.body.employee.fullName, "Alice Engineer");

    const employeeDashboard = await request(app).get("/api/admin/dashboard").set("Cookie", cookies.employee);
    assert.equal(employeeDashboard.status, 403);
  });

  it("preserves the legacy dashboard while enforcement is OFF", async () => {
    const body = await dashboard(cookies.legacy);
    assert.equal(body.summary.monthlyPayroll, 22000);
    assert.equal(body.salaryExpenses.restricted, undefined);
    assert.equal(Array.isArray(body.salaryExpenses.months), true);
    assert.equal(Array.isArray(body.recentLeaves), true);
    assert.equal(JSON.stringify(body).includes("legacy-leave-c10"), true);
    assert.equal(typeof body.summary.todayPresent, "number");
    assert.equal(typeof body.summary.onLeave, "number");
    assert.equal(body.attendanceCalendar.restricted, undefined);
    const mode = (await Company.findById(legacy._id).lean()).config?.hrAccessEnforcement?.mode || "OFF";
    assert.equal(mode, "OFF");
    const acmeMode = (await Company.findById(acme._id).lean()).config.hrAccessEnforcement.mode;
    assert.equal(acmeMode, "ENFORCED");
  });
});
