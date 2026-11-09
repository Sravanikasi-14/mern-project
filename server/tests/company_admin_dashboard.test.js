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
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { ASSET_STATUSES } from "../models/CompanyAsset.js";
import { PAYROLL_CYCLE_STATUSES, PAYMENT_STATUSES } from "../models/PayrollCycle.js";
import { createCompanyAdmin } from "../services/companyAdminService.js";
import { getCompanyBusinessDate } from "../services/attendanceService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

const PASSWORD = "CompanyAdminPass1!";
const DB_PATH = "D:/tmp/hrms-mongo/ca2-company-admin-dashboard";

let mongo;
let app;
let acme;
let globex;
let caCookieAcme;
let caCookieGlobex;
let hrCookieAcme;
let employeeCookieAcme;
let todayStr;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create({
    instance: {
      dbPath: "D:/tmp/hrms-mongo/ca2-company-admin-dashboard",
      storageEngine: "wiredTiger",
    },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme CA2",
    slug: "acme-ca2",
    databaseName: "company_acme_ca2",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { timezone: "Asia/Kolkata" },
    branding: { displayName: "Acme CA2", logoUrl: "" },
  });
  globex = await Company.create({
    companyName: "Globex CA2",
    slug: "globex-ca2",
    databaseName: "company_globex_ca2",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { timezone: "Asia/Kolkata" },
  });

  todayStr = getCompanyBusinessDate(new Date(), "Asia/Kolkata");

  const modelsA = await getCompanyModels(acme);
  const {
    User: UserA,
    Employee: EmployeeA,
    Attendance: AttendanceA,
    LeaveRequest: LeaveRequestA,
    OfferLetter: OfferLetterA,
    PayrollCycle: PayrollCycleA,
    CompanyAsset: AssetA,
    CompanyHrPolicy: PolicyA,
    Department: DepartmentA,
    AuditLog: AuditLogA,
  } = modelsA;

  await UserA.syncIndexes();

  await PolicyA.create({
    effectiveFromDate: new Date("2020-01-01"),
    attendanceRules: {
      officeStartTime: "09:30",
      officeEndTime: "18:30",
      gracePeriodMinutes: 15,
    },
    payrollRules: { currencySymbol: "₹", currencyCode: "INR" },
  });

  await DepartmentA.create({ name: "Engineering", normalizedName: "engineering", isActive: true });
  await DepartmentA.create({ name: "Design", normalizedName: "design", isActive: true });

  await UserA.create({
    email: "hr@acme-ca2.test",
    passwordHash: await hashPassword(PASSWORD),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  await UserA.create({
    email: "hr2@acme-ca2.test",
    passwordHash: await hashPassword(PASSWORD),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  await UserA.create({
    email: "employee@acme-ca2.test",
    passwordHash: await hashPassword(PASSWORD),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  await createCompanyAdmin(UserA, {
    email: "company-admin@acme-ca2.test",
    passwordHash: await hashPassword(PASSWORD),
    fullName: "Acme Company Admin",
  });

  const emp1 = await EmployeeA.create({
    employeeCode: "CA2-001",
    fullName: "Alice Active",
    email: "alice@acme-ca2.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering" },
  });
  const emp2 = await EmployeeA.create({
    employeeCode: "CA2-002",
    fullName: "Bob Late",
    email: "bob@acme-ca2.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Designer", department: "Design" },
  });
  const emp3 = await EmployeeA.create({
    employeeCode: "CA2-003",
    fullName: "Cara Leave",
    email: "cara@acme-ca2.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Analyst", department: "Engineering" },
  });
  await EmployeeA.create({
    employeeCode: "CA2-004",
    fullName: "Dana Inactive",
    email: "dana@acme-ca2.test",
    status: EMPLOYEE_STATUSES.INACTIVE,
    job: { jobTitle: "Ops", department: "Operations" },
  });

  // Present on time (09:20 IST) and late (10:05 IST) — same rules as HR Admin dashboard.
  await AttendanceA.create({
    employeeId: emp1._id,
    date: todayStr,
    status: "PRESENT",
    checkIn: new Date(`${todayStr}T03:50:00.000Z`),
  });
  await AttendanceA.create({
    employeeId: emp2._id,
    date: todayStr,
    status: "PRESENT",
    checkIn: new Date(`${todayStr}T04:35:00.000Z`),
  });

  await LeaveRequestA.create({
    employeeId: emp3._id,
    leaveTypeCode: "CASUAL",
    fromDate: new Date(`${todayStr}T00:00:00.000Z`),
    toDate: new Date(`${todayStr}T23:59:59.999Z`),
    daysCount: 1,
    status: "APPROVED",
    reason: "Personal",
  });
  await LeaveRequestA.create({
    employeeId: emp1._id,
    leaveTypeCode: "SICK",
    fromDate: new Date("2020-01-01T00:00:00.000Z"),
    toDate: new Date("2020-01-02T23:59:59.999Z"),
    daysCount: 2,
    status: "PENDING",
    reason: "Pending review",
  });
  await LeaveRequestA.create({
    employeeId: emp2._id,
    leaveTypeCode: "CASUAL",
    fromDate: new Date("2020-02-01T00:00:00.000Z"),
    toDate: new Date("2020-02-01T23:59:59.999Z"),
    daysCount: 1,
    status: "REJECTED",
    reason: "Rejected",
  });

  await OfferLetterA.create({
    candidate: { fullName: "Eva Candidate", email: "eva@hire.test" },
    position: "Frontend Dev",
    department: "Engineering",
    monthlySalary: 90000,
    joiningDate: new Date("2026-12-01"),
    content: "Offer content",
    status: "SENT",
  });
  await OfferLetterA.create({
    candidate: { fullName: "Frank Draft", email: "frank@hire.test" },
    position: "Backend Dev",
    department: "Engineering",
    monthlySalary: 95000,
    joiningDate: new Date("2026-12-15"),
    content: "Offer content",
    status: "DRAFT",
  });

  await PayrollCycleA.create({
    periodMonth: 10,
    periodYear: 2026,
    periodStartDate: new Date("2026-10-01"),
    periodEndDate: new Date("2026-10-31"),
    status: PAYROLL_CYCLE_STATUSES.FINALIZED,
    paymentStatus: PAYMENT_STATUSES.PARTIALLY_PAID,
    employeeCount: 3,
    totalGrossEarnings: 300000,
    totalNetPayable: 250000,
    totalPaidAmount: 100000,
    validationIssues: [
      {
        employeeId: emp1._id,
        employeeCode: "CA2-001",
        fullName: "Alice Active",
        issue: "Missing bank",
      },
    ],
    payments: [
      {
        paymentDate: new Date("2026-10-28"),
        amount: 100000,
        referenceNumber: "SENSITIVE-REF",
      },
    ],
  });

  await AssetA.create({
    assetTag: "LAP-001",
    name: "Laptop One",
    category: "LAPTOP",
    status: ASSET_STATUSES.ASSIGNED,
  });
  await AssetA.create({
    assetTag: "LAP-002",
    name: "Laptop Two",
    category: "LAPTOP",
    status: ASSET_STATUSES.AVAILABLE,
  });
  await AssetA.create({
    assetTag: "MON-001",
    name: "Monitor",
    category: "MONITOR",
    status: ASSET_STATUSES.UNDER_MAINTENANCE,
  });

  await AuditLogA.create({
    actorEmail: "hr@acme-ca2.test",
    actorRole: USER_ROLES.HR_ADMIN,
    action: AUDIT_ACTIONS.EMPLOYEE_CREATED,
    targetType: "Employee",
    targetId: emp1._id,
    changes: { bankAccount: "should-not-leak", fullName: "Alice Active" },
  });

  const modelsB = await getCompanyModels(globex);
  await modelsB.User.syncIndexes();
  await createCompanyAdmin(modelsB.User, {
    email: "company-admin@globex-ca2.test",
    passwordHash: await hashPassword(PASSWORD),
    fullName: "Globex Company Admin",
  });
  await modelsB.Employee.create({
    employeeCode: "GX-001",
    fullName: "Globex Only",
    email: "only@globex-ca2.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Ops", department: "Ops" },
  });

  const loginCaA = await request(app).post("/api/auth/login").send({
    companyCode: "acme-ca2",
    email: "company-admin@acme-ca2.test",
    password: PASSWORD,
  });
  caCookieAcme = cookieFrom(loginCaA);

  const loginCaB = await request(app).post("/api/auth/login").send({
    companyCode: "globex-ca2",
    email: "company-admin@globex-ca2.test",
    password: PASSWORD,
  });
  caCookieGlobex = cookieFrom(loginCaB);

  const loginHr = await request(app).post("/api/auth/login").send({
    companyCode: "acme-ca2",
    email: "hr@acme-ca2.test",
    password: PASSWORD,
  });
  hrCookieAcme = cookieFrom(loginHr);

  const loginEmp = await request(app).post("/api/auth/login").send({
    companyCode: "acme-ca2",
    email: "employee@acme-ca2.test",
    password: PASSWORD,
  });
  employeeCookieAcme = cookieFrom(loginEmp);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Phase CA2 — Company Admin dashboard API", () => {
  it("1. Company Admin can access the Company Admin dashboard API", async () => {
    const res = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", caCookieAcme);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.company.companyName, "Acme CA2");
    assert.equal(res.body.businessDate, todayStr);
    assert.ok(res.body.overview);
    assert.ok(res.body.attendance);
    assert.ok(res.body.leave);
    assert.ok(res.body.payroll);
    assert.ok(res.body.hiring);
    assert.ok(res.body.assets);
    assert.ok(Array.isArray(res.body.recentActivity));
    assert.ok(Array.isArray(res.body.quickAccess));
  });

  it("2. HR Admin and Employee cannot access Company Admin dashboard API", async () => {
    const hrRes = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", hrCookieAcme);
    assert.equal(hrRes.status, 403);

    const empRes = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", employeeCookieAcme);
    assert.equal(empRes.status, 403);
  });

  it("3. Company Admin cannot access another company's dashboard data", async () => {
    const acmeRes = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", caCookieAcme);
    const globexRes = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", caCookieGlobex);

    assert.equal(acmeRes.status, 200);
    assert.equal(globexRes.status, 200);
    assert.equal(acmeRes.body.company.slug, "acme-ca2");
    assert.equal(globexRes.body.company.slug, "globex-ca2");
    assert.equal(acmeRes.body.overview.activeEmployeeCount, 3);
    assert.equal(globexRes.body.overview.activeEmployeeCount, 1);
    assert.notEqual(
      acmeRes.body.overview.totalEmployeeCount,
      globexRes.body.overview.totalEmployeeCount
    );
  });

  it("4. Aggregated employee counts are correct", async () => {
    const res = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", caCookieAcme);

    assert.equal(res.body.overview.activeEmployeeCount, 3);
    assert.equal(res.body.overview.totalEmployeeCount, 4);
    assert.equal(res.body.overview.departmentCount, 2);
    assert.equal(res.body.overview.activeHrAdminCount, 2);

    const eng = res.body.workforce.byDepartment.find((d) => d.name === "Engineering");
    const design = res.body.workforce.byDepartment.find((d) => d.name === "Design");
    assert.equal(eng.count, 2);
    assert.equal(design.count, 1);
  });

  it("5. Attendance summaries follow existing attendance rules", async () => {
    const res = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", caCookieAcme);

    assert.equal(res.body.attendance.available, true);
    assert.equal(res.body.attendance.presentToday, 2);
    assert.equal(res.body.attendance.lateToday, 1);
    assert.equal(res.body.attendance.onLeaveToday, 1);
    assert.equal(res.body.attendance.absentToday, 0);
    assert.ok(Array.isArray(res.body.attendance.trend));
    assert.equal(res.body.attendance.trend.length, 7);
  });

  it("6. Leave summaries use existing statuses", async () => {
    const res = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", caCookieAcme);

    assert.equal(res.body.leave.pending, 1);
    assert.equal(res.body.leave.approved, 1);
    assert.equal(res.body.leave.rejected, 1);
    assert.equal(res.body.leave.total, 3);
  });

  it("7. Payroll summaries do not expose sensitive employee details", async () => {
    const res = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", caCookieAcme);

    const payroll = res.body.payroll;
    assert.equal(payroll.hasCycle, true);
    assert.equal(payroll.status, PAYROLL_CYCLE_STATUSES.FINALIZED);
    assert.equal(payroll.paymentStatus, PAYMENT_STATUSES.PARTIALLY_PAID);
    assert.equal(payroll.totalNetPayable, 250000);
    assert.equal(payroll.totalPaidAmount, 100000);

    const raw = JSON.stringify(res.body);
    assert.equal(raw.includes("SENSITIVE-REF"), false);
    assert.equal(raw.includes("Missing bank"), false);
    assert.equal(raw.includes("should-not-leak"), false);
    assert.equal(raw.includes("monthlySalary"), false);
    assert.equal("payments" in payroll, false);
    assert.equal("validationIssues" in payroll, false);
  });

  it("8. Missing optional module data does not break the dashboard", async () => {
    const res = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", caCookieGlobex);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.overview.activeEmployeeCount, 1);
    assert.equal(res.body.leave.total, 0);
    assert.equal(res.body.payroll.hasCycle, false);
    assert.equal(res.body.hiring.available, true);
    assert.equal(res.body.hiring.openPositions, 0);
    assert.equal(res.body.assets.available, true);
    assert.equal(res.body.assets.total, 0);
    assert.deepEqual(res.body.recentActivity, []);
  });

  it("9. Recent activity respects tenant boundaries", async () => {
    const acmeRes = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", caCookieAcme);
    const globexRes = await request(app)
      .get("/api/company-admin/dashboard")
      .set("Cookie", caCookieGlobex);

    assert.ok(acmeRes.body.recentActivity.length >= 1);
    assert.equal(
      acmeRes.body.recentActivity.some((a) => a.action === AUDIT_ACTIONS.EMPLOYEE_CREATED),
      true
    );
    assert.equal(
      acmeRes.body.recentActivity.every((a) => a.changes === undefined),
      true
    );
    assert.deepEqual(globexRes.body.recentActivity, []);
  });

  it("Company Admin can use same-tenant HR Admin dashboard without cross-tenant leakage", async () => {
    // Approved design: COMPANY_ADMIN is allowed on /api/admin/* with tenant binding via auth.
    const res = await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", caCookieAcme);
    assert.equal(res.status, 200, res.body?.message);
    const blob = JSON.stringify(res.body).toLowerCase();
    assert.equal(blob.includes("globex"), false);

    const globexHrDash = await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", caCookieGlobex);
    assert.equal(globexHrDash.status, 200, globexHrDash.body?.message);
    assert.equal(JSON.stringify(globexHrDash.body).toLowerCase().includes("acme"), false);
  });
});
