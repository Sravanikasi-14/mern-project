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
    databaseName: "company_acme_policy_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  companyB = await Company.create({
    companyName: "Globex Corp",
    slug: "globex",
    databaseName: "company_globex_policy_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  // Provision and seed Company A
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

  // Ensure exactly one clean default policy is active in Company A
  await CompanyHrPolicyA.deleteMany({});
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
    attendanceRules: { officeStartTime: "09:30", officeEndTime: "18:30" },
    holidays: [
      { name: "Republic Day", date: new Date("2026-01-26"), type: "National Holiday" },
    ],
  });

  // Seed Company B
  const { User: UserB, CompanyHrPolicy: CompanyHrPolicyB } = await getCompanyModels(companyB);
  await CompanyHrPolicyB.deleteMany({});
  await CompanyHrPolicyB.create({
    effectiveFromDate: new Date("2026-01-01"),
    leaveTypes: [
      { code: "CASUAL", name: "Casual Leave", yearlyDays: 8, isActive: true },
      { code: "SICK", name: "Sick Leave", yearlyDays: 6, isActive: true },
      { code: "EARNED", name: "Earned Leave", yearlyDays: 12, isActive: true },
    ],
    attendanceRules: { officeStartTime: "09:30", officeEndTime: "18:30" },
  });
  await UserB.create({
    email: "hr@globex.test",
    passwordHash: await hashPassword("GlobexPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Authenticate Company A HR
  const resHrA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme", email: "hr@acme.test", password: "AcmePass123!" });
  hrCookieA = cookieFrom(resHrA);

  // Authenticate Company A Employee
  const resEmpA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme", email: "emp@acme.test", password: "AcmePass123!" });
  employeeCookieA = cookieFrom(resEmpA);

  // Authenticate Company B HR
  const resHrB = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "globex", email: "hr@globex.test", password: "GlobexPass123!" });
  hrCookieB = cookieFrom(resHrB);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("Company HR Policies Feature Test Suite", () => {
  let activePolicyAId;

  it("1. HR administrator can retrieve the active policy and policy history", async () => {
    const resActive = await request(app)
      .get("/api/policies/active")
      .set("Cookie", hrCookieA);

    assert.equal(resActive.status, 200);
    assert.equal(resActive.body.success, true);
    assert.ok(resActive.body.policy);
    assert.equal(resActive.body.policy.attendanceRules.officeStartTime, "09:30");
    assert.equal(resActive.body.policy.leaveTypes.length, 3);
    activePolicyAId = resActive.body.policy._id;

    const resHistory = await request(app)
      .get("/api/policies/history")
      .set("Cookie", hrCookieA);

    assert.equal(resHistory.status, 200);
    assert.equal(resHistory.body.success, true);
    assert.ok(Array.isArray(resHistory.body.policies));
    assert.equal(resHistory.body.policies.length, 1);
  });

  it("2. Employee can retrieve active policy, but is strictly blocked (403) from modifications and history", async () => {
    // Employee can read active policy
    const resActive = await request(app)
      .get("/api/policies/active")
      .set("Cookie", employeeCookieA);

    assert.equal(resActive.status, 200);
    assert.equal(resActive.body.success, true);

    // Employee blocked from history
    const resHistory = await request(app)
      .get("/api/policies/history")
      .set("Cookie", employeeCookieA);
    assert.equal(resHistory.status, 403);

    // Employee blocked from creating revision
    const resCreate = await request(app)
      .post("/api/policies")
      .set("Cookie", employeeCookieA)
      .send({
        effectiveFromDate: "2026-06-01",
        leaveTypes: [{ code: "CASUAL", name: "Casual Leave", yearlyDays: 10, isActive: true }],
      });
    assert.equal(resCreate.status, 403);

    // Employee blocked from updating revision
    const resUpdate = await request(app)
      .put(`/api/policies/${activePolicyAId}`)
      .set("Cookie", employeeCookieA)
      .send({
        effectiveFromDate: "2026-01-01",
        leaveTypes: [{ code: "CASUAL", name: "Casual Leave", yearlyDays: 10, isActive: true }],
      });
    assert.equal(resUpdate.status, 403);
  });

  it("3. Unauthenticated requests are rejected with 401", async () => {
    const res = await request(app).get("/api/policies/active");
    assert.equal(res.status, 401);

    const resPost = await request(app).post("/api/policies").send({});
    assert.equal(resPost.status, 401);
  });

  it("4. Rejects invalid policy values with clear 400 validation errors", async () => {
    // Office start time after end time
    const resInvalidTimes = await request(app)
      .put(`/api/policies/${activePolicyAId}`)
      .set("Cookie", hrCookieA)
      .send({
        effectiveFromDate: "2026-01-01",
        leaveTypes: [{ code: "CASUAL", name: "Casual Leave", yearlyDays: 10, isActive: true }],
        attendanceRules: { officeStartTime: "18:00", officeEndTime: "09:00" },
      });
    assert.equal(resInvalidTimes.status, 400);
    assert.match(resInvalidTimes.body.message, /earlier than office end time/i);

    // Invalid time format
    const resInvalidFormat = await request(app)
      .put(`/api/policies/${activePolicyAId}`)
      .set("Cookie", hrCookieA)
      .send({
        effectiveFromDate: "2026-01-01",
        leaveTypes: [{ code: "CASUAL", name: "Casual Leave", yearlyDays: 10, isActive: true }],
        attendanceRules: { officeStartTime: "25:99", officeEndTime: "18:00" },
      });
    assert.equal(resInvalidFormat.status, 400);

    // Duplicate leave type code
    const resDupLeave = await request(app)
      .put(`/api/policies/${activePolicyAId}`)
      .set("Cookie", hrCookieA)
      .send({
        effectiveFromDate: "2026-01-01",
        leaveTypes: [
          { code: "CASUAL", name: "Casual 1", yearlyDays: 10, isActive: true },
          { code: "CASUAL", name: "Casual 2", yearlyDays: 5, isActive: true },
        ],
        attendanceRules: { officeStartTime: "09:30", officeEndTime: "18:30" },
      });
    assert.equal(resDupLeave.status, 400);
    assert.match(resDupLeave.body.message, /duplicate leave type code/i);

    // Duplicate holiday for same date and name
    const resDupHoliday = await request(app)
      .put(`/api/policies/${activePolicyAId}`)
      .set("Cookie", hrCookieA)
      .send({
        effectiveFromDate: "2026-01-01",
        leaveTypes: [{ code: "CASUAL", name: "Casual Leave", yearlyDays: 10, isActive: true }],
        attendanceRules: { officeStartTime: "09:30", officeEndTime: "18:30" },
        holidays: [
          { name: "Independence Day", date: "2026-08-15", type: "National Holiday" },
          { name: "Independence Day", date: "2026-08-15", type: "National Holiday" },
        ],
      });
    assert.equal(resDupHoliday.status, 400);
    assert.match(resDupHoliday.body.message, /duplicate holiday entry/i);

    // Invalid leave rules (probation > 24)
    const resInvalidProbation = await request(app)
      .put(`/api/policies/${activePolicyAId}`)
      .set("Cookie", hrCookieA)
      .send({
        effectiveFromDate: "2026-01-01",
        leaveTypes: [{ code: "CASUAL", name: "Casual Leave", yearlyDays: 10, isActive: true }],
        leaveRules: { probationMonths: 36 },
        attendanceRules: { officeStartTime: "09:30", officeEndTime: "18:30" },
      });
    assert.equal(resInvalidProbation.status, 400);
    assert.match(resInvalidProbation.body.message, /probation/i);
  });

  it("5. HR administrator can update policy and records audit log", async () => {
    const res = await request(app)
      .put(`/api/policies/${activePolicyAId}`)
      .set("Cookie", hrCookieA)
      .send({
        effectiveFromDate: "2026-01-01",
        leaveTypes: [
          { code: "CASUAL", name: "Casual Leave", yearlyDays: 10, isActive: true },
          { code: "SICK", name: "Sick Leave", yearlyDays: 8, isActive: true },
          { code: "EARNED", name: "Earned Leave", yearlyDays: 15, isActive: true },
          { code: "FLOATING", name: "Floating Holiday", yearlyDays: 2, isActive: true },
        ],
        leaveRules: {
          probationMonths: 6,
          maxConsecutiveDays: 10,
          leaveYearStartMonth: 4, // April
          carryForwardLimitDays: 12,
          allowEncashment: true,
        },
        attendanceRules: {
          officeStartTime: "09:00",
          officeEndTime: "18:00",
        },
        weekendRules: {
          saturdayOff: true,
          sundayOff: true,
        },
        holidays: [
          { name: "Republic Day", date: "2026-01-26", type: "National Holiday" },
          { name: "Independence Day", date: "2026-08-15", type: "National Holiday" },
          { name: "Diwali", date: "2026-11-08", type: "Festival Holiday" },
        ],
        notes: "Updated office hours to 9 AM and added Floating Leave",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.policy.attendanceRules.officeStartTime, "09:00");
    assert.equal(res.body.policy.leaveTypes.length, 4);
    assert.equal(res.body.policy.holidays.length, 3);
    assert.equal(res.body.policy.leaveRules.allowEncashment, true);

    // Verify audit log
    const { AuditLog: AuditLogA } = await getCompanyModels(companyA);
    const auditRecord = await AuditLogA.findOne({
      action: "HR_POLICY_UPDATED",
      targetId: activePolicyAId,
    });
    assert.ok(auditRecord);
    assert.equal(auditRecord.actorEmail, "hr@acme.test");
  });

  it("6. Tenant isolation: Company B policy changes do not leak into or affect Company A", async () => {
    // Company B retrieves its policy
    const resBInitial = await request(app)
      .get("/api/policies/active")
      .set("Cookie", hrCookieB);
    assert.equal(resBInitial.status, 200);
    const policyBId = resBInitial.body.policy._id;

    // Company B updates its policy with 10:00 start time
    const resBUpdate = await request(app)
      .put(`/api/policies/${policyBId}`)
      .set("Cookie", hrCookieB)
      .send({
        effectiveFromDate: "2026-01-01",
        leaveTypes: [{ code: "CASUAL", name: "Casual", yearlyDays: 5, isActive: true }],
        attendanceRules: { officeStartTime: "10:00", officeEndTime: "19:00" },
      });
    assert.equal(resBUpdate.status, 200);
    assert.equal(resBUpdate.body.policy.attendanceRules.officeStartTime, "10:00");

    // Company A's policy remains 09:00
    const resACheck = await request(app)
      .get("/api/policies/active")
      .set("Cookie", hrCookieA);
    assert.equal(resACheck.status, 200);
    assert.equal(resACheck.body.policy.attendanceRules.officeStartTime, "09:00");

    // Company B HR cannot update Company A's policy ID
    const resCrossUpdate = await request(app)
      .put(`/api/policies/${activePolicyAId}`)
      .set("Cookie", hrCookieB)
      .send({
        effectiveFromDate: "2026-01-01",
        leaveTypes: [{ code: "CASUAL", name: "Casual", yearlyDays: 5, isActive: true }],
        attendanceRules: { officeStartTime: "11:00", officeEndTime: "20:00" },
      });
    assert.equal(resCrossUpdate.status, 404);
  });

  it("7. Safe leave-type deletion guard: cannot delete a leave type referenced by existing leave requests", async () => {
    const { LeaveRequest: LeaveRequestA } = await getCompanyModels(companyA);

    // Create an approved leave request referencing CASUAL
    await LeaveRequestA.create({
      employeeId: employeeRecordA._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-07-10"),
      toDate: new Date("2026-07-12"),
      daysCount: 3,
      reason: "Family trip",
      status: "APPROVED",
    });

    // Check utility endpoint
    const resCheckInUse = await request(app)
      .get("/api/policies/leave-types/CASUAL/in-use")
      .set("Cookie", hrCookieA);
    assert.equal(resCheckInUse.status, 200);
    assert.equal(resCheckInUse.body.inUse, true);
    assert.equal(resCheckInUse.body.count, 1);

    // Try to update policy removing CASUAL
    const resDeleteReferenced = await request(app)
      .put(`/api/policies/${activePolicyAId}`)
      .set("Cookie", hrCookieA)
      .send({
        effectiveFromDate: "2026-01-01",
        leaveTypes: [
          { code: "SICK", name: "Sick Leave", yearlyDays: 8, isActive: true },
          { code: "EARNED", name: "Earned Leave", yearlyDays: 15, isActive: true },
        ],
        attendanceRules: { officeStartTime: "09:00", officeEndTime: "18:00" },
      });

    assert.equal(resDeleteReferenced.status, 400);
    assert.match(resDeleteReferenced.body.message, /Cannot remove leave type 'CASUAL'/i);
    assert.match(resDeleteReferenced.body.message, /deactivate it/i);

    // Deactivating CASUAL instead of removing succeeds
    const resDeactivate = await request(app)
      .put(`/api/policies/${activePolicyAId}`)
      .set("Cookie", hrCookieA)
      .send({
        effectiveFromDate: "2026-01-01",
        leaveTypes: [
          { code: "CASUAL", name: "Casual Leave", yearlyDays: 10, isActive: false },
          { code: "SICK", name: "Sick Leave", yearlyDays: 8, isActive: true },
          { code: "EARNED", name: "Earned Leave", yearlyDays: 15, isActive: true },
          { code: "FLOATING", name: "Floating Holiday", yearlyDays: 2, isActive: true },
        ],
        attendanceRules: { officeStartTime: "09:00", officeEndTime: "18:00" },
      });

    assert.equal(resDeactivate.status, 200);
    const casualType = resDeactivate.body.policy.leaveTypes.find((t) => t.code === "CASUAL");
    assert.equal(casualType.isActive, false);

    // Removing unused FLOATING leave type (0 requests) succeeds
    const resRemoveUnused = await request(app)
      .put(`/api/policies/${activePolicyAId}`)
      .set("Cookie", hrCookieA)
      .send({
        effectiveFromDate: "2026-01-01",
        leaveTypes: [
          { code: "CASUAL", name: "Casual Leave", yearlyDays: 10, isActive: false },
          { code: "SICK", name: "Sick Leave", yearlyDays: 8, isActive: true },
          { code: "EARNED", name: "Earned Leave", yearlyDays: 15, isActive: true },
        ],
        attendanceRules: { officeStartTime: "09:00", officeEndTime: "18:00" },
      });
    assert.equal(resRemoveUnused.status, 200);
    assert.equal(resRemoveUnused.body.policy.leaveTypes.length, 3);
  });

  it("8. Effective dates select the correct revision (future-dated revision doesn't take effect prematurely)", async () => {
    // Schedule a future revision effective 2027-01-01 with officeStartTime 08:30
    const resCreateFuture = await request(app)
      .post("/api/policies")
      .set("Cookie", hrCookieA)
      .send({
        effectiveFromDate: "2027-01-01",
        leaveTypes: [
          { code: "CASUAL", name: "Casual Leave", yearlyDays: 12, isActive: true },
          { code: "SICK", name: "Sick Leave", yearlyDays: 10, isActive: true },
        ],
        attendanceRules: { officeStartTime: "08:30", officeEndTime: "17:30" },
        notes: "FY2027 Policy with 8:30 AM start",
      });

    assert.equal(resCreateFuture.status, 201);
    assert.equal(resCreateFuture.body.policy.attendanceRules.officeStartTime, "08:30");

    // As of today (2026), active policy must still return the 2026 revision (09:00 start time)
    const resCurrentActive = await request(app)
      .get("/api/policies/active")
      .set("Cookie", hrCookieA);

    assert.equal(resCurrentActive.status, 200);
    assert.equal(resCurrentActive.body.policy.attendanceRules.officeStartTime, "09:00");

    // Querying active policy as of 2027-02-01 returns the future revision (08:30)
    const res2027Active = await request(app)
      .get("/api/policies/active?asOfDate=2027-02-01")
      .set("Cookie", hrCookieA);

    assert.equal(res2027Active.status, 200);
    assert.equal(res2027Active.body.policy.attendanceRules.officeStartTime, "08:30");

    // History contains both revisions
    const resHistory = await request(app)
      .get("/api/policies/history")
      .set("Cookie", hrCookieA);

    assert.equal(resHistory.status, 200);
    assert.equal(resHistory.body.policies.length, 2);
  });

  it("9. Inactive leave types cannot be requested by employee, while active types can", async () => {
    // Employee tries to apply for CASUAL (which was deactivated in test 7)
    const resApplyInactive = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookieA)
      .send({
        leaveType: "CASUAL",
        startDate: "2026-11-10",
        endDate: "2026-11-12",
        reason: "Test inactive leave application",
      });

    assert.equal(resApplyInactive.status, 400);
    assert.match(resApplyInactive.body.message, /invalid or inactive leave type/i);

    // Employee applies for active SICK leave type
    const resApplyActive = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookieA)
      .send({
        leaveType: "SICK",
        startDate: "2026-11-17",
        endDate: "2026-11-18",
        reason: "Flu symptoms",
      });

    assert.equal(resApplyActive.status, 201);
    assert.equal(resApplyActive.body.success, true);
    assert.equal(resApplyActive.body.leaveRequest.leaveTypeCode, "SICK");
  });

  it("10. Validates and persists all expanded policy categories (workHours, payroll, location, tax, lifecycle, etc.)", async () => {
    const expandedPayload = {
      workHoursRules: {
        standardDailyHours: 8.5,
        standardWeeklyHours: 42.5,
        overtimeAllowed: true,
        overtimeThresholdDailyHours: 9,
        shiftName: "General Day Shift",
      },
      payrollRules: {
        currencySymbol: "$",
        currencyCode: "USD",
        payCycleStartDay: 5,
        salaryCalculationBasis: "ACTUAL_MONTH_DAYS",
        lateDeductionGraceCount: 2,
        halfDayDeductionRate: 50,
        areHolidaysPaid: true,
        deductLopForUnpaidLeave: true,
      },
      locationRules: {
        requireLocationForPunch: true,
        allowWebTracking: true,
        geofenceEnabled: true,
        geofenceRadiusMeters: 250,
        officeLatitude: 40.7128,
        officeLongitude: -74.006,
        officeAddress: "123 Broadway, NY",
      },
      taxStatutoryRules: {
        panRequiredForPayroll: true,
        pfApplicable: true,
        pfDeductionRatePercent: 12,
        esiApplicable: false,
        ptApplicable: true,
        disclaimer: "Official Acme payroll policy configuration.",
      },
      lifecycleRules: {
        probationDurationMonths: 3,
        confirmationReviewRequired: true,
        noticePeriodDays: 60,
        noticePeriodServingRequired: true,
        resignationApprovalLevels: 1,
      },
      recruitmentRules: {
        offerValidityDays: 14,
        requireCandidateSignature: true,
        autoExpireOffers: true,
      },
      documentRules: {
        mandatoryDocumentTypes: ["ID_PROOF", "ADDRESS_PROOF", "DEGREE_CERTIFICATE"],
        maxFileSizeMB: 15,
      },
      generalRules: {
        policyTitle: "Acme Global Enterprise Policy 2026",
        policyCode: "POL-ACME-2026",
        description: "Primary comprehensive organizational operating guidelines.",
        workFromHomeAllowed: true,
      },
    };

    const resUpdate = await request(app)
      .put(`/api/policies/${activePolicyAId}`)
      .set("Cookie", hrCookieA)
      .send(expandedPayload);

    assert.equal(resUpdate.status, 200);
    assert.equal(resUpdate.body.success, true);
    const p = resUpdate.body.policy;

    assert.equal(p.workHoursRules.standardDailyHours, 8.5);
    assert.equal(p.workHoursRules.shiftName, "General Day Shift");
    assert.equal(p.payrollRules.currencySymbol, "$");
    assert.equal(p.payrollRules.payCycleStartDay, 5);
    assert.equal(p.payrollRules.salaryCalculationBasis, "ACTUAL_MONTH_DAYS");
    assert.equal(p.locationRules.requireLocationForPunch, true);
    assert.equal(p.locationRules.geofenceRadiusMeters, 250);
    assert.equal(p.locationRules.officeAddress, "123 Broadway, NY");
    assert.equal(p.taxStatutoryRules.pfApplicable, true);
    assert.equal(p.taxStatutoryRules.pfDeductionRatePercent, 12);
    assert.equal(p.lifecycleRules.probationDurationMonths, 3);
    assert.equal(p.lifecycleRules.noticePeriodDays, 60);
    assert.equal(p.recruitmentRules.offerValidityDays, 14);
    assert.equal(p.documentRules.mandatoryDocumentTypes.length, 3);
    assert.equal(p.documentRules.maxFileSizeMB, 15);
    assert.equal(p.generalRules.policyCode, "POL-ACME-2026");

    // Fetch active policy to confirm DB round-trip persistence
    const resGetActive = await request(app)
      .get("/api/policies/active")
      .set("Cookie", hrCookieA);

    assert.equal(resGetActive.status, 200);
    const activeP = resGetActive.body.policy;
    assert.equal(activeP.payrollRules.currencySymbol, "$");
    assert.equal(activeP.locationRules.officeAddress, "123 Broadway, NY");
    assert.equal(activeP.generalRules.policyTitle, "Acme Global Enterprise Policy 2026");
  });
});

