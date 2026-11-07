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
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

const PASSWORD = "PortalAccessPass1!";
const DB_PATH = "D:/tmp/hrms-mongo/ca-portal-access";

let mongo;
let app;
let server;
let acme;
let globex;
let cookies;

function cookieFrom(response) {
  const cookiesHeader = response.headers["set-cookie"] || [];
  return cookiesHeader.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

async function login(companyCode, email) {
  const res = await request(app).post("/api/auth/login").send({ companyCode, email, password: PASSWORD });
  assert.equal(res.status, 200, res.body?.message || "login failed");
  return { cookie: cookieFrom(res), body: res.body };
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
    companyName: "Acme Portal",
    slug: "acme-portal",
    databaseName: "company_acme_portal",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { hrAccessEnforcement: { mode: "OFF" } },
  });
  globex = await Company.create({
    companyName: "Globex Portal",
    slug: "globex-portal",
    databaseName: "company_globex_portal",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });

  const models = await getCompanyModels(acme);
  const globexModels = await getCompanyModels(globex);
  const passwordHash = await hashPassword(PASSWORD);
  const engineering = await models.Department.create({ name: "Engineering", isActive: true });
  const design = await models.Department.create({ name: "Design", isActive: true });
  await models.Employee.create({
    employeeCode: "POR-001",
    fullName: "Alice Engineer",
    email: "alice@acme-portal.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering", departmentId: engineering._id },
  });
  await models.Employee.create({
    employeeCode: "POR-002",
    fullName: "Bob Designer",
    email: "bob@acme-portal.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Designer", department: "Design", departmentId: design._id },
  });
  const alice = await models.Employee.findOne({ email: "alice@acme-portal.test" });
  const aliceUser = await models.User.create({
    email: "alice@acme-portal.test",
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Alice Engineer",
    isActive: true,
    employeeId: alice._id,
  });
  alice.userId = aliceUser._id;
  await alice.save();

  const configured = (permissions, mode, departmentIds = []) => ({
    version: 1,
    configuredAt: new Date(),
    updatedAt: new Date(),
    permissions,
    employeeScope: { mode, departmentIds, employeeIds: [] },
  });
  await models.User.create({
    email: "hr.dash@acme-portal.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Dash Only",
    isActive: true,
    hrAccess: configured(["dashboard.view"], "COMPANY"),
  });
  await models.User.create({
    email: "hr.people@acme-portal.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "People Engineering",
    isActive: true,
    hrAccess: configured(["people.view"], "CUSTOM", [engineering._id]),
  });
  await createCompanyAdmin(models.User, {
    email: "ca@acme-portal.test",
    passwordHash,
    fullName: "Portal Company Admin",
  });

  await globexModels.Employee.create({
    employeeCode: "GLX-001",
    fullName: "Globex Person",
    email: "person@globex-portal.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Analyst", department: "Finance" },
  });
  await globexModels.User.create({
    email: "hr@globex-portal.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Globex HR",
    isActive: true,
  });

  await Company.findByIdAndUpdate(acme._id, {
    $set: { "config.hrAccessEnforcement.mode": "ENFORCED" },
  });

  const caLogin = await login("acme-portal", "ca@acme-portal.test");
  const dashLogin = await login("acme-portal", "hr.dash@acme-portal.test");
  cookies = {
    ca: caLogin.cookie,
    caBody: caLogin.body,
    dash: dashLogin.cookie,
    dashBody: dashLogin.body,
    people: (await login("acme-portal", "hr.people@acme-portal.test")).cookie,
    employee: (await login("acme-portal", "alice@acme-portal.test")).cookie,
    globex: (await login("globex-portal", "hr@globex-portal.test")).cookie,
  };
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("company admin portal and enforced HR permissions", () => {
  it("reports enforcement mode on login without applying it to Company Admin", () => {
    assert.equal(cookies.caBody.company.hrAccessEnforcement.mode, "ENFORCED");
    assert.equal(cookies.caBody.user.role, "COMPANY_ADMIN");
    assert.equal(cookies.dashBody.company.hrAccessEnforcement.mode, "ENFORCED");
    assert.deepEqual(cookies.dashBody.user.hrAccess.permissions, ["dashboard.view"]);
  });

  it("lets Company Admin use company HR modules and HR management", async () => {
    const dashboard = await request(app).get("/api/admin/dashboard").set("Cookie", cookies.ca);
    assert.equal(dashboard.status, 200, dashboard.body?.message);
    const people = await request(app).get("/api/employees").set("Cookie", cookies.ca);
    assert.equal(people.status, 200, people.body?.message);
    const emails = JSON.stringify(people.body);
    assert.equal(emails.includes("alice@acme-portal.test"), true);
    assert.equal(emails.includes("bob@acme-portal.test"), true);
    assert.equal(emails.includes("person@globex-portal.test"), false);
    const leave = await request(app).get("/api/leave-requests").set("Cookie", cookies.ca);
    assert.equal(leave.status, 200, leave.body?.message);
    const assets = await request(app).get("/api/assets").set("Cookie", cookies.ca);
    assert.equal(assets.status, 200, assets.body?.message);
    const reports = await request(app).get("/api/admin/intelligence").set("Cookie", cookies.ca);
    assert.notEqual(reports.status, 403);
    const readiness = await request(app).get("/api/company-admin/hr-access/enforcement").set("Cookie", cookies.ca);
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.enforcement.mode, "ENFORCED");
  });

  it("blocks an enforced HR Admin from modules and employees outside the saved access", async () => {
    const deniedPeople = await request(app).get("/api/employees").set("Cookie", cookies.dash);
    assert.equal(deniedPeople.status, 403);
    assert.equal(deniedPeople.body.code, "HR_PERMISSION_DENIED");
    const deniedLeave = await request(app).get("/api/leave-requests").set("Cookie", cookies.dash);
    assert.equal(deniedLeave.status, 403);
    const deniedAssets = await request(app).get("/api/assets").set("Cookie", cookies.dash);
    assert.equal(deniedAssets.status, 403, deniedAssets.body?.message);
    const dashboard = await request(app).get("/api/admin/dashboard").set("Cookie", cookies.dash);
    assert.equal(dashboard.status, 200, dashboard.body?.message);

    const scoped = await request(app).get("/api/employees").set("Cookie", cookies.people);
    assert.equal(scoped.status, 200, scoped.body?.message);
    const scopedText = JSON.stringify(scoped.body);
    assert.equal(scopedText.includes("alice@acme-portal.test"), true);
    assert.equal(scopedText.includes("bob@acme-portal.test"), false);
  });

  it("keeps employee self-service and blocks employee access to admin and company-admin APIs", async () => {
    const me = await request(app).get("/api/employees/me").set("Cookie", cookies.employee);
    assert.equal(me.status, 200, me.body?.message);
    const admin = await request(app).get("/api/admin/dashboard").set("Cookie", cookies.employee);
    assert.equal(admin.status, 403);
    const companyAdmin = await request(app).get("/api/company-admin/hr-admins").set("Cookie", cookies.employee);
    assert.equal(companyAdmin.status, 403);
    const hrCompanyAdmin = await request(app).get("/api/company-admin/hr-admins").set("Cookie", cookies.dash);
    assert.equal(hrCompanyAdmin.status, 403);
  });

  it("keeps enforcement OFF for a company that was not switched on", async () => {
    const stored = await Company.findById(globex._id).select("config.hrAccessEnforcement.mode").lean();
    assert.notEqual(stored.config?.hrAccessEnforcement?.mode, "ENFORCED");
    const people = await request(app).get("/api/employees").set("Cookie", cookies.globex);
    assert.equal(people.status, 200, people.body?.message);
    const text = JSON.stringify(people.body);
    assert.equal(text.includes("person@globex-portal.test"), true);
    assert.equal(text.includes("alice@acme-portal.test"), false);
    const acmeMode = await Company.findById(acme._id).select("config.hrAccessEnforcement.mode").lean();
    assert.equal(acmeMode.config.hrAccessEnforcement.mode, "ENFORCED");
  });
});
