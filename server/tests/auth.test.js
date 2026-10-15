import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { signOnboardingToken } from "../utils/onboardingToken.js";
import { hashPassword } from "../utils/password.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

const PASSWORD = "CorrectHorseBattery1";
const OTHER_PASSWORD = "OtherCorrectHorse2";

let mongo;
let app;
let acme;
let globex;
let acmeHrCookie;
let acmeEmployeeCookie;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

async function createCompany({
  companyName,
  slug,
  databaseName,
  status = COMPANY_STATUSES.ACTIVE,
  primaryContact = {},
}) {
  return Company.create({
    companyName,
    slug,
    databaseName,
    migrationVersion: 0,
    status,
    primaryContact,
    schemaVersion: 1,
  });
}

async function createUser(company, { email, role, isActive = true, password = PASSWORD }) {
  const { User } = await getCompanyModels(company);
  return User.create({
    email,
    passwordHash: await hashPassword(password),
    role,
    isActive,
    schemaVersion: 1,
  });
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await createCompany({
    companyName: "Acme",
    slug: "acme",
    databaseName: "company_acme",
  });
  globex = await createCompany({
    companyName: "Globex",
    slug: "globex",
    databaseName: "company_globex",
  });
  await createCompany({
    companyName: "Paused Co",
    slug: "paused",
    databaseName: "company_paused",
    status: COMPANY_STATUSES.SUSPENDED,
  });

  await createUser(acme, {
    email: "hr@acme.test",
    role: USER_ROLES.HR_ADMIN,
  });
  await createUser(acme, {
    email: "employee@acme.test",
    role: USER_ROLES.EMPLOYEE,
  });
  await createUser(acme, {
    email: "inactive@acme.test",
    role: USER_ROLES.EMPLOYEE,
    isActive: false,
  });
  await createUser(globex, {
    email: "hr@globex.test",
    role: USER_ROLES.HR_ADMIN,
    password: OTHER_PASSWORD,
  });
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("company-user authentication", () => {
  it("logs in an HR Admin using companyCode and never returns passwordHash", async () => {
    const response = await request(app).post("/api/auth/login").send({
      companyCode: "acme",
      email: "hr@acme.test",
      password: PASSWORD,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, "hr@acme.test");
    assert.equal(response.body.user.role, USER_ROLES.HR_ADMIN);
    assert.equal(response.body.user.passwordHash, undefined);
    assert.equal(response.body.company.databaseName, undefined);
    assert.equal(response.body.company.companyCode, "acme");
    assert.ok(response.body.user.lastLoginAt);
    assert.ok(cookieFrom(response));
    assert.equal(JSON.stringify(response.body).includes("passwordHash"), false);
    acmeHrCookie = cookieFrom(response);
  });

  it("logs in an Employee using backwards-compatible slug", async () => {
    const response = await request(app).post("/api/auth/login").send({
      slug: "ACME",
      email: "  Employee@acme.test  ",
      password: PASSWORD,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.user.role, USER_ROLES.EMPLOYEE);
    assert.equal(response.body.user.passwordHash, undefined);
    assert.equal(response.body.company.companyCode, "acme");
    acmeEmployeeCookie = cookieFrom(response);
  });

  it("rejects an incorrect password without revealing the account", async () => {
    const response = await request(app).post("/api/auth/login").send({
      slug: "acme",
      email: "hr@acme.test",
      password: "wrong-password",
    });

    assert.equal(response.status, 401);
    assert.match(response.body.message, /company code, email, or password is incorrect/i);
  });

  it("rejects an unknown email with the same error", async () => {
    const response = await request(app).post("/api/auth/login").send({
      slug: "acme",
      email: "missing@acme.test",
      password: PASSWORD,
    });

    assert.equal(response.status, 401);
    assert.match(response.body.message, /company code, email, or password is incorrect/i);
  });

  it("rejects an inactive account", async () => {
    const response = await request(app).post("/api/auth/login").send({
      slug: "acme",
      email: "inactive@acme.test",
      password: PASSWORD,
    });

    assert.equal(response.status, 403);
    assert.match(response.body.message, /account is inactive/i);
  });

  it("rejects missing tenant identification", async () => {
    const response = await request(app).post("/api/auth/login").send({
      email: "hr@acme.test",
      password: PASSWORD,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /company code/i);
  });

  it("rejects an unknown company slug", async () => {
    const response = await request(app).post("/api/auth/login").send({
      slug: "unknown",
      email: "hr@acme.test",
      password: PASSWORD,
    });

    assert.equal(response.status, 404);
  });

  it("rejects a suspended company", async () => {
    const response = await request(app).post("/api/auth/login").send({
      slug: "paused",
      email: "hr@acme.test",
      password: PASSWORD,
    });

    assert.equal(response.status, 403);
  });

  it("rejects missing credentials", async () => {
    const response = await request(app).post("/api/auth/login").send({
      slug: "acme",
    });

    assert.equal(response.status, 400);
  });

  it("rejects object payloads that would be unsafe to query", async () => {
    const response = await request(app).post("/api/auth/login").send({
      slug: { $gt: "" },
      email: { $gt: "" },
      password: PASSWORD,
    });

    assert.equal(response.status, 400);
  });

  it("restores the authenticated user from the session cookie", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Cookie", acmeHrCookie);

    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, "hr@acme.test");
    assert.equal(response.body.user.passwordHash, undefined);
  });

  it("rejects protected routes without authentication", async () => {
    const response = await request(app).get("/api/employees/summary");
    assert.equal(response.status, 401);
  });

  it("rejects invalid credentials on /me", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Cookie", `${getAuthCookieName()}=not-a-jwt`);

    assert.equal(response.status, 401);
  });

  it("rejects expired credentials", async () => {
    const expired = jwt.sign(
      { sub: new mongoose.Types.ObjectId().toString(), companyId: acme._id.toString() },
      process.env.JWT_SECRET,
      {
        expiresIn: "0s",
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      }
    );

    const response = await request(app)
      .get("/api/auth/me")
      .set("Cookie", `${getAuthCookieName()}=${expired}`);

    assert.equal(response.status, 401);
  });

  it("blocks an Employee from HR Admin-only routes", async () => {
    const overview = await request(app)
      .get("/api/admin/overview")
      .set("Cookie", acmeEmployeeCookie);
    const createEmp = await request(app)
      .post("/api/employees")
      .set("Cookie", acmeEmployeeCookie)
      .send({ firstName: "Test" });

    assert.equal(overview.status, 403);
    assert.equal(createEmp.status, 403);
  });

  it("allows an HR Admin to access admin-only routes", async () => {
    const response = await request(app)
      .get("/api/admin/overview")
      .set("Cookie", acmeHrCookie);

    assert.equal(response.status, 200);
    assert.equal(response.body.slug, "acme");
  });

  it("keeps tenant data isolated across company workspaces", async () => {
    const globexLogin = await request(app).post("/api/auth/login").send({
      slug: "globex",
      email: "hr@globex.test",
      password: OTHER_PASSWORD,
    });
    const globexEmployees = await request(app)
      .get("/api/employees")
      .set("Cookie", cookieFrom(globexLogin));
    const acmeEmployees = await request(app)
      .get("/api/employees")
      .set("Cookie", acmeHrCookie);

    assert.equal(globexEmployees.status, 200);
    assert.equal(globexEmployees.body.employees.length, 0);
    assert.equal(acmeEmployees.status, 200);
    assert.equal(acmeEmployees.body.employees.length, 0);
  });

  it("does not authenticate a company user against another company", async () => {
    const response = await request(app).post("/api/auth/login").send({
      slug: "globex",
      email: "hr@acme.test",
      password: PASSWORD,
    });

    assert.equal(response.status, 401);
  });

  it("rejects a token whose companyId does not match the user database", async () => {
    const forged = jwt.sign(
      {
        sub: (await (await getCompanyModels(acme)).User.findOne({ email: "hr@acme.test" }))._id.toString(),
        companyId: globex._id.toString(),
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1h",
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      }
    );

    const response = await request(app)
      .get("/api/admin/overview")
      .set("Cookie", `${getAuthCookieName()}=${forged}`);

    assert.equal(response.status, 401);
  });

  it("logs out and then rejects the cleared credentials", async () => {
    const login = await request(app).post("/api/auth/login").send({
      slug: "acme",
      email: "hr@acme.test",
      password: PASSWORD,
    });
    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookieFrom(login));
    const clearedCookie = cookieFrom(logout);
    const me = await request(app)
      .get("/api/auth/me")
      .set("Cookie", clearedCookie || "");

    assert.equal(logout.status, 200);
    assert.equal(me.status, 401);
  });

  describe("initial HR Admin onboarding", () => {
    let newCompany;
    let validToken;

    before(async () => {
      newCompany = await createCompany({
        companyName: "Initech",
        slug: "initech",
        databaseName: "company_initech",
      });
      validToken = signOnboardingToken({
        companyId: newCompany._id,
        email: "boss@initech.test",
      });
    });

    it("verifies a valid onboarding token and returns company details", async () => {
      const response = await request(app)
        .get(`/api/auth/onboarding/verify?token=${encodeURIComponent(validToken)}`);

      assert.equal(response.status, 200);
      assert.equal(response.body.valid, true);
      assert.equal(response.body.companyCode, "initech");
      assert.equal(response.body.companyName, "Initech");
      assert.equal(response.body.email, "boss@initech.test");
    });

    it("rejects an invalid onboarding token during verification", async () => {
      const response = await request(app)
        .get("/api/auth/onboarding/verify?token=tampered-or-invalid-token");

      assert.equal(response.status, 400);
    });

    it("rejects password shorter than 8 characters during onboarding completion", async () => {
      const response = await request(app)
        .post("/api/auth/onboarding/complete")
        .send({
          token: validToken,
          password: "short",
        });

      assert.equal(response.status, 400);
      assert.match(response.body.message, /8 characters/i);
    });

    it("completes onboarding, creates HR_ADMIN, sets auth cookie, and logs in", async () => {
      const response = await request(app)
        .post("/api/auth/onboarding/complete")
        .send({
          token: validToken,
          password: "SuperSecretPassword123!",
        });

      assert.equal(response.status, 201);
      assert.equal(response.body.user.email, "boss@initech.test");
      assert.equal(response.body.user.role, USER_ROLES.HR_ADMIN);
      assert.equal(response.body.user.passwordHash, undefined);
      assert.ok(cookieFrom(response));

      const { User } = await getCompanyModels(newCompany);
      const createdUser = await User.findOne({ email: "boss@initech.test" });
      assert.ok(createdUser);
      assert.equal(createdUser.role, USER_ROLES.HR_ADMIN);
      assert.equal(createdUser.isActive, true);
    });

    it("rejects using the same onboarding token again", async () => {
      const response = await request(app)
        .post("/api/auth/onboarding/complete")
        .send({
          token: validToken,
          password: "SuperSecretPassword123!",
        });

      assert.equal(response.status, 409);
    });

    it("allows the newly onboarded HR Admin to log in with Company code", async () => {
      const response = await request(app).post("/api/auth/login").send({
        companyCode: "initech",
        email: "boss@initech.test",
        password: "SuperSecretPassword123!",
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.user.email, "boss@initech.test");
      assert.equal(response.body.user.role, USER_ROLES.HR_ADMIN);
      assert.ok(cookieFrom(response));
    });
  });

  describe("controlled initial HR Admin onboarding for provisioned companies", () => {
    let starkCompany;

    before(async () => {
      starkCompany = await createCompany({
        companyName: "Stark Industries",
        slug: "stark",
        databaseName: "company_stark",
        primaryContact: {
          fullName: "Pepper Potts",
          email: "pepper@stark.test",
        },
      });
    });

    it("rejects setup when required fields are missing", async () => {
      const response = await request(app).post("/api/auth/setup-initial-admin").send({
        companyCode: "stark",
      });

      assert.equal(response.status, 400);
      assert.match(response.body.message, /company code, email, and password/i);
    });

    it("rejects setup when password is less than 8 characters", async () => {
      const response = await request(app).post("/api/auth/setup-initial-admin").send({
        companyCode: "stark",
        email: "pepper@stark.test",
        password: "short",
        confirmPassword: "short",
      });

      assert.equal(response.status, 400);
      assert.match(response.body.message, /8 characters/i);
    });

    it("rejects setup when confirm password does not match", async () => {
      const response = await request(app).post("/api/auth/setup-initial-admin").send({
        companyCode: "stark",
        email: "pepper@stark.test",
        password: "IronManPassword123!",
        confirmPassword: "DifferentPassword123!",
      });

      assert.equal(response.status, 400);
      assert.match(response.body.message, /match/i);
    });

    it("rejects setup when targeting an unprovisioned company workspace", async () => {
      const response = await request(app).post("/api/auth/setup-initial-admin").send({
        companyCode: "nonexistent",
        email: "admin@nonexistent.test",
        password: "SomePassword123!",
        confirmPassword: "SomePassword123!",
      });

      assert.equal(response.status, 404);
      assert.match(response.body.message, /couldn't find this company workspace/i);
    });

    it("rejects setup when an unauthorized email tries to claim a provisioned company", async () => {
      const response = await request(app).post("/api/auth/setup-initial-admin").send({
        companyCode: "stark",
        email: "impostor@stark.test",
        password: "SomePassword123!",
        confirmPassword: "SomePassword123!",
      });

      assert.equal(response.status, 403);
      assert.match(response.body.message, /designated primary contact/i);
    });

    it("sets up initial HR Admin for a provisioned company without an invitation link", async () => {
      const response = await request(app).post("/api/auth/setup-initial-admin").send({
        companyCode: "stark",
        email: "pepper@stark.test",
        password: "IronManPassword123!",
        confirmPassword: "IronManPassword123!",
      });

      assert.equal(response.status, 201);
      assert.equal(response.body.user.email, "pepper@stark.test");
      assert.equal(response.body.user.role, USER_ROLES.HR_ADMIN);
      assert.equal(response.body.company.companyCode, "stark");
      assert.ok(cookieFrom(response));

      // Check session was tracked in authSessions and restores on /me
      const meResponse = await request(app)
        .get("/api/auth/me")
        .set("Cookie", cookieFrom(response));

      assert.equal(meResponse.status, 200);
      assert.equal(meResponse.body.user.email, "pepper@stark.test");
    });

    it("rejects setup on a company that already has an HR Admin", async () => {
      // stark now already has an HR Admin created in the previous test
      const response = await request(app).post("/api/auth/setup-initial-admin").send({
        companyCode: "stark",
        email: "pepper@stark.test",
        password: "IronManPassword123!",
        confirmPassword: "IronManPassword123!",
      });

      assert.equal(response.status, 409);
      assert.match(response.body.message, /already established/i);
    });
  });
});

