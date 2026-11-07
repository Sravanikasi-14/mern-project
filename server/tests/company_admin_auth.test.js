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
import { USER_ROLES } from "../models/User.js";
import {
  activateCompanyAdmin,
  createCompanyAdmin,
  deactivateCompanyAdmin,
  findActiveCompanyAdmin,
} from "../services/companyAdminService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { HttpError } from "../utils/httpError.js";

const PASSWORD = "CompanyAdminPass1!";

let mongo;
let app;
let acme;
let globex;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

/** Role portal entry paths (mirrors web/mobile homeForRole). */
function homeForRole(role) {
  if (role === USER_ROLES.COMPANY_ADMIN) return "/company";
  if (role === USER_ROLES.HR_ADMIN) return "/admin/dashboard";
  if (role === USER_ROLES.EMPLOYEE) return "/app/dashboard";
  return "/login";
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme CA1",
    slug: "acme-ca1",
    databaseName: "company_acme_ca1",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });
  globex = await Company.create({
    companyName: "Globex CA1",
    slug: "globex-ca1",
    databaseName: "company_globex_ca1",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });

  const { User: AcmeUser } = await getCompanyModels(acme);
  await AcmeUser.syncIndexes();

  await AcmeUser.create({
    email: "hr@acme-ca1.test",
    passwordHash: await hashPassword(PASSWORD),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  await AcmeUser.create({
    email: "employee@acme-ca1.test",
    passwordHash: await hashPassword(PASSWORD),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  await createCompanyAdmin(AcmeUser, {
    email: "company-admin@acme-ca1.test",
    passwordHash: await hashPassword(PASSWORD),
    fullName: "Acme Company Admin",
  });

  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.syncIndexes();
  await createCompanyAdmin(GlobexUser, {
    email: "company-admin@globex-ca1.test",
    passwordHash: await hashPassword(PASSWORD),
    fullName: "Globex Company Admin",
  });
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Phase CA1 — existing roles remain intact", () => {
  it("existing HR Admin login still works", async () => {
    const res = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca1",
      email: "hr@acme-ca1.test",
      password: PASSWORD,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, USER_ROLES.HR_ADMIN);
    assert.equal(res.body.company.slug, "acme-ca1");
    assert.ok(cookieFrom(res));
  });

  it("existing Employee login still works", async () => {
    const res = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca1",
      email: "employee@acme-ca1.test",
      password: PASSWORD,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, USER_ROLES.EMPLOYEE);
  });

  it("Candidate direct login remains blocked", async () => {
    const { User } = await getCompanyModels(acme);
    await User.create({
      email: "candidate@acme-ca1.test",
      passwordHash: await hashPassword(PASSWORD),
      role: USER_ROLES.CANDIDATE,
      isActive: true,
      onboarding: { status: "SUBMITTED" },
    });
    const res = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca1",
      email: "candidate@acme-ca1.test",
      password: PASSWORD,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "CANDIDATE_ACCESS_DENIED");
  });
});

describe("Phase CA1 — Company Admin authentication", () => {
  it("Company Admin login succeeds with role and company context", async () => {
    const res = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca1",
      email: "company-admin@acme-ca1.test",
      password: PASSWORD,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, USER_ROLES.COMPANY_ADMIN);
    assert.equal(res.body.user.email, "company-admin@acme-ca1.test");
    assert.equal(res.body.company.slug, "acme-ca1");
    assert.ok(res.body.token);
    assert.ok(cookieFrom(res));
  });

  it("Company Admin /auth/me restores session with correct role", async () => {
    const login = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca1",
      email: "company-admin@acme-ca1.test",
      password: PASSWORD,
    });
    const cookie = cookieFrom(login);
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.role, USER_ROLES.COMPANY_ADMIN);
    assert.equal(me.body.company.slug, "acme-ca1");
  });

  it("Company Admin cannot access another company's data", async () => {
    const login = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca1",
      email: "company-admin@acme-ca1.test",
      password: PASSWORD,
    });
    const cookie = cookieFrom(login);

    // HR-only admin dashboard must remain HR_ADMIN-gated (no accidental inherit).
    const dash = await request(app).get("/api/admin/dashboard").set("Cookie", cookie);
    assert.equal(dash.status, 403);

    // Wrong-tenant login credentials fail.
    const cross = await request(app).post("/api/auth/login").send({
      companyCode: "globex-ca1",
      email: "company-admin@acme-ca1.test",
      password: PASSWORD,
    });
    assert.equal(cross.status, 401);
  });

  it("Company Admin does not inherit HR Admin employee list access", async () => {
    const login = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca1",
      email: "company-admin@acme-ca1.test",
      password: PASSWORD,
    });
    const cookie = cookieFrom(login);
    const people = await request(app).get("/api/employees").set("Cookie", cookie);
    assert.equal(people.status, 403);
  });
});

