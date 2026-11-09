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
import {
  assertHrPermission,
  isEmployeeIdInScope,
  mergeEmployeeScopeFilter,
  resolveHrAccessContext,
} from "../services/hrAccessEnforcementService.js";

const PASSWORD = "HrEnforcePass1!";

let mongo;
let app;
let acme;
let caCookie;
let hrCookie;
let empCookie;
let hrAdminId;
let engDeptId;
let designDeptId;
let employeeIdA;
let employeeIdB;

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

const DB_PATH = "D:/tmp/hrms-mongo/ca4c-hr-enforce-iso";

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
    companyName: "Acme CA4C",
    slug: "acme-ca4c-iso",
    databaseName: "company_acme_ca4c",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });

  const models = await getCompanyModels(acme);
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
  designDeptId = String(design._id);

  const empA = await models.Employee.create({
    employeeCode: "CA4C-001",
    fullName: "Alice Engineer",
    email: "alice@acme-ca4c-iso.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering", departmentId: eng._id },
  });
  const empB = await models.Employee.create({
    employeeCode: "CA4C-002",
    fullName: "Bob Designer",
    email: "bob@acme-ca4c-iso.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Designer", department: "Design", departmentId: design._id },
  });
  employeeIdA = String(empA._id);
  employeeIdB = String(empB._id);

  const passwordHash = await hashPassword(PASSWORD);
  await createCompanyAdmin(models.User, {
    email: "ca@acme-ca4c-iso.test",
    passwordHash,
    fullName: "Acme CA",
  });

  const hr = await models.User.create({
    email: "hr@acme-ca4c-iso.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Acme HR",
    isActive: true,
    lastLoginAt: new Date(),
  });
  hrAdminId = String(hr._id);

  const empUser = await models.User.create({
    email: "alice@acme-ca4c-iso.test",
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Alice Engineer",
    isActive: true,
    employeeId: empA._id,
  });
  empA.userId = empUser._id;
  await empA.save();

  caCookie = await login("acme-ca4c-iso", "ca@acme-ca4c-iso.test");
  hrCookie = await login("acme-ca4c-iso", "hr@acme-ca4c-iso.test");
  empCookie = await login("acme-ca4c-iso", "alice@acme-ca4c-iso.test");
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("CA4-C shared enforcement unit helpers", () => {
  it("fails closed for missing permission and malformed config when enforced", async () => {
    const models = await getCompanyModels(acme);
    const user = await models.User.findById(hrAdminId);
    user.hrAccess = undefined;
    await user.save();

    acme.config = acme.config || {};
    acme.config.hrAccessEnforcement = { mode: "ENFORCED" };

    const ctx = await resolveHrAccessContext({ user, company: acme, models });
    assert.equal(ctx.enforced, true);
    assert.equal(ctx.configured, false);
    assert.throws(() => assertHrPermission(ctx, "people.view"), (err) => err.code === "HR_ACCESS_NOT_CONFIGURED");
  });

  it("allows exact permission and denies wrong action", async () => {
    const models = await getCompanyModels(acme);
    const user = await models.User.findById(hrAdminId);
    user.hrAccess = {
      version: 1,
      configuredAt: new Date(),
      updatedAt: new Date(),
      employeeScope: { mode: "COMPANY", departmentIds: [], employeeIds: [] },
      permissions: ["people.view"],
    };
    await user.save();

    acme.config.hrAccessEnforcement = { mode: "ENFORCED" };
    const ctx = await resolveHrAccessContext({ user, company: acme, models });
    assert.doesNotThrow(() => assertHrPermission(ctx, "people.view"));
    assert.throws(() => assertHrPermission(ctx, "people.edit"), (err) => err.code === "HR_PERMISSION_DENIED");
    assert.throws(() => assertHrPermission(ctx, "people.create"), (err) => err.code === "HR_PERMISSION_DENIED");
  });

  it("CUSTOM scope uses UNION of departments and employees", async () => {
    const models = await getCompanyModels(acme);
    const user = await models.User.findById(hrAdminId);
    user.hrAccess = {
      version: 1,
      configuredAt: new Date(),
      updatedAt: new Date(),
      employeeScope: {
        mode: "CUSTOM",
        departmentIds: [engDeptId],
        employeeIds: [employeeIdB],
      },
      permissions: ["people.view"],
    };
    await user.save();

    acme.config.hrAccessEnforcement = { mode: "ENFORCED" };
    const ctx = await resolveHrAccessContext({ user, company: acme, models });
    assert.equal(isEmployeeIdInScope(ctx, employeeIdA), true);
    assert.equal(isEmployeeIdInScope(ctx, employeeIdB), true);

    const filter = mergeEmployeeScopeFilter(ctx, { status: "ACTIVE" });
    const scoped = await models.Employee.find(filter).select("_id").lean();
    const ids = new Set(scoped.map((e) => String(e._id)));
    assert.equal(ids.has(employeeIdA), true);
    assert.equal(ids.has(employeeIdB), true);
  });
});

