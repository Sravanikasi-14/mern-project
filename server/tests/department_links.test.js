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
import { selectDepartmentMatch } from "../services/departmentLinkService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

const PASSWORD = "DeptLinksPass1!";
const DB_PATH = "D:/tmp/hrms-mongo/ca-dept-links";

let mongo;
let app;
let acme;
let globex;
let legacy;
let caCookie;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

describe("canonical department links", () => {
  it("matches one active department and rejects blank, inactive, and ambiguous names", () => {
    const engineering = { name: "Engineering", normalizedName: "engineering", isActive: true };
    const tech = { name: "TECH", normalizedName: "tech", isActive: true };
    const inactive = { name: "Management", normalizedName: "management", isActive: false };

    assert.equal(selectDepartmentMatch([engineering, tech], " engineering ").status, "active");
    assert.equal(selectDepartmentMatch([engineering, tech], "ENGINEERING").department.name, "Engineering");
    assert.equal(selectDepartmentMatch([engineering, tech], "TECH").department.name, "TECH");
    assert.equal(selectDepartmentMatch([engineering], "Core Platform Engineering").status, "unresolved");
    assert.equal(selectDepartmentMatch([engineering], "   ").status, "blank");
    assert.equal(selectDepartmentMatch([inactive], "management").status, "inactive");
    assert.equal(
      selectDepartmentMatch(
        [engineering, { name: "ENGINEERING", normalizedName: "engineering", isActive: true }],
        "Engineering"
      ).status,
      "ambiguous"
    );
  });

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
      companyName: "Acme Departments",
      slug: "acme-dept-links",
      databaseName: "company_acme_dept_links",
      status: COMPANY_STATUSES.ACTIVE,
      schemaVersion: 1,
      config: { hrAccessEnforcement: { mode: "OFF" } },
    });
    globex = await Company.create({
      companyName: "Globex Departments",
      slug: "globex-dept-links",
      databaseName: "company_globex_dept_links",
      status: COMPANY_STATUSES.ACTIVE,
      schemaVersion: 1,
      config: { hrAccessEnforcement: { mode: "OFF" } },
    });
    legacy = await Company.create({
      companyName: "Legacy Departments",
      slug: "legacy-dept-links",
      databaseName: "company_legacy_dept_links",
      status: COMPANY_STATUSES.ACTIVE,
      schemaVersion: 1,
      config: { hrAccessEnforcement: { mode: "ENFORCED" } },
    });

    const passwordHash = await hashPassword(PASSWORD);
    const acmeModels = await getCompanyModels(acme);
    await createCompanyAdmin(acmeModels.User, {
      email: "ca@acme-dept.test",
      fullName: "Acme Company Admin",
      passwordHash,
      isActive: true,
    });
    const legacyModels = await getCompanyModels(legacy);
    await createCompanyAdmin(legacyModels.User, {
      email: "ca@legacy-dept.test",
      fullName: "Legacy Company Admin",
      passwordHash,
      isActive: true,
    });

    caCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "acme-dept-links",
        email: "ca@acme-dept.test",
        password: PASSWORD,
      })
    );
    assert.ok(caCookie);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("resolves department names on create and edit without clearing an existing link", async () => {
    const createdDept = await request(app)
      .post("/api/departments")
      .set("Cookie", caCookie)
      .send({ name: "Engineering" });
    assert.equal(createdDept.status, 201, createdDept.body?.message);
    const engineeringId = createdDept.body.department.id || createdDept.body.department._id;

    const created = await request(app)
      .post("/api/employees")
      .set("Cookie", caCookie)
      .send({
        fullName: "Case Match",
        email: "case.match@acme-dept.test",
        employeeCode: "DEP-1",
        jobTitle: "Engineer",
        department: "engineering",
      });
    assert.equal(created.status, 201, created.body?.message);

    const models = await getCompanyModels(acme);
    const employee = await models.Employee.findOne({ email: "case.match@acme-dept.test" });
    assert.equal(String(employee.job.departmentId), String(engineeringId));
    assert.equal(employee.job.department, "Engineering");
    assert.equal(employee.job.jobTitle, "Engineer");

    const blank = await request(app)
      .post("/api/employees")
      .set("Cookie", caCookie)
      .send({
        fullName: "Blank Dept",
        email: "blank.dept@acme-dept.test",
        employeeCode: "DEP-2",
        department: "   ",
      });
    assert.equal(blank.status, 201, blank.body?.message);
    const blankEmployee = await models.Employee.findOne({ email: "blank.dept@acme-dept.test" });
    assert.equal(blankEmployee.job.departmentId ?? null, null);
    assert.equal((blankEmployee.job.department || "").trim(), "");
    assert.equal(await models.Department.countDocuments({ normalizedName: "" }), 0);

    const unlinked = await models.Employee.create({
      employeeCode: "DEP-FREE",
      fullName: "Free Text",
      email: "free.text@acme-dept.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "Analyst", department: "Notes", departmentId: null },
    });
    const freeEdit = await request(app)
      .patch(`/api/employees/${unlinked._id}`)
      .set("Cookie", caCookie)
      .send({ department: "Field Notes" });
    assert.equal(freeEdit.status, 200, freeEdit.body?.message);
    const freeAfter = await models.Employee.findById(unlinked._id);
    assert.equal(freeAfter.job.departmentId ?? null, null);
    assert.equal(freeAfter.job.department, "Field Notes");

    const titleOnly = await request(app)
      .patch(`/api/employees/${employee._id}`)
      .set("Cookie", caCookie)
      .send({ jobTitle: "Senior Engineer" });
    assert.equal(titleOnly.status, 200, titleOnly.body?.message);
    const titled = await models.Employee.findById(employee._id);
    assert.equal(titled.job.jobTitle, "Senior Engineer");
    assert.equal(String(titled.job.departmentId), String(engineeringId));
    assert.equal(titled.job.department, "Engineering");

    const whitespace = await request(app)
      .patch(`/api/employees/${employee._id}`)
      .set("Cookie", caCookie)
      .send({ department: "   " });
    assert.equal(whitespace.status, 200, whitespace.body?.message);
    const stillLinked = await models.Employee.findById(employee._id);
    assert.equal(String(stillLinked.job.departmentId), String(engineeringId));
    assert.equal(stillLinked.job.department, "Engineering");

    const unresolved = await request(app)
      .patch(`/api/employees/${employee._id}`)
      .set("Cookie", caCookie)
      .send({ department: "Unknown Lab" });
    assert.equal(unresolved.status, 400);
    assert.equal(unresolved.body.code, "DEPARTMENT_UNRESOLVED");
    const unchanged = await models.Employee.findById(employee._id);
    assert.equal(String(unchanged.job.departmentId), String(engineeringId));
    assert.equal(unchanged.job.department, "Engineering");
    assert.equal(unchanged.job.jobTitle, "Senior Engineer");
  });

  it("renames linked employee text and only exact team text", async () => {
    const models = await getCompanyModels(acme);
    const engineering = await models.Department.findOne({ normalizedName: "engineering" });
    const employee = await models.Employee.findOne({ email: "case.match@acme-dept.test" });
    await models.Team.create({ name: "Platform", department: "Engineering", isActive: true });
    await models.Team.create({ name: "Lower", department: "engineering", isActive: true });
    await models.Team.create({ name: "Other", department: "TECH", isActive: true });

    const renamed = await request(app)
      .patch(`/api/departments/${engineering._id}`)
      .set("Cookie", caCookie)
      .send({ name: "Product Engineering" });
    assert.equal(renamed.status, 200, renamed.body?.message);

    const employeeAfter = await models.Employee.findById(employee._id);
    assert.equal(String(employeeAfter.job.departmentId), String(engineering._id));
    assert.equal(employeeAfter.job.department, "Product Engineering");
    assert.equal(employeeAfter.job.jobTitle, "Senior Engineer");
    assert.equal((await models.Team.findOne({ name: "Platform" })).department, "Product Engineering");
    assert.equal((await models.Team.findOne({ name: "Lower" })).department, "engineering");
    assert.equal((await models.Team.findOne({ name: "Other" })).department, "TECH");
  });

  it("keeps assignments when a department is deactivated and rejects a new one", async () => {
    const models = await getCompanyModels(acme);
    const engineering = await models.Department.findOne({ normalizedName: "product engineering" });
    const employee = await models.Employee.findOne({ email: "case.match@acme-dept.test" });

    const deactivated = await request(app)
      .post(`/api/departments/${engineering._id}/deactivate`)
      .set("Cookie", caCookie);
    assert.equal(deactivated.status, 200, deactivated.body?.message);
    assert.equal(await models.Department.countDocuments({ _id: engineering._id }), 1);

    const employeeAfter = await models.Employee.findById(employee._id);
    assert.equal(String(employeeAfter.job.departmentId), String(engineering._id));
    assert.equal(employeeAfter.job.department, "Product Engineering");
    assert.equal((await models.Team.findOne({ name: "Platform" })).department, "Product Engineering");

    const listed = await request(app).get("/api/departments").set("Cookie", caCookie);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.departments.some((department) => department.name === "Product Engineering"), false);

    const assign = await request(app)
      .put(`/api/departments/employees/${employee._id}/membership`)
      .set("Cookie", caCookie)
      .send({ departmentId: String(engineering._id) });
    assert.equal(assign.status, 400);

    const created = await request(app)
      .post("/api/employees")
      .set("Cookie", caCookie)
      .send({
        fullName: "Inactive Assign",
        email: "inactive.assign@acme-dept.test",
        employeeCode: "DEP-3",
        department: "Product Engineering",
      });
    assert.equal(created.status, 400);
    assert.equal(created.body.code, "DEPARTMENT_INACTIVE");
    assert.equal(await models.Employee.countDocuments({ email: "inactive.assign@acme-dept.test" }), 0);
    assert.equal(String((await models.Employee.findById(employee._id)).job.departmentId), String(engineering._id));
  });

  it("backfills legacy names once, preserves existing ids, and ignores other tenants", async () => {
    const legacyModels = await getCompanyModels(legacy);
    const design = await legacyModels.Department.create({ name: "Design", isActive: true });
    await legacyModels.Employee.create({
      employeeCode: "LEG-DESIGN",
      fullName: "Already Linked",
      email: "linked@legacy-dept.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "Designer", department: "Engineering", departmentId: design._id, project: { projectName: "Keep Me" } },
    });
    const legacyRows = [
      ["LEG-E1", "eng.one@legacy-dept.test", "Engineering"],
      ["LEG-E2", "eng.two@legacy-dept.test", "engineering"],
      ["LEG-TECH", "tech@legacy-dept.test", "TECH"],
      ["LEG-CORE", "core@legacy-dept.test", "Core Platform Engineering"],
      ["LEG-MGT", "mgt@legacy-dept.test", "Management"],
      ["LEG-CO", "company@legacy-dept.test", "Company"],
      ["LEG-BLANK", "blank@legacy-dept.test", "   "],
      ["LEG-EMPTY", "empty@legacy-dept.test", ""],
    ];
    for (const [employeeCode, email, department] of legacyRows) {
      await legacyModels.Employee.create({
        employeeCode,
        fullName: employeeCode,
        email,
        status: EMPLOYEE_STATUSES.ACTIVE,
        job: { department, project: { projectName: "Untouched" } },
      });
    }

    const globexModels = await getCompanyModels(globex);
    await globexModels.Employee.create({
      employeeCode: "G-1",
      fullName: "Globex Person",
      email: "person@globex-dept.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { department: "Engineering" },
    });

    const legacyCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "legacy-dept-links",
        email: "ca@legacy-dept.test",
        password: PASSWORD,
      })
    );
    const enforcementBefore = (await Company.findById(legacy)).config.hrAccessEnforcement.mode;

    const first = await request(app)
      .post("/api/departments/backfill-department-links")
      .set("Cookie", legacyCookie);
    assert.equal(first.status, 200, first.body?.message);
    const second = await request(app)
      .post("/api/departments/backfill-department-links")
      .set("Cookie", legacyCookie);
    assert.equal(second.status, 200, second.body?.message);

    const names = (await legacyModels.Department.find({}).select("name").lean()).map((department) => department.name).sort();
    assert.deepEqual(names, [
      "Company",
      "Core Platform Engineering",
      "Design",
      "Engineering",
      "Management",
      "TECH",
    ]);
    assert.equal(second.body.report.departmentsCreated, 0);

    const engineering = await legacyModels.Department.findOne({ normalizedName: "engineering" });
    const firstEmployee = await legacyModels.Employee.findOne({ email: "eng.one@legacy-dept.test" });
    const secondEmployee = await legacyModels.Employee.findOne({ email: "eng.two@legacy-dept.test" });
    assert.equal(String(firstEmployee.job.departmentId), String(engineering._id));
    assert.equal(String(secondEmployee.job.departmentId), String(engineering._id));
    assert.equal(firstEmployee.job.department, "Engineering");
    assert.equal(secondEmployee.job.department, "Engineering");
    assert.equal(firstEmployee.job.project.projectName, "Untouched");

    const linked = await legacyModels.Employee.findOne({ email: "linked@legacy-dept.test" });
    assert.equal(String(linked.job.departmentId), String(design._id));
    assert.equal(linked.job.department, "Engineering");
    assert.equal(linked.job.jobTitle, "Designer");

    const blank = await legacyModels.Employee.findOne({ email: "blank@legacy-dept.test" });
    const empty = await legacyModels.Employee.findOne({ email: "empty@legacy-dept.test" });
    assert.equal(blank.job.departmentId ?? null, null);
    assert.equal(empty.job.departmentId ?? null, null);

    const globexEmployee = await globexModels.Employee.findOne({ email: "person@globex-dept.test" });
    assert.equal(globexEmployee.job.departmentId ?? null, null);
    assert.equal(await globexModels.Department.countDocuments({}), 0);
    assert.equal((await Company.findById(legacy)).config.hrAccessEnforcement.mode, enforcementBefore);
    const legacyAdmin = await legacyModels.User.findOne({ email: "ca@legacy-dept.test" }).lean();
    assert.equal(legacyAdmin.role, USER_ROLES.COMPANY_ADMIN);
    assert.equal(legacyAdmin.employeeId ?? null, null);
  });

  it("shows each employee once under the linked department name", async () => {
    const models = await getCompanyModels(acme);
    const employee = await models.Employee.findOne({ email: "case.match@acme-dept.test" });
    employee.job.department = "Stale Label";
    employee.markModified("job");
    await employee.save();

    const overview = await request(app)
      .get("/api/employees/organization-explorer/departments")
      .set("Cookie", caCookie);
    assert.equal(overview.status, 200, overview.body?.message);
    const matches = overview.body.departments.filter((department) =>
      department.employees.some((person) => person.id === String(employee._id))
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, "Product Engineering");
    assert.equal(matches[0].employees.filter((person) => person.id === String(employee._id)).length, 1);
    assert.equal(matches[0].employees.find((person) => person.id === String(employee._id)).department, "Product Engineering");

    const detail = await request(app)
      .get("/api/employees/organization-explorer/departments/Product%20Engineering")
      .set("Cookie", caCookie);
    assert.equal(detail.status, 200, detail.body?.message);
    assert.equal(detail.body.employees.filter((person) => person.id === String(employee._id)).length, 1);
  });

  it("rejects an ambiguous active-department name without writing a link", async () => {
    const models = await getCompanyModels(acme);
    await models.Department.collection.dropIndex("departments_normalized_name_unique").catch(() => {});
    await models.Department.collection.insertMany([
      {
        name: "Shared",
        normalizedName: "shared",
        description: "",
        code: "",
        isActive: true,
        schemaVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: "SHARED",
        normalizedName: "shared",
        description: "",
        code: "",
        isActive: true,
        schemaVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const before = await models.Employee.countDocuments({ email: "ambiguous@acme-dept.test" });
    const created = await request(app)
      .post("/api/employees")
      .set("Cookie", caCookie)
      .send({
        fullName: "Ambiguous",
        email: "ambiguous@acme-dept.test",
        employeeCode: "DEP-AMB",
        department: "shared",
      });
    assert.equal(created.status, 409);
    assert.equal(created.body.code, "AMBIGUOUS_DEPARTMENT");
    assert.equal(await models.Employee.countDocuments({ email: "ambiguous@acme-dept.test" }), before);
  });
});
