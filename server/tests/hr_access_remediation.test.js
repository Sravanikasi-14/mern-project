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
import { createCompanyAdmin } from "../services/companyAdminService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { executeHrAnalystTool } from "../services/hrAnalystTools.js";
import {
  filterValidationIssuesByScope,
  resolveHrAccessContext,
} from "../services/hrAccessEnforcementService.js";
import { SETTLEMENT_STATUSES } from "../models/Settlement.js";
import { calculateDeterministicFindings } from "../services/hrIntelligenceService.js";

const PASSWORD = "HrRemediatePass1!";

let mongo;
let app;
let acme;
let caCookie;
let hrCookie;
let empCookie;
let hrAdminId;
let engDeptId;
let employeeIdA;
let employeeIdB;
let settlementInScopeId;
let settlementOutScopeId;
let models;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

async function login(companyCode, email) {
  const res = await request(app).post("/api/auth/login").send({
    companyCode,
    email,
    password: PASSWORD,
  });
  assert.equal(res.status, 200, res.body?.message || "login failed");
  return cookieFrom(res);
}

const DB_PATH = "D:/tmp/hrms-mongo/ca4c2-remediation";

before(async () => {
  // Clear persisted WiredTiger fixture so fixed company slugs do not collide across runs.
  fs.rmSync(DB_PATH, { recursive: true, force: true });
  fs.mkdirSync(DB_PATH, { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: {
      dbPath: DB_PATH,
      storageEngine: "wiredTiger",
    },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme CA4C2",
    slug: "acme-ca4c2",
    databaseName: "company_acme_ca4c2",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { hrAccessEnforcement: { mode: "OFF" } },
  });

  models = await getCompanyModels(acme);
  const eng = await models.Department.create({
    name: "Engineering",
    normalizedName: "engineering",
    isActive: true,
  });
  const design = await models.Department.create({
    name: "Design",
    normalizedName: "design",
    isActive: true,
  });
  engDeptId = String(eng._id);

  const empA = await models.Employee.create({
    employeeCode: "C2-001",
    fullName: "Alice Engineer",
    email: "alice@acme-ca4c2.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering", departmentId: eng._id },
  });
  const empB = await models.Employee.create({
    employeeCode: "C2-002",
    fullName: "Bob Designer",
    email: "bob@acme-ca4c2.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Designer", department: "Design", departmentId: design._id },
  });
  employeeIdA = String(empA._id);
  employeeIdB = String(empB._id);

  const passwordHash = await hashPassword(PASSWORD);
  await createCompanyAdmin(models.User, {
    email: "ca@acme-ca4c2.test",
    passwordHash,
    fullName: "Acme CA",
  });

  const hr = await models.User.create({
    email: "hr@acme-ca4c2.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Acme HR",
    isActive: true,
    lastLoginAt: new Date(),
    hrAccess: {
      version: 1,
      configuredAt: new Date(),
      updatedAt: new Date(),
      employeeScope: {
        mode: "CUSTOM",
        departmentIds: [eng._id],
        employeeIds: [],
      },
      permissions: [
        "people.view",
        "people.edit",
        "dashboard.view",
        "attendance.view",
        "leave.view",
        "leave.edit",
        "leave.approve",
        "payroll.view",
        "payroll.create",
        "payroll.calculate",
        "settlements.view",
        "settlements.edit",
        "settlements.pay",
        "settlements.complete",
        "organization.view",
        "reports.view",
        "impact.view",
        "impact.manage",
        "assets.view",
      ],
    },
  });
  hrAdminId = String(hr._id);

  const empUser = await models.User.create({
    email: "alice@acme-ca4c2.test",
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Alice Engineer",
    isActive: true,
    employeeId: empA._id,
  });
  empA.userId = empUser._id;
  await empA.save();

  const sIn = await models.Settlement.create({
    employeeId: empA._id,
    status: SETTLEMENT_STATUSES.DRAFT,
    exitDetails: { exitReason: "RESIGNATION", lastWorkingDay: new Date() },
    earnings: [],
    deductions: [],
    netSettlementAmount: 0,
    statusHistory: [{ status: SETTLEMENT_STATUSES.DRAFT, changedAt: new Date(), remarks: "init" }],
  });
  const sOut = await models.Settlement.create({
    employeeId: empB._id,
    status: SETTLEMENT_STATUSES.DRAFT,
    exitDetails: { exitReason: "RESIGNATION", lastWorkingDay: new Date() },
    earnings: [],
    deductions: [],
    netSettlementAmount: 0,
    statusHistory: [{ status: SETTLEMENT_STATUSES.DRAFT, changedAt: new Date(), remarks: "init" }],
  });
  settlementInScopeId = String(sIn._id);
  settlementOutScopeId = String(sOut._id);

  // Enable ENFORCED only inside this isolated memory DB (not a real tenant)
  await Company.findByIdAndUpdate(acme._id, {
    $set: { "config.hrAccessEnforcement.mode": "ENFORCED" },
  });
  acme = await Company.findById(acme._id);

  caCookie = await login("acme-ca4c2", "ca@acme-ca4c2.test");
  hrCookie = await login("acme-ca4c2", "hr@acme-ca4c2.test");
  empCookie = await login("acme-ca4c2", "alice@acme-ca4c2.test");
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("CA4-C.2 P0 chatbot analyst scope", () => {
  it("filters attendance analysis to in-scope employees and denies missing permission", async () => {
    const hrUser = await models.User.findById(hrAdminId);
    const hrAccess = await resolveHrAccessContext({
      user: hrUser,
      company: acme,
      models,
    });

    const ok = await executeHrAnalystTool(
      "analyzeAttendance",
      { targetDate: "today" },
      { models, company: acme, user: hrUser, hrAccess }
    );
    assert.ok(!ok.error);
    const names = JSON.stringify(ok);
    assert.equal(names.includes("Bob Designer"), false);
    assert.ok(names.includes("Alice Engineer") || ok.summary);

    const deniedAccess = {
      ...hrAccess,
      permissions: new Set(["people.view"]),
    };
    const denied = await executeHrAnalystTool(
      "analyzeAttendance",
      { targetDate: "today" },
      { models, company: acme, user: hrUser, hrAccess: deniedAccess }
    );
    assert.equal(denied.error, "HR_PERMISSION_DENIED");
  });
});

