import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { LEAVE_STATUSES } from "../models/LeaveRequest.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "../models/Task.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { classifyTasksForLeave, PLANNING_CATEGORIES } from "../services/leaveImpactAnalysisService.js";

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
let employeeA;
let peerA;
let hrUserA;
let modelsA;

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
    companyName: "Impact Co",
    slug: "impactco",
    databaseName: "company_impact_a",
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata" },
  });
  companyB = await Company.create({
    companyName: "Other Co",
    slug: "otherco",
    databaseName: "company_impact_b",
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata" },
  });

  modelsA = await getCompanyModels(companyA);
  const modelsB = await getCompanyModels(companyB);

  hrUserA = await modelsA.User.create({
    email: "hr@impactco.test",
    passwordHash: await hashPassword("HrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  await modelsB.User.create({
    email: "hr@otherco.test",
    passwordHash: await hashPassword("HrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  peerA = await modelsA.Employee.create({
    fullName: "Peer Member",
    employeeCode: "IMP-002",
    email: "peer@impactco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Platform" },
  });

  employeeA = await modelsA.Employee.create({
    fullName: "Leave Taker",
    employeeCode: "IMP-001",
    email: "leaver@impactco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Senior Engineer",
      department: "Platform",
      reportingManagerId: peerA._id,
    },
  });

  const loginA = await request(app).post("/api/auth/login").send({
    companyCode: "impactco",
    email: "hr@impactco.test",
    password: "HrPass123!",
  });
  hrCookieA = cookieFrom(loginA);

  const loginB = await request(app).post("/api/auth/login").send({
    companyCode: "otherco",
    email: "hr@otherco.test",
    password: "HrPass123!",
  });
  hrCookieB = cookieFrom(loginB);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

async function createLeave({ fromDate, toDate, status = LEAVE_STATUSES.PENDING, employeeId = employeeA._id }) {
  return modelsA.LeaveRequest.create({
    employeeId,
    leaveTypeCode: "CASUAL",
    fromDate: new Date(`${fromDate}T00:00:00.000Z`),
    toDate: new Date(`${toDate}T00:00:00.000Z`),
    daysCount: 3,
    reason: "Personal time",
    status,
  });
}

describe("classifyTasksForLeave unit rules", () => {
  it("does not flag completed tasks; classifies during/after/overdue correctly", () => {
    const result = classifyTasksForLeave(
      [
        {
          _id: "1",
          title: "Done",
          status: TASK_STATUSES.APPROVED,
          priority: TASK_PRIORITIES.HIGH,
          deadline: "2026-06-12",
        },
        {
          _id: "2",
          title: "Due during",
          status: TASK_STATUSES.IN_PROGRESS,
          priority: TASK_PRIORITIES.MEDIUM,
          deadline: "2026-06-12",
        },
        {
          _id: "3",
          title: "Critical during",
          status: TASK_STATUSES.ASSIGNED,
          priority: TASK_PRIORITIES.CRITICAL,
          deadline: "2026-06-13",
        },
        {
          _id: "4",
          title: "Overdue",
          status: TASK_STATUSES.ASSIGNED,
          priority: TASK_PRIORITIES.LOW,
          deadline: "2026-06-01",
        },
        {
          _id: "5",
          title: "Soon after return",
          status: TASK_STATUSES.ASSIGNED,
          priority: TASK_PRIORITIES.MEDIUM,
          deadline: "2026-06-18",
        },
        {
          _id: "6",
          title: "Far later",
          status: TASK_STATUSES.ASSIGNED,
          priority: TASK_PRIORITIES.LOW,
          deadline: "2026-08-01",
        },
      ],
      "2026-06-10",
      "2026-06-14"
    );

    assert.equal(result.alreadyCompleted.length, 1);
    assert.ok(result.requiresCoverageDuringLeave.some((t) => t._id === "2"));
    assert.ok(result.requiresCoverageDuringLeave.some((t) => t._id === "3"));
    assert.ok(result.requiresAttentionBeforeLeave.some((t) => t._id === "3"));
    assert.ok(result.overdueOpen.some((t) => t._id === "4"));
    assert.ok(result.upcomingDependencies.some((t) => t._id === "5"));
    assert.ok(result.canWaitUntilReturn.some((t) => t._id === "6"));
  });

  it("records missing deadline information without assuming zero impact", () => {
    const result = classifyTasksForLeave(
      [{ _id: "x", title: "No deadline", status: TASK_STATUSES.ASSIGNED, priority: TASK_PRIORITIES.HIGH, deadline: null }],
      "2026-06-10",
      "2026-06-14"
    );
    assert.equal(result.requiresCoverageDuringLeave.length, 0);
    assert.ok(result.missingInformation.some((m) => m.code === "TASK_DEADLINE_MISSING"));
  });
});

