process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f56-employee-filter-options-test-secret-32!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f56_filter_options";
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
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import {
  buildEmployeeFilterOptions,
  normalizeFilterOptionLabel,
} from "../services/employeeFilterOptionsService.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

function hrAccess(permissions, scope) {
  return {
    version: 1,
    configuredAt: new Date(),
    updatedAt: new Date(),
    permissions,
    employeeScope: scope,
  };
}

describe("F56 employee filter-options", () => {
  let mongoServer;
  let app;
  let acme;
  let globex;
  let acmeModels;
  let globexModels;
  let engDept;
  let financeDept;
  let caCookie;
  let hrCustomCookie;
  let hrDeniedCookie;
  let empCookie;
  let globexCookie;
  let rareDeptName;
  let rareTitle;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    await connectCentralDB();
    app = createApp();

    const password = await hashPassword("F56Pass123!");
    const stamp = Date.now();

    acme = await Company.create({
      companyName: "F56 Acme",
      slug: `f56-acme-${stamp}`,
      databaseName: `company_f56_acme_${stamp}`,
      status: COMPANY_STATUSES.ACTIVE,
      config: { hrAccessEnforcement: { mode: "ENFORCED" } },
    });
    globex = await Company.create({
      companyName: "F56 Globex",
      slug: `f56-globex-${stamp}`,
      databaseName: `company_f56_globex_${stamp}`,
      status: COMPANY_STATUSES.ACTIVE,
    });

    acmeModels = await getCompanyModels(acme, { provision: true });
    globexModels = await getCompanyModels(globex, { provision: true });

    engDept = await acmeModels.Department.create({ name: "Engineering", isActive: true });
    financeDept = await acmeModels.Department.create({ name: "Finance", isActive: true });

    await acmeModels.User.create({
      email: "ca@f56-acme.test",
      passwordHash: password,
      role: USER_ROLES.COMPANY_ADMIN,
      fullName: "F56 CA",
      isActive: true,
    });

    await acmeModels.User.create({
      email: "hr.custom@f56-acme.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "F56 Custom HR",
      isActive: true,
      hrAccess: hrAccess(["people.view", "people.create", "people.edit"], {
        mode: "CUSTOM",
        departmentIds: [engDept._id],
        employeeIds: [],
      }),
    });

    await acmeModels.User.create({
      email: "hr.denied@f56-acme.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "F56 Denied HR",
      isActive: true,
      hrAccess: hrAccess(["dashboard.view"], {
        mode: "COMPANY",
        departmentIds: [],
        employeeIds: [],
      }),
    });

    rareDeptName = "Zebra Rare Dept";
    rareTitle = "Zebra Rare Title";

    // 300 employees sorting before "Zzz" — pool of 300 would miss the rare Zzz row.
    const bulk = [];
    for (let i = 0; i < 300; i++) {
      const n = String(i).padStart(3, "0");
      bulk.push({
        employeeCode: `F56-A-${n}`,
        fullName: `Aaa Person ${n}`,
        email: `aaa${n}@f56-acme.test`,
        status: EMPLOYEE_STATUSES.ACTIVE,
        job: {
          jobTitle: "Engineer",
          department: "Engineering",
          departmentId: engDept._id,
          employmentType: "Full-time",
          workLocation: "HQ",
          project: { projectName: "Alpha", projectType: "MANDATE" },
          joiningDate: new Date("2026-01-01"),
        },
      });
    }
    // Blank / whitespace / null-ish fields should not appear as options.
    bulk.push({
      employeeCode: "F56-BLANK",
      fullName: "Blank Fields Emp",
      email: "blank@f56-acme.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: {
        jobTitle: "   ",
        department: "",
        employmentType: null,
        workLocation: "  ",
        project: { projectName: "   ", projectType: "BENCH" },
        joiningDate: new Date("2026-01-01"),
      },
    });
    // Duplicate labels + finance (out of CUSTOM HR scope)
    bulk.push({
      employeeCode: "F56-FIN",
      fullName: "Finance Only",
      email: "finance@f56-acme.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: {
        jobTitle: "Analyst",
        department: "Finance",
        departmentId: financeDept._id,
        employmentType: "Full-time",
        workLocation: "Remote",
        project: { projectName: "Ledger", projectType: "INTERNAL" },
        joiningDate: new Date("2026-01-01"),
      },
    });
    // Past the 300-name pool window
    bulk.push({
      employeeCode: "F56-Z",
      fullName: "Zzz Last Person",
      email: "zzz@f56-acme.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: {
        jobTitle: rareTitle,
        department: rareDeptName,
        employmentType: "Contract",
        workLocation: "Satellite",
        project: { projectName: "Omega Rare", projectType: "RETAIL" },
        joiningDate: new Date("2026-01-01"),
      },
    });

    await acmeModels.Employee.insertMany(bulk);

    const empUser = await acmeModels.User.create({
      email: "emp@f56-acme.test",
      passwordHash: password,
      role: USER_ROLES.EMPLOYEE,
      fullName: "Aaa Person 000",
      isActive: true,
    });
    const firstEmp = await acmeModels.Employee.findOne({ employeeCode: "F56-A-000" });
    empUser.employeeId = firstEmp._id;
    firstEmp.userId = empUser._id;
    await empUser.save();
    await firstEmp.save();

    await globexModels.User.create({
      email: "hr@f56-globex.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "Globex HR",
      isActive: true,
      hrAccess: hrAccess(["people.view"], {
        mode: "COMPANY",
        departmentIds: [],
        employeeIds: [],
      }),
    });
    await globexModels.Employee.create({
      employeeCode: "GX-1",
      fullName: "Globex Secret",
      email: "secret@f56-globex.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: {
        jobTitle: "Globex Only Title",
        department: "Globex Only Dept",
        employmentType: "Full-time",
        workLocation: "Globex HQ",
        project: { projectName: "Globex Only Project", projectType: "MANDATE" },
        joiningDate: new Date("2026-01-01"),
      },
    });

    async function login(companyCode, email) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ companyCode, email, password: "F56Pass123!" });
      assert.equal(res.status, 200, res.body?.message || "login failed");
      return cookieFrom(res);
    }

    caCookie = await login(acme.slug, "ca@f56-acme.test");
    hrCustomCookie = await login(acme.slug, "hr.custom@f56-acme.test");
    hrDeniedCookie = await login(acme.slug, "hr.denied@f56-acme.test");
    empCookie = await login(acme.slug, "emp@f56-acme.test");
    globexCookie = await login(globex.slug, "hr@f56-globex.test");
  });

  after(async () => {
    await disconnectAll();
    if (mongoServer) await mongoServer.stop();
  });

  it("normalizeFilterOptionLabel drops null/empty/whitespace", () => {
    assert.equal(normalizeFilterOptionLabel(null), null);
    assert.equal(normalizeFilterOptionLabel(""), null);
    assert.equal(normalizeFilterOptionLabel("   "), null);
    assert.equal(normalizeFilterOptionLabel(" Eng "), "Eng");
  });

  it("requires people.view and rejects employees", async () => {
    assert.equal((await request(app).get("/api/employees/filter-options")).status, 401);
    const denied = await request(app)
      .get("/api/employees/filter-options")
      .set("Cookie", hrDeniedCookie);
    assert.equal(denied.status, 403);
    const emp = await request(app).get("/api/employees/filter-options").set("Cookie", empCookie);
    assert.equal(emp.status, 403);
  });

  it("returns complete distinct options beyond the 300 pool window", async () => {
    const res = await request(app)
      .get("/api/employees/filter-options")
      .query({ status: "ALL" })
      .set("Cookie", caCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.status, "ALL");

    const deptNames = res.body.departments.map((d) => d.name);
    assert.ok(deptNames.includes(rareDeptName), "rare dept after pool window must appear");
    assert.ok(deptNames.includes("Engineering"));
    assert.ok(deptNames.includes("Finance"));
    assert.equal(deptNames.includes(""), false);
    assert.ok(!deptNames.some((n) => !String(n).trim()));

    const eng = res.body.departments.find((d) => d.name === "Engineering");
    assert.ok(eng.count >= 300);
    const rare = res.body.departments.find((d) => d.name === rareDeptName);
    assert.equal(rare.count, 1);

    assert.ok(res.body.jobTitles.includes(rareTitle));
    assert.ok(res.body.jobTitles.includes("Engineer"));
    assert.equal(res.body.jobTitles.includes(""), false);
    assert.ok(!res.body.jobTitles.some((t) => t.trim() === ""));

    assert.ok(res.body.projects.includes("Omega Rare"));
    assert.ok(res.body.projects.includes("Alpha"));
    assert.ok(!res.body.projects.includes("   "));

    assert.ok(res.body.employmentTypes.includes("Contract"));
    assert.ok(res.body.workLocations.includes("Satellite"));

    // No employee documents / compensation leakage
    assert.equal(res.body.employees, undefined);
    assert.equal(res.body.compensation, undefined);
    const blob = JSON.stringify(res.body);
    assert.equal(blob.includes("monthlyCostToCompany"), false);
    assert.equal(blob.includes("Aaa Person 000"), false);
    assert.equal(blob.includes("@f56-acme.test"), false);
  });

  it("aggregation does not return full employee documents for large tenants", async () => {
    const options = await buildEmployeeFilterOptions({
      Employee: acmeModels.Employee,
      hrAccess: { enforced: false, role: USER_ROLES.COMPANY_ADMIN },
      status: "ALL",
    });
    assert.ok(Array.isArray(options.departments));
    assert.ok(options.departments.every((d) => d.name && typeof d.count === "number"));
    assert.equal(Object.keys(options).includes("employees"), false);
  });

  it("CUSTOM HR scope only sees in-scope departments/projects", async () => {
    const res = await request(app)
      .get("/api/employees/filter-options")
      .set("Cookie", hrCustomCookie);
    assert.equal(res.status, 200);
    const deptNames = res.body.departments.map((d) => d.name);
    assert.ok(deptNames.includes("Engineering"));
    assert.equal(deptNames.includes("Finance"), false);
    assert.equal(res.body.projects.includes("Ledger"), false);
    assert.ok(res.body.projects.includes("Alpha"));
    // Rare Zzz emp has no departmentId in eng scope match — department string only;
    // CUSTOM scope typically matches departmentIds / allowed employees.
    // Finance excluded; Engineering included.
  });

  it("tenant isolation: Globex options never include Acme values and vice versa", async () => {
    const globexRes = await request(app)
      .get("/api/employees/filter-options")
      .set("Cookie", globexCookie);
    assert.equal(globexRes.status, 200);
    assert.ok(globexRes.body.departments.some((d) => d.name === "Globex Only Dept"));
    assert.equal(
      globexRes.body.departments.some((d) => d.name === rareDeptName),
      false
    );
    assert.equal(globexRes.body.jobTitles.includes(rareTitle), false);

    const acmeRes = await request(app)
      .get("/api/employees/filter-options")
      .set("Cookie", caCookie);
    assert.equal(acmeRes.body.departments.some((d) => d.name === "Globex Only Dept"), false);
    assert.equal(acmeRes.body.projects.includes("Globex Only Project"), false);
  });

  it("preserves People list pagination and filtering", async () => {
    const list = await request(app)
      .get("/api/employees")
      .query({
        page: 1,
        limit: 50,
        sortBy: "fullName",
        sortOrder: "asc",
        department: rareDeptName,
        includeCompensation: false,
      })
      .set("Cookie", caCookie);
    assert.equal(list.status, 200);
    assert.equal(list.body.pagination.limit, 50);
    assert.ok(list.body.pagination.totalEmployees >= 1);
    assert.ok(
      list.body.employees.every(
        (e) => String(e.job?.department || "").toLowerCase() === rareDeptName.toLowerCase()
      )
    );

    const page2 = await request(app)
      .get("/api/employees")
      .query({ page: 2, limit: 50, sortBy: "fullName", sortOrder: "asc" })
      .set("Cookie", caCookie);
    assert.equal(page2.status, 200);
    assert.equal(page2.body.pagination.page, 2);
    assert.ok(page2.body.employees.length > 0);
  });

  it("rejects invalid status query", async () => {
    const res = await request(app)
      .get("/api/employees/filter-options")
      .query({ status: "NOPE" })
      .set("Cookie", caCookie);
    assert.equal(res.status, 400);
  });

  it("invalidateEmployees includes filter-options query key (desktop cache)", async () => {
    const { invalidateEmployees } = await import("../../client/src/lib/queryKeys.js");
    const calls = [];
    const client = {
      invalidateQueries: async ({ queryKey }) => {
        calls.push(queryKey);
      },
    };
    await invalidateEmployees(client);
    assert.ok(
      calls.some(
        (key) => Array.isArray(key) && key[0] === "admin" && key[1] === "employees-filter-options"
      ),
      `expected employees-filter-options invalidation, got ${JSON.stringify(calls)}`
    );
    assert.ok(calls.some((key) => Array.isArray(key) && key[1] === "employees"));
    assert.ok(calls.some((key) => Array.isArray(key) && key[1] === "employees-pool"));
  });
});
