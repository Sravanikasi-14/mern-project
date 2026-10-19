import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "super-secret-test-jwt-key-32-chars-long";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_auth_test";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

const TEST_PASSWORD = "ValidSecurePassword123";
const VERCEL_ORIGIN = "https://mern-project-nu-nine.vercel.app";

let mongoServer;
let app;
let testCompany;
let hrAdminUser;
let employeeUser;
let hrToken;
let hrCookie;
let empToken;

describe("HRMS Authentication Lifecycle — 16 Verification Scenarios", () => {
  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    await connectCentralDB();

    testCompany = await Company.create({
      companyName: "Acme Enterprise",
      slug: "acme-ent",
      databaseName: "acme_ent_db",
      status: COMPANY_STATUSES.ACTIVE,
      migrationVersion: 0,
      schemaVersion: 1,
    });

    const { User } = await getCompanyModels(testCompany);

    // 1. HR Admin user
    hrAdminUser = await User.create({
      email: "hradmin@acme.com",
      passwordHash: await hashPassword(TEST_PASSWORD),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      profile: { firstName: "Alice", lastName: "HRAdmin" },
      schemaVersion: 1,
    });

    // 2. Employee user
    employeeUser = await User.create({
      email: "employee@acme.com",
      passwordHash: await hashPassword(TEST_PASSWORD),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
      profile: { firstName: "Bob", lastName: "Employee" },
      schemaVersion: 1,
    });

    // 3. Inactive user
    await User.create({
      email: "inactive@acme.com",
      passwordHash: await hashPassword(TEST_PASSWORD),
      role: USER_ROLES.EMPLOYEE,
      isActive: false,
      profile: { firstName: "Ian", lastName: "Inactive" },
      schemaVersion: 1,
    });

    app = createApp();
  });

  after(async () => {
    await disconnectAll();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // Scenario 1: Login with valid credentials
  it("Scenario 1: Login with valid credentials returns session token, user details, and sets secure cookie", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", VERCEL_ORIGIN)
      .send({
        companyCode: "acme-ent",
        email: "hradmin@acme.com",
        password: TEST_PASSWORD,
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, "hradmin@acme.com");
    assert.equal(res.body.user.role, "HR_ADMIN");
    assert.ok(res.body.token, "Expected session token in body");

    hrToken = res.body.token;
    const cookies = res.headers["set-cookie"] || [];
    hrCookie = cookies.find((c) => c.startsWith(`${getAuthCookieName()}=`));
    assert.ok(hrCookie, "Expected auth cookie set");

    // Also log in employee for role-based access tests
    const empRes = await request(app)
      .post("/api/auth/login")
      .set("Origin", VERCEL_ORIGIN)
      .send({
        companyCode: "acme-ent",
        email: "employee@acme.com",
        password: TEST_PASSWORD,
      });

    assert.equal(empRes.status, 200);
    empToken = empRes.body.token;
    assert.equal(empRes.body.user.role, "EMPLOYEE");
  });

  // Scenario 2: Login with an incorrect password
  it("Scenario 2: Login with incorrect password returns 401 without exposing internals", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", VERCEL_ORIGIN)
      .send({
        companyCode: "acme-ent",
        email: "hradmin@acme.com",
        password: "WrongPassword999",
      });

    assert.equal(res.status, 401);
    assert.match(res.body.message, /invalid|incorrect/i);
    assert.equal(res.body.stack, undefined, "Stack trace must never be leaked");
  });

  // Scenario 3: Login with an unknown email
  it("Scenario 3: Login with unknown email returns 401 with generic message (not revealing user existence)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", VERCEL_ORIGIN)
      .send({
        companyCode: "acme-ent",
        email: "nonexistent.user@acme.com",
        password: TEST_PASSWORD,
      });

    assert.equal(res.status, 401);
    // Standard security policy: uniform error message for unknown email & bad password without revealing existence
    assert.match(res.body.message, /incorrect|invalid/i);
  });

  // Scenario 4: Submit the form with missing fields
  it("Scenario 4: Submit login with missing fields returns 400 validation error", async () => {
    const resMissingEmail = await request(app)
      .post("/api/auth/login")
      .set("Origin", VERCEL_ORIGIN)
      .send({
        companyCode: "acme-ent",
        password: TEST_PASSWORD,
      });

    assert.equal(resMissingEmail.status, 400);
    assert.match(resMissingEmail.body.message, /enter/i);

    const resMissingPassword = await request(app)
      .post("/api/auth/login")
      .set("Origin", VERCEL_ORIGIN)
      .send({
        companyCode: "acme-ent",
        email: "hradmin@acme.com",
      });

    assert.equal(resMissingPassword.status, 400);
    assert.match(resMissingPassword.body.message, /enter/i);
  });

  // Scenario 5: Attempt login with an inactive account
  it("Scenario 5: Attempt login with inactive account returns 403 Forbidden with account inactive status", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", VERCEL_ORIGIN)
      .send({
        companyCode: "acme-ent",
        email: "inactive@acme.com",
        password: TEST_PASSWORD,
      });

    assert.equal(res.status, 403);
    assert.match(res.body.message, /disabled|inactive/i);
  });

  // Scenario 6 & 7: Refresh page while authenticated / Load /api/auth/me with valid session
  it("Scenario 6 & 7: Page refresh / session restoration via /api/auth/me restores valid user & role (Bearer and Cookie)", async () => {
    // Via Bearer token
    const resBearer = await request(app)
      .get("/api/auth/me")
      .set("Origin", VERCEL_ORIGIN)
      .set("Authorization", `Bearer ${hrToken}`);

    assert.equal(resBearer.status, 200);
    assert.equal(resBearer.body.user.email, "hradmin@acme.com");
    assert.equal(resBearer.body.user.role, "HR_ADMIN");
    assert.equal(resBearer.body.company.slug, "acme-ent");

    // Via Cookie
    const resCookie = await request(app)
      .get("/api/auth/me")
      .set("Origin", VERCEL_ORIGIN)
      .set("Cookie", hrCookie);

    assert.equal(resCookie.status, 200);
    assert.equal(resCookie.body.user.email, "hradmin@acme.com");
  });

  // Scenario 8: Load /api/auth/me without a session
  it("Scenario 8: Load /api/auth/me without session returns 401 with proper CORS headers", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Origin", VERCEL_ORIGIN);

    assert.equal(res.status, 401);
    assert.equal(res.headers["access-control-allow-origin"], VERCEL_ORIGIN);
    assert.equal(res.headers["access-control-allow-credentials"], "true");
  });

  // Scenario 9: Handle an expired or invalid token
  it("Scenario 9: Handle an expired or malformed session token returns 401", async () => {
    // Malformed token
    const resMalformed = await request(app)
      .get("/api/auth/me")
      .set("Origin", VERCEL_ORIGIN)
      .set("Authorization", "Bearer invalid.malformed.token");

    assert.equal(resMalformed.status, 401);

    // Expired token
    const expiredToken = jwt.sign(
      {
        sub: String(hrAdminUser._id),
        companyId: String(testCompany._id),
      },
      process.env.JWT_SECRET,
      {
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
        expiresIn: -10, // expired 10 seconds ago
      }
    );

    const resExpired = await request(app)
      .get("/api/auth/me")
      .set("Origin", VERCEL_ORIGIN)
      .set("Authorization", `Bearer ${expiredToken}`);

    assert.equal(resExpired.status, 401);
  });

  // Scenario 10: Attempt unauthorized access to protected route without authentication
  it("Scenario 10: Attempt unauthorized access to protected route returns 401", async () => {
    const res = await request(app)
      .get("/api/admin/employees")
      .set("Origin", VERCEL_ORIGIN);

    assert.equal(res.status, 401);
  });

  // Scenario 11: Attempt access to a route belonging to another role
  it("Scenario 11: Employee attempting access to HR Admin protected route returns 403 Forbidden", async () => {
    const res = await request(app)
      .get("/api/admin/employees")
      .set("Origin", VERCEL_ORIGIN)
      .set("Authorization", `Bearer ${empToken}`);

    assert.equal(res.status, 403);
    assert.match(res.body.message, /access|forbidden|denied/i);
  });

  // Scenario 12: Logout successfully
  it("Scenario 12: Logout successfully revokes session in DB and clears auth cookie", async () => {
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Origin", VERCEL_ORIGIN)
      .set("Authorization", `Bearer ${hrToken}`)
      .set("Cookie", hrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.message, "Logged out");

    // Verify cookie clearing in Set-Cookie header
    const cookies = res.headers["set-cookie"] || [];
    const clearedCookie = cookies.find((c) => c.startsWith(`${getAuthCookieName()}=`));
    assert.ok(clearedCookie, "Expected Set-Cookie header clearing the cookie");
    assert.match(clearedCookie, /Expires=Thu, 01 Jan 1970/i);
  });

  // Scenario 13: Verify the session is no longer usable after logout
  it("Scenario 13: Revoked token cannot access protected /api/auth/me or API routes", async () => {
    const resMe = await request(app)
      .get("/api/auth/me")
      .set("Origin", VERCEL_ORIGIN)
      .set("Authorization", `Bearer ${hrToken}`);

    assert.equal(resMe.status, 401);
    assert.match(resMe.body.message, /logged out|invalid|expired/i);
  });

  // Scenario 14: Network/Server error handling does not expose internals
  it("Scenario 14: Error handling returns predictable JSON structure without stack traces", async () => {
    const resNonExistent = await request(app)
      .get("/api/non-existent-endpoint")
      .set("Origin", VERCEL_ORIGIN);

    assert.ok(resNonExistent.status === 404 || resNonExistent.status === 401);
    assert.equal(resNonExistent.body.stack, undefined);
  });

  // Scenario 15: Verify CORS preflight and credential handling
  it("Scenario 15: OPTIONS preflight from production Vercel origin returns 204 with full CORS headers", async () => {
    const res = await request(app)
      .options("/api/auth/me")
      .set("Origin", VERCEL_ORIGIN)
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "Authorization, Content-Type");

    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], VERCEL_ORIGIN);
    assert.equal(res.headers["access-control-allow-credentials"], "true");
    assert.match(res.headers["access-control-allow-methods"], /GET/);
    assert.match(res.headers["access-control-allow-headers"], /Authorization/i);
  });

  // Scenario 16: Verify authentication failures do not cause infinite redirect loops or 500s
  it("Scenario 16: Authentication failures cleanly return 401/403 with distinct HTTP status codes", async () => {
    const res401 = await request(app)
      .get("/api/auth/me")
      .set("Origin", VERCEL_ORIGIN);

    assert.equal(res401.status, 401);

    const res403 = await request(app)
      .get("/api/admin/employees")
      .set("Origin", VERCEL_ORIGIN)
      .set("Authorization", `Bearer ${empToken}`);

    assert.equal(res403.status, 403);

    // Ensure status is never conflated with 500
    assert.notEqual(res401.status, 500);
    assert.notEqual(res403.status, 500);
  });
});
