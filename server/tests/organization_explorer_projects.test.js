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
import { PROJECT_EMPLOYEE_ALLOWED_KEYS } from "../services/organizationExplorerProjectsService.js";
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
      department: data.department || "Engineering",
      employmentType: data.employmentType || "Full-time",
      workLocation: data.workLocation || "Hyderabad",
      joiningDate: data.joiningDate || new Date("2024-01-15"),
      reportingManagerId: data.reportingManagerId || null,
      project: {
        projectName: Object.prototype.hasOwnProperty.call(data, "projectName")
          ? data.projectName
          : "",
        projectType: Object.prototype.hasOwnProperty.call(data, "projectType")
          ? data.projectType
          : "",
      },
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
    assert.equal(emp.projectName, undefined);
    assert.equal(emp.projectType, undefined);
    for (const key of Object.keys(emp)) {
      assert.ok(
        PROJECT_EMPLOYEE_ALLOWED_KEYS.includes(key),
        `unexpected project employee field: ${key}`
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
    companyName: "Acme Project Explorer",
    slug: "acme-proj",
    databaseName: "company_acme_proj",
    status: COMPANY_STATUSES.ACTIVE,
  });
  globex = await Company.create({
    companyName: "Globex Project Explorer",
    slug: "globex-proj",
    databaseName: "company_globex_proj",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: AcmeUser } = await getCompanyModels(acme);
  await AcmeUser.create({
    email: "hr@acme-proj.test",
    passwordHash: await hashPassword("AcmeHrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const empUser = await AcmeUser.create({
    email: "emp@acme-proj.test",
    passwordHash: await hashPassword("AcmeEmpPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  // Atlas Core — consistent MANDATE type; mixed casing / whitespace on name
  const atlasLead = await createEmp(acme, {
    employeeCode: "PRJ-A1",
    fullName: "Avery Atlas",
    email: "avery@acme-proj.test",
    jobTitle: "Tech Lead",
    projectName: "Atlas Core",
    projectType: "MANDATE",
  });
  const atlasDev = await createEmp(acme, {
    employeeCode: "PRJ-A2",
    fullName: "Blake Atlas",
    email: "emp@acme-proj.test",
    userId: empUser._id,
    jobTitle: "Software Engineer",
    projectName: "  atlas core  ",
    projectType: "MANDATE",
    reportingManagerId: atlasLead._id,
    invitation: { token: "secret-invite", status: "PENDING" },
  });
  empUser.employeeId = atlasDev._id;
  await empUser.save();

  const atlasCasing = await createEmp(acme, {
    employeeCode: "PRJ-A3",
    fullName: "Casey Atlas",
    email: "casey@acme-proj.test",
    jobTitle: "QA",
    projectName: "ATLAS CORE",
    projectType: "MANDATE",
    // Same reporting chain as Blake so employee Explorer visibility includes peers.
    reportingManagerId: atlasLead._id,
  });

  // Nova — conflicting types
  const nova1 = await createEmp(acme, {
    employeeCode: "PRJ-N1",
    fullName: "Dana Nova",
    email: "dana@acme-proj.test",
    jobTitle: "PM",
    department: "Product",
    projectName: "Nova Portal",
    projectType: "RETAIL",
  });
  const nova2 = await createEmp(acme, {
    employeeCode: "PRJ-N2",
    fullName: "Eden Nova",
    email: "eden@acme-proj.test",
    jobTitle: "Designer",
    department: "Product",
    projectName: "nova portal",
    projectType: "MANDATE",
  });

  // Orion — missing/blank type among assignments
  const orion1 = await createEmp(acme, {
    employeeCode: "PRJ-O1",
    fullName: "Fran Orion",
    email: "fran@acme-proj.test",
    projectName: "Orion Desk",
    projectType: "INTERNAL",
  });
  const orion2 = await createEmp(acme, {
    employeeCode: "PRJ-O2",
    fullName: "Gray Orion",
    email: "gray@acme-proj.test",
    projectName: "Orion Desk",
    projectType: "",
  });

  // Encoded-friendly name
  const special = await createEmp(acme, {
    employeeCode: "PRJ-S1",
    fullName: "Harper Special",
    email: "harper@acme-proj.test",
    projectName: "R&D / Labs",
    projectType: "INTERNAL",
  });

  // Unassigned (no project name)
  const unassignedEmpty = await createEmp(acme, {
    employeeCode: "PRJ-U1",
    fullName: "No Project Empty",
    email: "noproj@acme-proj.test",
    projectName: "",
    projectType: "",
  });
  const unassignedSpaces = await createEmp(acme, {
    employeeCode: "PRJ-U2",
    fullName: "No Project Spaces",
    email: "spacesproj@acme-proj.test",
    projectName: "   ",
    projectType: "BENCH",
  });

  await createEmp(acme, {
    employeeCode: "PRJ-INACT",
    fullName: "Inactive Atlas",
    email: "inactive@acme-proj.test",
    projectName: "Atlas Core",
    projectType: "MANDATE",
    status: EMPLOYEE_STATUSES.INACTIVE,
  });

  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "hr@globex-proj.test",
    passwordHash: await hashPassword("GlobexHrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const globexOnly = await createEmp(globex, {
    employeeCode: "GX-PRJ-1",
    fullName: "Globex Only",
    email: "gx@globex-proj.test",
    projectName: "Atlas Core",
    projectType: "MANDATE",
  });

  ids = {
    atlasLead: String(atlasLead._id),
    atlasDev: String(atlasDev._id),
    atlasCasing: String(atlasCasing._id),
    nova1: String(nova1._id),
    nova2: String(nova2._id),
    orion1: String(orion1._id),
    orion2: String(orion2._id),
    special: String(special._id),
    unassignedEmpty: String(unassignedEmpty._id),
    unassignedSpaces: String(unassignedSpaces._id),
    globexOnly: String(globexOnly._id),
  };

  acmeHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-proj",
      email: "hr@acme-proj.test",
      password: "AcmeHrPass123!",
    })
  );
  acmeEmpCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-proj",
      email: "emp@acme-proj.test",
      password: "AcmeEmpPass123!",
    })
  );
  globexHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "globex-proj",
      email: "hr@globex-proj.test",
      password: "GlobexHrPass123!",
    })
  );
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("GET /api/employees/organization-explorer/projects", () => {
  it("HR can retrieve project overview", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/projects")
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.projects));

    const atlas = res.body.projects.find((p) => projectGroupingKeyLike(p.name) === "atlas core");
    assert.ok(atlas);
    assert.equal(atlas.employeeCount, 3);
    assert.equal(atlas.projectType, "MANDATE");
    assert.equal(atlas.employees.some((e) => e.fullName === "Inactive Atlas"), false);
    assertSafeEmployees(atlas.employees);

    assert.equal(res.body.meta.unassignedCount, 2);
    assert.equal(res.body.projects.some((p) => /unassigned/i.test(p.name)), false);
    assert.equal(
      res.body.projects.some((p) => p.employees.some((e) => e.id === ids.globexOnly)),
      false
    );
  });

  it("Employee can retrieve project overview for visible colleagues only", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/projects")
      .set("Cookie", acmeEmpCookie);
    assert.equal(res.status, 200);
    // Blake only sees Atlas peers/manager — not Nova/Orion unrelated branches.
    assert.equal(res.body.projects.length, 1);
    const atlas = res.body.projects[0];
    assert.equal(projectGroupingKeyLike(atlas.name), "atlas core");
    assert.equal(atlas.employeeCount, 3);
  });

  it("groups multiple employees and normalizes case/whitespace", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/projects")
      .set("Cookie", acmeHrCookie);

    const atlasMatches = res.body.projects.filter(
      (p) => projectGroupingKeyLike(p.name) === "atlas core"
    );
    assert.equal(atlasMatches.length, 1);
    assert.equal(atlasMatches[0].employeeCount, 3);
    assert.ok(atlasMatches[0].employees.some((e) => e.id === ids.atlasLead));
    assert.ok(atlasMatches[0].employees.some((e) => e.id === ids.atlasDev));
    assert.ok(atlasMatches[0].employees.some((e) => e.id === ids.atlasCasing));
  });

  it("preserves a sensible display name from stored records", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/projects")
      .set("Cookie", acmeHrCookie);
    const atlas = res.body.projects.find((p) => projectGroupingKeyLike(p.name) === "atlas core");
    // First ACTIVE employee by fullName is Avery Atlas with "Atlas Core"
    assert.equal(atlas.name, "Atlas Core");
  });

  it("returns consistent projectType and null when conflicting/missing", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/projects")
      .set("Cookie", acmeHrCookie);

    const atlas = res.body.projects.find((p) => projectGroupingKeyLike(p.name) === "atlas core");
    assert.equal(atlas.projectType, "MANDATE");

    const nova = res.body.projects.find((p) => projectGroupingKeyLike(p.name) === "nova portal");
    assert.equal(nova.employeeCount, 2);
    assert.equal(nova.projectType, null);

    const orion = res.body.projects.find((p) => projectGroupingKeyLike(p.name) === "orion desk");
    assert.equal(orion.employeeCount, 2);
    assert.equal(orion.projectType, null);

    const special = res.body.projects.find((p) => p.name === "R&D / Labs");
    assert.equal(special.projectType, "INTERNAL");
  });

  it("reflects missing project assignments in unassignedCount", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/projects")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.body.meta.unassignedCount, 2);
    assert.equal(
      res.body.meta.totalAssignedEmployees + res.body.meta.unassignedCount,
      res.body.meta.totalEmployees
    );
  });
});

