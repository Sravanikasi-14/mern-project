process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { DEPARTMENT_EMPLOYEE_ALLOWED_KEYS } from "../services/organizationExplorerDepartmentsService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

let mongo;
let app;
let acme;
let globex;
let acmeHrCookie;
let acmeEmpCookie;
let globexHrCookie;
let ids = {};

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

async function createEmp(company, data) {
  const { Employee } = await getCompanyModels(company);
  return Employee.create({
    status: data.status || EMPLOYEE_STATUSES.ACTIVE,
    phoneNumber: data.phoneNumber || "9000000001",
    email: data.email,
    employeeCode: data.employeeCode,
    fullName: data.fullName,
    preferredName: data.preferredName || "",
    userId: data.userId,
    invitation: data.invitation,
    personalEmail: "personal@hidden.test",
    personalPhone: "1111111111",
    bankDetails: {
      accountHolderName: data.fullName,
      accountNumber: "1234567890",
      bankName: "Test Bank",
      ifscCode: "TEST0001",
    },
    taxDetails: { panNumber: "ABCDE1234F", taxRegime: "NEW" },
    identityDetails: { idType: "PAN", idNumber: "XXXX", isVerified: true },
    job: {
      jobTitle: data.jobTitle || "Engineer",
      department: Object.prototype.hasOwnProperty.call(data, "department")
        ? data.department
        : "Engineering",
      employmentType: data.employmentType || "Full-time",
      workLocation: data.workLocation || "Hyderabad",
      joiningDate: data.joiningDate || new Date("2024-01-15"),
      reportingManagerId: data.reportingManagerId || null,
    },
  });
}