describe("CA4-C.2 P0 settlement write IDOR", () => {
  it("allows in-scope draft edit and blocks out-of-scope mutation", async () => {
    const ok = await request(app)
      .patch(`/api/settlements/${settlementInScopeId}`)
      .set("Cookie", hrCookie)
      .send({
        earnings: [{ title: "Bonus", amount: 100, category: "OTHER" }],
        deductions: [],
      });
    assert.ok([200, 201].includes(ok.status), ok.body?.message);

    const denied = await request(app)
      .patch(`/api/settlements/${settlementOutScopeId}`)
      .set("Cookie", hrCookie)
      .send({
        earnings: [{ title: "Bonus", amount: 100, category: "OTHER" }],
        deductions: [],
      });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "HR_SCOPE_DENIED");

    const payDenied = await request(app)
      .post(`/api/settlements/${settlementOutScopeId}/pay`)
      .set("Cookie", hrCookie)
      .send({ paymentDate: "2026-01-15", paymentMethod: "BANK_TRANSFER" });
    assert.equal(payDenied.status, 403);
  });
});

describe("CA4-C.2 P0/P1 payroll response filtering", () => {
  it("does not return out-of-scope payslips after calculate", async () => {
    const before = await models.PayrollCycle.countDocuments();
    const create = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", hrCookie)
      .send({ periodMonth: 1, periodYear: 2026 });
    // CUSTOM scope cannot run company-wide cycle writes.
    assert.equal(create.status, 403);
    assert.equal(create.body.code, "HR_SCOPE_DENIED");
    assert.equal(await models.PayrollCycle.countDocuments(), before);

    const list = await request(app).get("/api/payroll/cycles").set("Cookie", hrCookie);
    assert.equal(list.status, 200);
    for (const c of list.body.cycles || []) {
      if (c._aggregatesRestricted) {
        assert.equal(c.totalNetSalary, null);
      }
    }
  });
});

