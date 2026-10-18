import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
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
let company;
let hrCookie;
let employeeCookie;
let employeeRecord;
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

  company = await Company.create({
    companyName: "Nexus Tech",
    slug: "nexus",
    databaseName: "company_nexus_leave_change_test",
    status: COMPANY_STATUSES.ACTIVE,
    config: {
      timezone: "Asia/Kolkata",
    },
  });

  models = await getCompanyModels(company);
  const { User, Employee, CompanyHrPolicy } = models;

  const hrUser = await User.create({
    email: "hr@nexus.test",
    passwordHash: await hashPassword("NexusPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const empUser = await User.create({
    email: "dev@nexus.test",
    passwordHash: await hashPassword("NexusPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  employeeRecord = await Employee.create({
    userId: empUser._id,
    employeeCode: "EMP-100",
    fullName: "John Doe",
    email: "dev@nexus.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Senior Developer",
      department: "Engineering",
      employmentType: "Full-time",
      workLocation: "Office",
      joiningDate: new Date("2024-01-15"),
    },
  });

  // Ensure HR policy exists with CASUAL, SICK, and EARNED
  await CompanyHrPolicy.create({
    effectiveFromDate: new Date("2026-01-01"),
    leaveTypes: [
      { code: "CASUAL", name: "Casual Leave", yearlyDays: 8, isActive: true },
      { code: "SICK", name: "Sick Leave", yearlyDays: 6, isActive: true },
      { code: "EARNED", name: "Earned Leave", yearlyDays: 12, isActive: true },
      { code: "SPECIAL", name: "Special Inactive Leave", yearlyDays: 5, isActive: false },
    ],
    attendanceRules: {
      officeStartTime: "09:30",
      officeEndTime: "18:30",
    },
  });

  // Log in HR
  const hrLogin = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "nexus", email: "hr@nexus.test", password: "NexusPass123!" });
  hrCookie = cookieFrom(hrLogin);

  // Log in Employee
  const empLogin = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "nexus", email: "dev@nexus.test", password: "NexusPass123!" });
  employeeCookie = cookieFrom(empLogin);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Leave Duplicate Prevention & HR Leave-Type Changes", () => {
  // Test 1: A new request overlapping an approved request is rejected
  it("1. should reject a new request that overlaps an existing APPROVED request", async () => {
    const { LeaveRequest } = models;
    // Create an approved leave for Nov 10 - Nov 12
    const approvedLeave = await LeaveRequest.create({
      employeeId: employeeRecord._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-11-10"),
      toDate: new Date("2026-11-12"),
      daysCount: 3,
      reason: "Family gathering",
      status: "APPROVED",
      decision: { decidedAt: new Date(), remarks: "Approved" },
    });
    assert.ok(approvedLeave._id);

    // Try applying for Nov 11 (within the approved range) as SICK leave
    const res = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookie)
      .send({
        leaveType: "SICK",
        startDate: "2026-11-11",
        endDate: "2026-11-11",
        reason: "Fever",
      });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Date conflict/i);
    assert.match(res.body.message, /APPROVED/i);
    assert.match(res.body.message, /2026-11-11/);
  });

  // Test 2: A new request overlapping a pending request is rejected
  it("2. should reject a new request that overlaps an existing PENDING request", async () => {
    const { LeaveRequest } = models;
    // Create a pending leave for Nov 20 - Nov 22
    await LeaveRequest.create({
      employeeId: employeeRecord._id,
      leaveTypeCode: "SICK",
      fromDate: new Date("2026-11-20"),
      toDate: new Date("2026-11-22"),
      daysCount: 1, // weekend excluded or similar
      reason: "Medical checkup",
      status: "PENDING",
    });

    // Try applying for Nov 22 as CASUAL
    const res = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookie)
      .send({
        leaveType: "CASUAL",
        startDate: "2026-11-22",
        endDate: "2026-11-23",
        reason: "Personal work",
      });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Date conflict/i);
    assert.match(res.body.message, /PENDING/i);
    assert.match(res.body.message, /2026-11-22/);
  });

  // Test 3: A rejected request no longer blocks those dates
  it("3. should allow an employee to apply for dates of a previously REJECTED request", async () => {
    const { LeaveRequest } = models;
    // Create a rejected leave for Dec 01 - Dec 02
    await LeaveRequest.create({
      employeeId: employeeRecord._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-12-01"),
      toDate: new Date("2026-12-02"),
      daysCount: 2,
      reason: "Trip",
      status: "REJECTED",
      decision: { decidedAt: new Date(), remarks: "Too busy" },
    });

    // Employee applies for Dec 01 - Dec 02
    const res = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookie)
      .send({
        leaveType: "CASUAL",
        startDate: "2026-12-01",
        endDate: "2026-12-02",
        reason: "Resubmitted with urgent note",
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.leaveRequest.status, "PENDING");
  });

  // Test 4: Partial and full-range overlaps are detected
  it("4. should detect full containment and partial boundary overlaps", async () => {
    const { LeaveRequest } = models;
    // Suppose existing leave is Dec 15 - Dec 18 (PENDING)
    await LeaveRequest.create({
      employeeId: employeeRecord._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-12-15"),
      toDate: new Date("2026-12-18"),
      daysCount: 4,
      reason: "Vacation",
      status: "PENDING",
    });

    // Case A: Full containment - requested range Dec 14 - Dec 20 encloses Dec 15 - Dec 18
    const resEnclosing = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookie)
      .send({
        leaveType: "CASUAL",
        startDate: "2026-12-14",
        endDate: "2026-12-20",
        reason: "Enclosing range test",
      });
    assert.equal(resEnclosing.status, 400);
    assert.match(resEnclosing.body.message, /2026-12-15 to 2026-12-18/);

    // Case B: Partial overlap at start (Dec 13 - Dec 16)
    const resStartOverlap = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookie)
      .send({
        leaveType: "CASUAL",
        startDate: "2026-12-13",
        endDate: "2026-12-16",
        reason: "Start overlap test",
      });
    assert.equal(resStartOverlap.status, 400);
    assert.match(resStartOverlap.body.message, /2026-12-15 to 2026-12-16/);

    // Case C: Partial overlap at end (Dec 17 - Dec 21)
    const resEndOverlap = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookie)
      .send({
        leaveType: "CASUAL",
        startDate: "2026-12-17",
        endDate: "2026-12-21",
        reason: "End overlap test",
      });
    assert.equal(resEndOverlap.status, 400);
    assert.match(resEndOverlap.body.message, /2026-12-17 to 2026-12-18/);
  });

  // Test 5: Concurrent overlapping submissions cannot both succeed
  it("5. should safely reject concurrent overlapping submissions from the same employee", async () => {
    const dates = {
      startDate: "2026-12-28",
      endDate: "2026-12-29",
      reason: "Concurrent test",
    };

    // Fire two identical or overlapping requests simultaneously
    const [sub1, sub2] = await Promise.all([
      request(app)
        .post("/api/employees/me/leave-requests")
        .set("Cookie", employeeCookie)
        .send({ leaveType: "CASUAL", ...dates }),
      request(app)
        .post("/api/employees/me/leave-requests")
        .set("Cookie", employeeCookie)
        .send({ leaveType: "SICK", ...dates }),
    ]);

    const statuses = [sub1.status, sub2.status].sort();
    // Exactly one must succeed (201) and one must be rejected (400)
    assert.deepEqual(statuses, [201, 400]);
  });

  // Test 6: HR can change the leave type of an approved request
  it("6. should allow HR to change the leave type of an APPROVED request and recalculate balances", async () => {
    const { LeaveRequest, AuditLog } = models;
    const approved = await LeaveRequest.create({
      employeeId: employeeRecord._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-11-02"),
      toDate: new Date("2026-11-04"),
      daysCount: 3,
      reason: "Personal matter",
      status: "APPROVED",
      decision: { decidedAt: new Date(), remarks: "Initial approval" },
    });

    const res = await request(app)
      .patch(`/api/leave-requests/${approved._id}/leave-type`)
      .set("Cookie", hrCookie)
      .send({
        newLeaveType: "SICK",
        reason: "Employee submitted medical certificate; converting to Sick leave",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.leaveRequest.leaveTypeCode, "SICK");
    assert.equal(res.body.leaveRequest.status, "APPROVED");

    // Verify database document was updated in-place
    const updated = await LeaveRequest.findById(approved._id);
    assert.equal(updated.leaveTypeCode, "SICK");
    assert.equal(updated.status, "APPROVED");
    assert.equal(String(updated.employeeId), String(employeeRecord._id));

    // Verify audit log recorded with existing convention
    const audit = await AuditLog.findOne({
      action: AUDIT_ACTIONS.LEAVE_TYPE_CHANGED,
      targetId: approved._id,
    });
    assert.ok(audit, "Audit log entry should exist for LEAVE_TYPE_CHANGED");
    assert.equal(audit.changes.oldLeaveType, "CASUAL");
    assert.equal(audit.changes.newLeaveType, "SICK");
    assert.match(audit.changes.reason, /medical certificate/i);
  });

  // Test 7: Employees cannot change approved leave types (403)
  it("7. should forbid employees from calling the change leave type API directly", async () => {
    const { LeaveRequest } = models;
    const approved = await LeaveRequest.create({
      employeeId: employeeRecord._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-11-05"),
      toDate: new Date("2026-11-06"),
      daysCount: 2,
      reason: "Rest",
      status: "APPROVED",
    });

    const res = await request(app)
      .patch(`/api/leave-requests/${approved._id}/leave-type`)
      .set("Cookie", employeeCookie)
      .send({
        newLeaveType: "EARNED",
        reason: "Unauthorized attempt",
      });

    assert.equal(res.status, 403);
  });

  // Test 8: Invalid or inactive leave types are rejected
  it("8. should reject invalid or inactive leave types when HR attempts to change type", async () => {
    const { LeaveRequest } = models;
    const approved = await LeaveRequest.create({
      employeeId: employeeRecord._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-11-16"),
      toDate: new Date("2026-11-17"),
      daysCount: 2,
      status: "APPROVED",
    });

    // Non-existent leave type
    const resFake = await request(app)
      .patch(`/api/leave-requests/${approved._id}/leave-type`)
      .set("Cookie", hrCookie)
      .send({
        newLeaveType: "NONEXISTENT",
        reason: "Testing fake type",
      });
    assert.equal(resFake.status, 400);
    assert.match(resFake.body.message, /invalid or inactive/i);

    // Inactive leave type ("SPECIAL" was created with isActive: false)
    const resInactive = await request(app)
      .patch(`/api/leave-requests/${approved._id}/leave-type`)
      .set("Cookie", hrCookie)
      .send({
        newLeaveType: "SPECIAL",
        reason: "Testing inactive type",
      });
    assert.equal(resInactive.status, 400);
    assert.match(resInactive.body.message, /invalid or inactive/i);

    // Same leave type as current
    const resSame = await request(app)
      .patch(`/api/leave-requests/${approved._id}/leave-type`)
      .set("Cookie", hrCookie)
      .send({
        newLeaveType: "CASUAL",
        reason: "Testing same type",
      });
    assert.equal(resSame.status, 400);
    assert.match(resSame.body.message, /already assigned to 'CASUAL'/i);

    // Missing reason explanation
    const resNoReason = await request(app)
      .patch(`/api/leave-requests/${approved._id}/leave-type`)
      .set("Cookie", hrCookie)
      .send({
        newLeaveType: "SICK",
        reason: "   ",
      });
    assert.equal(resNoReason.status, 400);
    assert.match(resNoReason.body.message, /explanation.*required/i);
  });

  // Test 9: Existing dates, status, and employee association remain unchanged during a type change
  it("9. should preserve employeeId, fromDate, toDate, and status during leave-type change", async () => {
    const { LeaveRequest } = models;
    const fromDate = new Date("2026-11-24");
    const toDate = new Date("2026-11-26");

    const approved = await LeaveRequest.create({
      employeeId: employeeRecord._id,
      leaveTypeCode: "CASUAL",
      fromDate,
      toDate,
      daysCount: 3,
      reason: "Holiday plan",
      status: "APPROVED",
      decision: { decidedAt: new Date("2026-10-15"), remarks: "Approved by HR" },
    });

    const res = await request(app)
      .patch(`/api/leave-requests/${approved._id}/leave-type`)
      .set("Cookie", hrCookie)
      .send({
        newLeaveType: "EARNED",
        reason: "Converting Casual to Earned leave per policy adjustment",
      });

    assert.equal(res.status, 200);

    const reloaded = await LeaveRequest.findById(approved._id);
    assert.equal(String(reloaded.employeeId), String(employeeRecord._id));
    assert.equal(reloaded.fromDate.toISOString(), fromDate.toISOString());
    assert.equal(reloaded.toDate.toISOString(), toDate.toISOString());
    assert.equal(reloaded.status, "APPROVED");
    assert.equal(reloaded.leaveTypeCode, "EARNED");
    assert.ok(reloaded.updatedAt >= approved.createdAt);
  });

  // Test 10: Cannot change leave type of a PENDING or REJECTED request
  it("10. should reject changing leave type if request is not APPROVED", async () => {
    const { LeaveRequest } = models;
    const pending = await LeaveRequest.create({
      employeeId: employeeRecord._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-12-08"),
      toDate: new Date("2026-12-09"),
      daysCount: 2,
      status: "PENDING",
    });

    const resPending = await request(app)
      .patch(`/api/leave-requests/${pending._id}/leave-type`)
      .set("Cookie", hrCookie)
      .send({
        newLeaveType: "SICK",
        reason: "Cannot change pending",
      });
    assert.equal(resPending.status, 400);
    assert.match(resPending.body.message, /only be changed for APPROVED requests/i);

    const rejected = await LeaveRequest.create({
      employeeId: employeeRecord._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-12-10"),
      toDate: new Date("2026-12-11"),
      daysCount: 2,
      status: "REJECTED",
    });

    const resRejected = await request(app)
      .patch(`/api/leave-requests/${rejected._id}/leave-type`)
      .set("Cookie", hrCookie)
      .send({
        newLeaveType: "SICK",
        reason: "Cannot change rejected",
      });
    assert.equal(resRejected.status, 400);
    assert.match(resRejected.body.message, /only be changed for APPROVED requests/i);
  });

  // Test 11: getLeaveRequestById returns availableLeaveTypes and recalculates balances
  it("11. should return availableLeaveTypes and recalculated balances in getLeaveRequestById", async () => {
    const { LeaveRequest } = models;
    const approved = await LeaveRequest.create({
      employeeId: employeeRecord._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-11-18"),
      toDate: new Date("2026-11-19"),
      daysCount: 2,
      status: "APPROVED",
    });

    const res = await request(app)
      .get(`/api/leave-requests/${approved._id}`)
      .set("Cookie", hrCookie);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.availableLeaveTypes));
    const codes = res.body.availableLeaveTypes.map((t) => t.code);
    assert.ok(codes.includes("CASUAL"));
    assert.ok(codes.includes("SICK"));
    assert.ok(codes.includes("EARNED"));
    assert.ok(!codes.includes("SPECIAL"), "Inactive types should be excluded from availableLeaveTypes");
    assert.ok(res.body.leaveBalance);
  });

  // Test 12: Employee dashboard returns scheduledRanges for client-side date conflict checking
  it("12. should return scheduledRanges in employee dashboard for client-side conflict checking", async () => {
    const res = await request(app)
      .get("/api/employees/me/dashboard")
      .set("Cookie", employeeCookie);

    assert.equal(res.status, 200);
    assert.ok(res.body.leave);
    assert.ok(Array.isArray(res.body.leave.scheduledRanges));
    // Verify each scheduledRange has startDate, endDate, status, and leaveType
    if (res.body.leave.scheduledRanges.length > 0) {
      const first = res.body.leave.scheduledRanges[0];
      assert.ok(first.startDate);
      assert.ok(first.endDate);
      assert.ok(first.status);
      assert.ok(first.leaveType);
    }
  });
});