describe("Phase CA1 — exactly one active Company Admin", () => {
  it("rejects a second active Company Admin for the same company", async () => {
    const { User } = await getCompanyModels(acme);
    const passwordHash = await hashPassword(PASSWORD);
    await assert.rejects(
      () =>
        createCompanyAdmin(User, {
          email: "second-ca@acme-ca1.test",
          passwordHash,
        }),
      (err) => err instanceof HttpError && err.status === 409 && err.code === "COMPANY_ADMIN_ALREADY_ACTIVE"
    );
  });

  it("deactivating the active Company Admin permits a controlled replacement", async () => {
    const { User } = await getCompanyModels(acme);
    const current = await findActiveCompanyAdmin(User);
    assert.ok(current);

    await deactivateCompanyAdmin(User, current._id);
    assert.equal(await findActiveCompanyAdmin(User), null);

    const replacement = await createCompanyAdmin(User, {
      email: "replacement-ca@acme-ca1.test",
      passwordHash: await hashPassword(PASSWORD),
      fullName: "Replacement CA",
    });
    assert.equal(replacement.role, USER_ROLES.COMPANY_ADMIN);
    assert.equal(replacement.isActive, true);

    const active = await findActiveCompanyAdmin(User);
    assert.equal(String(active._id), String(replacement._id));

    // Restore original active CA for remaining tests: deactivate replacement, reactivate original.
    await deactivateCompanyAdmin(User, replacement._id);
    await activateCompanyAdmin(User, current._id);
    const restored = await findActiveCompanyAdmin(User);
    assert.equal(String(restored._id), String(current._id));
  });

  it("concurrent creation cannot produce two active Company Admins", async () => {
    const { User } = await getCompanyModels(globex);
    const active = await findActiveCompanyAdmin(User);
    assert.ok(active);
    await deactivateCompanyAdmin(User, active._id);

    const hash = await hashPassword(PASSWORD);
    const results = await Promise.allSettled([
      createCompanyAdmin(User, {
        email: "race-a@globex-ca1.test",
        passwordHash: hash,
      }),
      createCompanyAdmin(User, {
        email: "race-b@globex-ca1.test",
        passwordHash: hash,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason?.status, 409);
    assert.equal(rejected[0].reason?.code, "COMPANY_ADMIN_ALREADY_ACTIVE");

    const stillOne = await User.countDocuments({
      role: USER_ROLES.COMPANY_ADMIN,
      isActive: true,
    });
    assert.equal(stillOne, 1);

    // Leave Globex with a known active CA for cleanliness.
    const winner = fulfilled[0].value;
    assert.ok(winner);
  });

  it("activating a second Company Admin while another is active fails", async () => {
    const { User } = await getCompanyModels(acme);
    const inactive = await User.create({
      email: "inactive-ca@acme-ca1.test",
      passwordHash: await hashPassword(PASSWORD),
      role: USER_ROLES.COMPANY_ADMIN,
      isActive: false,
    });
    await assert.rejects(
      () => activateCompanyAdmin(User, inactive._id),
      (err) => err instanceof HttpError && err.status === 409
    );
  });
});

describe("Phase CA1 — role-based portal routing foundation", () => {
  it("maps each role to the correct portal entry path", () => {
    assert.equal(homeForRole(USER_ROLES.COMPANY_ADMIN), "/company");
    assert.equal(homeForRole(USER_ROLES.HR_ADMIN), "/admin/dashboard");
    assert.equal(homeForRole(USER_ROLES.EMPLOYEE), "/app/dashboard");
    assert.equal(homeForRole(USER_ROLES.CANDIDATE), "/login");
  });
});