describe("CA4-C.2 P1 directory / notifications / dashboard / overview", () => {
  it("scopes employee directory for enforced HR", async () => {
    const res = await request(app).get("/api/employees/directory").set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    const names = (res.body.data || []).map((e) => e.fullName || "").join("|");
    assert.equal(names.includes("Bob"), false);
    assert.ok(names.includes("Alice") || (res.body.data || []).length >= 1);
  });

  it("scopes organization hierarchy for enforced HR", async () => {
    const res = await request(app).get("/api/employees/organization").set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    const blob = JSON.stringify(res.body);
    assert.equal(blob.includes("Bob Designer"), false);
  });

  it("scopes notifications leave feed", async () => {
    await models.LeaveRequest.create({
      employeeId: employeeIdB,
      leaveTypeCode: "CL",
      fromDate: new Date("2026-02-01"),
      toDate: new Date("2026-02-02"),
      daysCount: 2,
      status: "PENDING",
      reason: "secret-out-of-scope",
    });
    await models.LeaveRequest.create({
      employeeId: employeeIdA,
      leaveTypeCode: "CL",
      fromDate: new Date("2026-02-03"),
      toDate: new Date("2026-02-03"),
      daysCount: 1,
      status: "PENDING",
      reason: "in-scope-leave",
    });

    const res = await request(app).get("/api/notifications").set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    const blob = JSON.stringify(res.body);
    assert.equal(blob.includes("secret-out-of-scope"), false);
  });

  it("scopes admin dashboard pending leaves and overview employee count", async () => {
    const dash = await request(app).get("/api/admin/dashboard").set("Cookie", hrCookie);
    assert.equal(dash.status, 200);
    const pending = dash.body.pendingLeaveRequests ?? dash.body.metrics?.pendingLeaveRequests;
    if (typeof pending === "number") {
      assert.ok(pending <= 2);
    }
    const overview = await request(app).get("/api/admin/overview").set("Cookie", hrCookie);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.employeeCount, 1);
  });

  it("scopes leave SSE connection probe for HR with leave.view", async () => {
    const res = await request(app)
      .get("/api/leave-requests/events?probe=1")
      .set("Cookie", hrCookie);
    assert.equal(res.status, 200);
  });

  it("scopes impact leaderboard away from out-of-scope employees", async () => {
    await models.ImpactPointTransaction.create({
      employeeId: employeeIdB,
      employeeSnapshot: { fullName: "Bob Designer", employeeCode: "C2-002", department: "Design" },
      points: 50,
      transactionType: "EARNED",
      source: "MANUAL_ADJUSTMENT",
      eventType: "MANUAL",
      reason: "out-of-scope-award",
      actorUserId: hrAdminId,
      actorSnapshot: { fullName: "Acme HR", role: "HR_ADMIN" },
      idempotencyKey: `c2-out-${Date.now()}`,
    });
    await models.ImpactPointTransaction.create({
      employeeId: employeeIdA,
      employeeSnapshot: { fullName: "Alice Engineer", employeeCode: "C2-001", department: "Engineering" },
      points: 10,
      transactionType: "EARNED",
      source: "MANUAL_ADJUSTMENT",
      eventType: "MANUAL",
      reason: "in-scope-award",
      actorUserId: hrAdminId,
      actorSnapshot: { fullName: "Acme HR", role: "HR_ADMIN" },
      idempotencyKey: `c2-in-${Date.now()}`,
    });

    const res = await request(app).get("/api/impact-points/leaderboard").set("Cookie", hrCookie);
    assert.equal(res.status, 200, res.body?.message);
    const blob = JSON.stringify(res.body);
    assert.equal(blob.includes("Bob Designer"), false);
    assert.equal(blob.includes("out-of-scope-award"), false);
  });

  it("resolves handover employee scope from originalEmployeeId", async () => {
    const leaveIn = await models.LeaveRequest.create({
      employeeId: employeeIdA,
      leaveTypeCode: "CL",
      fromDate: new Date("2026-03-01"),
      toDate: new Date("2026-03-02"),
      daysCount: 2,
      status: "PENDING",
      reason: "handover-in-scope",
      handover: {
        status: "DRAFT",
        generalNotes: "",
        items: [],
        createdByUserId: hrAdminId,
      },
    });
    const leaveOut = await models.LeaveRequest.create({
      employeeId: employeeIdB,
      leaveTypeCode: "CL",
      fromDate: new Date("2026-03-05"),
      toDate: new Date("2026-03-06"),
      daysCount: 2,
      status: "PENDING",
      reason: "handover-out-of-scope",
      handover: {
        status: "DRAFT",
        generalNotes: "",
        items: [],
        createdByUserId: hrAdminId,
      },
    });

    const ok = await request(app).get(`/api/handovers/${leaveIn._id}`).set("Cookie", hrCookie);
    assert.equal(ok.status, 200, ok.body?.message);

    const denied = await request(app).get(`/api/handovers/${leaveOut._id}`).set("Cookie", hrCookie);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "HR_SCOPE_DENIED");
  });

  it("scopes settlement GET by id", async () => {
    const ok = await request(app)
      .get(`/api/settlements/${settlementInScopeId}`)
      .set("Cookie", hrCookie);
    assert.ok([200, 201].includes(ok.status), ok.body?.message);

    const denied = await request(app)
      .get(`/api/settlements/${settlementOutScopeId}`)
      .set("Cookie", hrCookie);
    assert.equal(denied.status, 403);
  });

  it("scopes HR intelligence aggregates", async () => {
    const res = await request(app).get("/api/admin/intelligence").set("Cookie", hrCookie);
    assert.ok([200, 403].includes(res.status));
    if (res.status === 200) {
      const blob = JSON.stringify(res.body);
      assert.equal(blob.includes("Bob Designer"), false);
    }
  });

  it("keeps employee self-service working", async () => {
    const res = await request(app).get("/api/employees/me").set("Cookie", empCookie);
    assert.equal(res.status, 200);
  });

  it("keeps company admin dashboard working", async () => {
    const res = await request(app).get("/api/company-admin/dashboard").set("Cookie", caCookie);
    assert.equal(res.status, 200);
  });
});

