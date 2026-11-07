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
import { departmentPayload } from "../../client/src/components/departmentAssignment.js";
import { retainSelectedEmployees } from "../../client/src/components/employeePickerState.js";
import { applyExplicitDesignation } from "../../client/src/components/organization-workspace/designationSelection.js";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { createCompanyAdmin } from "../services/companyAdminService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

const PASSWORD = "Batch6Pass1!";
const DB_PATH = "D:/tmp/hrms-mongo/ca-org-batch6";

let mongo;
let app;
let acme;
let globex;
let scoped;
let caCookie;
let globexCookie;
let hrCookie;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

async function createEmployee(cookie, fields) {
  const response = await request(app)
    .post("/api/employees")
    .set("Cookie", cookie)
    .send({
      fullName: "Batch Person",
      jobTitle: "Analyst",
      ...fields,
    });
  assert.equal(response.status, 201, response.body?.message);
  return response.body;
}

describe("organization batch 6 integration", () => {
  before(async () => {
    fs.rmSync(DB_PATH, { recursive: true, force: true });
    fs.mkdirSync(DB_PATH, { recursive: true });
    mongo = await MongoMemoryServer.create({
      instance: { dbPath: DB_PATH, storageEngine: "wiredTiger" },
    });
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    acme = await Company.create({
      companyName: "Batch 6 Acme",
      slug: "batch6-acme",
      databaseName: "company_batch6_acme",
      status: COMPANY_STATUSES.ACTIVE,
      schemaVersion: 1,
      config: { hrAccessEnforcement: { mode: "OFF" } },
    });
    globex = await Company.create({
      companyName: "Batch 6 Globex",
      slug: "batch6-globex",
      databaseName: "company_batch6_globex",
      status: COMPANY_STATUSES.ACTIVE,
      schemaVersion: 1,
      config: { hrAccessEnforcement: { mode: "OFF" } },
    });
    scoped = await Company.create({
      companyName: "Batch 6 Scoped",
      slug: "batch6-scoped",
      databaseName: "company_batch6_scoped",
      status: COMPANY_STATUSES.ACTIVE,
      schemaVersion: 1,
      config: { hrAccessEnforcement: { mode: "ENFORCED" } },
    });

    const passwordHash = await hashPassword(PASSWORD);
    const acmeModels = await getCompanyModels(acme);
    await createCompanyAdmin(acmeModels.User, {
      email: "ca@batch6.test",
      fullName: "Batch Company Admin",
      passwordHash,
      isActive: true,
    });
    const globexModels = await getCompanyModels(globex);
    await createCompanyAdmin(globexModels.User, {
      email: "ca@batch6-globex.test",
      fullName: "Globex Company Admin",
      passwordHash,
      isActive: true,
    });
    const scopedModels = await getCompanyModels(scoped);
    await createCompanyAdmin(scopedModels.User, {
      email: "ca@batch6-scoped.test",
      fullName: "Scoped Company Admin",
      passwordHash,
      isActive: true,
    });
    await scopedModels.User.create({
      email: "hr@batch6-scoped.test",
      fullName: "Scoped HR",
      passwordHash,
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      hrAccess: {
        version: 1,
        configuredAt: new Date(),
        updatedAt: new Date(),
        permissions: ["people.view", "people.create", "people.edit", "organization.view"],
        employeeScope: { mode: "COMPANY", departmentIds: [], employeeIds: [] },
      },
    });

    caCookie = cookieFrom(await request(app).post("/api/auth/login").send({
      companyCode: "batch6-acme",
      email: "ca@batch6.test",
      password: PASSWORD,
    }));
    globexCookie = cookieFrom(await request(app).post("/api/auth/login").send({
      companyCode: "batch6-globex",
      email: "ca@batch6-globex.test",
      password: PASSWORD,
    }));
    hrCookie = cookieFrom(await request(app).post("/api/auth/login").send({
      companyCode: "batch6-scoped",
      email: "hr@batch6-scoped.test",
      password: PASSWORD,
    }));
    assert.ok(caCookie);
    assert.ok(globexCookie);
    assert.ok(hrCookie);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("keeps a selected employee when that person is not on the current result page", () => {
    const selected = [{ id: "a", fullName: "Ada", jobTitle: "Lead", employeeCode: "A-1" }];
    const otherPage = [{ id: "b", fullName: "Bea", jobTitle: "Engineer", employeeCode: "B-1" }];
    const retained = retainSelectedEmployees(selected, otherPage);
    assert.equal(retained.length, 1);
    assert.equal(retained[0].fullName, "Ada");

    const refreshed = retainSelectedEmployees(selected, [
      { id: "a", fullName: "Ada Lovelace", jobTitle: "Director", employeeCode: "A-1" },
    ]);
    assert.equal(refreshed[0].fullName, "Ada Lovelace");
    assert.equal(refreshed[0].jobTitle, "Director");
  });

  it("suggests a catalog level without replacing the current grade", () => {
    const explicit = applyExplicitDesignation(
      { jobTitle: "Custom title", jobGrade: "L9" },
      { title: "Software Engineer", grade: "L4" }
    );
    assert.equal(explicit.jobTitle, "Software Engineer");
    assert.equal(explicit.jobGrade, "L9");
    assert.equal(explicit.suggestedGrade, "L4");
    assert.deepEqual(departmentPayload({}), {});
    assert.deepEqual(departmentPayload({ departmentId: "dept-1" }), { departmentId: "dept-1" });
    assert.deepEqual(departmentPayload({ clearDepartment: true, departmentId: "dept-1" }), {
      clearDepartment: true,
    });
    assert.deepEqual(departmentPayload({ legacyName: "Field Notes", submitLegacy: true }), {
      department: "Field Notes",
    });
  });

  it("persists a department id and keeps the department name in sync", async () => {
    const createdDept = await request(app)
      .post("/api/departments")
      .set("Cookie", caCookie)
      .send({ name: "Engineering" });
    assert.equal(createdDept.status, 201, createdDept.body?.message);
    const engineeringId = createdDept.body.department.id;

    await createEmployee(caCookie, {
      fullName: "Linked Hire",
      email: "linked.hire@batch6.test",
      employeeCode: "B6-1",
      departmentId: engineeringId,
    });

    const models = await getCompanyModels(acme);
    const employee = await models.Employee.findOne({ email: "linked.hire@batch6.test" });
    assert.equal(String(employee.job.departmentId), String(engineeringId));
    assert.equal(employee.job.department, "Engineering");

    const design = await request(app)
      .post("/api/departments")
      .set("Cookie", caCookie)
      .send({ name: "Design" });
    const designId = design.body.department.id;
    const moved = await request(app)
      .patch(`/api/employees/${employee._id}`)
      .set("Cookie", caCookie)
      .send({ departmentId: designId });
    assert.equal(moved.status, 200, moved.body?.message);
    const movedEmployee = await models.Employee.findById(employee._id);
    assert.equal(String(movedEmployee.job.departmentId), String(designId));
    assert.equal(movedEmployee.job.department, "Design");
    assert.equal(movedEmployee.job.jobTitle, "Analyst");
  });

  it("preserves legacy text, ignores a blank department, and clears only on an explicit action", async () => {
    const models = await getCompanyModels(acme);
    const legacy = await models.Employee.create({
      employeeCode: "B6-LEGACY",
      fullName: "Legacy Text",
      email: "legacy.text@batch6.test",
      status: "ACTIVE",
      job: { jobTitle: "Writer", jobGrade: "L2", department: "Field Notes", departmentId: null },
    });

    const blank = await request(app)
      .patch(`/api/employees/${legacy._id}`)
      .set("Cookie", caCookie)
      .send({ department: "   ", departmentId: "" });
    assert.equal(blank.status, 200, blank.body?.message);
    const stillLegacy = await models.Employee.findById(legacy._id);
    assert.equal(stillLegacy.job.departmentId ?? null, null);
    assert.equal(stillLegacy.job.department, "Field Notes");
    assert.equal(stillLegacy.job.jobGrade, "L2");

    const titleOnly = await request(app)
      .patch(`/api/employees/${legacy._id}`)
      .set("Cookie", caCookie)
      .send({ jobTitle: "Senior Writer" });
    assert.equal(titleOnly.status, 200, titleOnly.body?.message);
    const titled = await models.Employee.findById(legacy._id);
    assert.equal(titled.job.jobTitle, "Senior Writer");
    assert.equal(titled.job.jobGrade, "L2");
    assert.equal(titled.job.department, "Field Notes");

    const cleared = await request(app)
      .patch(`/api/employees/${legacy._id}`)
      .set("Cookie", caCookie)
      .send({ clearDepartment: true });
    assert.equal(cleared.status, 200, cleared.body?.message);
    const afterClear = await models.Employee.findById(legacy._id);
    assert.equal(afterClear.job.departmentId ?? null, null);
    assert.equal(afterClear.job.department, "");
    assert.equal(afterClear.job.jobTitle, "Senior Writer");
  });

  it("rejects an inactive department and a department from another tenant", async () => {
    const models = await getCompanyModels(acme);
    const employee = await models.Employee.findOne({ email: "linked.hire@batch6.test" });
    const design = await models.Department.findOne({ normalizedName: "design" });
    const beforeId = String(employee.job.departmentId);

    const inactive = await request(app)
      .post(`/api/departments/${design._id}/deactivate`)
      .set("Cookie", caCookie);
    assert.equal(inactive.status, 200, inactive.body?.message);

    const rejected = await request(app)
      .patch(`/api/employees/${employee._id}`)
      .set("Cookie", caCookie)
      .send({ departmentId: String(design._id) });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.code, "DEPARTMENT_INACTIVE");
    assert.equal(String((await models.Employee.findById(employee._id)).job.departmentId), beforeId);

    const foreign = await request(app)
      .post("/api/departments")
      .set("Cookie", globexCookie)
      .send({ name: "Globex Only" });
    assert.equal(foreign.status, 201, foreign.body?.message);
    const crossTenant = await request(app)
      .patch(`/api/employees/${employee._id}`)
      .set("Cookie", caCookie)
      .send({ departmentId: foreign.body.department.id });
    assert.equal(crossTenant.status, 400);
    assert.equal(crossTenant.body.code, "DEPARTMENT_NOT_FOUND");
    const unchanged = await models.Employee.findById(employee._id);
    assert.equal(String(unchanged.job.departmentId), beforeId);
    assert.equal(await (await getCompanyModels(globex)).Employee.countDocuments({}), 0);
  });

  it("applies employee scope before search results and department assignment", async () => {
    const scopedCookie = cookieFrom(await request(app).post("/api/auth/login").send({
      companyCode: "batch6-scoped",
      email: "ca@batch6-scoped.test",
      password: PASSWORD,
    }));
    const engineering = await request(app)
      .post("/api/departments")
      .set("Cookie", scopedCookie)
      .send({ name: "Engineering" });
    const design = await request(app)
      .post("/api/departments")
      .set("Cookie", scopedCookie)
      .send({ name: "Design" });
    const engineeringId = engineering.body.department.id;
    const designId = design.body.department.id;

    await createEmployee(scopedCookie, {
      fullName: "Scope Engineer",
      email: "scope.engineer@batch6.test",
      employeeCode: "SC-1",
      departmentId: engineeringId,
    });
    await createEmployee(scopedCookie, {
      fullName: "Scope Designer",
      email: "scope.designer@batch6.test",
      employeeCode: "SC-2",
      departmentId: designId,
    });

    const models = await getCompanyModels(scoped);
    await models.User.updateOne(
      { email: "hr@batch6-scoped.test" },
      { $set: { "hrAccess.employeeScope": { mode: "CUSTOM", departmentIds: [engineeringId], employeeIds: [] } } }
    );

    const listed = await request(app)
      .get("/api/employees")
      .set("Cookie", hrCookie)
      .query({ search: "Scope", limit: 24, status: "ACTIVE" });
    assert.equal(listed.status, 200, listed.body?.message);
    assert.equal(listed.body.pagination.totalEmployees, 1);
    assert.equal(listed.body.employees[0].email, "scope.engineer@batch6.test");

    const engineer = await models.Employee.findOne({ email: "scope.engineer@batch6.test" });
    const outside = await request(app)
      .patch(`/api/employees/${engineer._id}`)
      .set("Cookie", hrCookie)
      .send({ departmentId: designId });
    assert.equal(outside.status, 403);
    assert.equal(outside.body.code, "HR_SCOPE_DENIED");
    assert.equal(String((await models.Employee.findById(engineer._id)).job.departmentId), String(engineeringId));

    const designer = await models.Employee.findOne({ email: "scope.designer@batch6.test" });
    const hidden = await request(app)
      .patch(`/api/employees/${designer._id}`)
      .set("Cookie", hrCookie)
      .send({ jobTitle: "Should not save" });
    assert.equal(hidden.status, 403);
    assert.equal(hidden.body.code, "HR_SCOPE_DENIED");
  });

  it("searches and pages employees without returning the whole directory", async () => {
    for (let index = 1; index <= 9; index += 1) {
      await createEmployee(caCookie, {
        fullName: `PagePerson ${String(index).padStart(2, "0")}`,
        email: `page.person.${index}@batch6.test`,
        employeeCode: `B6-P${index}`,
        jobTitle: "Pager",
      });
    }
    const first = await request(app)
      .get("/api/employees")
      .set("Cookie", caCookie)
      .query({ search: "PagePerson", page: 1, limit: 8, status: "ACTIVE", sortBy: "fullName", sortOrder: "asc" });
    const second = await request(app)
      .get("/api/employees")
      .set("Cookie", caCookie)
      .query({ search: "PagePerson", page: 2, limit: 8, status: "ACTIVE", sortBy: "fullName", sortOrder: "asc" });
    assert.equal(first.status, 200, first.body?.message);
    assert.equal(first.body.pagination.totalEmployees, 9);
    assert.equal(first.body.pagination.totalPages, 2);
    assert.equal(first.body.employees.length, 8);
    assert.equal(second.body.employees.length, 1);
    const firstIds = new Set(first.body.employees.map((employee) => String(employee._id)));
    assert.equal(firstIds.has(String(second.body.employees[0]._id)), false);
  });

  it("assigns a team lead and members and rejects an inactive employee", async () => {
    const lead = await createEmployee(caCookie, {
      fullName: "Team Lead",
      email: "team.lead@batch6.test",
      employeeCode: "B6-LEAD",
    });
    const member = await createEmployee(caCookie, {
      fullName: "Team Member",
      email: "team.member@batch6.test",
      employeeCode: "B6-MEM",
    });
    const models = await getCompanyModels(acme);
    const leadEmployee = await models.Employee.findOne({ email: "team.lead@batch6.test" });
    const memberEmployee = await models.Employee.findOne({ email: "team.member@batch6.test" });
    assert.ok(lead.employee);

    const created = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", caCookie)
      .send({
        name: "Platform",
        department: "Engineering",
        leadEmployeeId: String(leadEmployee._id),
        memberEmployeeIds: [String(memberEmployee._id)],
      });
    assert.equal(created.status, 201, created.body?.message);
    assert.equal(created.body.team.lead.id, String(leadEmployee._id));
    assert.equal(created.body.team.members.some((person) => person.id === String(memberEmployee._id)), true);
    assert.equal(created.body.team.members.some((person) => person.id === String(leadEmployee._id)), true);

    const inactive = await models.Employee.create({
      employeeCode: "B6-OFF",
      fullName: "Inactive Person",
      email: "inactive.person@batch6.test",
      status: "INACTIVE",
      job: { jobTitle: "Former" },
    });
    const rejected = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", caCookie)
      .send({
        name: "Closed Team",
        memberEmployeeIds: [String(inactive._id)],
      });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.code, "INACTIVE_EMPLOYEE");
  });

  it("rejects self-reporting and a reporting cycle", async () => {
    const models = await getCompanyModels(acme);
    const manager = await models.Employee.findOne({ email: "team.lead@batch6.test" });
    const report = await models.Employee.findOne({ email: "team.member@batch6.test" });

    const assigned = await request(app)
      .patch(`/api/employees/${report._id}`)
      .set("Cookie", caCookie)
      .send({ reportingManagerId: String(manager._id) });
    assert.equal(assigned.status, 200, assigned.body?.message);

    const cycle = await request(app)
      .patch(`/api/employees/${manager._id}`)
      .set("Cookie", caCookie)
      .send({ reportingManagerId: String(report._id) });
    assert.equal(cycle.status, 400);
    assert.match(cycle.body.message, /circular reporting relationship/i);

    const self = await request(app)
      .patch(`/api/employees/${manager._id}`)
      .set("Cookie", caCookie)
      .send({ reportingManagerId: String(manager._id) });
    assert.equal(self.status, 400);
    assert.equal(self.body.code, "SELF_REPORTING");
    assert.equal((await models.Employee.findById(manager._id)).job.reportingManagerId ?? null, null);
  });

  it("imports a department name and does not change a grade when only the title is edited", async () => {
    const models = await getCompanyModels(acme);
    const engineering = await models.Department.findOne({ normalizedName: "engineering" });
    const imported = await request(app)
      .post("/api/employees/import")
      .set("Cookie", caCookie)
      .send({
        rows: [{
          fullName: "Imported Analyst",
          email: "imported.analyst@batch6.test",
          employeeCode: "B6-IMP",
          jobTitle: "Analyst",
          department: "engineering",
          jobGrade: "L9",
        }],
      });
    assert.equal(imported.status, 201, imported.body?.message);
    const employee = await models.Employee.findOne({ email: "imported.analyst@batch6.test" });
    assert.equal(String(employee.job.departmentId), String(engineering._id));
    assert.equal(employee.job.department, "Engineering");
    assert.equal(employee.job.jobGrade, "L9");

    const renamed = await request(app)
      .patch(`/api/employees/${employee._id}`)
      .set("Cookie", caCookie)
      .send({ jobTitle: "Software Engineer" });
    assert.equal(renamed.status, 200, renamed.body?.message);
    const after = await models.Employee.findById(employee._id);
    assert.equal(after.job.jobTitle, "Software Engineer");
    assert.equal(after.job.jobGrade, "L9");
    assert.equal(String(after.job.departmentId), String(engineering._id));

    const inactiveImport = await request(app)
      .post("/api/employees/import")
      .set("Cookie", caCookie)
      .send({
        rows: [{
          fullName: "Inactive Import",
          email: "inactive.import@batch6.test",
          employeeCode: "B6-IMP-OFF",
          department: "Design",
        }],
      });
    assert.equal(inactiveImport.status, 400);
    assert.equal(inactiveImport.body.failed[0].code, "DEPARTMENT_INACTIVE");
    assert.equal(await models.Employee.countDocuments({ email: "inactive.import@batch6.test" }), 0);
  });

  it("links a portal employment profile by department id without changing the system role", async () => {
    const models = await getCompanyModels(acme);
    const engineering = await models.Department.findOne({ normalizedName: "engineering" });
    const hr = await models.User.create({
      email: "hr@batch6.test",
      fullName: "Batch HR",
      passwordHash: await hashPassword(PASSWORD),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });

    const linked = await request(app)
      .put(`/api/company-admin/hr-admins/${hr._id}/employee-profile`)
      .set("Cookie", caCookie)
      .send({
        fullName: "Batch HR",
        employeeCode: "B6-HR",
        jobTitle: "HR Partner",
        jobGrade: "L5",
        departmentId: String(engineering._id),
      });
    assert.equal(linked.status, 200, linked.body?.message);
    assert.equal(linked.body.employeeProfile.departmentId, String(engineering._id));
    assert.equal(linked.body.employeeProfile.department, "Engineering");
    assert.equal((await models.User.findById(hr._id)).role, USER_ROLES.HR_ADMIN);

    const blank = await request(app)
      .put(`/api/company-admin/hr-admins/${hr._id}/employee-profile`)
      .set("Cookie", caCookie)
      .send({ department: "   ", jobTitle: "HR Partner" });
    assert.equal(blank.status, 200, blank.body?.message);
    const stillLinked = await models.Employee.findOne({ email: "hr@batch6.test" });
    assert.equal(String(stillLinked.job.departmentId), String(engineering._id));
    assert.equal(stillLinked.job.jobGrade, "L5");

    const cleared = await request(app)
      .put(`/api/company-admin/hr-admins/${hr._id}/employee-profile`)
      .set("Cookie", caCookie)
      .send({ clearDepartment: true });
    assert.equal(cleared.status, 200, cleared.body?.message);
    const after = await models.Employee.findOne({ email: "hr@batch6.test" });
    assert.equal(after.job.departmentId ?? null, null);
    assert.equal(after.job.department, "");
    assert.equal(after.job.jobTitle, "HR Partner");
    assert.equal((await models.User.findById(hr._id)).role, USER_ROLES.HR_ADMIN);
  });
});
