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
import { createCompanyAdmin } from "../services/companyAdminService.js";
import {
  provisionEmployeeAccount,
  PROVISIONING_SOURCES,
} from "../services/employeeProvisioningService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

const PASSWORD = "OrgFoundationPass1!";
const DB_PATH = "D:/tmp/hrms-mongo/ca-org-foundation";

let mongo;
let app;
let server;
let acme;
let globex;
let legacy;
let cookies;
let acmeEmployeeId;
let outsideEmployeeId;
let inactiveEmployeeId;

function cookieFrom(response) {
  const cookiesHeader = response.headers["set-cookie"] || [];
  return cookiesHeader.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

async function login(companyCode, email) {
  const res = await request(app).post("/api/auth/login").send({ companyCode, email, password: PASSWORD });
  assert.equal(res.status, 200, res.body?.message || `${email} login failed`);
  return cookieFrom(res);
}

before(async () => {
  fs.rmSync(DB_PATH, { recursive: true, force: true });
  fs.mkdirSync(DB_PATH, { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: DB_PATH, storageEngine: "wiredTiger" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  acme = await Company.create({
    companyName: "Acme Org Foundation",
    slug: "acme-org-foundation",
    databaseName: "company_acme_org_foundation",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { hrAccessEnforcement: { mode: "ENFORCED" } },
  });
  globex = await Company.create({
    companyName: "Globex Org Foundation",
    slug: "globex-org-foundation",
    databaseName: "company_globex_org_foundation",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { hrAccessEnforcement: { mode: "ENFORCED" } },
  });
  legacy = await Company.create({
    companyName: "Legacy Org Foundation",
    slug: "legacy-org-foundation",
    databaseName: "company_legacy_org_foundation",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { hrAccessEnforcement: { mode: "OFF" } },
  });

  const passwordHash = await hashPassword(PASSWORD);
  const acmeModels = await getCompanyModels(acme);
  const engineering = await acmeModels.Department.create({ name: "Engineering", isActive: true });
  const design = await acmeModels.Department.create({ name: "Design", isActive: true });
  const activeEmployee = await acmeModels.Employee.create({
    employeeCode: "ORG-001",
    fullName: "In Scope Engineer",
    email: "engineer@acme-org.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering", departmentId: engineering._id },
  });
  const outsideEmployee = await acmeModels.Employee.create({
    employeeCode: "ORG-002",
    fullName: "Outside Designer",
    email: "designer@acme-org.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Designer", department: "Design", departmentId: design._id },
  });
  const inactiveEmployee = await acmeModels.Employee.create({
    employeeCode: "ORG-003",
    fullName: "Inactive Engineer",
    email: "inactive@acme-org.test",
    status: EMPLOYEE_STATUSES.INACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering", departmentId: engineering._id },
  });
  acmeEmployeeId = String(activeEmployee._id);
  outsideEmployeeId = String(outsideEmployee._id);
  inactiveEmployeeId = String(inactiveEmployee._id);

  const configured = (permissions, departmentIds = []) => ({
    version: 1,
    configuredAt: new Date(),
    updatedAt: new Date(),
    permissions,
    employeeScope: { mode: "CUSTOM", departmentIds, employeeIds: [] },
  });
  await acmeModels.User.create({
    email: "hr.limited@acme-org.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Limited HR",
    isActive: true,
    hrAccess: configured(["dashboard.view"], [engineering._id]),
  });
  await acmeModels.User.create({
    email: "hr.org@acme-org.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Org HR",
    isActive: true,
    hrAccess: configured(["organization.view", "organization.manage"], [engineering._id]),
  });
  await acmeModels.User.create({
    email: "employee@acme-org.test",
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Employee",
    isActive: true,
    employeeId: activeEmployee._id,
  });
  await createCompanyAdmin(acmeModels.User, {
    email: "ca@acme-org.test",
    passwordHash,
    fullName: "Acme Company Admin",
  });

  const globexModels = await getCompanyModels(globex);
  await globexModels.Department.create({ name: "Globex Only Department", isActive: true });
  await createCompanyAdmin(globexModels.User, {
    email: "ca@globex-org.test",
    passwordHash,
    fullName: "Globex Company Admin",
  });

  const legacyModels = await getCompanyModels(legacy);
  await legacyModels.User.create({
    email: "hr@legacy-org.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Legacy HR",
    isActive: true,
  });
  await createCompanyAdmin(legacyModels.User, {
    email: "ca@legacy-org.test",
    passwordHash,
    fullName: "Legacy Company Admin",
  });
  await legacyModels.User.create({
    email: "orphan.employee@legacy-org.test",
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Orphan Employee",
    isActive: true,
    employeeId: null,
  });

  cookies = {
    ca: await login("acme-org-foundation", "ca@acme-org.test"),
    limited: await login("acme-org-foundation", "hr.limited@acme-org.test"),
    orgHr: await login("acme-org-foundation", "hr.org@acme-org.test"),
    employee: await login("acme-org-foundation", "employee@acme-org.test"),
    globex: await login("globex-org-foundation", "ca@globex-org.test"),
    legacyHr: await login("legacy-org-foundation", "hr@legacy-org.test"),
  };
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Company Admin department and project authorization", () => {
  it("lets Company Admin create, read, update and deactivate a department", async () => {
    const created = await request(app)
      .post("/api/departments")
      .set("Cookie", cookies.ca)
      .send({ name: "Finance", description: "Accounts", code: "FIN" });
    assert.equal(created.status, 201, created.body?.message);
    assert.equal(created.body.department.name, "Finance");
    assert.equal(created.body.department.isActive, true);
    const id = created.body.department.id;

    const listed = await request(app).get("/api/departments").set("Cookie", cookies.ca);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.departments.some((row) => row.id === id));

    const read = await request(app).get(`/api/departments/${id}`).set("Cookie", cookies.ca);
    assert.equal(read.status, 200);
    assert.equal(read.body.department.code, "FIN");

    const updated = await request(app)
      .patch(`/api/departments/${id}`)
      .set("Cookie", cookies.ca)
      .send({ description: "Accounts and payroll" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.department.description, "Accounts and payroll");

    const deactivated = await request(app)
      .post(`/api/departments/${id}/deactivate`)
      .set("Cookie", cookies.ca);
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.department.isActive, false);

    const activeList = await request(app).get("/api/departments").set("Cookie", cookies.ca);
    assert.equal(activeList.body.departments.some((row) => row.id === id), false);
  });

  it("lets Company Admin create, update, staff and deactivate a project", async () => {
    const created = await request(app)
      .post("/api/projects")
      .set("Cookie", cookies.ca)
      .send({ name: "Foundation Project", projectCode: "FND" });
    assert.equal(created.status, 201, created.body?.message);
    const id = created.body.project.id;

    const read = await request(app).get(`/api/projects/${id}`).set("Cookie", cookies.ca);
    assert.equal(read.status, 200);
    assert.equal(read.body.project.name, "Foundation Project");

    const updated = await request(app)
      .patch(`/api/projects/${id}`)
      .set("Cookie", cookies.ca)
      .send({ description: "Internal foundation work" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.project.description, "Internal foundation work");

    const added = await request(app)
      .post(`/api/projects/${id}/members`)
      .set("Cookie", cookies.ca)
      .send({ employeeId: acmeEmployeeId, isPrimary: true });
    assert.equal(added.status, 201, added.body?.message);

    const inactive = await request(app)
      .post(`/api/projects/${id}/members`)
      .set("Cookie", cookies.ca)
      .send({ employeeId: inactiveEmployeeId });
    assert.equal(inactive.status, 400);
    assert.match(inactive.body.message, /inactive employee/i);

    const deactivated = await request(app)
      .post(`/api/projects/${id}/deactivate`)
      .set("Cookie", cookies.ca);
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.project.isActive, false);
  });

  it("keeps enforced HR permissions and employee scope in place", async () => {
    const deniedCreate = await request(app)
      .post("/api/departments")
      .set("Cookie", cookies.limited)
      .send({ name: "Should Not Exist" });
    assert.equal(deniedCreate.status, 403);
    assert.equal(deniedCreate.body.code, "HR_PERMISSION_DENIED");

    const deniedRead = await request(app).get("/api/departments").set("Cookie", cookies.limited);
    assert.equal(deniedRead.status, 403);
    assert.equal(deniedRead.body.code, "HR_PERMISSION_DENIED");

    const allowed = await request(app)
      .post("/api/departments")
      .set("Cookie", cookies.orgHr)
      .send({ name: "People Ops" });
    assert.equal(allowed.status, 201, allowed.body?.message);

    const project = await request(app)
      .post("/api/projects")
      .set("Cookie", cookies.orgHr)
      .send({ name: "Scoped Project" });
    assert.equal(project.status, 201, project.body?.message);

    const inScope = await request(app)
      .post(`/api/projects/${project.body.project.id}/members`)
      .set("Cookie", cookies.orgHr)
      .send({ employeeId: acmeEmployeeId });
    assert.equal(inScope.status, 201, inScope.body?.message);

    const outOfScope = await request(app)
      .post(`/api/projects/${project.body.project.id}/members`)
      .set("Cookie", cookies.orgHr)
      .send({ employeeId: outsideEmployeeId });
    assert.equal(outOfScope.status, 403);
    assert.equal(outOfScope.body.code, "HR_SCOPE_DENIED");

    const employeeDenied = await request(app)
      .post("/api/departments")
      .set("Cookie", cookies.employee)
      .send({ name: "Employee Dept" });
    assert.equal(employeeDenied.status, 403);
  });

  it("lets enforcement-off HR keep legacy organization access", async () => {
    const created = await request(app)
      .post("/api/departments")
      .set("Cookie", cookies.legacyHr)
      .send({ name: "Legacy Department" });
    assert.equal(created.status, 201, created.body?.message);
    assert.equal(created.body.department.name, "Legacy Department");
  });

  it("does not expose another tenant's departments or projects", async () => {
    const acmeList = await request(app).get("/api/departments").set("Cookie", cookies.ca);
    assert.equal(acmeList.status, 200);
    assert.equal(
      acmeList.body.departments.some((row) => row.name === "Globex Only Department"),
      false
    );

    const globexModels = await getCompanyModels(globex);
    const foreign = await globexModels.Department.findOne({ name: "Globex Only Department" }).lean();
    const readForeign = await request(app)
      .get(`/api/departments/${foreign._id}`)
      .set("Cookie", cookies.ca);
    assert.equal(readForeign.status, 404);

    const patchForeign = await request(app)
      .patch(`/api/departments/${foreign._id}`)
      .set("Cookie", cookies.ca)
      .send({ description: "Cross tenant" });
    assert.equal(patchForeign.status, 404);

    const globexList = await request(app).get("/api/departments").set("Cookie", cookies.globex);
    assert.equal(globexList.status, 200);
    assert.equal(globexList.body.departments.some((row) => row.name === "Finance"), false);
    assert.ok(globexList.body.departments.some((row) => row.name === "Globex Only Department"));
  });
});