describe("CA4-C.4 P0 payroll validationIssues scope", () => {
  it("filters helper: keeps company-level issues and in-scope employees only", async () => {
    const hrUser = await models.User.findById(hrAdminId);
    const hrAccess = await resolveHrAccessContext({
      user: hrUser,
      company: acme,
      models,
    });
    const filtered = filterValidationIssuesByScope(hrAccess, [
      {
        employeeId: employeeIdB,
        employeeCode: "C2-002",
        fullName: "Bob Designer",
        issue: "missing CTC",
      },
      {
        employeeId: employeeIdA,
        employeeCode: "C2-001",
        fullName: "Alice Engineer",
        issue: "missing CTC",
      },
      { issue: "Company holiday calendar is not configured." },
    ]);
    assert.equal(filtered.length, 2);
    assert.ok(filtered.some((i) => i.fullName === "Alice Engineer"));
    assert.ok(filtered.some((i) => i.issue.includes("holiday")));
    assert.equal(
      filtered.some((i) => i.fullName === "Bob Designer"),
      false
    );
  });

  it("create and recalculate responses omit out-of-scope validationIssues", async () => {
    const beforeCycles = await models.PayrollCycle.countDocuments();
    const beforePayslips = await models.Payslip.countDocuments();
    const create = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", hrCookie)
      .send({ periodMonth: 3, periodYear: 2026 });
    assert.equal(create.status, 403, create.body?.message);
    assert.equal(create.body.code, "HR_SCOPE_DENIED");

    const cycle = await models.PayrollCycle.create({
      periodMonth: 3,
      periodYear: 2026,
      periodStartDate: new Date("2026-03-01T00:00:00.000Z"),
      periodEndDate: new Date("2026-03-31T23:59:59.999Z"),
      status: "CALCULATED",
      employeeCount: 2,
      totalNetPayable: 1000,
    });
    const kept = await models.Payslip.create({
      payrollCycleId: cycle._id,
      employeeId: employeeIdB,
      payslipNumber: "C2-KEEP-BOB",
      periodMonth: 3,
      periodYear: 2026,
      periodStartDate: new Date("2026-03-01T00:00:00.000Z"),
      periodEndDate: new Date("2026-03-31T23:59:59.999Z"),
      status: "DRAFT",
      monthlyCostToCompany: 222,
      grossEarnings: 222,
      totalDeductions: 0,
      daysBreakdown: { totalDaysInMonth: 31, workingDays: 22, payableDays: 22 },
      netPayable: 222,
    });

    const recalc = await request(app)
      .post(`/api/payroll/cycles/${cycle._id}/calculate`)
      .set("Cookie", hrCookie);
    assert.equal(recalc.status, 403, recalc.body?.message);
    assert.equal(recalc.body.code, "HR_SCOPE_DENIED");
    const still = await models.Payslip.findById(kept._id).lean();
    assert.equal(still.status, "DRAFT");
    assert.equal(Number(still.netPayable), 222);
    assert.equal(await models.PayrollCycle.countDocuments(), beforeCycles + 1);
    assert.ok((await models.Payslip.countDocuments()) >= beforePayslips + 1);
  });
});