describe("CA4-C rollout defaults OFF (backward compatible)", () => {
  it("unconfigured HR retains access while enforcement is OFF", async () => {
    await Company.findByIdAndUpdate(acme._id, {
      $set: { "config.hrAccessEnforcement.mode": "OFF" },
    });
    const models = await getCompanyModels(acme);
    await models.User.findByIdAndUpdate(hrAdminId, { $unset: { hrAccess: 1 } });

    const res = await request(app)
      .get("/api/employees")
      .set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.employees));
    assert.ok(res.body.employees.length >= 2);
  });

  it("Company Admin readiness reports unconfigured HR Admins", async () => {
    const res = await request(app)
      .get("/api/company-admin/hr-access/enforcement")
      .set("Cookie", caCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.enforcement.mode, "OFF");
    assert.equal(res.body.enforcement.canEnable, false);
    assert.ok(res.body.totals.activeUnconfigured >= 1);
  });

  it("cannot enable enforcement until all active HR Admins are configured", async () => {
    const res = await request(app)
      .put("/api/company-admin/hr-access/enforcement")
      .set("Cookie", caCookie)
      .send({ mode: "ENFORCED" });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "HR_ACCESS_NOT_READY");
  });

  it("bootstrap-legacy configures COMPANY + full catalog without enabling enforcement", async () => {
    const res = await request(app)
      .post("/api/company-admin/hr-access/bootstrap-legacy")
      .set("Cookie", caCookie)
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.enforcementMode, "OFF");
    const bootstrapped = (res.body.results || []).filter((r) => r.status === "bootstrapped");
    assert.ok(bootstrapped.length >= 1);

    const readiness = await request(app)
      .get("/api/company-admin/hr-access/enforcement")
      .set("Cookie", caCookie);
    assert.equal(readiness.body.enforcement.canEnable, true);
  });
});

describe("CA4-C ENFORCED permission + scope", () => {
  before(async () => {
    const enable = await request(app)
      .put("/api/company-admin/hr-access/enforcement")
      .set("Cookie", caCookie)
      .send({ mode: "ENFORCED", reason: "test" });
    assert.equal(enable.status, 200);
    assert.equal(enable.body.enforcement.mode, "ENFORCED");

    // Narrow HR to Engineering-only people.view (no create/edit/leave)
    const access = await request(app)
      .put(`/api/company-admin/hr-admins/${hrAdminId}/access`)
      .set("Cookie", caCookie)
      .send({
        employeeScope: {
          mode: "CUSTOM",
          departmentIds: [engDeptId],
          employeeIds: [],
        },
        permissions: ["people.view", "dashboard.view", "attendance.view", "leave.view"],
      });
    assert.equal(access.status, 200);

    // Refresh company in memory for subsequent direct service calls
    const fresh = await Company.findById(acme._id).lean();
    acme.config = fresh.config;
  });

  it("lists only in-scope employees", async () => {
    const res = await request(app).get("/api/employees").set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    const ids = (res.body.employees || []).map((e) => String(e._id));
    assert.ok(ids.includes(employeeIdA));
    assert.equal(ids.includes(employeeIdB), false);
  });

  it("denies out-of-scope employee detail", async () => {
    const res = await request(app)
      .get(`/api/employees/${employeeIdB}`)
      .set("Cookie", hrCookie);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "HR_SCOPE_DENIED");
  });

  it("allows in-scope employee detail", async () => {
    const res = await request(app)
      .get(`/api/employees/${employeeIdA}`)
      .set("Cookie", hrCookie);
    assert.equal(res.status, 200);
  });

  it("denies people.create without permission", async () => {
    const res = await request(app)
      .post("/api/employees")
      .set("Cookie", hrCookie)
      .send({
        fullName: "Denied Create",
        email: "denied-create@acme-ca4c-iso.test",
        employeeCode: "CA4C-X",
      });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "HR_PERMISSION_DENIED");
  });

  it("denies leave.approve without permission", async () => {
    const res = await request(app)
      .post("/api/leave-requests/000000000000000000000001/decision")
      .set("Cookie", hrCookie)
      .send({ action: "APPROVE" });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "HR_PERMISSION_DENIED");
  });

  it("denies payroll.view without permission", async () => {
    const res = await request(app).get("/api/payroll/cycles").set("Cookie", hrCookie);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "HR_PERMISSION_DENIED");
  });

  it("employee self-service remains intact", async () => {
    const res = await request(app).get("/api/employees/me").set("Cookie", empCookie);
    assert.equal(res.status, 200);
  });

  it("Company Admin portal remains operational", async () => {
    const res = await request(app).get("/api/company-admin/dashboard").set("Cookie", caCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  it("empty permissions deny protected operations", async () => {
    await request(app)
      .put(`/api/company-admin/hr-admins/${hrAdminId}/access`)
      .set("Cookie", caCookie)
      .send({
        employeeScope: { mode: "COMPANY", departmentIds: [], employeeIds: [] },
        permissions: [],
      });

    const res = await request(app).get("/api/admin/dashboard").set("Cookie", hrCookie);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "HR_PERMISSION_DENIED");
  });
});