describe("GET /api/employees/organization-explorer/projects/:project", () => {
  it("HR and employees can retrieve project employees", async () => {
    const hr = await request(app)
      .get("/api/employees/organization-explorer/projects/Atlas%20Core")
      .set("Cookie", acmeHrCookie);
    const emp = await request(app)
      .get("/api/employees/organization-explorer/projects/atlas%20core")
      .set("Cookie", acmeEmpCookie);

    assert.equal(hr.status, 200);
    assert.equal(emp.status, 200);
    assert.equal(hr.body.project, "Atlas Core");
    assert.equal(hr.body.projectType, "MANDATE");
    assert.equal(hr.body.employees.length, 3);
    assert.equal(emp.body.employees.length, 3);
    assertSafeEmployees(hr.body.employees);

    const blake = hr.body.employees.find((e) => e.id === ids.atlasDev);
    assert.equal(blake.fullName, "Blake Atlas");
    assert.equal(blake.employeeCode, "PRJ-A2");
    assert.equal(blake.jobTitle, "Software Engineer");
    assert.equal(blake.department, "Engineering");
    assert.equal(blake.reportingManagerId, ids.atlasLead);
  });

  it("supports URL-encoded project names", async () => {
    const encoded = encodeURIComponent("R&D / Labs");
    const res = await request(app)
      .get(`/api/employees/organization-explorer/projects/${encoded}`)
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.project, "R&D / Labs");
    assert.equal(res.body.employees.length, 1);
    assert.equal(res.body.employees[0].id, ids.special);
  });

  it("returns empty employees for unknown project", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/projects/Does%20Not%20Exist")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.project, "Does Not Exist");
    assert.deepEqual(res.body.employees, []);
    assert.equal(res.body.meta.total, 0);
    assert.equal(res.body.projectType, null);
  });

  it("excludes inactive employees and unassigned people from project detail", async () => {
    const res = await request(app)
      .get("/api/employees/organization-explorer/projects/Atlas%20Core")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.body.employees.some((e) => e.fullName === "Inactive Atlas"), false);
    assert.equal(res.body.employees.some((e) => e.id === ids.unassignedEmpty), false);
  });
});

