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
import { USER_ROLES } from "../models/User.js";
import { createCompanyAdmin } from "../services/companyAdminService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

const PASSWORD = "DesignationPass1!";
const DB_PATH = "D:/tmp/hrms-mongo/ca-designations";

let mongo;
let app;
let acme;
let globex;
let enforced;
let caCookie;
let globexCookie;
let viewHrCookie;
let manageHrCookie;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

describe("designation catalog", () => {
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
      companyName: "Acme Designations",
      slug: "acme-designations",
      databaseName: "company_acme_designations",
      status: COMPANY_STATUSES.ACTIVE,
      schemaVersion: 1,
      config: { hrAccessEnforcement: { mode: "OFF" } },
    });
    globex = await Company.create({
      companyName: "Globex Designations",
      slug: "globex-designations",
      databaseName: "company_globex_designations",
      status: COMPANY_STATUSES.ACTIVE,
      schemaVersion: 1,
      config: { hrAccessEnforcement: { mode: "OFF" } },
    });
    enforced = await Company.create({
      companyName: "Enforced Designations",
      slug: "enforced-designations",
      databaseName: "company_enforced_designations",
      status: COMPANY_STATUSES.ACTIVE,
      schemaVersion: 1,
      config: { hrAccessEnforcement: { mode: "ENFORCED" } },
    });

    const passwordHash = await hashPassword(PASSWORD);
    const acmeModels = await getCompanyModels(acme);
    await createCompanyAdmin(acmeModels.User, {
      email: "ca@acme-designations.test",
      fullName: "Acme Company Admin",
      passwordHash,
      isActive: true,
    });
    const globexModels = await getCompanyModels(globex);
    await createCompanyAdmin(globexModels.User, {
      email: "ca@globex-designations.test",
      fullName: "Globex Company Admin",
      passwordHash,
      isActive: true,
    });
    const enforcedModels = await getCompanyModels(enforced);
    const baseHr = {
      passwordHash,
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      hrAccess: {
        version: 1,
        configuredAt: new Date(),
        updatedAt: new Date(),
        employeeScope: { mode: "COMPANY", departmentIds: [], employeeIds: [] },
      },
    };
    await enforcedModels.User.create({
      ...baseHr,
      email: "view@enforced-designations.test",
      fullName: "View Only HR",
      hrAccess: {
        ...baseHr.hrAccess,
        permissions: ["organization.view", "people.view"],
      },
    });
    await enforcedModels.User.create({
      ...baseHr,
      email: "manage@enforced-designations.test",
      fullName: "Manage HR",
      hrAccess: {
        ...baseHr.hrAccess,
        permissions: ["organization.view", "organization.manage", "people.view", "people.edit"],
      },
    });

    caCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "acme-designations",
        email: "ca@acme-designations.test",
        password: PASSWORD,
      })
    );
    globexCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "globex-designations",
        email: "ca@globex-designations.test",
        password: PASSWORD,
      })
    );
    viewHrCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "enforced-designations",
        email: "view@enforced-designations.test",
        password: PASSWORD,
      })
    );
    manageHrCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "enforced-designations",
        email: "manage@enforced-designations.test",
        password: PASSWORD,
      })
    );
    assert.ok(caCookie);
    assert.ok(globexCookie);
    assert.ok(viewHrCookie);
    assert.ok(manageHrCookie);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("creates, edits, searches, and rejects duplicate designation titles", async () => {
    const created = await request(app)
      .post("/api/designations")
      .set("Cookie", caCookie)
      .send({
        title: "Software Engineer",
        grade: "L3",
        description: "Builds product features",
      });
    assert.equal(created.status, 201, created.body?.message);
    const id = created.body.designation.id;
    assert.equal(created.body.designation.isActive, true);
    assert.equal(created.body.designation.grade, "L3");

    const duplicate = await request(app)
      .post("/api/designations")
      .set("Cookie", caCookie)
      .send({ title: " software engineer " });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, "DUPLICATE_DESIGNATION");

    const updated = await request(app)
      .patch(`/api/designations/${id}`)
      .set("Cookie", caCookie)
      .send({ grade: "L4", description: "Senior product work" });
    assert.equal(updated.status, 200, updated.body?.message);
    assert.equal(updated.body.designation.title, "Software Engineer");
    assert.equal(updated.body.designation.grade, "L4");

    const found = await request(app)
      .get("/api/designations")
      .query({ q: "senior product", status: "active" })
      .set("Cookie", caCookie);
    assert.equal(found.status, 200, found.body?.message);
    assert.equal(found.body.designations.length, 1);
    assert.equal(found.body.designations[0].id, id);

    const deactivated = await request(app)
      .post(`/api/designations/${id}/deactivate`)
      .set("Cookie", caCookie)
      .send({});
    assert.equal(deactivated.status, 200, deactivated.body?.message);
    assert.equal(deactivated.body.designation.isActive, false);

    const activeOnly = await request(app).get("/api/designations").set("Cookie", caCookie);
    assert.equal(activeOnly.body.designations.some((row) => row.id === id), false);

    const inactive = await request(app)
      .get("/api/designations")
      .query({ status: "inactive" })
      .set("Cookie", caCookie);
    assert.equal(inactive.body.designations.some((row) => row.id === id), true);

    const restored = await request(app)
      .patch(`/api/designations/${id}`)
      .set("Cookie", caCookie)
      .send({ isActive: true });
    assert.equal(restored.status, 200, restored.body?.message);
    assert.equal(restored.body.designation.isActive, true);
  });

  it("leaves existing employee job titles and grades unchanged", async () => {
    const employee = await request(app)
      .post("/api/employees")
      .set("Cookie", caCookie)
      .send({
        fullName: "Legacy Title",
        email: "legacy.title@acme-designations.test",
        employeeCode: "DS-1",
        jobTitle: "Legacy Specialist",
        jobGrade: "L2",
      });
    assert.equal(employee.status, 201, employee.body?.message);

    const catalog = await request(app)
      .post("/api/designations")
      .set("Cookie", caCookie)
      .send({ title: "Legacy Specialist", grade: "L9", description: "Catalog copy" });
    assert.equal(catalog.status, 201, catalog.body?.message);

    await request(app)
      .post(`/api/designations/${catalog.body.designation.id}/deactivate`)
      .set("Cookie", caCookie)
      .send({});

    const models = await getCompanyModels(acme);
    const stored = await models.Employee.findOne({ email: "legacy.title@acme-designations.test" });
    assert.equal(stored.job.jobTitle, "Legacy Specialist");
    assert.equal(stored.job.jobGrade, "L2");
    assert.equal(stored.job.designationId, undefined);

    const listed = await request(app)
      .get("/api/designations")
      .query({ status: "all", q: "Legacy Specialist" })
      .set("Cookie", caCookie);
    assert.equal(listed.body.designations[0].usageCount, 1);

    const admin = await models.User.findOne({ email: "ca@acme-designations.test" });
    assert.equal(admin.role, USER_ROLES.COMPANY_ADMIN);
    assert.equal(admin.employeeId ?? null, null);
  });

  it("counts linked employees on the department list", async () => {
    const department = await request(app)
      .post("/api/departments")
      .set("Cookie", caCookie)
      .send({ name: "Platform", code: "PLT", description: "Product platform" });
    assert.equal(department.status, 201, department.body?.message);

    const employee = await request(app)
      .post("/api/employees")
      .set("Cookie", caCookie)
      .send({
        fullName: "Platform Member",
        email: "platform.member@acme-designations.test",
        employeeCode: "DS-2",
        jobTitle: "Analyst",
        department: "platform",
      });
    assert.equal(employee.status, 201, employee.body?.message);

    const listed = await request(app).get("/api/departments").set("Cookie", caCookie);
    const platform = listed.body.departments.find((row) => row.name === "Platform");
    assert.ok(platform);
    assert.equal(platform.employeeCount, 1);
    assert.equal(platform.code, "PLT");
  });

  it("keeps designations inside the tenant and enforces HR permissions", async () => {
    const foreign = await request(app).get("/api/designations").set("Cookie", globexCookie);
    assert.equal(foreign.status, 200, foreign.body?.message);
    assert.equal(
      foreign.body.designations.some((row) => row.title === "Software Engineer"),
      false
    );

    const denied = await request(app)
      .post("/api/designations")
      .set("Cookie", viewHrCookie)
      .send({ title: "Blocked Title" });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "HR_PERMISSION_DENIED");

    const allowedRead = await request(app).get("/api/designations").set("Cookie", viewHrCookie);
    assert.equal(allowedRead.status, 200, allowedRead.body?.message);

    const allowed = await request(app)
      .post("/api/designations")
      .set("Cookie", manageHrCookie)
      .send({ title: "HR Created Title", grade: "L1" });
    assert.equal(allowed.status, 201, allowed.body?.message);

    const acmeList = await request(app).get("/api/designations").query({ status: "all" }).set("Cookie", caCookie);
    assert.equal(
      acmeList.body.designations.some((row) => row.title === "HR Created Title"),
      false
    );

    const enforcedCompany = await Company.findById(enforced._id).lean();
    assert.equal(enforcedCompany.config.hrAccessEnforcement.mode, "ENFORCED");
    const acmeCompany = await Company.findById(acme._id).lean();
    assert.equal(acmeCompany.config.hrAccessEnforcement.mode, "OFF");
  });
});
