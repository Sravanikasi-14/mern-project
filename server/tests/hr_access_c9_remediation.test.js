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
import { emitOnboardingEvent } from "../services/onboardingEventsService.js";

const PASSWORD = "HrC9RemediatePass1!";
const BROAD = [
  "people.view",
  "people.create",
  "organization.view",
  "organization.manage",
  "dashboard.view",
  "payroll.view",
  "leave.view",
  "leave.edit",
  "hiring.view",
  "assets.view",
  "assets.assign",
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

async function makeTask(modelsRef, { assigneeId, assignedByUserId, title }) {
  return modelsRef.Task.create({
    title,
    description: "Coverage task",
    assigneeId,
    assignedByUserId,
    priority: "MEDIUM",
    status: TASK_STATUSES.ASSIGNED,
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

function withOnboardingSse(cookie, onReady, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${baseUrl}/api/onboarding/events`,
      { headers: { Cookie: cookie, Accept: "text/event-stream" } },
      (res) => {
        let buffer = "";
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            req.destroy();
            reject(new Error("Onboarding SSE subscription timed out"));
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
  fs.rmSync("D:/tmp/hrms-mongo/ca4c9-remediation", { recursive: true, force: true });
  fs.mkdirSync("D:/tmp/hrms-mongo/ca4c9-remediation", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/ca4c9-remediation", storageEngine: "wiredTiger" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  acme = await Company.create({
    companyName: "Acme CA4C9",
    slug: "acme-ca4c9",
    databaseName: "company_acme_ca4c9",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { hrAccessEnforcement: { mode: "OFF" } },
  });
  legacy = await Company.create({
    companyName: "Legacy CA4C9",
    slug: "legacy-ca4c9",
    databaseName: "company_legacy_ca4c9",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });

  models = await getCompanyModels(acme);
  legacyModels = await getCompanyModels(legacy);
  const passwordHash = await hashPassword(PASSWORD);
  const eng = await models.Department.create({ name: "Engineering", isActive: true });
  const design = await models.Department.create({ name: "Design", isActive: true });

  const bob = await models.Employee.create({
    employeeCode: "C9-002",
    fullName: "Bob Designer",
    email: "bob@acme-ca4c9.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Designer", department: "Design", departmentId: design._id },
  });
  const alice = await models.Employee.create({
    employeeCode: "C9-001",
    fullName: "Alice Engineer",
    email: "alice@acme-ca4c9.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Engineer",
      department: "Engineering",
      departmentId: eng._id,
      reportingManagerId: bob._id,
    },
  });
  const charlie = await models.Employee.create({
    employeeCode: "C9-003",
    fullName: "Charlie Engineer",
    email: "charlie@acme-ca4c9.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Engineer",
      department: "Engineering",
      departmentId: eng._id,
      reportingManagerId: alice._id,
    },
  });

  await models.EmployeeCompensation.create({
    employeeId: alice._id,
    revisions: [{ effectiveFromDate: new Date("2020-01-01"), monthlyCostToCompany: 50000 }],
  });

  const customScope = { mode: "CUSTOM", departmentIds: [eng._id], employeeIds: [] };
  const companyScope = { mode: "COMPANY", departmentIds: [], employeeIds: [] };
  const hrCustom = await models.User.create({
    email: "hr.custom@acme-ca4c9.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Custom HR",
    isActive: true,
    hrAccess: hrAccessDoc(BROAD, customScope),
  });
  await models.User.create({
    email: "hr.company@acme-ca4c9.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Company HR",
    isActive: true,
    hrAccess: hrAccessDoc(BROAD, companyScope),
  });
  await models.User.create({
    email: "hr.dash@acme-ca4c9.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Dash HR",
    isActive: true,
    hrAccess: hrAccessDoc(["dashboard.view"], customScope),
  });
  await models.User.create({
    email: "hr.leaveview@acme-ca4c9.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Leave View HR",
    isActive: true,
    hrAccess: hrAccessDoc(["leave.view"], customScope),
  });
  const aliceUser = await models.User.create({
    email: "alice@acme-ca4c9.test",
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Alice Engineer",
    isActive: true,
    employeeId: alice._id,
  });
  alice.userId = aliceUser._id;
  await alice.save();
  await models.User.create({
    email: "candidate@acme-ca4c9.test",
    passwordHash,
    role: USER_ROLES.CANDIDATE,
    fullName: "Casey Candidate",
    isActive: true,
  });
  await createCompanyAdmin(models.User, {
    email: "ca@acme-ca4c9.test",
    passwordHash,
    fullName: "Acme CA",
  });

  const mixedTeam = await models.Team.create({
    name: "Platform",
    department: "Engineering",
    memberEmployeeIds: [alice._id, bob._id],
    leadEmployeeId: alice._id,
    isActive: true,
  });
  const task = await makeTask(models, {
    assigneeId: alice._id,
    assignedByUserId: hrCustom._id,
    title: "Handover coverage",
  });
  const taskTwo = await makeTask(models, {
    assigneeId: alice._id,
    assignedByUserId: hrCustom._id,
    title: "Handover coverage two",
  });
  const selfTask = await makeTask(models, {
    assigneeId: alice._id,
    assignedByUserId: aliceUser._id,
    title: "Employee handover coverage",
  });
  const handoverLeave = await models.LeaveRequest.create({
    employeeId: alice._id,
    leaveTypeCode: "CL",
    fromDate: new Date("2026-09-01"),
    toDate: new Date("2026-09-05"),
    reason: "handover-c9",
    status: "PENDING",
    handover: {
      status: "DRAFT",
      items: [
        { taskId: task._id, status: "DRAFT" },
        { taskId: taskTwo._id, status: "DRAFT" },
      ],
    },
  });
  const selfLeave = await models.LeaveRequest.create({
    employeeId: alice._id,
    leaveTypeCode: "CL",
    fromDate: new Date("2026-10-01"),
    toDate: new Date("2026-10-02"),
    reason: "employee-handover-c9",
    status: "PENDING",
    handover: {
      status: "DRAFT",
      items: [{ taskId: selfTask._id, status: "DRAFT" }],
    },
  });
  const assetBob = await models.CompanyAsset.create({
    assetTag: "C9-BOB-LAP",
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

  await models.OfferLetter.create({
    candidate: { fullName: "Offer Person", email: "offer-c9@acme-ca4c9.test" },
    position: "Engineer",
    department: "Engineering",
    monthlySalary: 1000,
    joiningDate: new Date("2026-08-01"),
    content: "Offer",
    status: OFFER_LETTER_STATUSES.DRAFT,
  });

  const legacyEmp = await legacyModels.Employee.create({
    employeeCode: "LEG-001",
    fullName: "Legacy Employee",
    email: "legacy.emp@legacy-ca4c9.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering" },
  });
  await legacyModels.Department.create({ name: "Design", isActive: true });
  await legacyModels.User.create({
    email: "hr@legacy-ca4c9.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Legacy HR",
    isActive: true,
  });
  await legacyModels.EmployeeCompensation.create({
    employeeId: legacyEmp._id,
    revisions: [{ effectiveFromDate: new Date("2020-01-01"), monthlyCostToCompany: 22000 }],
  });

  await Company.findByIdAndUpdate(acme._id, {
    $set: { "config.hrAccessEnforcement.mode": "ENFORCED" },
  });

  cookies = {
    custom: await login("acme-ca4c9", "hr.custom@acme-ca4c9.test"),
    company: await login("acme-ca4c9", "hr.company@acme-ca4c9.test"),
    dash: await login("acme-ca4c9", "hr.dash@acme-ca4c9.test"),
    leaveView: await login("acme-ca4c9", "hr.leaveview@acme-ca4c9.test"),
    employee: await login("acme-ca4c9", "alice@acme-ca4c9.test"),
    legacy: await login("legacy-ca4c9", "hr@legacy-ca4c9.test"),
  };
  ids = {
    alice: alice._id,
    bob: bob._id,
    charlie: charlie._id,
    hrCustom: hrCustom._id,
    mixedTeam: mixedTeam._id,
    handoverLeave: handoverLeave._id,
    handoverItem: handoverLeave.handover.items[0]._id,
    handoverItemCompany: handoverLeave.handover.items[1]._id,
    selfLeave: selfLeave._id,
    selfItem: selfLeave.handover.items[0]._id,
    assetBob: assetBob._id,
    broad: BROAD,
  };
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("CA4-C.9 team writes", () => {
  it("rejects unauthorized members and redacts them on update and deactivate", async () => {
    const deniedPerm = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", cookies.dash)
      .send({ name: "No Perm Team", memberEmployeeIds: [String(ids.charlie)] });
    assert.equal(deniedPerm.status, 403);
    assert.equal(await models.Team.countDocuments({ name: "No Perm Team" }), 0);

    const employeeDenied = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", cookies.employee)
      .send({ name: "Employee Team", memberEmployeeIds: [String(ids.alice)] });
    assert.equal(employeeDenied.status, 403);

    const before = await models.Team.findById(ids.mixedTeam).lean();
    const rejected = await request(app)
      .put(`/api/employees/organization-explorer/teams/${ids.mixedTeam}`)
      .set("Cookie", cookies.custom)
      .send({ name: "Should Not Stick", memberEmployeeIds: [String(ids.bob)] });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.code, "HR_SCOPE_DENIED");
    const afterReject = await models.Team.findById(ids.mixedTeam).lean();
    assert.equal(afterReject.name, before.name);
    assert.deepEqual(
      afterReject.memberEmployeeIds.map(String).sort(),
      before.memberEmployeeIds.map(String).sort()
    );

    const created = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", cookies.custom)
      .send({
        name: "Scoped Squad",
        department: "Engineering",
        leadEmployeeId: String(ids.charlie),
        memberEmployeeIds: [String(ids.charlie)],
      });
    assert.equal(created.status, 201, created.body?.message);
    const createdBlob = JSON.stringify(created.body);
    assert.equal(createdBlob.includes("Charlie Engineer"), true);
    assert.equal(createdBlob.includes("Bob Designer"), false);
    const stored = await models.Team.findOne({ name: "Scoped Squad" }).lean();
    assert.ok(stored);
    assert.equal(stored.memberEmployeeIds.map(String).includes(String(ids.bob)), false);
    assert.equal(stored.memberEmployeeIds.map(String).includes(String(ids.charlie)), true);

    const outOfScopeCreate = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", cookies.custom)
      .send({ name: "Leak Squad", memberEmployeeIds: [String(ids.bob)] });
    assert.equal(outOfScopeCreate.status, 403);
    assert.equal(await models.Team.countDocuments({ name: "Leak Squad" }), 0);

    const renamed = await request(app)
      .put(`/api/employees/organization-explorer/teams/${ids.mixedTeam}`)
      .set("Cookie", cookies.custom)
      .send({ name: "Platform Renamed" });
    assert.equal(renamed.status, 200, renamed.body?.message);
    const renamedBlob = JSON.stringify(renamed.body);
    assert.equal(renamedBlob.includes("Bob Designer"), false);
    assert.equal(renamedBlob.includes("C9-002"), false);
    assert.equal(renamedBlob.includes("Alice Engineer"), true);
    const renamedDoc = await models.Team.findById(ids.mixedTeam).lean();
    assert.equal(renamedDoc.name, "Platform Renamed");
    assert.equal(renamedDoc.memberEmployeeIds.map(String).includes(String(ids.bob)), true);

    const company = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", cookies.company)
      .send({ name: "Company Squad", memberEmployeeIds: [String(ids.bob)] });
    assert.equal(company.status, 201, company.body?.message);
    assert.equal(JSON.stringify(company.body).includes("Bob Designer"), true);

    const legacyCreate = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", cookies.legacy)
      .send({
        name: "Legacy Squad",
        memberEmployeeIds: [String(legacyModels ? (await legacyModels.Employee.findOne().select("_id").lean())._id : "")],
      });
    assert.equal(legacyCreate.status, 201, legacyCreate.body?.message);
    assert.equal(JSON.stringify(legacyCreate.body).includes("Legacy Employee"), true);

    const deactivated = await request(app)
      .patch(`/api/employees/organization-explorer/teams/${ids.mixedTeam}/deactivate`)
      .set("Cookie", cookies.custom);
    assert.equal(deactivated.status, 200, deactivated.body?.message);
    const deactivatedBlob = JSON.stringify(deactivated.body);
    assert.equal(deactivatedBlob.includes("Bob Designer"), false);
    assert.equal(deactivatedBlob.includes("C9-002"), false);
    const inactive = await models.Team.findById(ids.mixedTeam).lean();
    assert.equal(inactive.isActive, false);
    assert.equal(inactive.memberEmployeeIds.map(String).includes(String(ids.bob)), true);
  });
});

describe("CA4-C.9 handover draft update", () => {
  it("requires leave.edit, rejects an out-of-scope backup, and keeps employee selection", async () => {
    const noEdit = await request(app)
      .put(`/api/handovers/${ids.handoverLeave}`)
      .set("Cookie", cookies.leaveView)
      .send({ items: [{ itemId: String(ids.handoverItem), backupEmployeeId: String(ids.charlie) }] });
    assert.equal(noEdit.status, 403);
    let leave = await models.LeaveRequest.findById(ids.handoverLeave).lean();
    let item = leave.handover.items.find((row) => String(row._id) === String(ids.handoverItem));
    assert.equal(item.backupEmployeeId, null);

    const denied = await request(app)
      .put(`/api/handovers/${ids.handoverLeave}`)
      .set("Cookie", cookies.custom)
      .send({ items: [{ itemId: String(ids.handoverItem), backupEmployeeId: String(ids.bob) }] });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "HR_SCOPE_DENIED");
    assert.equal(JSON.stringify(denied.body).includes("Bob Designer"), false);
    leave = await models.LeaveRequest.findById(ids.handoverLeave).lean();
    item = leave.handover.items.find((row) => String(row._id) === String(ids.handoverItem));
    assert.equal(item.backupEmployeeId, null);

    const allowed = await request(app)
      .put(`/api/handovers/${ids.handoverLeave}`)
      .set("Cookie", cookies.custom)
      .send({ items: [{ itemId: String(ids.handoverItem), backupEmployeeId: String(ids.charlie) }] });
    assert.equal(allowed.status, 200, allowed.body?.message);
    assert.equal(JSON.stringify(allowed.body).includes("Charlie Engineer"), true);
    leave = await models.LeaveRequest.findById(ids.handoverLeave).lean();
    item = leave.handover.items.find((row) => String(row._id) === String(ids.handoverItem));
    assert.equal(String(item.backupEmployeeId), String(ids.charlie));

    const company = await request(app)
      .put(`/api/handovers/${ids.handoverLeave}`)
      .set("Cookie", cookies.company)
      .send({
        items: [{ itemId: String(ids.handoverItemCompany), backupEmployeeId: String(ids.bob) }],
      });
    assert.equal(company.status, 200, company.body?.message);
    assert.equal(JSON.stringify(company.body).includes("Bob Designer"), true);
    leave = await models.LeaveRequest.findById(ids.handoverLeave).lean();
    const companyItem = leave.handover.items.find(
      (row) => String(row._id) === String(ids.handoverItemCompany)
    );
    assert.equal(String(companyItem.backupEmployeeId), String(ids.bob));

    const customRead = await request(app)
      .get(`/api/handovers/${ids.handoverLeave}`)
      .set("Cookie", cookies.custom);
    assert.equal(customRead.status, 200, customRead.body?.message);
    const readBlob = JSON.stringify(customRead.body);
    assert.equal(readBlob.includes("Bob Designer"), false);
    assert.equal(readBlob.includes("C9-002"), false);
    assert.equal(readBlob.includes("Charlie Engineer"), true);

    const self = await request(app)
      .put(`/api/handovers/${ids.selfLeave}`)
      .set("Cookie", cookies.employee)
      .send({ items: [{ itemId: String(ids.selfItem), backupEmployeeId: String(ids.bob) }] });
    assert.equal(self.status, 200, self.body?.message);
    assert.equal(JSON.stringify(self.body).includes("Bob Designer"), true);
    const selfLeave = await models.LeaveRequest.findById(ids.selfLeave).lean();
    assert.equal(String(selfLeave.handover.items[0].backupEmployeeId), String(ids.bob));
  });
});

describe("CA4-C.9 single employee creation", () => {
  it("does not provision an account outside CUSTOM department scope", async () => {
    const noPerm = await request(app)
      .post("/api/employees")
      .set("Cookie", cookies.dash)
      .send({
        fullName: "No Perm Hire",
        email: "noperm@acme-ca4c9.test",
        employeeCode: "C9-NP",
        department: "Engineering",
      });
    assert.equal(noPerm.status, 403);
    assert.equal(await models.User.countDocuments({ email: "noperm@acme-ca4c9.test" }), 0);
    assert.equal(await models.Employee.countDocuments({ email: "noperm@acme-ca4c9.test" }), 0);

    const denied = await request(app)
      .post("/api/employees")
      .set("Cookie", cookies.custom)
      .send({
        fullName: "Design Hire",
        email: "design.hire@acme-ca4c9.test",
        employeeCode: "C9-DSN",
        department: "Design",
      });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "HR_SCOPE_DENIED");
    assert.equal(denied.body.activation, undefined);
    assert.equal(await models.User.countDocuments({ email: "design.hire@acme-ca4c9.test" }), 0);
    assert.equal(await models.Employee.countDocuments({ email: "design.hire@acme-ca4c9.test" }), 0);

    const allowed = await request(app)
      .post("/api/employees")
      .set("Cookie", cookies.custom)
      .send({
        fullName: "Eng Hire",
        email: "eng.hire@acme-ca4c9.test",
        employeeCode: "C9-ENG",
        department: "Engineering",
      });
    assert.equal(allowed.status, 201, allowed.body?.message);
    assert.ok(allowed.body.activation?.activationLink);
    assert.equal(await models.User.countDocuments({ email: "eng.hire@acme-ca4c9.test" }), 1);
    assert.equal(await models.Employee.countDocuments({ email: "eng.hire@acme-ca4c9.test" }), 1);

    const company = await request(app)
      .post("/api/employees")
      .set("Cookie", cookies.company)
      .send({
        fullName: "Company Design Hire",
        email: "company.design@acme-ca4c9.test",
        employeeCode: "C9-CD",
        department: "Design",
      });
    assert.equal(company.status, 201, company.body?.message);
    assert.ok(company.body.activation?.activationLink);
    assert.equal(await models.User.countDocuments({ email: "company.design@acme-ca4c9.test" }), 1);

    const legacyCreate = await request(app)
      .post("/api/employees")
      .set("Cookie", cookies.legacy)
      .send({
        fullName: "Legacy Design Hire",
        email: "legacy.design@legacy-ca4c9.test",
        employeeCode: "LEG-DSN",
        department: "Design",
      });
    assert.equal(legacyCreate.status, 201, legacyCreate.body?.message);
    assert.ok(legacyCreate.body.activation?.activationLink);
    assert.equal(
      await legacyModels.User.countDocuments({ email: "legacy.design@legacy-ca4c9.test" }),
      1
    );

    const employeeDenied = await request(app)
      .post("/api/employees")
      .set("Cookie", cookies.employee)
      .send({
        fullName: "Employee Hire",
        email: "employee.hire@acme-ca4c9.test",
        employeeCode: "C9-EMP",
        department: "Engineering",
      });
    assert.equal(employeeDenied.status, 403);
    assert.equal(await models.User.countDocuments({ email: "employee.hire@acme-ca4c9.test" }), 0);
  });
});

describe("CA4-C.9 asset assignment error", () => {
  it("does not reveal an out-of-scope assignee name", async () => {
    const noPerm = await request(app)
      .post(`/api/assets/${ids.assetBob}/assign`)
      .set("Cookie", cookies.dash)
      .send({ employeeId: String(ids.charlie) });
    assert.equal(noPerm.status, 403);
    let asset = await models.CompanyAsset.findById(ids.assetBob).lean();
    assert.equal(String(asset.currentAssignment.employeeId), String(ids.bob));

    const denied = await request(app)
      .post(`/api/assets/${ids.assetBob}/assign`)
      .set("Cookie", cookies.custom)
      .send({ employeeId: String(ids.charlie) });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "HR_SCOPE_DENIED");
    const deniedBlob = JSON.stringify(denied.body);
    assert.equal(deniedBlob.includes("Bob Designer"), false);
    assert.equal(deniedBlob.includes("C9-002"), false);
    asset = await models.CompanyAsset.findById(ids.assetBob).lean();
    assert.equal(String(asset.currentAssignment.employeeId), String(ids.bob));
    assert.equal(asset.currentAssignment.employeeName, "Bob Designer");

    const company = await request(app)
      .post(`/api/assets/${ids.assetBob}/assign`)
      .set("Cookie", cookies.company)
      .send({ employeeId: String(ids.charlie) });
    assert.equal(company.status, 400);
    assert.equal(JSON.stringify(company.body).includes("Bob Designer"), true);
    asset = await models.CompanyAsset.findById(ids.assetBob).lean();
    assert.equal(String(asset.currentAssignment.employeeId), String(ids.bob));
  });
});

describe("CA4-C.9 reporting manager identity", () => {
  it("hides an out-of-scope manager name and keeps in-scope and self-service names", async () => {
    const list = await request(app).get("/api/employees").set("Cookie", cookies.custom);
    assert.equal(list.status, 200, list.body?.message);
    const aliceRow = (list.body.employees || []).find((row) => row.employeeCode === "C9-001");
    const charlieRow = (list.body.employees || []).find((row) => row.employeeCode === "C9-003");
    assert.equal(JSON.stringify(aliceRow.job.reportingManagerId).includes("Bob Designer"), false);
    assert.equal(JSON.stringify(aliceRow.job.reportingManagerId).includes("C9-002"), false);
    assert.equal(charlieRow.job.reportingManagerId.fullName, "Alice Engineer");
    assert.equal(charlieRow.job.reportingManagerId.employeeCode, "C9-001");

    const detail = await request(app).get(`/api/employees/${ids.alice}`).set("Cookie", cookies.custom);
    assert.equal(detail.status, 200, detail.body?.message);
    assert.equal(JSON.stringify(detail.body.job.reportingManagerId).includes("Bob Designer"), false);
    assert.equal(JSON.stringify(detail.body.job.reportingManagerId).includes("C9-002"), false);

    const visible = await request(app)
      .get(`/api/employees/${ids.alice}/visible-profile`)
      .set("Cookie", cookies.custom);
    assert.equal(visible.status, 200, visible.body?.message);
    assert.equal(
      JSON.stringify(visible.body.employee.job.reportingManagerId).includes("Bob Designer"),
      false
    );

    const offers = await request(app).get("/api/offer-letters/recipients").set("Cookie", cookies.custom);
    assert.equal(offers.status, 200, offers.body?.message);
    const offerAlice = (offers.body.recipients || []).find((row) => row.employeeCode === "C9-001");
    const offerCharlie = (offers.body.recipients || []).find((row) => row.employeeCode === "C9-003");
    assert.equal(offerAlice.reportingManager, "");
    assert.equal(offerCharlie.reportingManager, "Alice Engineer");
    assert.equal(JSON.stringify(offers.body).includes("Bob Designer"), false);

    const company = await request(app).get("/api/employees").set("Cookie", cookies.company);
    const companyAlice = (company.body.employees || []).find((row) => row.employeeCode === "C9-001");
    assert.equal(companyAlice.job.reportingManagerId.fullName, "Bob Designer");
    assert.equal(companyAlice.job.reportingManagerId.employeeCode, "C9-002");

    const self = await request(app).get("/api/employees/me").set("Cookie", cookies.employee);
    assert.equal(self.status, 200, self.body?.message);
    assert.equal(self.body.employee.job.reportingManagerId.fullName, "Bob Designer");
    assert.equal(self.body.employee.job.reportingManagerId.employeeCode, "C9-002");

    const selfVisible = await request(app)
      .get(`/api/employees/${ids.alice}/visible-profile`)
      .set("Cookie", cookies.employee);
    assert.equal(selfVisible.status, 200);
    assert.equal(selfVisible.body.employee.job.reportingManagerId.fullName, "Bob Designer");
  });
});

describe("CA4-C.9 dashboard compensation permission", () => {
  it("omits payroll totals without payroll.view and keeps them for authorized HR", async () => {
    const dash = await request(app).get("/api/admin/dashboard").set("Cookie", cookies.dash);
    assert.equal(dash.status, 200, dash.body?.message);
    assert.equal(dash.body.summary.monthlyPayroll, null);
    assert.equal(dash.body.payrollAllocation.restricted, true);
    assert.equal(dash.body.summary.activeEmployees > 0, true);
    assert.equal(JSON.stringify(dash.body.payrollAllocation).includes("50000"), false);
    assert.equal(dash.body.salaryExpenses.restricted, true);
    assert.equal(dash.body.payrollCycleSummary.restricted, true);
    assert.equal(dash.body.recentLeaves.restricted, true);
    assert.equal(dash.body.attendanceCalendar.restricted, true);

    const paid = await request(app).get("/api/admin/dashboard").set("Cookie", cookies.custom);
    assert.equal(paid.status, 200, paid.body?.message);
    assert.equal(paid.body.summary.monthlyPayroll, 50000);
    assert.equal(paid.body.payrollAllocation.restricted, undefined);
    assert.equal(paid.body.payrollAllocation.totalMonthly, 50000);

    const company = await request(app).get("/api/admin/dashboard").set("Cookie", cookies.company);
    assert.equal(company.status, 200, company.body?.message);
    assert.equal(typeof company.body.summary.monthlyPayroll, "number");
    assert.equal(company.body.payrollAllocation.restricted, undefined);

    const legacyDash = await request(app).get("/api/admin/dashboard").set("Cookie", cookies.legacy);
    assert.equal(legacyDash.status, 200, legacyDash.body?.message);
    assert.equal(legacyDash.body.summary.monthlyPayroll, 22000);
  });
});

describe("CA4-C.9 onboarding SSE permission refresh", () => {
  it("stops an open connection after hiring.view is removed", async () => {
    const employeeProbe = await request(app)
      .get("/api/onboarding/events?probe=1")
      .set("Cookie", cookies.employee);
    assert.equal(employeeProbe.status, 403);

    const candidate = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca4c9",
      email: "candidate@acme-ca4c9.test",
      password: PASSWORD,
    });
    assert.equal(candidate.body.code, "CANDIDATE_ACCESS_DENIED");

    const companyId = String(acme._id);
    let collected = [];
    try {
      collected = await withOnboardingSse(cookies.custom, async ({ frames }) => {
        await new Promise((resolve) => setImmediate(resolve));
        emitOnboardingEvent({
          type: "SUBMISSION",
          companyId,
          submissionId: "sub-before",
          status: "before-revoke",
        });
        await waitFor(frames, (all) => all.some((frame) => frame.status === "before-revoke"));

        await models.User.updateOne(
          { _id: ids.hrCustom },
          { $set: { "hrAccess.permissions": ["people.view", "dashboard.view"] } }
        );
        emitOnboardingEvent({
          type: "SUBMISSION",
          companyId,
          submissionId: "sub-after",
          status: "after-revoke",
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        return frames();
      });
    } finally {
      await models.User.updateOne(
        { _id: ids.hrCustom },
        { $set: { "hrAccess.permissions": ids.broad } }
      );
    }

    assert.equal(collected.some((frame) => frame.status === "before-revoke"), true);
    assert.equal(collected.some((frame) => frame.status === "after-revoke"), false);

    const legacyFrames = await withOnboardingSse(cookies.legacy, async ({ frames }) => {
      emitOnboardingEvent({
        type: "SUBMISSION",
        companyId: String(legacy._id),
        submissionId: "legacy-sub",
        status: "legacy-still-delivered",
      });
      await waitFor(frames, (all) => all.some((frame) => frame.status === "legacy-still-delivered"));
      return frames();
    });
    assert.equal(legacyFrames.some((frame) => frame.status === "legacy-still-delivered"), true);

    const mode = (await Company.findById(acme._id).lean()).config.hrAccessEnforcement.mode;
    assert.equal(mode, "ENFORCED");
    const legacyMode = (await Company.findById(legacy._id).lean()).config?.hrAccessEnforcement?.mode || "OFF";
    assert.equal(legacyMode, "OFF");
  });
});
