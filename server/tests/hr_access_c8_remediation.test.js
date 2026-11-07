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
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { TASK_STATUSES } from "../models/Task.js";
import { createCompanyAdmin } from "../services/companyAdminService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { emitLeaveEvent } from "../services/leaveEventsService.js";
import { recommendBackupEmployees } from "../services/backupRecommendationService.js";
import { executeHrAnalystTool } from "../services/hrAnalystTools.js";
import {
  assertHrPermission,
  isEmployeeIdInScope,
  mergeEmployeeScopeFilter,
  resolveHrAccessContext,
} from "../services/hrAccessEnforcementService.js";

const PASSWORD = "HrC8RemediatePass1!";
const BROAD = [
  "people.view",
  "people.edit",
  "people.import",
  "organization.view",
  "dashboard.view",
  "attendance.view",
  "leave.view",
  "leave.edit",
  "payroll.view",
  "payroll.create",
  "payroll.calculate",
  "payroll.finalize",
  "payroll.pay",
  "hiring.view",
  "hiring.edit",
  "impact.manage",
  "assets.edit",
  "assets.view",
];

let mongo;
let app;
let server;
let baseUrl;
let acme;
let legacy;
let models;
let legacyModels;
let cookies;
let ids;

function cookieFrom(response) {
  const cookiesHeader = response.headers["set-cookie"] || [];
  return cookiesHeader.find((value) => value.startsWith(`${getAuthCookieName()}=`));
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

async function makeTask(modelsRef, { assigneeId, assignedByUserId, status, title }) {
  return modelsRef.Task.create({
    title,
    description: "Coverage task",
    assigneeId,
    assignedByUserId,
    priority: "MEDIUM",
    status,
    deadline: new Date("2026-09-10T00:00:00.000Z"),
    pointsAwarded: 0,
  });
}

function parseSseFrames(buffer) {
  return buffer
    .split("\n\n")
    .map((block) => {
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) return null;
      try {
        return JSON.parse(dataLine.slice(5).trim());
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function withLeaveSseSubscription(cookie, onReady, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${baseUrl}/api/leave-requests/events`,
      { headers: { Cookie: cookie, Accept: "text/event-stream" } },
      (res) => {
        let buffer = "";
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            req.destroy();
            reject(new Error("SSE subscription timed out"));
          }
        }, timeoutMs);
        const finish = (value, err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          req.destroy();
          if (err) reject(err);
          else resolve(value);
        };
        res.on("data", (chunk) => {
          buffer += chunk.toString();
          const frames = parseSseFrames(buffer);
          if (frames.some((frame) => frame.type === "CONNECTED") && onReady) {
            const ready = onReady;
            onReady = null;
            Promise.resolve()
              .then(() => ready({ frames: () => parseSseFrames(buffer) }))
              .then((result) => finish(result))
              .catch((err) => finish(null, err));
          }
        });
        res.on("error", (err) => finish(null, err));
      }
    );
    req.on("error", reject);
  });
}

async function waitFor(read, predicate, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    const value = read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return read();
}

before(async () => {
  fs.rmSync("D:/tmp/hrms-mongo/ca4c8-remediation", { recursive: true, force: true });
  fs.mkdirSync("D:/tmp/hrms-mongo/ca4c8-remediation", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: {
      dbPath: "D:/tmp/hrms-mongo/ca4c8-remediation",
      storageEngine: "wiredTiger",
    },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const probe = await Company.create({
    companyName: "Probe Default CA4C8",
    slug: "probe-ca4c8-default",
    databaseName: "company_probe_ca4c8",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });
  const probeFresh = await Company.findById(probe._id).lean();
  assert.equal(probeFresh.config?.hrAccessEnforcement?.mode || "OFF", "OFF");
  assert.equal(Company.schema.path("config.hrAccessEnforcement.mode").defaultValue, "OFF");

  acme = await Company.create({
    companyName: "Acme CA4C8",
    slug: "acme-ca4c8",
    databaseName: "company_acme_ca4c8",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { hrAccessEnforcement: { mode: "OFF" } },
  });
  legacy = await Company.create({
    companyName: "Legacy CA4C8",
    slug: "legacy-ca4c8",
    databaseName: "company_legacy_ca4c8",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });

  models = await getCompanyModels(acme);
  legacyModels = await getCompanyModels(legacy);
  const passwordHash = await hashPassword(PASSWORD);

  const eng = await models.Department.create({ name: "Engineering", isActive: true });
  const design = await models.Department.create({ name: "Design", isActive: true });

  const alice = await models.Employee.create({
    employeeCode: "C8-001",
    fullName: "Alice Engineer",
    email: "alice@acme-ca4c8.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    bankDetails: { accountNumber: "SECRET-ALICE-ACCT" },
    job: {
      jobTitle: "Engineer",
      department: "Engineering",
      departmentId: eng._id,
      project: { projectName: "Apollo" },
    },
  });
  const bob = await models.Employee.create({
    employeeCode: "C8-002",
    fullName: "Bob Designer",
    email: "bob@acme-ca4c8.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    bankDetails: { accountNumber: "SECRET-BOB-ACCT" },
    job: {
      jobTitle: "Designer",
      department: "Design",
      departmentId: design._id,
      project: { projectName: "Apollo" },
    },
  });
  const charlie = await models.Employee.create({
    employeeCode: "C8-003",
    fullName: "Charlie Engineer",
    email: "charlie@acme-ca4c8.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering", departmentId: eng._id },
  });
  const nina = await models.Employee.create({
    employeeCode: "C8-004",
    fullName: "Nina Nameonly",
    email: "nina@acme-ca4c8.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Analyst", department: "Engineering", departmentId: design._id },
  });

  await models.EmployeeCompensation.create({
    employeeId: alice._id,
    revisions: [{ effectiveFromDate: new Date("2020-01-01"), monthlyCostToCompany: 50000 }],
  });

  await createCompanyAdmin(models.User, {
    email: "ca@acme-ca4c8.test",
    passwordHash,
    fullName: "Acme CA",
  });

  const customScope = { mode: "CUSTOM", departmentIds: [eng._id], employeeIds: [] };
  const companyScope = { mode: "COMPANY", departmentIds: [], employeeIds: [] };
  const hrCustom = await models.User.create({
    email: "hr.custom@acme-ca4c8.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Custom HR",
    isActive: true,
    hrAccess: hrAccessDoc(BROAD, customScope),
  });
  const hrCompany = await models.User.create({
    email: "hr.company@acme-ca4c8.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Company HR",
    isActive: true,
    hrAccess: hrAccessDoc(BROAD, companyScope),
  });
  const hrDash = await models.User.create({
    email: "hr.dash@acme-ca4c8.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Dash HR",
    isActive: true,
    hrAccess: hrAccessDoc(["dashboard.view"], customScope),
  });
  const hrHiring = await models.User.create({
    email: "hr.hiring@acme-ca4c8.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Hiring HR",
    isActive: true,
    hrAccess: hrAccessDoc(["hiring.view", "hiring.edit", "people.view"], customScope),
  });
  const aliceUser = await models.User.create({
    email: "alice@acme-ca4c8.test",
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Alice Engineer",
    isActive: true,
    employeeId: alice._id,
  });
  alice.userId = aliceUser._id;
  await alice.save();
  await models.User.create({
    email: "candidate@acme-ca4c8.test",
    passwordHash,
    role: USER_ROLES.CANDIDATE,
    fullName: "Casey Candidate",
    isActive: true,
  });

  const taskAlice = await makeTask(models, {
    assigneeId: alice._id,
    assignedByUserId: hrCustom._id,
    status: TASK_STATUSES.ASSIGNED,
    title: "Alice assigned",
  });
  const taskBob = await makeTask(models, {
    assigneeId: bob._id,
    assignedByUserId: hrCustom._id,
    status: TASK_STATUSES.ASSIGNED,
    title: "Bob assigned",
  });
  const taskAliceReview = await makeTask(models, {
    assigneeId: alice._id,
    assignedByUserId: hrCustom._id,
    status: TASK_STATUSES.SUBMITTED,
    title: "Alice submitted",
  });
  const taskBobReview = await makeTask(models, {
    assigneeId: bob._id,
    assignedByUserId: hrCustom._id,
    status: TASK_STATUSES.SUBMITTED,
    title: "Bob submitted",
  });
  const taskOwn = await makeTask(models, {
    assigneeId: alice._id,
    assignedByUserId: hrCompany._id,
    status: TASK_STATUSES.ASSIGNED,
    title: "Alice own start",
  });

  await models.Team.create({
    name: "Platform",
    memberEmployeeIds: [alice._id, bob._id],
    leadEmployeeId: alice._id,
    isActive: true,
  });

  const offer = await models.OfferLetter.create({
    candidate: { fullName: "Secret Candidate", email: "secret-offer@ca4c8.test" },
    position: "Designer",
    department: "Design",
    monthlySalary: 88000,
    joiningDate: new Date("2026-08-01"),
    content: "Offer content for dashboard leak check.",
    status: OFFER_LETTER_STATUSES.SENT,
  });
  const linkOffer = await models.OfferLetter.create({
    candidate: { fullName: "Link Candidate", email: "link-offer@ca4c8.test" },
    position: "Engineer",
    department: "Engineering",
    monthlySalary: 41000,
    joiningDate: new Date("2026-08-01"),
    content: "Offer content for employee linking.",
    status: OFFER_LETTER_STATUSES.ACCEPTED,
  });

  await models.LeaveRequest.create({
    employeeId: bob._id,
    leaveTypeCode: "CL",
    fromDate: new Date("2026-06-02"),
    toDate: new Date("2026-06-03"),
    reason: "secret-bob-leave-c8",
    status: "PENDING",
  });
  await models.LeaveRequest.create({
    employeeId: alice._id,
    leaveTypeCode: "CL",
    fromDate: new Date("2026-06-04"),
    toDate: new Date("2026-06-05"),
    reason: "alice-leave-c8",
    status: "PENDING",
  });

  const dashCycle = await models.PayrollCycle.create({
    periodMonth: 6,
    periodYear: 2026,
    periodStartDate: new Date("2026-06-01"),
    periodEndDate: new Date("2026-06-30"),
    status: "FINALIZED",
    employeeCount: 2,
    totalNetPayable: 999999,
  });
  await models.Payslip.create({
    payrollCycleId: dashCycle._id,
    employeeId: alice._id,
    payslipNumber: "C8-DASH-ALICE",
    periodMonth: 6,
    periodYear: 2026,
    periodStartDate: new Date("2026-06-01"),
    periodEndDate: new Date("2026-06-30"),
    status: "FINALIZED",
    ...payslipFields(100),
  });
  await models.Payslip.create({
    payrollCycleId: dashCycle._id,
    employeeId: bob._id,
    payslipNumber: "C8-DASH-BOB",
    periodMonth: 6,
    periodYear: 2026,
    periodStartDate: new Date("2026-06-01"),
    periodEndDate: new Date("2026-06-30"),
    status: "FINALIZED",
    ...payslipFields(400000),
  });

  const mutCycle = await models.PayrollCycle.create({
    periodMonth: 8,
    periodYear: 2026,
    periodStartDate: new Date("2026-08-01"),
    periodEndDate: new Date("2026-08-31"),
    status: "CALCULATED",
    employeeCount: 2,
    totalNetPayable: 500,
  });
  const slipA = await models.Payslip.create({
    payrollCycleId: mutCycle._id,
    employeeId: alice._id,
    payslipNumber: "C8-MUT-ALICE",
    periodMonth: 8,
    periodYear: 2026,
    periodStartDate: new Date("2026-08-01"),
    periodEndDate: new Date("2026-08-31"),
    status: "DRAFT",
    ...payslipFields(100),
  });
  const slipB = await models.Payslip.create({
    payrollCycleId: mutCycle._id,
    employeeId: bob._id,
    payslipNumber: "C8-MUT-BOB",
    periodMonth: 8,
    periodYear: 2026,
    periodStartDate: new Date("2026-08-01"),
    periodEndDate: new Date("2026-08-31"),
    status: "DRAFT",
    ...payslipFields(400),
  });

  const assetBob = await models.CompanyAsset.create({
    assetTag: "C8-BOB-LAP",
    name: "Bob Laptop",
    category: "LAPTOP",
    status: "ASSIGNED",
    currentAssignment: {
      employeeId: bob._id,
      employeeName: bob.fullName,
      employeeCode: bob.employeeCode,
      assignedDate: new Date("2026-01-01"),
    },
  });
  const assetAlice = await models.CompanyAsset.create({
    assetTag: "C8-ALICE-LAP",
    name: "Alice Laptop",
    category: "LAPTOP",
    status: "ASSIGNED",
    currentAssignment: {
      employeeId: alice._id,
      employeeName: alice.fullName,
      employeeCode: alice.employeeCode,
      assignedDate: new Date("2026-01-01"),
    },
  });

  const handoverTask = await makeTask(models, {
    assigneeId: alice._id,
    assignedByUserId: hrCustom._id,
    status: TASK_STATUSES.ASSIGNED,
    title: "Handover coverage",
  });
  const handoverTask2 = await makeTask(models, {
    assigneeId: alice._id,
    assignedByUserId: hrCustom._id,
    status: TASK_STATUSES.ASSIGNED,
    title: "Handover coverage two",
  });
  const handoverLeave = await models.LeaveRequest.create({
    employeeId: alice._id,
    leaveTypeCode: "CL",
    fromDate: new Date("2026-09-01"),
    toDate: new Date("2026-09-05"),
    reason: "handover-c8",
    status: "PENDING",
    handover: {
      status: "DRAFT",
      items: [
        { taskId: handoverTask._id, status: "DRAFT" },
        { taskId: handoverTask2._id, status: "DRAFT" },
      ],
    },
  });

  const legacyEmp = await legacyModels.Employee.create({
    employeeCode: "LEG-001",
    fullName: "Legacy Employee",
    email: "legacy.emp@legacy-ca4c8.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    bankDetails: { accountNumber: "SECRET-LEGACY-ACCT" },
    job: { jobTitle: "Engineer", department: "Engineering" },
  });
  const legacyHr = await legacyModels.User.create({
    email: "hr@legacy-ca4c8.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Legacy HR",
    isActive: true,
  });
  const legacyTask = await makeTask(legacyModels, {
    assigneeId: legacyEmp._id,
    assignedByUserId: legacyHr._id,
    status: TASK_STATUSES.ASSIGNED,
    title: "Legacy task",
  });

  await Company.findByIdAndUpdate(acme._id, {
    $set: { "config.hrAccessEnforcement.mode": "ENFORCED" },
  });
  acme = await Company.findById(acme._id);

  cookies = {
    custom: await login("acme-ca4c8", "hr.custom@acme-ca4c8.test"),
    company: await login("acme-ca4c8", "hr.company@acme-ca4c8.test"),
    dash: await login("acme-ca4c8", "hr.dash@acme-ca4c8.test"),
    hiring: await login("acme-ca4c8", "hr.hiring@acme-ca4c8.test"),
    employee: await login("acme-ca4c8", "alice@acme-ca4c8.test"),
    ca: await login("acme-ca4c8", "ca@acme-ca4c8.test"),
    legacy: await login("legacy-ca4c8", "hr@legacy-ca4c8.test"),
  };
  ids = {
    eng: eng._id,
    design: design._id,
    alice: alice._id,
    bob: bob._id,
    charlie: charlie._id,
    nina: nina._id,
    hrCustom: hrCustom._id,
    taskAlice: taskAlice._id,
    taskBob: taskBob._id,
    taskAliceReview: taskAliceReview._id,
    taskBobReview: taskBobReview._id,
    taskOwn: taskOwn._id,
    offer: offer._id,
    linkOffer: linkOffer._id,
    mutCycle: mutCycle._id,
    slipA: slipA._id,
    slipB: slipB._id,
    assetBob: assetBob._id,
    assetAlice: assetAlice._id,
    handoverLeave: handoverLeave._id,
    handoverItem: handoverLeave.handover.items[0]._id,
    handoverItemCompany: handoverLeave.handover.items[1]._id,
    legacyEmp: legacyEmp._id,
    legacyTask: legacyTask._id,
  };
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("CA4-C.8 P0.1 visible employee profile", () => {
  it("denies HR without people.view and hides out-of-scope bank details", async () => {
    const deniedPerm = await request(app)
      .get(`/api/employees/${ids.alice}/visible-profile`)
      .set("Cookie", cookies.dash);
    assert.equal(deniedPerm.status, 403);
    assert.equal(deniedPerm.body.code, "HR_PERMISSION_DENIED");

    const deniedScope = await request(app)
      .get(`/api/employees/${ids.bob}/visible-profile`)
      .set("Cookie", cookies.custom);
    assert.equal(deniedScope.status, 403);
    assert.equal(deniedScope.body.code, "HR_SCOPE_DENIED");
    assert.equal(JSON.stringify(deniedScope.body).includes("SECRET-BOB-ACCT"), false);

    const allowed = await request(app)
      .get(`/api/employees/${ids.alice}/visible-profile`)
      .set("Cookie", cookies.custom);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.employee.bankDetails.accountNumber, "SECRET-ALICE-ACCT");

    const company = await request(app)
      .get(`/api/employees/${ids.bob}/visible-profile`)
      .set("Cookie", cookies.company);
    assert.equal(company.status, 200);
    assert.equal(company.body.employee.bankDetails.accountNumber, "SECRET-BOB-ACCT");
  });
});

describe("CA4-C.8 P0.2 work management mutations", () => {
  it("rejects unauthorized task changes without awarding points or changing status", async () => {
    const beforePoints = await models.ImpactPointTransaction.countDocuments();
    const noPerm = await request(app)
      .patch(`/api/tasks/${ids.taskBob}`)
      .set("Cookie", cookies.dash)
      .send({ title: "Hacked title" });
    assert.equal(noPerm.status, 403);
    assert.equal(noPerm.body.code, "HR_PERMISSION_DENIED");

    const outPatch = await request(app)
      .patch(`/api/tasks/${ids.taskBob}`)
      .set("Cookie", cookies.custom)
      .send({ title: "Hacked title" });
    assert.equal(outPatch.status, 403);
    assert.equal(outPatch.body.code, "HR_SCOPE_DENIED");

    const outStart = await request(app)
      .post(`/api/tasks/${ids.taskBob}/start`)
      .set("Cookie", cookies.custom);
    assert.equal(outStart.status, 403);
    const outSubmit = await request(app)
      .post(`/api/tasks/${ids.taskBob}/submit`)
      .set("Cookie", cookies.custom)
      .send({ deliverables: [], submissionNotes: "no" });
    assert.equal(outSubmit.status, 403);
    const outReview = await request(app)
      .post(`/api/tasks/${ids.taskBobReview}/review`)
      .set("Cookie", cookies.custom)
      .send({ decision: "APPROVED", comments: "ok" });
    assert.equal(outReview.status, 403);

    const bobTask = await models.Task.findById(ids.taskBob).lean();
    const bobReview = await models.Task.findById(ids.taskBobReview).lean();
    assert.equal(bobTask.title, "Bob assigned");
    assert.equal(bobTask.status, TASK_STATUSES.ASSIGNED);
    assert.equal(bobReview.status, TASK_STATUSES.SUBMITTED);
    assert.equal(bobReview.pointsAwarded || 0, 0);
    assert.equal(await models.ImpactPointTransaction.countDocuments(), beforePoints);

    const inPatch = await request(app)
      .patch(`/api/tasks/${ids.taskAlice}`)
      .set("Cookie", cookies.custom)
      .send({ title: "Alice scoped update" });
    assert.equal(inPatch.status, 200, inPatch.body?.message);
    const started = await request(app)
      .post(`/api/tasks/${ids.taskAlice}/start`)
      .set("Cookie", cookies.custom);
    assert.equal(started.status, 200, started.body?.message);
    const submitted = await request(app)
      .post(`/api/tasks/${ids.taskAlice}/submit`)
      .set("Cookie", cookies.custom)
      .send({ deliverables: [], submissionNotes: "done" });
    assert.equal(submitted.status, 200, submitted.body?.message);
    const reviewed = await request(app)
      .post(`/api/tasks/${ids.taskAliceReview}/review`)
      .set("Cookie", cookies.custom)
      .send({ decision: "APPROVED", comments: "ok" });
    assert.equal(reviewed.status, 200, reviewed.body?.message);
    assert.equal((await models.Task.findById(ids.taskAliceReview).lean()).status, TASK_STATUSES.APPROVED);

    const companyPatch = await request(app)
      .patch(`/api/tasks/${ids.taskBob}`)
      .set("Cookie", cookies.company)
      .send({ title: "Company HR update" });
    assert.equal(companyPatch.status, 200, companyPatch.body?.message);
    assert.equal((await models.Task.findById(ids.taskBob).lean()).title, "Company HR update");

    const own = await request(app)
      .post(`/api/tasks/${ids.taskOwn}/start`)
      .set("Cookie", cookies.employee);
    assert.equal(own.status, 200, own.body?.message);
    assert.equal((await models.Task.findById(ids.taskOwn).lean()).status, TASK_STATUSES.IN_PROGRESS);
  });
});

describe("CA4-C.8 P0.3 organization explorer", () => {
  it("hides out-of-scope names and counts from CUSTOM HR", async () => {
    const denied = await request(app)
      .get("/api/employees/organization-explorer/departments")
      .set("Cookie", cookies.dash);
    assert.equal(denied.status, 403);

    const custom = await request(app)
      .get("/api/employees/organization-explorer/departments")
      .set("Cookie", cookies.custom);
    assert.equal(custom.status, 200, custom.body?.message);
    const customBlob = JSON.stringify(custom.body);
    assert.equal(customBlob.includes("Bob Designer"), false);
    assert.equal(customBlob.includes("C8-002"), false);
    assert.equal(customBlob.includes("Nina Nameonly"), false);
    assert.equal(customBlob.includes("Alice Engineer"), true);
    const engineering = (custom.body.departments || []).find((row) => row.name === "Engineering");
    assert.equal(engineering.employeeCount, 2);

    const projects = await request(app)
      .get("/api/employees/organization-explorer/projects")
      .set("Cookie", cookies.custom);
    assert.equal(projects.status, 200, projects.body?.message);
    const projectBlob = JSON.stringify(projects.body);
    assert.equal(projectBlob.includes("Bob Designer"), false);
    assert.equal(projectBlob.includes("Alice Engineer"), true);

    const teams = await request(app)
      .get("/api/employees/organization-explorer/teams")
      .set("Cookie", cookies.custom);
    assert.equal(teams.status, 200, teams.body?.message);
    const teamBlob = JSON.stringify(teams.body);
    assert.equal(teamBlob.includes("Bob Designer"), false);
    assert.equal(teamBlob.includes("C8-002"), false);
    assert.equal(teamBlob.includes("Alice Engineer"), true);

    const company = await request(app)
      .get("/api/employees/organization-explorer/departments")
      .set("Cookie", cookies.company);
    assert.equal(company.status, 200);
    assert.equal(JSON.stringify(company.body).includes("Bob Designer"), true);
  });
});

describe("CA4-C.8 P0.4 offer recipients and linking", () => {
  it("scopes recipients, omits salary without payroll.view, and rejects out-of-scope links", async () => {
    const denied = await request(app)
      .get("/api/offer-letters/recipients")
      .set("Cookie", cookies.dash);
    assert.equal(denied.status, 403);

    const hiringOnly = await request(app)
      .get("/api/offer-letters/recipients")
      .set("Cookie", cookies.hiring);
    assert.equal(hiringOnly.status, 200, hiringOnly.body?.message);
    const hiringBlob = JSON.stringify(hiringOnly.body);
    assert.equal(hiringBlob.includes("Bob Designer"), false);
    assert.equal(hiringBlob.includes("Alice Engineer"), true);
    const aliceRow = (hiringOnly.body.recipients || []).find((row) => row.employeeCode === "C8-001");
    assert.ok(aliceRow);
    assert.equal(Object.prototype.hasOwnProperty.call(aliceRow, "monthlySalary"), false);

    const withPayroll = await request(app)
      .get("/api/offer-letters/recipients")
      .set("Cookie", cookies.custom);
    assert.equal(withPayroll.status, 200);
    const paidAlice = (withPayroll.body.recipients || []).find((row) => row.employeeCode === "C8-001");
    assert.equal(paidAlice.monthlySalary, 50000);
    assert.equal(JSON.stringify(withPayroll.body).includes("Bob Designer"), false);

    const company = await request(app)
      .get("/api/offer-letters/recipients")
      .set("Cookie", cookies.company);
    assert.equal(company.status, 200);
    assert.equal(JSON.stringify(company.body).includes("Bob Designer"), true);
    const companyBob = (company.body.recipients || []).find((row) => row.employeeCode === "C8-002");
    assert.equal(Object.prototype.hasOwnProperty.call(companyBob, "monthlySalary"), true);

    const before = await models.OfferLetter.findById(ids.linkOffer).lean();
    const deniedLink = await request(app)
      .post(`/api/offer-letters/${ids.linkOffer}/link-employee`)
      .set("Cookie", cookies.custom)
      .send({ employeeId: String(ids.bob) });
    assert.equal(deniedLink.status, 403);
    assert.equal(deniedLink.body.code, "HR_SCOPE_DENIED");
    const unchanged = await models.OfferLetter.findById(ids.linkOffer).lean();
    assert.equal(String(unchanged.employeeId || ""), String(before.employeeId || ""));

    const linked = await request(app)
      .post(`/api/offer-letters/${ids.linkOffer}/link-employee`)
      .set("Cookie", cookies.custom)
      .send({ employeeId: String(ids.alice) });
    assert.equal(linked.status, 200, linked.body?.message);
    assert.equal(String((await models.OfferLetter.findById(ids.linkOffer).lean()).employeeId), String(ids.alice));
  });
});

describe("CA4-C.8 P0.5 and P1.11 dashboard leakage", () => {
  it("scopes leaves and salary and hides hiring details without hiring.view", async () => {
    const dash = await request(app)
      .get("/api/admin/dashboard?year=2026")
      .set("Cookie", cookies.dash);
    assert.equal(dash.status, 200, dash.body?.message);
    const blob = JSON.stringify(dash.body);
    assert.equal(blob.includes("secret-bob-leave-c8"), false);
    assert.equal(blob.includes("Bob Designer"), false);
    assert.equal(blob.includes("alice-leave-c8"), false);
    assert.equal(blob.includes("secret-offer@ca4c8.test"), false);
    assert.equal(blob.includes("88000"), false);
    assert.equal(blob.includes("999999"), false);
    assert.equal(dash.body.recruitmentFunnel.restricted, true);
    assert.equal(dash.body.salaryExpenses.restricted, true);
    assert.equal(dash.body.recentLeaves.restricted, true);
    assert.equal(dash.body.summary.monthlyPayroll, null);

    const scoped = await request(app)
      .get("/api/admin/dashboard?year=2026")
      .set("Cookie", cookies.custom);
    assert.equal(scoped.status, 200, scoped.body?.message);
    const scopedBlob = JSON.stringify(scoped.body);
    assert.equal(scopedBlob.includes("alice-leave-c8"), true);
    assert.equal(scopedBlob.includes("secret-bob-leave-c8"), false);
    const june = (scoped.body.salaryExpenses?.months || []).find((row) => row.monthNumber === 6);
    assert.equal(june.amount, 100);

    const company = await request(app)
      .get("/api/admin/dashboard?year=2026")
      .set("Cookie", cookies.company);
    assert.equal(company.status, 200, company.body?.message);
    const companyBlob = JSON.stringify(company.body);
    assert.equal(companyBlob.includes("secret-bob-leave-c8"), true);
    assert.equal(companyBlob.includes("secret-offer@ca4c8.test"), true);
    const companyJune = (company.body.salaryExpenses?.months || []).find((row) => row.monthNumber === 6);
    assert.equal(companyJune.amount, 999999);
  });
});

describe("CA4-C.8 P0.6 payroll mutations", () => {
  it("rejects custom cycle writes and leaves persisted payslips unchanged", async () => {
    const beforeCycles = await models.PayrollCycle.countDocuments();
    const noPerm = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", cookies.dash)
      .send({ periodMonth: 9, periodYear: 2026 });
    assert.equal(noPerm.status, 403);
    assert.equal(noPerm.body.code, "HR_PERMISSION_DENIED");

    const created = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", cookies.custom)
      .send({ periodMonth: 9, periodYear: 2026 });
    assert.equal(created.status, 403);
    assert.equal(created.body.code, "HR_SCOPE_DENIED");
    assert.equal(await models.PayrollCycle.countDocuments(), beforeCycles);

    const recalc = await request(app)
      .post(`/api/payroll/cycles/${ids.mutCycle}/calculate`)
      .set("Cookie", cookies.custom);
    const finalize = await request(app)
      .post(`/api/payroll/cycles/${ids.mutCycle}/finalize`)
      .set("Cookie", cookies.custom);
    const pay = await request(app)
      .post(`/api/payroll/cycles/${ids.mutCycle}/pay`)
      .set("Cookie", cookies.custom)
      .send({ amount: 500, paymentDate: "2026-08-31", paymentMethod: "BANK_TRANSFER" });
    assert.equal(recalc.status, 403);
    assert.equal(finalize.status, 403);
    assert.equal(pay.status, 403);

    const cycle = await models.PayrollCycle.findById(ids.mutCycle).lean();
    const slipA = await models.Payslip.findById(ids.slipA).lean();
    const slipB = await models.Payslip.findById(ids.slipB).lean();
    assert.equal(cycle.status, "CALCULATED");
    assert.equal(slipA.status, "DRAFT");
    assert.equal(slipB.status, "DRAFT");
    assert.equal(Number(slipA.netPayable), 100);
    assert.equal(Number(slipB.netPayable), 400);

    const companyFinalize = await request(app)
      .post(`/api/payroll/cycles/${ids.mutCycle}/finalize`)
      .set("Cookie", cookies.company);
    assert.equal(companyFinalize.status, 200, companyFinalize.body?.message);
    assert.equal((await models.PayrollCycle.findById(ids.mutCycle).lean()).status, "FINALIZED");
    assert.equal((await models.Payslip.findById(ids.slipA).lean()).status, "FINALIZED");
    assert.equal((await models.Payslip.findById(ids.slipB).lean()).status, "FINALIZED");

    const customPayAfter = await request(app)
      .post(`/api/payroll/cycles/${ids.mutCycle}/pay`)
      .set("Cookie", cookies.custom)
      .send({ amount: 500, paymentDate: "2026-08-31", paymentMethod: "BANK_TRANSFER" });
    assert.equal(customPayAfter.status, 403);
    assert.equal((await models.PayrollCycle.findById(ids.mutCycle).lean()).status, "FINALIZED");
    assert.equal((await models.Payslip.findById(ids.slipB).lean()).status, "FINALIZED");

    const companyPay = await request(app)
      .post(`/api/payroll/cycles/${ids.mutCycle}/pay`)
      .set("Cookie", cookies.company)
      .send({ amount: 500, paymentDate: "2026-08-31", paymentMethod: "BANK_TRANSFER" });
    assert.equal(companyPay.status, 200, companyPay.body?.message);
  });
});

describe("CA4-C.8 P1.7 asset update", () => {
  it("rejects an update when the current assignee is out of scope", async () => {
    const denied = await request(app)
      .put(`/api/assets/${ids.assetBob}`)
      .set("Cookie", cookies.custom)
      .send({ name: "Hacked asset" });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "HR_SCOPE_DENIED");
    assert.equal((await models.CompanyAsset.findById(ids.assetBob).lean()).name, "Bob Laptop");

    const allowed = await request(app)
      .put(`/api/assets/${ids.assetAlice}`)
      .set("Cookie", cookies.custom)
      .send({ name: "Alice Laptop Updated" });
    assert.equal(allowed.status, 200, allowed.body?.message);
    assert.equal((await models.CompanyAsset.findById(ids.assetAlice).lean()).name, "Alice Laptop Updated");

    const company = await request(app)
      .put(`/api/assets/${ids.assetBob}`)
      .set("Cookie", cookies.company)
      .send({ name: "Company Updated Laptop" });
    assert.equal(company.status, 200, company.body?.message);
    assert.equal((await models.CompanyAsset.findById(ids.assetBob).lean()).name, "Company Updated Laptop");
  });
});

describe("CA4-C.8 P1.8 bulk employee import", () => {
  it("does not provision an account for a department outside scope", async () => {
    const rows = [
      {
        fullName: "Import Engineer",
        email: "import.eng@acme-ca4c8.test",
        employeeCode: "C8-101",
        department: "Engineering",
      },
      {
        fullName: "Import Designer",
        email: "import.design@acme-ca4c8.test",
        employeeCode: "C8-102",
        department: "Design",
      },
    ];
    const commit = await request(app)
      .post("/api/employees/import")
      .set("Cookie", cookies.custom)
      .send({ rows, importValidOnly: true });
    assert.equal(commit.status, 201, JSON.stringify(commit.body));
    assert.equal(commit.body.summary.createdCount, 1);
    assert.equal(commit.body.created[0].email, "import.eng@acme-ca4c8.test");
    assert.equal(commit.body.failed.some((row) => row.data.email === "import.design@acme-ca4c8.test"), true);
    assert.equal(commit.body.failed.every((row) => row.activationLink === undefined), true);
    assert.equal(await models.User.exists({ email: "import.design@acme-ca4c8.test" }), null);
    assert.ok(await models.User.exists({ email: "import.eng@acme-ca4c8.test" }));

    await models.User.updateOne(
      { _id: ids.hrCustom },
      {
        $set: {
          "hrAccess.employeeScope.departmentIds": [],
          "hrAccess.employeeScope.employeeIds": [ids.alice],
        },
      }
    );
    try {
      const beforeUsers = await models.User.countDocuments();
      const idOnly = await request(app)
        .post("/api/employees/import")
        .set("Cookie", cookies.custom)
        .send({
          importValidOnly: true,
          rows: [
            {
              fullName: "Import Id Only",
              email: "import.idonly@acme-ca4c8.test",
              employeeCode: "C8-103",
              department: "Engineering",
            },
          ],
        });
      assert.equal(idOnly.status, 400, JSON.stringify(idOnly.body));
      assert.equal(idOnly.body.summary.createdCount, 0);
      assert.equal(idOnly.body.failed[0].errors.department, "This department is outside your employee scope.");
      assert.equal(await models.User.exists({ email: "import.idonly@acme-ca4c8.test" }), null);
      assert.equal(await models.User.countDocuments(), beforeUsers);
    } finally {
      await models.User.updateOne(
        { _id: ids.hrCustom },
        {
          $set: {
            "hrAccess.employeeScope.mode": "CUSTOM",
            "hrAccess.employeeScope.departmentIds": [ids.eng],
            "hrAccess.employeeScope.employeeIds": [],
          },
        }
      );
    }
  });
});

describe("CA4-C.8 P1.9 leave backup recommendations", () => {
  it("filters backup candidates to the caller scope", async () => {
    const task = await makeTask(models, {
      assigneeId: ids.alice,
      assignedByUserId: ids.hrCustom,
      status: TASK_STATUSES.ASSIGNED,
      title: "Backup source",
    });
    const result = await recommendBackupEmployees(
      { models, company: acme, hrAccess: await resolveHrAccessContext({
        user: await models.User.findById(ids.hrCustom),
        company: acme,
        models,
      }) },
      ids.alice,
      task._id,
      new Date("2026-09-01"),
      new Date("2026-09-05"),
      { includeWeak: true }
    );
    const blob = JSON.stringify(result);
    assert.equal(blob.includes("Bob Designer"), false);
    assert.equal(blob.includes("Charlie Engineer"), true);

    const httpRes = await request(app)
      .get(`/api/leave-requests/${ids.handoverLeave}/backup-recommendations`)
      .set("Cookie", cookies.custom);
    assert.equal(httpRes.status, 200, httpRes.body?.message);
    assert.equal(JSON.stringify(httpRes.body).includes("Bob Designer"), false);

    const before = await models.LeaveBackupProposal.countDocuments();
    const saveDenied = await request(app)
      .put(`/api/leave-requests/${ids.handoverLeave}/backup-proposals`)
      .set("Cookie", cookies.custom)
      .send({ taskId: String(task._id), backupEmployeeId: String(ids.bob) });
    assert.equal(saveDenied.status, 403);
    assert.equal(await models.LeaveBackupProposal.countDocuments(), before);

    const saveOk = await request(app)
      .put(`/api/leave-requests/${ids.handoverLeave}/backup-proposals`)
      .set("Cookie", cookies.custom)
      .send({ taskId: String(task._id), backupEmployeeId: String(ids.charlie) });
    assert.equal(saveOk.status, 200, saveOk.body?.message);
  });
});

describe("CA4-C.8 P1.10 impact recognition", () => {
  it("requires impact.manage and in-scope recipient before writing a transaction", async () => {
    const before = await models.ImpactPointTransaction.countDocuments();
    const noPerm = await request(app)
      .post("/api/impact-points/recognize")
      .set("Cookie", cookies.dash)
      .send({ recipientEmployeeId: String(ids.alice), points: 5, reason: "Thanks" });
    assert.equal(noPerm.status, 403);
    assert.equal(noPerm.body.code, "HR_PERMISSION_DENIED");
    assert.equal(await models.ImpactPointTransaction.countDocuments(), before);

    const out = await request(app)
      .post("/api/impact-points/recognize")
      .set("Cookie", cookies.custom)
      .send({ recipientEmployeeId: String(ids.bob), points: 5, reason: "Thanks" });
    assert.equal(out.status, 403);
    assert.equal(out.body.code, "HR_SCOPE_DENIED");
    assert.equal(await models.ImpactPointTransaction.countDocuments(), before);

    const ok = await request(app)
      .post("/api/impact-points/recognize")
      .set("Cookie", cookies.custom)
      .send({ recipientEmployeeId: String(ids.alice), points: 5, reason: "Thanks" });
    assert.equal(ok.status, 201, ok.body?.message);
    assert.equal(await models.ImpactPointTransaction.countDocuments(), before + 1);

    const company = await request(app)
      .post("/api/impact-points/recognize")
      .set("Cookie", cookies.company)
      .send({ recipientEmployeeId: String(ids.bob), points: 4, reason: "Company thanks" });
    assert.equal(company.status, 201, company.body?.message);
  });
});

describe("CA4-C.8 P1.12 cross-module analyst tools", () => {
  it("does not let dashboard.view pull other module details", async () => {
    const dashUser = await models.User.findOne({ email: "hr.dash@acme-ca4c8.test" });
    const dashAccess = await resolveHrAccessContext({ user: dashUser, company: acme, models });
    const limited = await executeHrAnalystTool(
      "getCrossModuleOverview",
      {},
      { models, company: acme, user: dashUser, hrAccess: dashAccess }
    );
    assert.deepEqual(limited.modulesIncluded, []);
    assert.equal(limited.healthOverview.attendanceRate, undefined);
    assert.equal(limited.healthOverview.payrollStatus, undefined);
    assert.equal(limited.healthOverview.offersAcceptedCount, undefined);
    assert.equal(limited.healthOverview.activeStaffCount, undefined);
    assert.equal(JSON.stringify(limited).includes("Bob Designer"), false);

    await models.User.updateOne(
      { _id: dashUser._id },
      { $set: { "hrAccess.permissions": ["dashboard.view", "attendance.view"] } }
    );
    try {
      const refreshed = await models.User.findById(dashUser._id);
      const access = await resolveHrAccessContext({ user: refreshed, company: acme, models });
      const attendanceOnly = await executeHrAnalystTool(
        "getCrossModuleOverview",
        {},
        { models, company: acme, user: refreshed, hrAccess: access }
      );
      assert.deepEqual(attendanceOnly.modulesIncluded, ["attendance"]);
      assert.equal(attendanceOnly.healthOverview.offersAcceptedCount, undefined);
      assert.ok(attendanceOnly.healthOverview.attendanceRate !== undefined);
    } finally {
      await models.User.updateOne(
        { _id: dashUser._id },
        { $set: { "hrAccess.permissions": ["dashboard.view"] } }
      );
    }

    const hiringUser = await models.User.findOne({ email: "hr.hiring@acme-ca4c8.test" });
    const hiringAccess = await resolveHrAccessContext({ user: hiringUser, company: acme, models });
    const recruitment = await executeHrAnalystTool(
      "analyzeRecruitmentAndOffers",
      {},
      { models, company: acme, user: hiringUser, hrAccess: hiringAccess }
    );
    assert.ok(recruitment.funnel);
    assert.equal(recruitment.error, undefined);
  });
});

describe("CA4-C.8 P1.13 invalid scope mode", () => {
  it("fails closed for a missing or malformed scope mode", async () => {
    const user = {
      role: USER_ROLES.HR_ADMIN,
      hrAccess: {
        version: 1,
        configuredAt: new Date(),
        permissions: ["people.view"],
        employeeScope: { mode: "custom", departmentIds: [], employeeIds: [] },
      },
    };
    const malformed = await resolveHrAccessContext({ user, company: acme, models });
    assert.equal(malformed.configured, false);
    assert.equal(malformed.denyReason, "HR_SCOPE_MODE_INVALID");
    assert.equal(isEmployeeIdInScope(malformed, ids.alice), false);
    assert.throws(
      () => assertHrPermission(malformed, "people.view"),
      (err) => err.code === "HR_SCOPE_MODE_INVALID"
    );
    assert.throws(
      () => mergeEmployeeScopeFilter(malformed, {}),
      (err) => err.code === "HR_SCOPE_MODE_INVALID"
    );

    const missing = await resolveHrAccessContext({
      user: {
        role: USER_ROLES.HR_ADMIN,
        hrAccess: {
          version: 1,
          configuredAt: new Date(),
          permissions: ["people.view"],
          employeeScope: { departmentIds: [ids.eng], employeeIds: [] },
        },
      },
      company: acme,
      models,
    });
    assert.equal(missing.denyReason, "HR_SCOPE_MODE_INVALID");

    await models.User.collection.updateOne(
      { _id: ids.hrCustom },
      { $set: { "hrAccess.employeeScope.mode": "custom" } }
    );
    try {
      const res = await request(app).get("/api/employees").set("Cookie", cookies.custom);
      assert.equal(res.status, 403);
      assert.equal(res.body.code, "HR_SCOPE_MODE_INVALID");
    } finally {
      await models.User.collection.updateOne(
        { _id: ids.hrCustom },
        { $set: { "hrAccess.employeeScope.mode": "CUSTOM" } }
      );
    }
  });
});

describe("CA4-C.8 P2.14 department name matching", () => {
  it("does not include an employee whose department name matches but department id does not", async () => {
    const res = await request(app).get("/api/employees").set("Cookie", cookies.custom);
    assert.equal(res.status, 200, res.body?.message);
    const blob = JSON.stringify(res.body);
    assert.equal(blob.includes("Nina Nameonly"), false);
    assert.equal(blob.includes("C8-004"), false);
    assert.equal(blob.includes("Alice Engineer"), true);

    const company = await request(app).get("/api/employees").set("Cookie", cookies.company);
    assert.equal(company.status, 200);
    assert.equal(JSON.stringify(company.body).includes("Nina Nameonly"), true);
  });
});

describe("CA4-C.8 P2.15 leave SSE scope refresh", () => {
  it("stops delivering events on an open connection after scope is reduced", async () => {
    const companyId = String(acme._id);
    let collected = [];
    try {
    collected = await withLeaveSseSubscription(cookies.custom, async ({ frames }) => {
      await new Promise((resolve) => setImmediate(resolve));
      emitLeaveEvent({
        type: "LEAVE_UPDATED",
        companyId,
        employeeId: ids.alice,
        reason: "alice-before-reduce",
      });
      await waitFor(frames, (all) => all.some((frame) => frame.reason === "alice-before-reduce"));

      await models.User.updateOne(
        { _id: ids.hrCustom },
        {
          $set: {
            "hrAccess.employeeScope.departmentIds": [],
            "hrAccess.employeeScope.employeeIds": [ids.charlie],
          },
        }
      );
      emitLeaveEvent({
        type: "LEAVE_UPDATED",
        companyId,
        employeeId: ids.alice,
        reason: "alice-after-reduce",
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      emitLeaveEvent({
        type: "LEAVE_UPDATED",
        companyId,
        employeeId: ids.charlie,
        reason: "charlie-after-reduce",
      });
      await waitFor(frames, (all) => all.some((frame) => frame.reason === "charlie-after-reduce"));

      await Company.findByIdAndUpdate(acme._id, {
        $set: { "config.hrAccessEnforcement.mode": "OFF" },
      });
      emitLeaveEvent({
        type: "LEAVE_UPDATED",
        companyId,
        employeeId: ids.bob,
        reason: "bob-while-enforcement-off",
      });
      await waitFor(frames, (all) => all.some((frame) => frame.reason === "bob-while-enforcement-off"));
      await Company.findByIdAndUpdate(acme._id, {
        $set: { "config.hrAccessEnforcement.mode": "ENFORCED" },
      });
      emitLeaveEvent({
        type: "LEAVE_UPDATED",
        companyId,
        employeeId: ids.bob,
        reason: "bob-after-enforcement-on",
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return frames();
    });

    assert.equal(collected.some((frame) => frame.reason === "alice-before-reduce"), true);
    assert.equal(collected.some((frame) => frame.reason === "alice-after-reduce"), false);
    assert.equal(collected.some((frame) => frame.reason === "charlie-after-reduce"), true);
    assert.equal(collected.some((frame) => frame.reason === "bob-while-enforcement-off"), true);
    assert.equal(collected.some((frame) => frame.reason === "bob-after-enforcement-on"), false);
    } finally {
      await Company.findByIdAndUpdate(acme._id, {
        $set: { "config.hrAccessEnforcement.mode": "ENFORCED" },
      });
      await models.User.updateOne(
        { _id: ids.hrCustom },
        {
          $set: {
            "hrAccess.employeeScope.departmentIds": [ids.eng],
            "hrAccess.employeeScope.employeeIds": [],
          },
        }
      );
    }
  });
});

describe("CA4-C.8 P2.16 task department metadata", () => {
  it("does not reveal departments that belong only to out-of-scope employees", async () => {
    const custom = await request(app).get("/api/tasks/meta").set("Cookie", cookies.custom);
    assert.equal(custom.status, 200, custom.body?.message);
    const departments = custom.body.departments || custom.body.data?.departments || [];
    assert.equal(departments.includes("Design"), false);
    assert.equal(departments.includes("Engineering"), true);

    const company = await request(app).get("/api/tasks/meta").set("Cookie", cookies.company);
    assert.equal(company.status, 200);
    const companyDepartments = company.body.departments || company.body.data?.departments || [];
    assert.equal(companyDepartments.includes("Design"), true);
  });
});

describe("CA4-C.8 P2.17 handover backup employee", () => {
  it("rejects an out-of-scope backup without changing the handover item", async () => {
    const noPerm = await request(app)
      .post(`/api/handovers/${ids.handoverLeave}/items/${ids.handoverItem}/reassign`)
      .set("Cookie", cookies.dash)
      .send({ backupEmployeeId: String(ids.charlie) });
    assert.equal(noPerm.status, 403);

    const denied = await request(app)
      .post(`/api/handovers/${ids.handoverLeave}/items/${ids.handoverItem}/reassign`)
      .set("Cookie", cookies.custom)
      .send({ backupEmployeeId: String(ids.bob) });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "HR_SCOPE_DENIED");
    let leave = await models.LeaveRequest.findById(ids.handoverLeave).lean();
    const item = leave.handover.items.find((row) => String(row._id) === String(ids.handoverItem));
    assert.equal(item.backupEmployeeId, null);

    const allowed = await request(app)
      .post(`/api/handovers/${ids.handoverLeave}/items/${ids.handoverItem}/reassign`)
      .set("Cookie", cookies.custom)
      .send({ backupEmployeeId: String(ids.charlie) });
    assert.equal(allowed.status, 200, allowed.body?.message);
    leave = await models.LeaveRequest.findById(ids.handoverLeave).lean();
    const updated = leave.handover.items.find((row) => String(row._id) === String(ids.handoverItem));
    assert.equal(String(updated.backupEmployeeId), String(ids.charlie));

    const company = await request(app)
      .post(`/api/handovers/${ids.handoverLeave}/items/${ids.handoverItemCompany}/reassign`)
      .set("Cookie", cookies.company)
      .send({ backupEmployeeId: String(ids.bob) });
    assert.equal(company.status, 200, company.body?.message);
    leave = await models.LeaveRequest.findById(ids.handoverLeave).lean();
    const companyItem = leave.handover.items.find(
      (row) => String(row._id) === String(ids.handoverItemCompany)
    );
    assert.equal(String(companyItem.backupEmployeeId), String(ids.bob));
  });
});

describe("CA4-C.8 employee, candidate, and enforcement-off behavior", () => {
  it("keeps employee self-service, rejects candidates, and preserves legacy HR when enforcement is off", async () => {
    const me = await request(app).get("/api/employees/me").set("Cookie", cookies.employee);
    assert.equal(me.status, 200, me.body?.message);

    const selfProfile = await request(app)
      .get(`/api/employees/${ids.alice}/visible-profile`)
      .set("Cookie", cookies.employee);
    assert.equal(selfProfile.status, 200);
    assert.equal(selfProfile.body.employee.fullName, "Alice Engineer");
    assert.equal(selfProfile.body.employee.bankDetails.accountNumber, "SECRET-ALICE-ACCT");
    const otherProfile = await request(app)
      .get(`/api/employees/${ids.bob}/visible-profile`)
      .set("Cookie", cookies.employee);
    assert.equal(JSON.stringify(otherProfile.body).includes("SECRET-BOB-ACCT"), false);

    const candidate = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca4c8",
      email: "candidate@acme-ca4c8.test",
      password: PASSWORD,
    });
    assert.notEqual(candidate.status, 200);
    assert.equal(candidate.body.code, "CANDIDATE_ACCESS_DENIED");

    const legacyProfile = await request(app)
      .get(`/api/employees/${ids.legacyEmp}/visible-profile`)
      .set("Cookie", cookies.legacy);
    assert.equal(legacyProfile.status, 200, legacyProfile.body?.message);
    assert.equal(legacyProfile.body.employee.bankDetails.accountNumber, "SECRET-LEGACY-ACCT");

    const legacyPatch = await request(app)
      .patch(`/api/tasks/${ids.legacyTask}`)
      .set("Cookie", cookies.legacy)
      .send({ title: "Legacy HR update" });
    assert.equal(legacyPatch.status, 200, legacyPatch.body?.message);
    assert.equal((await legacyModels.Task.findById(ids.legacyTask).lean()).title, "Legacy HR update");

    const legacyCompany = await Company.findById(legacy._id).lean();
    assert.equal(legacyCompany.config?.hrAccessEnforcement?.mode || "OFF", "OFF");

    const oversight = await request(app)
      .get("/api/company-admin/hr-access/enforcement")
      .set("Cookie", cookies.ca);
    assert.equal(oversight.status, 200);
    const hrBoundary = await request(app)
      .get("/api/company-admin/hr-admins")
      .set("Cookie", cookies.custom);
    assert.equal(hrBoundary.status, 403);
  });
});