describe("Organization Explorer projects auth + isolation", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/employees/organization-explorer/projects");
    assert.equal(res.status, 401);
  });

  it("returns 403 when Projects view is disabled", async () => {
    await Company.updateOne(
      { _id: acme._id },
      {
        $set: {
          "config.organizationExplorer.enabledViews": ["reporting", "departments"],
          "config.organizationExplorer.defaultView": "reporting",
          "config.organizationExplorer.allowCompletedProjectsFilter": false,
        },
      }
    );

    const overview = await request(app)
      .get("/api/employees/organization-explorer/projects")
      .set("Cookie", acmeEmpCookie);
    const detail = await request(app)
      .get("/api/employees/organization-explorer/projects/Atlas%20Core")
      .set("Cookie", acmeHrCookie);

    assert.equal(overview.status, 403);
    assert.equal(detail.status, 403);

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
      .get("/api/employees/organization-explorer/projects")
      .query({
        companyId: String(globex._id),
        databaseName: globex.databaseName,
        companyCode: "globex-proj",
      })
      .set("Cookie", acmeHrCookie);

    assert.equal(acmeRes.status, 200);
    assert.equal(
      acmeRes.body.projects.some((p) => p.employees.some((e) => e.id === ids.globexOnly)),
      false
    );

    const gx = await request(app)
      .get("/api/employees/organization-explorer/projects")
      .set("Cookie", globexHrCookie);
    assert.equal(gx.status, 200);
    const atlas = gx.body.projects.find((p) => projectGroupingKeyLike(p.name) === "atlas core");
    assert.ok(atlas);
    assert.equal(atlas.employees.length, 1);
    assert.equal(atlas.employees[0].id, ids.globexOnly);
    assert.equal(atlas.employees.some((e) => e.id === ids.atlasDev), false);
  });
});

describe("Existing reporting / departments / directory regressions", () => {
  it("organization-view, departments, and directory remain available", async () => {
    const orgView = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeEmpCookie);
    assert.equal(orgView.status, 200);
    assert.ok(orgView.body.employees.some((e) => e.id === ids.atlasDev));

    const departments = await request(app)
      .get("/api/employees/organization-explorer/departments")
      .set("Cookie", acmeEmpCookie);
    assert.equal(departments.status, 200);
    assert.ok(Array.isArray(departments.body.departments));

    const directory = await request(app)
      .get("/api/employees/directory")
      .set("Cookie", acmeEmpCookie);
    assert.equal(directory.status, 200);
    assert.ok(Array.isArray(directory.body.data));
  });
});

function projectGroupingKeyLike(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}
