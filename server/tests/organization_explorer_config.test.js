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
import {
  DEFAULT_ORGANIZATION_EXPLORER_CONFIG,
  resolveOrganizationExplorerConfig,
  validateOrganizationExplorerUpdate,
} from "../services/organizationExplorerConfigService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { HttpError } from "../utils/httpError.js";
import { hashPassword } from "../utils/password.js";

let mongo;
let app;
let acme;
let globex;
let legacy;
let acmeHrCookie;
let acmeEmpCookie;
let globexHrCookie;
let platformAdminCookie;

const DEFAULTS = {
  enabledViews: ["reporting", "teams", "projects", "departments"],
  defaultView: "reporting",
  allowCompletedProjectsFilter: false,
};

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

function assertDefaultConfig(data) {
  assert.deepEqual(data.enabledViews, DEFAULTS.enabledViews);
  assert.equal(data.defaultView, DEFAULTS.defaultView);
  assert.equal(data.allowCompletedProjectsFilter, false);
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme Explorer Config",
    slug: "acme-oec",
    databaseName: "company_acme_oec",
    status: COMPANY_STATUSES.ACTIVE,
  });
  globex = await Company.create({
    companyName: "Globex Explorer Config",
    slug: "globex-oec",
    databaseName: "company_globex_oec",
    status: COMPANY_STATUSES.ACTIVE,
  });
  // Legacy company: no organizationExplorer stored (simulates pre-Phase-4B docs).
  legacy = await Company.collection.insertOne({
    companyName: "Legacy Explorer Config",
    slug: "legacy-oec",
    databaseName: "company_legacy_oec",
    status: COMPANY_STATUSES.ACTIVE,
    branding: { displayName: "", logoUrl: "", logoMimeType: "", primaryColor: "#4338ca" },
    config: {
      timezone: "Asia/Kolkata",
      currencyCode: "INR",
      enabledModules: [],
    },
    primaryContact: { fullName: "", email: "", phoneNumber: "" },
    letterhead: { address: "", website: "", signatoryName: "", signatoryTitle: "" },
    subscription: { plan: "ENTERPRISE", maxEmployeeSeats: 100 },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  legacy = await Company.findById(legacy.insertedId);

  const { User: AcmeUser, Employee: AcmeEmployee } = await getCompanyModels(acme);
  await AcmeUser.create({
    email: "hr@acme-oec.test",
    passwordHash: await hashPassword("AcmeHrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const empUser = await AcmeUser.create({
    email: "emp@acme-oec.test",
    passwordHash: await hashPassword("AcmeEmpPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const emp = await AcmeEmployee.create({
    fullName: "Acme Worker",
    employeeCode: "OEC-001",
    email: "emp@acme-oec.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    userId: empUser._id,
    job: { jobTitle: "Engineer", department: "Engineering" },
  });
  empUser.employeeId = emp._id;
  await empUser.save();

  // Platform Admin is outside company USER_ROLES — insert raw so enum cannot apply,
  // then forge a JWT to prove settings requireRole still blocks it.
  const platformInsert = await AcmeUser.collection.insertOne({
    email: "platform@acme-oec.test",
    passwordHash: await hashPassword("PlatformPass123!"),
    role: "PLATFORM_ADMIN",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "hr@globex-oec.test",
    passwordHash: await hashPassword("GlobexHrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const { User: LegacyUser } = await getCompanyModels(legacy);
  await LegacyUser.create({
    email: "hr@legacy-oec.test",
    passwordHash: await hashPassword("LegacyHrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  acmeHrCookie = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ email: "hr@acme-oec.test", password: "AcmeHrPass123!", companyCode: "acme-oec" })
  );
  acmeEmpCookie = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ email: "emp@acme-oec.test", password: "AcmeEmpPass123!", companyCode: "acme-oec" })
  );
  globexHrCookie = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ email: "hr@globex-oec.test", password: "GlobexHrPass123!", companyCode: "globex-oec" })
  );

  const jwt = await import("jsonwebtoken");
  platformAdminCookie = `${getAuthCookieName()}=${jwt.default.sign(
    { sub: platformInsert.insertedId.toString(), companyId: acme._id.toString() },
    process.env.JWT_SECRET,
    {
      expiresIn: "1h",
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    }
  )}`;
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("organizationExplorerConfigService defaults + validation", () => {
  it("resolves missing / partial config to defaults", () => {
    assertDefaultConfig(resolveOrganizationExplorerConfig(undefined));
    assertDefaultConfig(resolveOrganizationExplorerConfig(null));
    assertDefaultConfig(resolveOrganizationExplorerConfig({}));
    assertDefaultConfig(DEFAULT_ORGANIZATION_EXPLORER_CONFIG);
  });

  it("rejects empty, duplicate, and disabled defaultView updates", () => {
    assert.throws(
      () => validateOrganizationExplorerUpdate({ enabledViews: [] }),
      (err) => err instanceof HttpError && err.status === 400
    );
    assert.throws(
      () =>
        validateOrganizationExplorerUpdate({
          enabledViews: ["reporting", "reporting"],
        }),
      (err) => err instanceof HttpError && err.status === 400
    );
    assert.throws(
      () =>
        validateOrganizationExplorerUpdate({
          enabledViews: ["teams"],
          defaultView: "reporting",
        }),
      (err) => err instanceof HttpError && err.status === 400
    );
  });

  it("rejects enabling allowCompletedProjectsFilter", () => {
    assert.throws(
      () => validateOrganizationExplorerUpdate({ allowCompletedProjectsFilter: true }),
      (err) =>
        err instanceof HttpError &&
        err.status === 400 &&
        err.code === "COMPLETED_PROJECTS_FILTER_LOCKED"
    );
  });
});

describe("Organization Explorer settings API", () => {
  it("returns defaults for legacy companies without organizationExplorer", async () => {
    const login = await request(app).post("/api/auth/login").send({
      email: "hr@legacy-oec.test",
      password: "LegacyHrPass123!",
      companyCode: "legacy-oec",
    });
    const legacyHrCookie = cookieFrom(login);
    assert.ok(legacyHrCookie);

    const res = await request(app)
      .get("/api/settings/organization-explorer")
      .set("Cookie", legacyHrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assertDefaultConfig(res.body.data);

    // Stored document still has no organizationExplorer key.
    const raw = await Company.collection.findOne({ _id: legacy._id });
    assert.equal(raw.config?.organizationExplorer, undefined);
  });

  it("HR can read organization explorer configuration", async () => {
    const res = await request(app)
      .get("/api/settings/organization-explorer")
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assertDefaultConfig(res.body.data);
  });

  it("Employee can read organization explorer configuration", async () => {
    const res = await request(app)
      .get("/api/settings/organization-explorer")
      .set("Cookie", acmeEmpCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assertDefaultConfig(res.body.data);
  });

  it("Employee cannot update organization explorer configuration", async () => {
    const res = await request(app)
      .put("/api/settings/organization-explorer")
      .set("Cookie", acmeEmpCookie)
      .send({ enabledViews: ["reporting", "teams"], defaultView: "reporting" });

    assert.equal(res.status, 403);
  });

  it("HR can update enabled views and default view", async () => {
    const res = await request(app)
      .put("/api/settings/organization-explorer")
      .set("Cookie", acmeHrCookie)
      .send({
        enabledViews: ["reporting", "departments"],
        defaultView: "departments",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data.enabledViews, ["reporting", "departments"]);
    assert.equal(res.body.data.defaultView, "departments");
    assert.equal(res.body.data.allowCompletedProjectsFilter, false);

    const get = await request(app)
      .get("/api/settings/organization-explorer")
      .set("Cookie", acmeEmpCookie);
    assert.equal(get.status, 200);
    assert.deepEqual(get.body.data.enabledViews, ["reporting", "departments"]);
    assert.equal(get.body.data.defaultView, "departments");
  });

  it("rejects duplicate views", async () => {
    const res = await request(app)
      .put("/api/settings/organization-explorer")
      .set("Cookie", acmeHrCookie)
      .send({ enabledViews: ["reporting", "teams", "reporting"], defaultView: "reporting" });

    assert.equal(res.status, 400);
  });

  it("rejects empty enabledViews", async () => {
    const res = await request(app)
      .put("/api/settings/organization-explorer")
      .set("Cookie", acmeHrCookie)
      .send({ enabledViews: [], defaultView: "reporting" });

    assert.equal(res.status, 400);
  });

  it("rejects defaultView that is not enabled", async () => {
    const res = await request(app)
      .put("/api/settings/organization-explorer")
      .set("Cookie", acmeHrCookie)
      .send({ enabledViews: ["teams"], defaultView: "projects" });

    assert.equal(res.status, 400);
  });

  it("rejects enabling completed-project filtering", async () => {
    const res = await request(app)
      .put("/api/settings/organization-explorer")
      .set("Cookie", acmeHrCookie)
      .send({
        enabledViews: ["reporting", "teams"],
        defaultView: "reporting",
        allowCompletedProjectsFilter: true,
      });

    assert.equal(res.status, 400);
    assert.match(String(res.body.message || res.body.error || ""), /completed|Project lifecycle/i);
  });

  it("blocks cross-tenant access (Globex HR cannot mutate Acme via cookie swap assumptions)", async () => {
    // Globex HR reads/writes only Globex — Acme config stays untouched.
    const before = await Company.findById(acme._id).lean();
    const acmeBefore = resolveOrganizationExplorerConfig(before.config?.organizationExplorer);

    const globexGet = await request(app)
      .get("/api/settings/organization-explorer")
      .set("Cookie", globexHrCookie);
    assert.equal(globexGet.status, 200);
    assertDefaultConfig(globexGet.body.data);

    const globexPut = await request(app)
      .put("/api/settings/organization-explorer")
      .set("Cookie", globexHrCookie)
      .send({ enabledViews: ["projects"], defaultView: "projects" });
    assert.equal(globexPut.status, 200);
    assert.deepEqual(globexPut.body.data.enabledViews, ["projects"]);

    const acmeAfterDoc = await Company.findById(acme._id).lean();
    const acmeAfter = resolveOrganizationExplorerConfig(acmeAfterDoc.config?.organizationExplorer);
    assert.deepEqual(acmeAfter, acmeBefore);

    // Client-supplied company ids / db names are ignored — auth company context wins.
    const spoof = await request(app)
      .put("/api/settings/organization-explorer")
      .set("Cookie", globexHrCookie)
      .send({
        companyId: String(acme._id),
        databaseName: acme.databaseName,
        companyCode: "acme-oec",
        enabledViews: ["reporting"],
        defaultView: "reporting",
      });
    assert.equal(spoof.status, 200);
    assert.deepEqual(spoof.body.data.enabledViews, ["reporting"]);

    const stillAcme = await Company.findById(acme._id).lean();
    assert.deepEqual(
      resolveOrganizationExplorerConfig(stillAcme.config?.organizationExplorer),
      acmeBefore
    );
    const globexDoc = await Company.findById(globex._id).lean();
    assert.deepEqual(globexDoc.config.organizationExplorer.enabledViews, ["reporting"]);
  });

  it("blocks Platform Admin from Organization Explorer settings", async () => {
    const get = await request(app)
      .get("/api/settings/organization-explorer")
      .set("Cookie", platformAdminCookie);
    const put = await request(app)
      .put("/api/settings/organization-explorer")
      .set("Cookie", platformAdminCookie)
      .send({ enabledViews: ["reporting"], defaultView: "reporting" });

    assert.equal(get.status, 403);
    assert.equal(put.status, 403);
  });

  it("preserves existing company settings GET/PUT behavior and includes explorer config", async () => {
    const get = await request(app).get("/api/settings/company").set("Cookie", acmeHrCookie);
    assert.equal(get.status, 200);
    assert.ok(get.body.company);
    assert.ok(get.body.company.config);
    assert.ok(get.body.company.config.organizationExplorer);
    assert.equal(typeof get.body.company.config.timezone, "string");

    const empBlocked = await request(app)
      .get("/api/settings/company")
      .set("Cookie", acmeEmpCookie);
    assert.equal(empBlocked.status, 403);

    const put = await request(app)
      .put("/api/settings/company")
      .set("Cookie", acmeHrCookie)
      .send({
        displayName: "Acme Explorer Brand",
        organizationExplorer: {
          enabledViews: ["reporting", "teams", "departments"],
          defaultView: "teams",
        },
      });
    assert.equal(put.status, 200);
    assert.equal(put.body.company.branding.displayName, "Acme Explorer Brand");
    assert.deepEqual(put.body.company.config.organizationExplorer.enabledViews, [
      "reporting",
      "teams",
      "departments",
    ]);
    assert.equal(put.body.company.config.organizationExplorer.defaultView, "teams");
    assert.equal(put.body.company.config.organizationExplorer.allowCompletedProjectsFilter, false);

    const explorer = await request(app)
      .get("/api/settings/organization-explorer")
      .set("Cookie", acmeHrCookie);
    assert.equal(explorer.status, 200);
    assert.deepEqual(explorer.body.data.enabledViews, ["reporting", "teams", "departments"]);
    assert.equal(explorer.body.data.defaultView, "teams");
  });

  it("company settings PUT rejects enabling completed filter", async () => {
    const res = await request(app)
      .put("/api/settings/company")
      .set("Cookie", acmeHrCookie)
      .send({
        organizationExplorer: {
          allowCompletedProjectsFilter: true,
        },
      });
    assert.equal(res.status, 400);
  });
});