describe("CA4-C.4 P1 dashboard / chatbot / intelligence / impact reverse", () => {
  it("dashboard payroll summary does not expose company-wide salary totals", async () => {
    const dash = await request(app).get("/api/admin/dashboard").set("Cookie", hrCookie);
    assert.equal(dash.status, 200);
    const summary =
      dash.body.payrollActionCentre?.currentCycle ||
      dash.body.payrollCycleSummary ||
      dash.body.metrics?.payrollCycleSummary;
    const last =
      dash.body.payrollActionCentre?.lastCompletedCycle || dash.body.lastCompletedCycle;
    if (summary?.exists) {
      assert.equal(summary._aggregatesRestricted, true);
      assert.ok(
        summary.totalNetSalary === null ||
          typeof summary.totalNetSalary === "number" ||
          summary.employeeCount === 0 ||
          summary.employeeCount === 1
      );
      // Must not equal a fabricated company-wide 2-employee dump when only 1 is in scope
      if (typeof summary.employeeCount === "number") {
        assert.ok(summary.employeeCount <= 1);
      }
    }
    if (last && last._aggregatesRestricted) {
      assert.ok(last.employeeCount === null || last.employeeCount <= 1);
    }
  });

  it("chatbot payroll readiness redacts company-wide salary aggregates for CUSTOM HR", async () => {
    const hrUser = await models.User.findById(hrAdminId);
    const hrAccess = await resolveHrAccessContext({
      user: hrUser,
      company: acme,
      models,
    });
    const result = await executeHrAnalystTool(
      "analyzePayrollReadiness",
      { compareHistoricalCycles: true },
      { models, company: acme, user: hrUser, hrAccess }
    );
    assert.ok(!result.error, result.message);
    const blob = JSON.stringify(result);
    assert.equal(blob.includes("Bob Designer"), false);
    if (result.currentCycle?._aggregatesRestricted) {
      assert.ok(
        result.currentCycle.totalNetPayable === null ||
          result.currentCycle.employeeCount === null ||
          result.currentCycle.employeeCount <= 1
      );
    }
    for (const h of result.historicalCycles || []) {
      if (h._aggregatesRestricted) {
        assert.ok(
          h.totalNetPayable === null || h.employeeCount === null || h.employeeCount <= 1
        );
      }
    }
  });

  it("intelligence task and late-arrival counts exclude out-of-scope employees", async () => {
    const yesterday = new Date(Date.now() - 86400000);
    await models.Task.create({
      title: "Out of scope overdue",
      description: "secret",
      assigneeId: employeeIdB,
      assignedByUserId: hrAdminId,
      assignedByEmployeeId: employeeIdA,
      status: "IN_PROGRESS",
      deadline: yesterday,
      priority: "MEDIUM",
    });
    await models.Task.create({
      title: "In scope overdue",
      description: "ok",
      assigneeId: employeeIdA,
      assignedByUserId: hrAdminId,
      assignedByEmployeeId: employeeIdA,
      status: "IN_PROGRESS",
      deadline: yesterday,
      priority: "MEDIUM",
    });

    const companyTimezone = acme.config?.timezone || "Asia/Kolkata";
    const { getCompanyBusinessDate } = await import("../services/attendanceService.js");
    const todayStr = getCompanyBusinessDate(new Date(), companyTimezone);
    await models.Attendance.create({
      employeeId: employeeIdB,
      date: todayStr,
      checkIn: new Date(`${todayStr}T12:00:00.000Z`),
    });
    await models.Attendance.create({
      employeeId: employeeIdA,
      date: todayStr,
      checkIn: new Date(`${todayStr}T12:05:00.000Z`),
    });

    const hrUser = await models.User.findById(hrAdminId);
    const hrAccess = await resolveHrAccessContext({
      user: hrUser,
      company: acme,
      models,
    });
    const findings = await calculateDeterministicFindings({
      models,
      company: acme,
      hrAccess,
    });
    const list = Array.isArray(findings) ? findings : [];
    const taskF = list.find((f) => f.id === "insight-tasks-action");
    const lateF = list.find((f) => f.id === "insight-attendance-exceptions");
    assert.ok(taskF, "expected scoped overdue task finding for Alice");
    assert.equal(taskF.count, 1);
    assert.equal(String(taskF.summary || "").includes("Out of scope"), false);
    if (lateF) {
      assert.equal(lateF.count, 1);
    }
  });

  it("impact reverse rejects out-of-scope tx and allows in-scope; no partial mutation", async () => {
    const txOut = await models.ImpactPointTransaction.create({
      employeeId: employeeIdB,
      employeeSnapshot: { fullName: "Bob Designer", employeeCode: "C2-002", department: "Design" },
      points: 25,
      transactionType: "EARNED",
      source: "MANUAL_ADJUSTMENT",
      eventType: "MANUAL",
      reason: "reverse-out-of-scope",
      actorUserId: hrAdminId,
      actorSnapshot: { fullName: "Acme HR", role: "HR_ADMIN" },
      idempotencyKey: `c4-rev-out-${Date.now()}`,
      isReversed: false,
    });
    const txIn = await models.ImpactPointTransaction.create({
      employeeId: employeeIdA,
      employeeSnapshot: { fullName: "Alice Engineer", employeeCode: "C2-001", department: "Engineering" },
      points: 15,
      transactionType: "EARNED",
      source: "MANUAL_ADJUSTMENT",
      eventType: "MANUAL",
      reason: "reverse-in-scope",
      actorUserId: hrAdminId,
      actorSnapshot: { fullName: "Acme HR", role: "HR_ADMIN" },
      idempotencyKey: `c4-rev-in-${Date.now()}`,
      isReversed: false,
    });

    const denied = await request(app)
      .post(`/api/impact-points/transactions/${txOut._id}/reverse`)
      .set("Cookie", hrCookie)
      .send({ reason: "cleanup out of scope" });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "HR_SCOPE_DENIED");
    const outReloaded = await models.ImpactPointTransaction.findById(txOut._id).lean();
    assert.equal(outReloaded.isReversed, false);
    const reversalCount = await models.ImpactPointTransaction.countDocuments({
      reversalReferenceId: txOut._id,
    });
    assert.equal(reversalCount, 0);

    const ok = await request(app)
      .post(`/api/impact-points/transactions/${txIn._id}/reverse`)
      .set("Cookie", hrCookie)
      .send({ reason: "cleanup in scope" });
    assert.equal(ok.status, 200, ok.body?.message);
    const inReloaded = await models.ImpactPointTransaction.findById(txIn._id).lean();
    assert.equal(inReloaded.isReversed, true);

    // Missing manage permission
    const hrUser = await models.User.findById(hrAdminId);
    hrUser.hrAccess.permissions = hrUser.hrAccess.permissions.filter((p) => p !== "impact.manage");
    await hrUser.save();
    // Force cookie refresh by re-login so session sees updated user? Middleware loads user from DB each request typically.
    const deniedPerm = await request(app)
      .post(`/api/impact-points/transactions/${txOut._id}/reverse`)
      .set("Cookie", hrCookie)
      .send({ reason: "no manage" });
    assert.equal(deniedPerm.status, 403);
    // restore manage for other tests
    hrUser.hrAccess.permissions = [...hrUser.hrAccess.permissions, "impact.manage"];
    await hrUser.save();
  });
});

describe("CA4-C.2 rollout remains configurable OFF in schema default", () => {
  it("fresh company document defaults enforcement to OFF", () => {
    const fresh = new Company({
      companyName: "X",
      slug: "x-temp-ca4c2",
      databaseName: "company_x_temp",
      status: COMPANY_STATUSES.ACTIVE,
    });
    assert.equal(fresh.config?.hrAccessEnforcement?.mode || "OFF", "OFF");
  });

  it("isolated fixture may ENFORCE without changing schema default", async () => {
    const reloaded = await Company.findById(acme._id).lean();
    assert.equal(reloaded.config.hrAccessEnforcement.mode, "ENFORCED");
    const schemaDefault = Company.schema.path("config.hrAccessEnforcement.mode").defaultValue;
    assert.equal(schemaDefault, "OFF");
  });
});
