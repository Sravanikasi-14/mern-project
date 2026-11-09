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
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { HR_PERMISSION_KEYS } from "../constants/hrAccessCatalog.js";
import { createCompanyAdmin } from "../services/companyAdminService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

const PASSWORD = "CompanyAdminPass1!";
const DB_PATH = "D:/tmp/hrms-mongo/ca4b-hr-access-iso";

let mongo;
let app;
let acme;
let globex;
let caCookieAcme;
let caCookieGlobex;
let hrCookieAcme;
let employeeCookieAcme;
let hrAdminId;
let caUserId;
let engineeringDeptId;
let designDeptId;
let employeeIdA;
let employeeIdB;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

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
    companyName: "Acme CA4B",
    slug: "acme-ca4b-iso",
    databaseName: "company_acme_ca4b",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });
  globex = await Company.create({
    companyName: "Globex CA4B",
    slug: "globex-ca4b-iso",
    databaseName: "company_globex_ca4b",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });

  const modelsA = await getCompanyModels(acme);
  const eng = await modelsA.Department.create({
    name: "Engineering",
    normalizedName: "engineering",
    isActive: true,
  });
  const design = await modelsA.Department.create({
    name: "Design",
    normalizedName: "design",
    isActive: true,
  });
  engineeringDeptId = String(eng._id);
  designDeptId = String(design._id);

  const empA = await modelsA.Employee.create({
    employeeCode: "CA4B-001",
    fullName: "Alice Engineer",
    email: "alice@acme-ca4b-iso.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering", departmentId: eng._id },
  });
  const empB = await modelsA.Employee.create({
    employeeCode: "CA4B-002",
    fullName: "Bob Designer",
    email: "bob@acme-ca4b-iso.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Designer", department: "Design", departmentId: design._id },
  });
  employeeIdA = String(empA._id);
  employeeIdB = String(empB._id);

  const hr = await modelsA.User.create({
    email: "hr@acme-ca4b-iso.test",
    passwordHash: await hashPassword(PASSWORD),
    role: USER_ROLES.HR_ADMIN,
    fullName: "Acme HR",
    isActive: true,
    lastLoginAt: new Date(),
  });
  hrAdminId = String(hr._id);

  await modelsA.User.create({
    email: "employee@acme-ca4b-iso.test",
    passwordHash: await hashPassword(PASSWORD),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  const ca = await createCompanyAdmin(modelsA.User, {
    email: "company-admin@acme-ca4b-iso.test",
    passwordHash: await hashPassword(PASSWORD),
    fullName: "Acme Company Admin",
  });
  caUserId = String(ca._id);

  const modelsB = await getCompanyModels(globex);
  await createCompanyAdmin(modelsB.User, {
    email: "company-admin@globex-ca4b-iso.test",
    passwordHash: await hashPassword(PASSWORD),
    fullName: "Globex Company Admin",
  });
  await modelsB.User.create({
    email: "hr@globex-ca4b-iso.test",
    passwordHash: await hashPassword(PASSWORD),
    role: USER_ROLES.HR_ADMIN,
    fullName: "Globex HR",
    isActive: true,
  });

  caCookieAcme = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca4b-iso",
      email: "company-admin@acme-ca4b-iso.test",
      password: PASSWORD,
    })
  );
  caCookieGlobex = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "globex-ca4b-iso",
      email: "company-admin@globex-ca4b-iso.test",
      password: PASSWORD,
    })
  );
  hrCookieAcme = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca4b-iso",
      email: "hr@acme-ca4b-iso.test",
      password: PASSWORD,
    })
  );
  employeeCookieAcme = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca4b-iso",
      email: "employee@acme-ca4b-iso.test",
      password: PASSWORD,
    })
  );
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Phase CA4-B — HR Admin access configuration", () => {
  it("Company Admin can retrieve catalog, options, and unconfigured access", async () => {
    const catalog = await request(app)
      .get("/api/company-admin/hr-access/catalog")
      .set("Cookie", caCookieAcme);
    assert.equal(catalog.status, 200);
    assert.ok(catalog.body.catalog.modules.length >= 5);
    assert.ok(catalog.body.catalog.permissionKeys.includes("people.view"));
    assert.ok(catalog.body.catalog.permissionKeys.includes("payroll.pay"));
    assert.equal(catalog.body.catalog.permissionKeys.includes("payroll.delete"), false);

    const options = await request(app)
      .get("/api/company-admin/hr-access/options")
      .set("Cookie", caCookieAcme);
    assert.equal(options.status, 200);
    assert.ok(options.body.departments.some((d) => d.id === engineeringDeptId));
    assert.ok(options.body.employees.some((e) => e.id === employeeIdA));

    const access = await request(app)
      .get(`/api/company-admin/hr-admins/${hrAdminId}/access`)
      .set("Cookie", caCookieAcme);
    assert.equal(access.status, 200);
    assert.equal(access.body.access.configured, false);
    assert.equal(access.body.hrAdmin.email, "hr@acme-ca4b-iso.test");
  });

  it("HR Admin and Employee cannot access configuration APIs", async () => {
    const hrRes = await request(app)
      .get(`/api/company-admin/hr-admins/${hrAdminId}/access`)
      .set("Cookie", hrCookieAcme);
    assert.equal(hrRes.status, 403);

    const empRes = await request(app)
      .put(`/api/company-admin/hr-admins/${hrAdminId}/access`)
      .set("Cookie", employeeCookieAcme)
      .send({
        employeeScope: { mode: "COMPANY" },
        permissions: ["people.view"],
      });
    assert.equal(empRes.status, 403);
  });

  it("Company Admin can save full access config with custom multi-select scope", async () => {
    const res = await request(app)
      .put(`/api/company-admin/hr-admins/${hrAdminId}/access`)
      .set("Cookie", caCookieAcme)
      .send({
        employeeScope: {
          mode: "CUSTOM",
          departmentIds: [engineeringDeptId, designDeptId],
          employeeIds: [employeeIdA],
        },
        permissions: ["people.view", "people.edit", "attendance.view", "leave.approve"],
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.access.configured, true);
    assert.equal(res.body.access.employeeScope.mode, "CUSTOM");
    assert.equal(res.body.access.employeeScope.departmentIds.length, 2);
    assert.equal(res.body.access.employeeScope.employeeIds.length, 1);
    assert.deepEqual(
      [...res.body.access.permissions].sort(),
      ["attendance.view", "leave.approve", "people.edit", "people.view"].sort()
    );

    const list = await request(app)
      .get("/api/company-admin/hr-admins")
      .set("Cookie", caCookieAcme);
    const row = list.body.items.find((i) => i.id === hrAdminId);
    assert.equal(row.accessConfigured, true);
  });

  it("Scope and module permissions can be updated independently", async () => {
    const scopeOnly = await request(app)
      .put(`/api/company-admin/hr-admins/${hrAdminId}/access/scope`)
      .set("Cookie", caCookieAcme)
      .send({
        employeeScope: { mode: "COMPANY", departmentIds: [], employeeIds: [] },
      });
    assert.equal(scopeOnly.status, 200);
    assert.equal(scopeOnly.body.access.employeeScope.mode, "COMPANY");
    assert.ok(scopeOnly.body.access.permissions.includes("people.view"));

    const permsOnly = await request(app)
      .put(`/api/company-admin/hr-admins/${hrAdminId}/access/permissions`)
      .set("Cookie", caCookieAcme)
      .send({
        permissions: ["payroll.view", "payroll.pay"],
      });
    assert.equal(permsOnly.status, 200);
    assert.deepEqual([...permsOnly.body.access.permissions].sort(), ["payroll.pay", "payroll.view"]);
    assert.equal(permsOnly.body.access.employeeScope.mode, "COMPANY");
  });

  it("Invalid department/employee IDs and permission actions are rejected", async () => {
    const badDept = await request(app)
      .put(`/api/company-admin/hr-admins/${hrAdminId}/access/scope`)
      .set("Cookie", caCookieAcme)
      .send({
        employeeScope: {
          mode: "CUSTOM",
          departmentIds: ["507f1f77bcf86cd799439011"],
          employeeIds: [],
        },
      });
    assert.equal(badDept.status, 400);

    const badEmp = await request(app)
      .put(`/api/company-admin/hr-admins/${hrAdminId}/access`)
      .set("Cookie", caCookieAcme)
      .send({
        employeeScope: {
          mode: "CUSTOM",
          departmentIds: [],
          employeeIds: ["507f1f77bcf86cd799439011"],
        },
        permissions: ["people.view"],
      });
    assert.equal(badEmp.status, 400);

    const badPerm = await request(app)
      .put(`/api/company-admin/hr-admins/${hrAdminId}/access/permissions`)
      .set("Cookie", caCookieAcme)
      .send({ permissions: ["people.view", "people.fly"] });
    assert.equal(badPerm.status, 400);

    const emptyCustom = await request(app)
      .put(`/api/company-admin/hr-admins/${hrAdminId}/access/scope`)
      .set("Cookie", caCookieAcme)
      .send({ employeeScope: { mode: "CUSTOM", departmentIds: [], employeeIds: [] } });
    assert.equal(emptyCustom.status, 400);

    assert.ok(HR_PERMISSION_KEYS.includes("leave.approve"));
  });

  it("Cross-tenant HR Admin IDs are rejected", async () => {
    const res = await request(app)
      .get(`/api/company-admin/hr-admins/${hrAdminId}/access`)
      .set("Cookie", caCookieGlobex);
    assert.equal(res.status, 404);

    const put = await request(app)
      .put(`/api/company-admin/hr-admins/${hrAdminId}/access`)
      .set("Cookie", caCookieGlobex)
      .send({
        employeeScope: { mode: "COMPANY" },
        permissions: ["people.view"],
      });
    assert.equal(put.status, 404);
  });

  it("Company Admin cannot configure their own account through these APIs", async () => {
    const res = await request(app)
      .get(`/api/company-admin/hr-admins/${caUserId}/access`)
      .set("Cookie", caCookieAcme);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "CANNOT_CONFIGURE_SELF");
  });

  it("Audit events are recorded without permission key dumps of secrets", async () => {
    const { AuditLog } = await getCompanyModels(acme);
    const audits = await AuditLog.find({
      targetId: hrAdminId,
      action: {
        $in: [
          AUDIT_ACTIONS.HR_ADMIN_ACCESS_UPDATED,
          AUDIT_ACTIONS.HR_ADMIN_SCOPE_UPDATED,
          AUDIT_ACTIONS.HR_ADMIN_PERMISSIONS_UPDATED,
        ],
      },
    }).lean();
    assert.ok(audits.length >= 1);
    const raw = JSON.stringify(audits);
    assert.equal(raw.includes("password"), false);
    assert.equal(raw.includes("passwordHash"), false);
  });

  it("Existing HR Admin login still works after configuration (no enforcement yet)", async () => {
    const login = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca4b-iso",
      email: "hr@acme-ca4b-iso.test",
      password: PASSWORD,
    });
    assert.equal(login.status, 200);

    const dash = await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", cookieFrom(login));
    assert.equal(dash.status, 200);
  });
});