function assertSafeEmployees(employees) {
  assert.ok(Array.isArray(employees));
  const json = JSON.stringify(employees);
  assert.equal(json.includes("secret-invite"), false);
  assert.equal(json.includes("passwordHash"), false);
  assert.equal(json.includes("personalEmail"), false);
  assert.equal(json.includes("personalPhone"), false);
  assert.equal(json.includes("bankDetails"), false);
  assert.equal(json.includes("taxDetails"), false);
  assert.equal(json.includes("identityDetails"), false);
  assert.equal(json.includes("compensation"), false);
  assert.equal(json.includes("9000000001"), false);
  for (const emp of employees) {
    assert.equal(emp.email, undefined);
    assert.equal(emp.phoneNumber, undefined);
    assert.equal(emp.status, undefined);
    assert.equal(emp.invitation, undefined);
    for (const key of Object.keys(emp)) {
      assert.ok(
        DEPARTMENT_EMPLOYEE_ALLOWED_KEYS.includes(key),
        `unexpected department employee field: ${key}`
      );
    }
  }
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme Dept Explorer",
    slug: "acme-dept",
    databaseName: "company_acme_dept",
    status: COMPANY_STATUSES.ACTIVE,
  });
  globex = await Company.create({
    companyName: "Globex Dept Explorer",
    slug: "globex-dept",
    databaseName: "company_globex_dept",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: AcmeUser } = await getCompanyModels(acme);
  await AcmeUser.create({
    email: "hr@acme-dept.test",
    passwordHash: await hashPassword("AcmeHrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const empUser = await AcmeUser.create({
    email: "emp@acme-dept.test",
    passwordHash: await hashPassword("AcmeEmpPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  const mgr = await createEmp(acme, {
    employeeCode: "DEPT-MGR",
    fullName: "Dana Manager",
    email: "mgr@acme-dept.test",
    jobTitle: "Engineering Manager",
    department: "Engineering",
  });
  const eng1 = await createEmp(acme, {
    employeeCode: "DEPT-E1",
    fullName: "Alex Engineer",
    email: "emp@acme-dept.test",
    userId: empUser._id,
    jobTitle: "Software Engineer",
    department: "Engineering",
    reportingManagerId: mgr._id,
    invitation: { token: "secret-invite", status: "PENDING" },
  });
  empUser.employeeId = eng1._id;
  await empUser.save();

  const eng2 = await createEmp(acme, {
    employeeCode: "DEPT-E2",
    fullName: "Blake Engineer",
    email: "blake@acme-dept.test",
    jobTitle: "Software Engineer",
    department: "Engineering",
    reportingManagerId: mgr._id,
  });
  const hrPerson = await createEmp(acme, {
    employeeCode: "DEPT-HR",
    fullName: "Casey People",
    email: "people@acme-dept.test",
    jobTitle: "HR Specialist",
    department: "People Ops",
  });
  const unassignedEmpty = await createEmp(acme, {
    employeeCode: "DEPT-U1",
    fullName: "Empty Dept",
    email: "empty@acme-dept.test",
    jobTitle: "Contractor",
    department: "",
  });
  const unassignedNull = await createEmp(acme, {
    employeeCode: "DEPT-U2",
    fullName: "Null Dept",
    email: "nulldept@acme-dept.test",
    jobTitle: "Contractor",
    department: null,
  });
  const unassignedSpaces = await createEmp(acme, {
    employeeCode: "DEPT-U3",
    fullName: "Spaces Dept",
    email: "spaces@acme-dept.test",
    jobTitle: "Contractor",
    department: "   ",
  });
  const product = await createEmp(acme, {
    employeeCode: "DEPT-P1",
    fullName: "Pat Product",
    email: "product@acme-dept.test",
    jobTitle: "PM",
    department: "Product & Design",
  });
  await createEmp(acme, {
    employeeCode: "DEPT-INACT",
    fullName: "Inactive Engineer",
    email: "inactive@acme-dept.test",
    jobTitle: "Software Engineer",
    department: "Engineering",
    status: EMPLOYEE_STATUSES.INACTIVE,
  });

  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "hr@globex-dept.test",
    passwordHash: await hashPassword("GlobexHrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const globexOnly = await createEmp(globex, {
    employeeCode: "GX-DEPT-1",
    fullName: "Globex Only",
    email: "gx@globex-dept.test",
    jobTitle: "Director",
    department: "Engineering",
  });

  ids = {
    mgr: String(mgr._id),
    eng1: String(eng1._id),
    eng2: String(eng2._id),
    hrPerson: String(hrPerson._id),
    unassignedEmpty: String(unassignedEmpty._id),
    unassignedNull: String(unassignedNull._id),
    unassignedSpaces: String(unassignedSpaces._id),
    product: String(product._id),
    globexOnly: String(globexOnly._id),
  };

  acmeHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-dept",
      email: "hr@acme-dept.test",
      password: "AcmeHrPass123!",
    })
  );
  acmeEmpCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-dept",
      email: "emp@acme-dept.test",
      password: "AcmeEmpPass123!",
    })
  );
  globexHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "globex-dept",
      email: "hr@globex-dept.test",
      password: "GlobexHrPass123!",
    })
  );
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("GET /api/employees/organization-explorer/departments", () => {
  it("HR can retrieve department overview", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/departments")
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.departments));
    assert.ok(res.body.departments.length >= 3);

    const engineering = res.body.departments.find((d) => d.name === "Engineering");
    assert.ok(engineering);
    assert.equal(engineering.employeeCount, 3);
    assert.equal(engineering.employees.length, 3);
    assert.ok(engineering.employees.some((e) => e.id === ids.mgr));
    assert.ok(engineering.employees.some((e) => e.id === ids.eng1));
    assert.ok(engineering.employees.some((e) => e.id === ids.eng2));
    assert.equal(engineering.employees.some((e) => e.fullName === "Inactive Engineer"), false);

    const unassigned = res.body.departments.find((d) => d.name === "Unassigned");
    assert.ok(unassigned);
    assert.equal(unassigned.employeeCount, 3);
    assert.ok(unassigned.employees.some((e) => e.id === ids.unassignedEmpty));
    assert.ok(unassigned.employees.some((e) => e.id === ids.unassignedNull));
    assert.ok(unassigned.employees.some((e) => e.id === ids.unassignedSpaces));

    for (const dept of res.body.departments) {
      assertSafeEmployees(dept.employees);
    }
    assert.equal(res.body.departments.some((d) => d.employees.some((e) => e.id === ids.globexOnly)), false);
  });

  it("Employee can retrieve department overview", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/departments")
      .set("Cookie", acmeEmpCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const engineering = res.body.departments.find((d) => d.name === "Engineering");
    assert.equal(engineering.employeeCount, 3);
    assertSafeEmployees(engineering.employees);
  });

  it("groups multiple employees in one department correctly", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/departments")
      .set("Cookie", acmeHrCookie);
    const engineering = res.body.departments.find((d) => d.name === "Engineering");
    assert.equal(engineering.employeeCount, engineering.employees.length);
    assert.equal(new Set(engineering.employees.map((e) => e.id)).size, 3);
  });
});

