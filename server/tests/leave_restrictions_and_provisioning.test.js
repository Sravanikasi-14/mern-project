import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { getCentralDbName, getCompanyModels, disconnectAll } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import {
  getCompanyCurrentDateTime,
  getLeaveDateRestrictions,
  parseTimeToMinutes,
  minutesToTimeString,
  validateLeaveDates,
} from "../services/leaveService.js";
import {
  provisionTenantDatabase,
  provisionAllTenantDatabases,
} from "../services/tenantProvisioningService.js";
import { leaveEvents, emitLeaveEvent } from "../services/leaveEventsService.js";

let mongod;
let app;
let companyAcme;
let companyGlobex;
let hrCookieAcme;
let employeeCookieAcme;
let employeeIdAcme;

function cookieFrom(res) {
  const cookieHeader = res.headers["set-cookie"];
  if (!cookieHeader) return "";
  return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
}

describe("HRMS Leave Management — Date Restrictions, Tenant Provisioning, and Live Sync", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "supersecretkey_test_leave_mgmt_123!";
    process.env.COOKIE_SECRET = "supersecretcookie_test_123!";
    process.env.CENTRAL_DB_NAME = "platform_test";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    // 1. Create Acme Company in central DB
    companyAcme = await Company.create({
      companyName: "Acme Corp",
      slug: "acme",
      databaseName: "tenant_acme_db",
      status: COMPANY_STATUSES.ACTIVE,
      config: {
        timezone: "Asia/Kolkata",
        currencyCode: "INR",
      },
    });

    // 2. Create Globex Company in central DB
    companyGlobex = await Company.create({
      companyName: "Globex Corporation",
      slug: "globex",
      databaseName: "tenant_globex_db",
      status: COMPANY_STATUSES.ACTIVE,
      config: {
        timezone: "Asia/Kolkata",
        currencyCode: "INR",
      },
    });

    // Setup Acme Users & Employee
    const { User: UserAcme, Employee: EmployeeAcme } = await getCompanyModels(companyAcme);

    await UserAcme.create({
      email: "hr@acme.test",
      passwordHash: await hashPassword("AcmeAdmin123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });

    const empUser = await UserAcme.create({
      email: "emp@acme.test",
      passwordHash: await hashPassword("Employee123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
    });

    const empDoc = await EmployeeAcme.create({
      userId: empUser._id,
      employeeCode: "ACM-001",
      email: "emp@acme.test",
      fullName: "Jane Doe",
      status: "ACTIVE",
      job: {
        jobTitle: "Software Engineer",
        department: "Engineering",
        joiningDate: new Date("2026-01-15"),
      },
      attendance: {
        totalWorkingDays: 20,
        daysPresent: 20,
        leaveBalance: { casual: 8, sick: 6, earned: 12 },
      },
    });
    employeeIdAcme = empDoc._id;

    // Login HR
    const loginHr = await request(app).post("/api/auth/login").send({
      companyCode: "acme",
      email: "hr@acme.test",
      password: "AcmeAdmin123!",
    });
    hrCookieAcme = cookieFrom(loginHr);

    // Login Employee
    const loginEmp = await request(app).post("/api/auth/login").send({
      companyCode: "acme",
      email: "emp@acme.test",
      password: "Employee123!",
    });
    employeeCookieAcme = cookieFrom(loginEmp);
  });

  after(async () => {
    await disconnectAll();
    if (mongod) await mongod.stop();
  });

  // =========================================================================
  // ISSUE 1: RESTRICT LEAVE APPLICATION DATES CORRECTLY
  // =========================================================================

  describe("Issue 1: Leave Application Date Restrictions & Cutoff Calculations", () => {
    it("1. Correctly calculates cutoff time as officeStartTime minus 60 minutes", () => {
      // 09:00 -> 08:00
      assert.equal(minutesToTimeString(parseTimeToMinutes("09:00") - 60), "08:00");
      // 09:30 -> 08:30
      assert.equal(minutesToTimeString(parseTimeToMinutes("09:30") - 60), "08:30");
      // 10:00 -> 09:00
      assert.equal(minutesToTimeString(parseTimeToMinutes("10:00") - 60), "09:00");
    });

    it("2. Allows today before cutoff time", () => {
      const policy = {
        attendanceRules: { officeStartTime: "09:30", officeEndTime: "18:30" },
      };
      // Simulate 08:15 Asia/Kolkata (before 08:30 cutoff)
      const mockNow = new Date("2026-10-18T02:45:00.000Z"); // 08:15 IST (+05:30)

      const restrictions = getLeaveDateRestrictions(policy, "Asia/Kolkata", mockNow);
      assert.equal(restrictions.isTodayEligible, true);
      assert.equal(restrictions.cutoffTime, "08:30");
      assert.equal(restrictions.earliestEligibleDate, restrictions.todayStr);

      // Validation succeeds for today
      const validated = validateLeaveDates(
        restrictions.todayStr,
        restrictions.todayStr,
        policy,
        "Asia/Kolkata",
        mockNow
      );
      assert.equal(validated.fromStr, restrictions.todayStr);
    });

    it("3. Rejects today exactly at cutoff time and afterward", () => {
      const policy = {
        attendanceRules: { officeStartTime: "09:30", officeEndTime: "18:30" },
      };
      // Exactly at 08:30 IST (+05:30) = 03:00 UTC
      const mockCutoff = new Date("2026-10-18T03:00:00.000Z");
      const restrictionsAtCutoff = getLeaveDateRestrictions(policy, "Asia/Kolkata", mockCutoff);
      assert.equal(restrictionsAtCutoff.isTodayEligible, false);
      assert.equal(restrictionsAtCutoff.earliestEligibleDate, restrictionsAtCutoff.tomorrowStr);

      assert.throws(
        () =>
          validateLeaveDates(
            restrictionsAtCutoff.todayStr,
            restrictionsAtCutoff.todayStr,
            policy,
            "Asia/Kolkata",
            mockCutoff
          ),
        /cutoff time for today was/i
      );

      // After cutoff: 11:30 IST (+05:30) = 06:00 UTC
      const mockAfter = new Date("2026-10-18T06:00:00.000Z");
      const restrictionsAfter = getLeaveDateRestrictions(policy, "Asia/Kolkata", mockAfter);
      assert.equal(restrictionsAfter.isTodayEligible, false);

      assert.throws(
        () =>
          validateLeaveDates(
            restrictionsAfter.todayStr,
            restrictionsAfter.todayStr,
            policy,
            "Asia/Kolkata",
            mockAfter
          ),
        /Same-day leave requests must be submitted at least 1 hour before/i
      );
    });

    it("4. Tomorrow and future dates remain accepted when otherwise valid", () => {
      const policy = {
        attendanceRules: { officeStartTime: "09:30", officeEndTime: "18:30" },
      };
      // After cutoff
      const mockAfter = new Date("2026-10-18T06:00:00.000Z");
      const restrictions = getLeaveDateRestrictions(policy, "Asia/Kolkata", mockAfter);

      // Tomorrow is accepted
      const validatedTomorrow = validateLeaveDates(
        restrictions.tomorrowStr,
        restrictions.tomorrowStr,
        policy,
        "Asia/Kolkata",
        mockAfter
      );
      assert.equal(validatedTomorrow.fromStr, restrictions.tomorrowStr);

      // Next month is accepted
      const validatedFuture = validateLeaveDates(
        "2026-11-20",
        "2026-11-22",
        policy,
        "Asia/Kolkata",
        mockAfter
      );
      assert.equal(validatedFuture.fromStr, "2026-11-20");
    });

    it("5. Past dates are rejected by the backend even if submitted directly", async () => {
      const res = await request(app)
        .post("/api/employees/me/leave-requests")
        .set("Cookie", employeeCookieAcme)
        .send({
          leaveType: "CASUAL",
          startDate: "2025-01-01",
          endDate: "2025-01-02",
          reason: "Bypassing frontend validation",
        });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /past dates/i);
    });

    it("6. Rejects start date after end date", async () => {
      const res = await request(app)
        .post("/api/employees/me/leave-requests")
        .set("Cookie", employeeCookieAcme)
        .send({
          leaveType: "CASUAL",
          startDate: "2026-11-25",
          endDate: "2026-11-20",
          reason: "Invalid range",
        });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Start date cannot be after end date/i);
    });

    it("7. Safely handles and reports missing or invalid officeStartTime or timezone without silently inventing a rule", () => {
      // Missing officeStartTime
      assert.throws(
        () => getLeaveDateRestrictions({}, "Asia/Kolkata"),
        /officeStartTime is not configured/i
      );

      // Invalid officeStartTime
      assert.throws(
        () => getLeaveDateRestrictions({ attendanceRules: { officeStartTime: "invalid" } }, "Asia/Kolkata"),
        /invalid \(expected HH:mm format\)/i
      );

      // Invalid timezone
      assert.throws(
        () => getLeaveDateRestrictions({ attendanceRules: { officeStartTime: "09:30" } }, "Invalid/Timezone"),
        /timezone 'Invalid\/Timezone' is invalid/i
      );
    });
  });

  // =========================================================================
  // ISSUE 2: TENANT DATABASE PROVISIONING
  // =========================================================================

  describe("Issue 2: Idempotent Tenant Database Provisioning & Schema Enforcement", () => {
    it("1. Provisions leave_requests and company_hr_policies for every existing company", async () => {
      const report = await provisionAllTenantDatabases();
      assert.ok(report.checked.length >= 2);
      assert.equal(report.errors.length, 0);

      const { connection: connGlobex } = await getCompanyModels(companyGlobex);
      const cols = await connGlobex.db.listCollections().toArray();
      const colNames = cols.map((c) => c.name);

      assert.ok(colNames.includes("leave_requests"));
      assert.ok(colNames.includes("company_hr_policies"));
    });

    it("2. Verifies required approved indexes exist on leave_requests and company_hr_policies", async () => {
      const { connection } = await getCompanyModels(companyAcme);

      const leaveIndexes = await connection.db.collection("leave_requests").indexes();
      const indexKeys = leaveIndexes.map((idx) => JSON.stringify(idx.key));

      // Approved compound indexes: (employeeId, status, fromDate) and (status, fromDate)
      assert.ok(
        indexKeys.some((k) => k.includes('"employeeId":1') && k.includes('"status":1') && k.includes('"fromDate":1'))
      );
      assert.ok(
        indexKeys.some((k) => k.includes('"status":1') && k.includes('"fromDate":1'))
      );

      // Policy index: { effectiveFromDate: -1 }
      const policyIndexes = await connection.db.collection("company_hr_policies").indexes();
      const polKeys = policyIndexes.map((idx) => JSON.stringify(idx.key));
      assert.ok(polKeys.some((k) => k.includes('"effectiveFromDate":-1')));
    });

    it("3. Provisions at least one valid policy document with attendanceRules", async () => {
      const { connection } = await getCompanyModels(companyGlobex);
      const policies = await connection.db.collection("company_hr_policies").find({}).toArray();

      assert.equal(policies.length, 1);
      assert.ok(policies[0].attendanceRules);
      assert.equal(policies[0].attendanceRules.officeStartTime, "09:30");
      assert.ok(Array.isArray(policies[0].leaveTypes));
      assert.ok(policies[0].leaveTypes.length >= 3);
    });

    it("4. Idempotent: Re-running provisioning does not create duplicate policies or damage existing data", async () => {
      const { connection } = await getCompanyModels(companyGlobex);
      const countBefore = await connection.db.collection("company_hr_policies").countDocuments();

      // Run provisioning again
      const report = await provisionAllTenantDatabases();
      assert.equal(report.errors.length, 0);

      const countAfter = await connection.db.collection("company_hr_policies").countDocuments();
      assert.equal(countBefore, countAfter);
    });

    it("5. Production safety: Central platform database is never treated as a tenant", async () => {
      const centralDbName = getCentralDbName();
      await assert.rejects(
        () => provisionTenantDatabase({ slug: "platform", databaseName: centralDbName }),
        /Production safety check failed/i
      );
    });
  });

  // =========================================================================
  // ISSUE 3: LIVE SYNCHRONIZATION & WORKFLOW
  // =========================================================================

  describe("Issue 3: Cross-Portal Synchronization and Leave Workflow", () => {
    it("1. SSE events endpoint is available and authenticates both roles", async () => {
      // Unauthenticated request is rejected
      const unauthRes = await request(app).get("/api/leave-requests/events?probe=1");
      assert.equal(unauthRes.status, 401);

      // Authenticated employee connects and receives text/event-stream
      const empRes = await request(app)
        .get("/api/leave-requests/events?probe=1")
        .set("Cookie", employeeCookieAcme);
      assert.equal(empRes.status, 200);
      assert.equal(empRes.headers["content-type"], "text/event-stream");
      assert.match(empRes.text, /"type":"CONNECTED"/);

      // Authenticated HR connects and receives text/event-stream
      const hrRes = await request(app)
        .get("/api/leave-requests/events?probe=1")
        .set("Cookie", hrCookieAcme);
      assert.equal(hrRes.status, 200);
      assert.equal(hrRes.headers["content-type"], "text/event-stream");
      assert.match(hrRes.text, /"type":"CONNECTED"/);
    });

    it("2. Submitting a leave request immediately emits LEAVE_SUBMITTED event and shows PENDING", async () => {
      let eventFired = false;
      let capturedEvent = null;

      const listener = (event) => {
        if (event.type === "LEAVE_SUBMITTED") {
          eventFired = true;
          capturedEvent = event;
        }
      };
      leaveEvents.on("leave_update", listener);

      const res = await request(app)
        .post("/api/employees/me/leave-requests")
        .set("Cookie", employeeCookieAcme)
        .send({
          leaveType: "CASUAL",
          startDate: "2026-11-17",
          endDate: "2026-11-18",
          reason: "Attending conference",
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.leaveRequest.status, "PENDING");
      assert.equal(eventFired, true);
      assert.equal(capturedEvent.leaveTypeCode, "CASUAL");

      leaveEvents.off("leave_update", listener);
    });

    it("3. Pending request does NOT deduct leave balance", async () => {
      const dashRes = await request(app)
        .get("/api/employees/me/dashboard")
        .set("Cookie", employeeCookieAcme);

      assert.equal(dashRes.status, 200);
      // Casual entitlement is 8, 0 approved leaves, balance remains 8
      assert.equal(dashRes.body.leave.balance.casual, 8);
      assert.ok(dashRes.body.leave.summary.pending >= 1);
    });

    it("4. HR decision emits LEAVE_DECIDED event and updates status without manual refresh", async () => {
      // Find pending request in HR queue
      const hrListRes = await request(app)
        .get("/api/leave-requests?status=PENDING")
        .set("Cookie", hrCookieAcme);

      assert.equal(hrListRes.status, 200);
      const pendingReq = hrListRes.body.leaveRequests[0];
      assert.ok(pendingReq);

      let decisionEventFired = false;
      const listener = (event) => {
        if (event.type === "LEAVE_DECIDED" && event.leaveRequestId === String(pendingReq._id)) {
          decisionEventFired = true;
        }
      };
      leaveEvents.on("leave_update", listener);

      // HR approves
      const approveRes = await request(app)
        .post(`/api/leave-requests/${pendingReq._id}/decision`)
        .set("Cookie", hrCookieAcme)
        .send({
          action: "APPROVE",
          remarks: "Approved. Enjoy your conference.",
        });

      assert.equal(approveRes.status, 200);
      assert.equal(approveRes.body.leaveRequest.status, "APPROVED");
      assert.equal(decisionEventFired, true);

      leaveEvents.off("leave_update", listener);

      // Employee dashboard now reflects deducted balance
      const updatedDash = await request(app)
        .get("/api/employees/me/dashboard")
        .set("Cookie", employeeCookieAcme);

      assert.equal(updatedDash.status, 200);
      assert.equal(updatedDash.body.leave.balance.casual, 6); // 8 - 2 days = 6
    });

    it("5. Rejects concurrent or duplicate decisions on already processed request", async () => {
      const hrListRes = await request(app)
        .get("/api/leave-requests?status=APPROVED")
        .set("Cookie", hrCookieAcme);

      const approvedReq = hrListRes.body.leaveRequests[0];
      assert.ok(approvedReq);

      // Attempt to reject an already approved request
      const duplicateRes = await request(app)
        .post(`/api/leave-requests/${approvedReq._id}/decision`)
        .set("Cookie", hrCookieAcme)
        .send({
          action: "REJECT",
          remarks: "Trying to change mind",
        });

      assert.equal(duplicateRes.status, 409);
      assert.match(duplicateRes.body.message, /already been processed/i);
    });
  });
});
