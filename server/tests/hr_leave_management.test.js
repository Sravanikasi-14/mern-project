import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
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

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  companyA = await Company.create({
    companyName: "Acme Corp",
    slug: "acme",
    databaseName: "company_acme_leave_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  companyB = await Company.create({
    companyName: "Globex Corp",
    slug: "globex",
    databaseName: "company_globex_leave_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: UserA, Employee: EmployeeA, CompanyHrPolicy: CompanyHrPolicyA } =
    await getCompanyModels(companyA);

  const hrUserA = await UserA.create({
    email: "hr@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const empUserA = await UserA.create({
    email: "emp@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  employeeRecordA = await EmployeeA.create({
    userId: empUserA._id,
    employeeCode: "EMP-001",
    fullName: "Alice Smith",
    email: "emp@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Software Engineer",
      department: "Engineering",
    },
    attendance: {
      totalWorkingDays: 22,
      daysPresent: 20,
      leaveBalance: { casual: 8, sick: 6, earned: 12 },
    },
  });

  // Ensure default policy is active
  await CompanyHrPolicyA.create({
    effectiveFromDate: new Date("2026-01-01"),
    leaveTypes: [
      { code: "CASUAL", name: "Casual Leave", yearlyDays: 8, isActive: true },
      { code: "SICK", name: "Sick Leave", yearlyDays: 6, isActive: true },
      { code: "EARNED", name: "Earned Leave", yearlyDays: 12, isActive: true },
    ],
    leaveRules: {
      probationMonths: 3,
      maxConsecutiveDays: 14,
      leaveYearStartMonth: 1,
      carryForwardLimitDays: 10,
      allowEncashment: false,
    },
    weekendRules: { saturdayOff: true, sundayOff: true },
    holidays: [
      { name: "Republic Day", date: new Date("2026-01-26"), type: "National Holiday" },
    ],
  });

  // Setup Company B
  const { User: UserB } = await getCompanyModels(companyB);
  await UserB.create({
    email: "hr@globex.test",
    passwordHash: await hashPassword("GlobexPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const loginHrA = await request(app).post("/api/auth/login").send({
    companyCode: "acme",
    email: "hr@acme.test",
    password: "AcmePass123!",
  });
  hrCookieA = cookieFrom(loginHrA);

  const loginHrB = await request(app).post("/api/auth/login").send({
    companyCode: "globex",
    email: "hr@globex.test",
    password: "GlobexPass123!",
  });
  hrCookieB = cookieFrom(loginHrB);

  const loginEmpA = await request(app).post("/api/auth/login").send({
    companyCode: "acme",
    email: "emp@acme.test",
    password: "AcmePass123!",
  });
  employeeCookieA = cookieFrom(loginEmpA);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("HR Leave Management Workflow & Approved Schema Integration", () => {
  let createdLeaveId;

  it("1. HR retrieves initial empty leave summary (all zeroed)", async () => {
    const res = await request(app)
      .get("/api/leave-requests/summary")
      .set("Cookie", hrCookieA);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.summary.pending, 0);
    assert.equal(res.body.summary.approved, 0);
    assert.equal(res.body.summary.rejected, 0);
    assert.equal(res.body.summary.onLeaveToday, 0);
  });

  it("2. Employee submits a leave request through the portal", async () => {
    const res = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookieA)
      .send({
        leaveType: "CASUAL",
        startDate: "2026-06-10",
        endDate: "2026-06-11",
        reason: "Personal family commitment",
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.leaveRequest.status, "PENDING");
    assert.equal(res.body.leaveRequest.leaveTypeCode, "CASUAL");
    assert.equal(res.body.leaveRequest.days, 2);

    createdLeaveId = res.body.leaveRequest._id;
    assert.ok(createdLeaveId);
  });

  it("3. Detects and rejects overlapping leave requests for the same employee", async () => {
    const res = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookieA)
      .send({
        leaveType: "CASUAL",
        startDate: "2026-06-11", // Overlaps with 2026-06-10 to 2026-06-11
        endDate: "2026-06-12",
        reason: "Overlapping attempt",
      });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /overlapping/i);
  });

  it("4. HR sees the submitted request in the pending queue and summary count updates", async () => {
    const resSummary = await request(app)
      .get("/api/leave-requests/summary")
      .set("Cookie", hrCookieA);

    assert.equal(resSummary.status, 200);
    assert.equal(resSummary.body.summary.pending, 1);
    assert.equal(resSummary.body.summary.approved, 0);

    const resList = await request(app)
      .get("/api/leave-requests")
      .set("Cookie", hrCookieA);

    assert.equal(resList.status, 200);
    assert.equal(resList.body.leaveRequests.length, 1);
    assert.equal(resList.body.leaveRequests[0].employeeName, "Alice Smith");
    assert.equal(resList.body.leaveRequests[0].employeeCode, "EMP-001");
    assert.equal(resList.body.leaveRequests[0].status, "PENDING");
    assert.equal(resList.body.leaveRequests[0].daysCount, 2);
  });

  it("5. HR filters leave requests by status and searches by employee code", async () => {
    // Filter pending
    const resPending = await request(app)
      .get("/api/leave-requests?status=PENDING")
      .set("Cookie", hrCookieA);
    assert.equal(resPending.body.leaveRequests.length, 1);

    // Filter approved (should be 0)
    const resApproved = await request(app)
      .get("/api/leave-requests?status=APPROVED")
      .set("Cookie", hrCookieA);
    assert.equal(resApproved.body.leaveRequests.length, 0);

    // Search by code
    const resSearch = await request(app)
      .get("/api/leave-requests?search=EMP-001")
      .set("Cookie", hrCookieA);
    assert.equal(resSearch.body.leaveRequests.length, 1);
  });

  it("6. HR inspects full details of the leave request including employee leave balance", async () => {
    const res = await request(app)
      .get(`/api/leave-requests/${createdLeaveId}`)
      .set("Cookie", hrCookieA);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.leaveRequest.employee.fullName, "Alice Smith");
    assert.equal(res.body.leaveRequest.daysCount, 2);
    assert.ok(res.body.leaveBalance);
    assert.equal(res.body.leaveBalance.balance.casual, 8); // Still 8 because pending does not deduct
  });

  it("7. HR approves the leave request with remarks", async () => {
    const res = await request(app)
      .post(`/api/leave-requests/${createdLeaveId}/decision`)
      .set("Cookie", hrCookieA)
      .send({
        action: "APPROVE",
        remarks: "Approved as requested. Please coordinate handover.",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.leaveRequest.status, "APPROVED");
    assert.equal(res.body.leaveRequest.decision.decidedBy, "hr@acme.test");
    assert.equal(res.body.leaveRequest.decision.remarks, "Approved as requested. Please coordinate handover.");

    // Summary counts updated
    const resSummary = await request(app)
      .get("/api/leave-requests/summary")
      .set("Cookie", hrCookieA);
    assert.equal(resSummary.body.summary.pending, 0);
    assert.equal(resSummary.body.summary.approved, 1);
  });

  it("8. Protects against duplicate decision: cannot re-approve or reject already processed request", async () => {
    const res = await request(app)
      .post(`/api/leave-requests/${createdLeaveId}/decision`)
      .set("Cookie", hrCookieA)
      .send({
        action: "REJECT",
        remarks: "Attempting to change approved request",
      });

    assert.equal(res.status, 409);
    assert.match(res.body.message, /already been processed/i);
  });

  it("9. Employee dashboard reflects updated approved status and balance deduction", async () => {
    const res = await request(app)
      .get("/api/employees/me/dashboard")
      .set("Cookie", employeeCookieA);

    assert.equal(res.status, 200);
    // Casual balance now 8 - 2 = 6
    assert.equal(res.body.leave.balance.casual, 6);
    assert.equal(res.body.leave.summary.approved, 1);
    assert.equal(res.body.leave.summary.pending, 0);

    const reqRecord = res.body.leave.recentRequests[0];
    assert.equal(reqRecord.status, "APPROVED");
    assert.equal(reqRecord.decision.remarks, "Approved as requested. Please coordinate handover.");
  });

  it("10. Employee submits another request and HR rejects it; balance is not deducted", async () => {
    const applyRes = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookieA)
      .send({
        leaveType: "SICK",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        reason: "Doctor appointment",
      });
    assert.equal(applyRes.status, 201);
    const rejectTargetId = applyRes.body.leaveRequest._id;

    // HR Rejects
    const rejectRes = await request(app)
      .post(`/api/leave-requests/${rejectTargetId}/decision`)
      .set("Cookie", hrCookieA)
      .send({
        action: "REJECT",
        remarks: "Team coverage required on that date.",
      });
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.body.leaveRequest.status, "REJECTED");

    // Check employee dashboard: sick balance remains 6!
    const dashRes = await request(app)
      .get("/api/employees/me/dashboard")
      .set("Cookie", employeeCookieA);
    assert.equal(dashRes.body.leave.balance.sick, 6);
    assert.equal(dashRes.body.leave.summary.rejected, 1);
  });

  it("11. Security: Employee is strictly blocked with 403 from HR leave endpoints", async () => {
    const resList = await request(app)
      .get("/api/leave-requests")
      .set("Cookie", employeeCookieA);
    assert.equal(resList.status, 403);

    const resDecision = await request(app)
      .post(`/api/leave-requests/${createdLeaveId}/decision`)
      .set("Cookie", employeeCookieA)
      .send({ action: "APPROVE" });
    assert.equal(resDecision.status, 403);
  });

  it("12. Tenant isolation: HR of Company B cannot see Company A's leave requests", async () => {
    const resB = await request(app)
      .get("/api/leave-requests")
      .set("Cookie", hrCookieB);

    assert.equal(resB.status, 200);
    assert.equal(resB.body.leaveRequests.length, 0);
    assert.equal(resB.body.summary.pending, 0);
    assert.equal(resB.body.summary.approved, 0);
  });
});