describe("GET /api/employees/organization-explorer/departments/:department", () => {
  it("HR and employees can retrieve department employees", async () => {
    const hr = await request(app)
      .get("/api/employees/organization-explorer/departments/Engineering")
      .set("Cookie", acmeHrCookie);
    const emp = await request(app)
      .get("/api/employees/organization-explorer/departments/Engineering")
      .set("Cookie", acmeEmpCookie);

    assert.equal(hr.status, 200);
    assert.equal(emp.status, 200);
    assert.equal(hr.body.department, "Engineering");
    assert.equal(hr.body.employees.length, 3);
    assert.equal(emp.body.employees.length, 3);
    assert.equal(hr.body.meta.total, 3);
    assertSafeEmployees(hr.body.employees);
    assertSafeEmployees(emp.body.employees);

    const eng1 = hr.body.employees.find((e) => e.id === ids.eng1);
    assert.equal(eng1.fullName, "Alex Engineer");
    assert.equal(eng1.employeeCode, "DEPT-E1");
    assert.equal(eng1.jobTitle, "Software Engineer");
    assert.equal(eng1.department, "Engineering");
    assert.equal(eng1.reportingManagerId, ids.mgr);
  });

  it("returns Unassigned bucket for missing/empty departments", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/departments/Unassigned")
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.department, "Unassigned");
    assert.equal(res.body.employees.length, 3);
    assertSafeEmployees(res.body.employees);
  });

  it("supports URL-encoded department names", async () => {
    const encoded = encodeURIComponent("Product & Design");
    const res = await request(app)
      .get(`/api/employees/organization-explorer/departments/${encoded}`)
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.department, "Product & Design");
    assert.equal(res.body.employees.length, 1);
    assert.equal(res.body.employees[0].id, ids.product);
  });

  it("returns empty result for a valid department with no active employees", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/departments/Legal")
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.department, "Legal");
    assert.deepEqual(res.body.employees, []);
    assert.equal(res.body.meta.total, 0);
  });

  it("excludes inactive employees from department detail", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/departments/Engineering")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.body.employees.some((e) => e.fullName === "Inactive Engineer"), false);
  });
});

describe("Organization Explorer departments auth + isolation", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/employees/organization-explorer/departments");
    assert.equal(res.status, 401);
  });

  it("returns 403 when Departments view is disabled", async () => {
    await Company.updateOne(
      { _id: acme._id },
      {
        $set: {
          "config.organizationExplorer.enabledViews": ["reporting", "teams"],
          "config.organizationExplorer.defaultView": "reporting",
          "config.organizationExplorer.allowCompletedProjectsFilter": false,
        },
      }
    );

    const overview = await request(app)
      .get("/api/employees/organization-explorer/departments")
      .set("Cookie", acmeEmpCookie);
    const detail = await request(app)
      .get("/api/employees/organization-explorer/departments/Engineering")
      .set("Cookie", acmeHrCookie);

    assert.equal(overview.status, 403);
    assert.equal(detail.status, 403);

    // Restore defaults for later / parallel-safe assertions.
    await Company.updateOne(
      { _id: acme._id },
      {
        $set: {
          "config.organizationExplorer.enabledViews": [
            "reporting",
            "teams",
            "projects",
            "departments",
          ],
          "config.organizationExplorer.defaultView": "reporting",
        },
      }
    );
  });

  it("never returns cross-tenant data and ignores client-supplied tenant ids", async () => {
    const acmeRes = await request(app)
      .get("/api/employees/organization-explorer/departments")
      .query({
        companyId: String(globex._id),
        databaseName: globex.databaseName,
        companyCode: "globex-dept",
      })
      .set("Cookie", acmeHrCookie);

    assert.equal(acmeRes.status, 200);
    assert.equal(
      acmeRes.body.departments.some((d) => d.employees.some((e) => e.id === ids.globexOnly)),
      false
    );
    assert.equal(
      acmeRes.body.departments.some((d) => d.employees.some((e) => e.employeeCode === "GX-DEPT-1")),
      false
    );

    const gx = await request(app)
      .get("/api/employees/organization-explorer/departments")
      .set("Cookie", globexHrCookie);
    assert.equal(gx.status, 200);
    const eng = gx.body.departments.find((d) => d.name === "Engineering");
    assert.ok(eng);
    assert.equal(eng.employees.length, 1);
    assert.equal(eng.employees[0].id, ids.globexOnly);
    assert.equal(eng.employees.some((e) => e.id === ids.eng1), false);
  });
});

describe("Existing reporting / directory regressions", () => {
  it("organization-view and directory remain available", async () => {
    const orgView = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeEmpCookie);
    assert.equal(orgView.status, 200);
    assert.ok(Array.isArray(orgView.body.employees));
    assert.ok(orgView.body.employees.some((e) => e.id === ids.eng1));

    const directory = await request(app)
      .get("/api/employees/directory")
      .set("Cookie", acmeEmpCookie);
    assert.equal(directory.status, 200);
    assert.ok(Array.isArray(directory.body.employees) || Array.isArray(directory.body.data));
  });
});