describe("Leave impact analysis API", () => {
  it("1. Employee with no assigned tasks — neutral planning category", async () => {
    const leave = await createLeave({ fromDate: "2026-07-06", toDate: "2026-07-08" });
    const res = await request(app)
      .get(`/api/leave-requests/${leave._id}/impact`)
      .set("Cookie", hrCookieA);
    assert.equal(res.status, 200);
    assert.equal(res.body.impact.planningCategory.code, PLANNING_CATEGORIES.NONE);
    assert.equal(res.body.impact.responsibilities.totalRelevantTasks, 0);
    assert.equal(res.body.impact.doesNot.autoReject, true);
    assert.equal(res.body.impact.doesNot.blockApproval, true);
  });

  it("2–6. Tasks due during leave, critical, overdue, after return, completed", async () => {
    const base = {
      description: "Impact analysis fixture task",
      assigneeId: employeeA._id,
      assignedByUserId: hrUserA._id,
    };
    await modelsA.Task.create([
      {
        ...base,
        title: "Ship during leave",
        priority: TASK_PRIORITIES.MEDIUM,
        status: TASK_STATUSES.IN_PROGRESS,
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        deadline: new Date("2026-08-12T00:00:00.000Z"),
      },
      {
        ...base,
        title: "Critical cutover",
        priority: TASK_PRIORITIES.CRITICAL,
        status: TASK_STATUSES.ASSIGNED,
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        deadline: new Date("2026-08-13T00:00:00.000Z"),
      },
      {
        ...base,
        title: "Overdue doc",
        priority: TASK_PRIORITIES.HIGH,
        status: TASK_STATUSES.ASSIGNED,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        deadline: new Date("2026-08-01T00:00:00.000Z"),
      },
      {
        ...base,
        title: "Follow-up after return",
        priority: TASK_PRIORITIES.MEDIUM,
        status: TASK_STATUSES.ASSIGNED,
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        deadline: new Date("2026-08-18T00:00:00.000Z"),
      },
      {
        ...base,
        title: "Already done",
        priority: TASK_PRIORITIES.HIGH,
        status: TASK_STATUSES.APPROVED,
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        deadline: new Date("2026-08-12T00:00:00.000Z"),
        completedAt: new Date("2026-08-05T00:00:00.000Z"),
      },
    ]);

    const leave = await createLeave({ fromDate: "2026-08-10", toDate: "2026-08-14" });
    const res = await request(app)
      .get(`/api/leave-requests/${leave._id}/impact`)
      .set("Cookie", hrCookieA);
    assert.equal(res.status, 200);
    const impact = res.body.impact;
    assert.ok(impact.responsibilities.requiresCoverageDuringLeave.length >= 2);
    assert.ok(impact.responsibilities.overdueOpen.length >= 1);
    assert.ok(impact.responsibilities.upcomingDependencies.length >= 1);
    assert.ok(impact.responsibilities.alreadyCompleted.some((t) => t.title === "Already done"));
    assert.equal(impact.planningCategory.code, PLANNING_CATEGORIES.CRITICAL);
    assert.match(impact.planningCategory.guidance, /reporting manager|coverage/i);
    assert.doesNotMatch(JSON.stringify(impact), /reject to avoid|high risk|leave is not recommended/i);
  });

  it("7–8. Overlapping approved vs pending leave distinguished; requestor excluded", async () => {
    await createLeave({
      fromDate: "2026-09-10",
      toDate: "2026-09-12",
      status: LEAVE_STATUSES.APPROVED,
      employeeId: peerA._id,
    });
    await createLeave({
      fromDate: "2026-09-11",
      toDate: "2026-09-12",
      status: LEAVE_STATUSES.PENDING,
      employeeId: peerA._id,
    });
    const leave = await createLeave({ fromDate: "2026-09-10", toDate: "2026-09-12" });

    const res = await request(app)
      .get(`/api/leave-requests/${leave._id}/impact`)
      .set("Cookie", hrCookieA);
    assert.equal(res.status, 200);
    const team = res.body.impact.teamAvailability;
    assert.equal(team.employeesOnApprovedLeave.length, 1);
    assert.equal(team.pendingOverlappingLeaveRequests.length, 1);
    assert.ok(!JSON.stringify(team).includes("Personal time")); // no peer reasons leaked from this request's reason path on peers — peers have reason but API omits reason field
    assert.equal(team.pendingOverlappingLeaveRequests[0].reason, undefined);
    assert.ok(team.employeesAvailableDuringPeriod <= team.totalDepartmentEmployees - 1);
  });

  it("9–10. Leave spanning weekend/holiday and multi-month window still returns working days", async () => {
    // Ensure policy exists with weekend offs
    const policy = await modelsA.CompanyHrPolicy.create({
      effectiveFromDate: new Date("2026-01-01"),
      weekendRules: { saturdayOff: true, sundayOff: true },
      holidays: [{ name: "Festival", date: new Date("2026-10-02T00:00:00.000Z"), type: "PUBLIC", isPaid: true }],
      leaveTypes: [
        { code: "CASUAL", name: "Casual", yearlyDays: 12, isPaid: true, isActive: true },
      ],
    });
    assert.ok(policy);

    const leave = await createLeave({ fromDate: "2026-10-01", toDate: "2026-11-05" });
    const res = await request(app)
      .get(`/api/leave-requests/${leave._id}/impact`)
      .set("Cookie", hrCookieA);
    assert.equal(res.status, 200);
    assert.ok(res.body.impact.leaveWindow.workingDays > 0);
    assert.ok(res.body.impact.leaveWindow.workingDays < res.body.impact.leaveWindow.calendarDays);
    assert.ok(res.body.impact.teamAvailability.holidaysInPeriod.some((h) => h.date === "2026-10-02"));
  });

  it("12. Missing manager/department surfaced in missingInformation", async () => {
    const orphan = await modelsA.Employee.create({
      fullName: "No Dept",
      employeeCode: "IMP-009",
      email: "nodept@impactco.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "Contractor" },
    });
    const leave = await createLeave({
      fromDate: "2026-12-01",
      toDate: "2026-12-02",
      employeeId: orphan._id,
    });
    const res = await request(app)
      .get(`/api/leave-requests/${leave._id}/impact`)
      .set("Cookie", hrCookieA);
    assert.equal(res.status, 200);
    const codes = res.body.impact.missingInformation.map((m) => m.code);
    assert.ok(codes.includes("DEPARTMENT_MISSING"));
    assert.ok(codes.includes("REPORTING_MANAGER_MISSING"));
  });

  it("13. Cross-company isolation", async () => {
    const leave = await createLeave({ fromDate: "2026-12-10", toDate: "2026-12-11" });
    const res = await request(app)
      .get(`/api/leave-requests/${leave._id}/impact`)
      .set("Cookie", hrCookieB);
    assert.equal(res.status, 404);
  });

  it("14–17. Eligibility unchanged shape; HR can still approve when coverage needed", async () => {
    const leave = await createLeave({ fromDate: "2027-01-11", toDate: "2027-01-13" });
    const impactRes = await request(app)
      .get(`/api/leave-requests/${leave._id}/impact`)
      .set("Cookie", hrCookieA);
    assert.equal(impactRes.status, 200);
    assert.ok(impactRes.body.impact.eligibility.leaveBalance);
    assert.ok(Array.isArray(impactRes.body.impact.eligibility.leaveBalance.detailed));

    const decide = await request(app)
      .post(`/api/leave-requests/${leave._id}/decision`)
      .set("Cookie", hrCookieA)
      .send({ action: "APPROVE", remarks: "Approved with coverage plan offline" });
    assert.equal(decide.status, 200);
    assert.equal(decide.body.leaveRequest.status, LEAVE_STATUSES.APPROVED);
  });
});