describe("Employee provisioning identity protection", () => {
  it("does not demote a Company Admin or HR Admin", async () => {
    const companyAdminAttempt = await request(app)
      .post("/api/employees")
      .set("Cookie", cookies.legacyHr)
      .send({
        fullName: "Legacy Company Admin",
        email: "ca@legacy-org.test",
        employeeCode: "LEG-CA",
      });
    assert.equal(companyAdminAttempt.status, 409);
    assert.equal(companyAdminAttempt.body.code, "EMAIL_OWNED_BY_COMPANY_ADMIN");

    const hrAttempt = await request(app)
      .post("/api/employees")
      .set("Cookie", cookies.legacyHr)
      .send({
        fullName: "Legacy HR",
        email: "hr@legacy-org.test",
        employeeCode: "LEG-HR",
      });
    assert.equal(hrAttempt.status, 409);
    assert.equal(hrAttempt.body.code, "EMAIL_OWNED_BY_HR_ADMIN");

    const models = await getCompanyModels(legacy);
    const companyAdmin = await models.User.findOne({ email: "ca@legacy-org.test" }).lean();
    const hrAdmin = await models.User.findOne({ email: "hr@legacy-org.test" }).lean();
    assert.equal(companyAdmin.role, USER_ROLES.COMPANY_ADMIN);
    assert.equal(companyAdmin.isActive, true);
    assert.equal(companyAdmin.employeeId, null);
    assert.equal(hrAdmin.role, USER_ROLES.HR_ADMIN);
    assert.equal(hrAdmin.isActive, true);
    assert.equal(await models.Employee.countDocuments({ email: "ca@legacy-org.test" }), 0);
    assert.equal(await models.Employee.countDocuments({ email: "hr@legacy-org.test" }), 0);
    assert.equal(await models.User.countDocuments({ email: "ca@legacy-org.test" }), 1);

    const companyAdminUser = await models.User.findOne({ email: "ca@legacy-org.test" });
    await assert.rejects(
      () =>
        provisionEmployeeAccount(
          { models, company: legacy, clientBaseUrl: "http://localhost:5173" },
          {
            fullName: "Legacy Company Admin",
            email: "ca@legacy-org.test",
            employeeCode: "LEG-CA-2",
          },
          { source: PROVISIONING_SOURCES.ONBOARDING, existingUserId: companyAdminUser._id }
        ),
      (err) => err.code === "EMAIL_OWNED_BY_COMPANY_ADMIN"
    );
    const unchanged = await models.User.findOne({ email: "ca@legacy-org.test" }).lean();
    assert.equal(unchanged.role, USER_ROLES.COMPANY_ADMIN);
  });

  it("still provisions a new employee and reuses an unlinked employee account", async () => {
    const created = await request(app)
      .post("/api/employees")
      .set("Cookie", cookies.legacyHr)
      .send({
        fullName: "New Legacy Employee",
        email: "new.employee@legacy-org.test",
        employeeCode: "LEG-100",
      });
    assert.equal(created.status, 201, created.body?.message);

    const models = await getCompanyModels(legacy);
    const createdUser = await models.User.findOne({ email: "new.employee@legacy-org.test" }).lean();
    assert.equal(createdUser.role, USER_ROLES.EMPLOYEE);
    assert.ok(createdUser.employeeId);
    assert.equal(await models.User.countDocuments({ email: "new.employee@legacy-org.test" }), 1);

    const duplicate = await request(app)
      .post("/api/employees")
      .set("Cookie", cookies.legacyHr)
      .send({
        fullName: "New Legacy Employee",
        email: "new.employee@legacy-org.test",
        employeeCode: "LEG-101",
      });
    assert.equal(duplicate.status, 409);
    assert.equal(await models.User.countDocuments({ email: "new.employee@legacy-org.test" }), 1);
    const stillEmployee = await models.User.findOne({ email: "new.employee@legacy-org.test" }).lean();
    assert.equal(stillEmployee.role, USER_ROLES.EMPLOYEE);

    const reused = await request(app)
      .post("/api/employees")
      .set("Cookie", cookies.legacyHr)
      .send({
        fullName: "Orphan Employee",
        email: "orphan.employee@legacy-org.test",
        employeeCode: "LEG-200",
      });
    assert.equal(reused.status, 201, reused.body?.message);
    const users = await models.User.find({ email: "orphan.employee@legacy-org.test" }).lean();
    assert.equal(users.length, 1);
    assert.equal(users[0].role, USER_ROLES.EMPLOYEE);
    assert.ok(users[0].employeeId);
    const employee = await models.Employee.findById(users[0].employeeId).lean();
    assert.equal(employee.email, "orphan.employee@legacy-org.test");
    assert.equal(String(employee.userId), String(users[0]._id));
  });
});
