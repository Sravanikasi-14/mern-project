import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { hashAuthToken } from "../utils/authTokenHash.js";
import { provisionEmployeeAccount, PROVISIONING_SOURCES } from "../services/employeeProvisioningService.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

let mongo;
let app;
let companyA;
let companyB;
let hrCookieA;
let hrCookieB;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  companyA = await Company.create({
    companyName: "Acme Corp",
    slug: "acme",
    databaseName: "company_acme_prov",
    status: COMPANY_STATUSES.ACTIVE,
  });
  companyB = await Company.create({
    companyName: "Globex",
    slug: "globex",
    databaseName: "company_globex_prov",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: UserA } = await getCompanyModels(companyA);
  await UserA.create({
    email: "hr@acme.test",
    passwordHash: await hashPassword("AcmeHrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  // Preserve existing employee login fixture pattern
  await UserA.create({
    email: "employee@acme.test",
    passwordHash: await hashPassword("EmployeePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  const { User: UserB } = await getCompanyModels(companyB);
  await UserB.create({
    email: "hr@globex.test",
    passwordHash: await hashPassword("GlobexHrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const loginA = await request(app).post("/api/auth/login").send({
    companyCode: "acme",
    email: "hr@acme.test",
    password: "AcmeHrPass123!",
  });
  hrCookieA = cookieFrom(loginA);

  const loginB = await request(app).post("/api/auth/login").send({
    companyCode: "globex",
    email: "hr@globex.test",
    password: "GlobexHrPass123!",
  });
  hrCookieB = cookieFrom(loginB);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Employee provisioning pathways A/B/C", () => {
  it("preserves HR and existing employee@acme.test login", async () => {
    const hr = await request(app).post("/api/auth/login").send({
      companyCode: "acme",
      email: "hr@acme.test",
      password: "AcmeHrPass123!",
    });
    assert.equal(hr.status, 200);

    const emp = await request(app).post("/api/auth/login").send({
      companyCode: "acme",
      email: "employee@acme.test",
      password: "EmployeePass123!",
    });
    assert.equal(emp.status, 200);
  });

  it("Path A: creates multiple employees with activation links and independent logins", async () => {
    const created = [];
    for (const person of [
      { fullName: "Alice One", email: "alice@acme.test", employeeCode: "ACM-201" },
      { fullName: "Bob Two", email: "bob@acme.test", employeeCode: "ACM-202" },
    ]) {
      const res = await request(app)
        .post("/api/employees")
        .set("Cookie", hrCookieA)
        .send({ ...person, jobTitle: "Engineer", department: "R&D" });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.accountStatus, "PENDING_ACTIVATION");
      assert.ok(res.body.activation.activationLink.includes("/activate?token="));
      assert.equal(res.body.invitation.emailSent, false);
      created.push(res.body);
    }

    const { User, AuthToken, Employee } = await getCompanyModels(companyA);
    for (const item of created) {
      const user = await User.findOne({ email: item.employee.email });
      assert.equal(user.isActive, false);
      assert.equal(user.role, USER_ROLES.EMPLOYEE);
      assert.ok(user.employeeId);

      const tokenDocs = await AuthToken.find({ email: item.employee.email, isActive: true });
      assert.equal(tokenDocs.length, 1);
      // Stored value must be hash, not raw JWT
      assert.equal(tokenDocs[0].token.includes("."), false);

      const url = new URL(item.activation.activationLink);
      const raw = url.searchParams.get("token");
      assert.equal(tokenDocs[0].token, hashAuthToken(raw));

      const verify = await request(app).get(`/api/auth/activate/verify?token=${encodeURIComponent(raw)}`);
      assert.equal(verify.status, 200);

      const password = `Pass-${item.employee.employeeCode}!`;
      const activate = await request(app).post("/api/auth/activate/complete").send({ token: raw, password });
      assert.equal(activate.status, 200, JSON.stringify(activate.body));

      const login = await request(app).post("/api/auth/login").send({
        companyCode: "acme",
        email: item.employee.email,
        password,
      });
      assert.equal(login.status, 200);

      const emp = await Employee.findById(item.employee._id);
      assert.equal(emp.invitation.status, "ACCEPTED");
    }

    // Token reuse rejected
    const url = new URL(created[0].activation.activationLink);
    const reuse = await request(app)
      .post("/api/auth/activate/complete")
      .send({ token: url.searchParams.get("token"), password: "AnotherPass99!" });
    assert.equal(reuse.status, 409);
  });

  it("Path A: rejects duplicate email and employee code", async () => {
    const dupEmail = await request(app)
      .post("/api/employees")
      .set("Cookie", hrCookieA)
      .send({ fullName: "Dup", email: "alice@acme.test", employeeCode: "ACM-999" });
    assert.equal(dupEmail.status, 409);

    const dupCode = await request(app)
      .post("/api/employees")
      .set("Cookie", hrCookieA)
      .send({ fullName: "Dup", email: "newdup@acme.test", employeeCode: "ACM-201" });
    assert.equal(dupCode.status, 409);
  });

  it("Path A: regenerates activation link without creating another account", async () => {
    const create = await request(app)
      .post("/api/employees")
      .set("Cookie", hrCookieA)
      .send({ fullName: "Carol Regen", email: "carol@acme.test", employeeCode: "ACM-203" });
    assert.equal(create.status, 201);
    const employeeId = create.body.employee._id;
    const firstLink = create.body.activation.activationLink;

    const regen = await request(app)
      .post(`/api/employees/${employeeId}/activation-link`)
      .set("Cookie", hrCookieA);
    assert.equal(regen.status, 200);
    assert.ok(regen.body.activation.activationLink);
    assert.notEqual(regen.body.activation.activationLink, firstLink);

    const { Employee } = await getCompanyModels(companyA);
    const count = await Employee.countDocuments({ email: "carol@acme.test" });
    assert.equal(count, 1);

    // Old link should no longer verify as active
    const oldToken = new URL(firstLink).searchParams.get("token");
    const oldVerify = await request(app).get(`/api/auth/activate/verify?token=${encodeURIComponent(oldToken)}`);
    assert.ok([400, 409].includes(oldVerify.status));

    const newToken = new URL(regen.body.activation.activationLink).searchParams.get("token");
    const activate = await request(app)
      .post("/api/auth/activate/complete")
      .send({ token: newToken, password: "CarolPass123!" });
    assert.equal(activate.status, 200);
  });

  it("enforces cross-company isolation on create and login", async () => {
    const create = await request(app)
      .post("/api/employees")
      .set("Cookie", hrCookieB)
      .send({ fullName: "Globex Emp", email: "alice@acme.test", employeeCode: "GLX-001" });
    assert.equal(create.status, 201);

    // Same email allowed in another tenant
    const wrongTenantLogin = await request(app).post("/api/auth/login").send({
      companyCode: "globex",
      email: "alice@acme.test",
      password: "Pass-ACM-201!",
    });
    assert.equal(wrongTenantLogin.status, 401);

    const { Employee: EmpA } = await getCompanyModels(companyA);
    const { Employee: EmpB } = await getCompanyModels(companyB);
    assert.equal(await EmpA.countDocuments({ email: "alice@acme.test" }), 1);
    assert.equal(await EmpB.countDocuments({ email: "alice@acme.test" }), 1);
  });

  it("Path B contract: provisionEmployeeAccount with existingUserId is idempotent on duplicate", async () => {
    const models = await getCompanyModels(companyA);
    const candidate = await models.User.create({
      email: "candidate.pathb@acme.test",
      role: USER_ROLES.CANDIDATE,
      isActive: false,
      onboarding: { status: "APPROVED" },
    });

    // Direct path A must refuse candidate emails
    const blocked = await request(app)
      .post("/api/employees")
      .set("Cookie", hrCookieA)
      .send({
        fullName: "Path B Person",
        email: "candidate.pathb@acme.test",
        employeeCode: "ACM-301",
      });
    assert.equal(blocked.status, 409);

    const first = await provisionEmployeeAccount(
      {
        models,
        company: companyA,
        actorUserId: null,
        clientBaseUrl: "http://localhost:5173",
      },
      {
        fullName: "Path B Person",
        email: "candidate.pathb@acme.test",
        employeeCode: "ACM-301",
        jobTitle: "Analyst",
      },
      { source: PROVISIONING_SOURCES.ONBOARDING, existingUserId: candidate._id }
    );
    assert.equal(first.accountStatus, "PENDING_ACTIVATION");
    assert.ok(first.activation.activationLink.includes("/activate?token="));

    await assert.rejects(
      () =>
        provisionEmployeeAccount(
          { models, company: companyA, clientBaseUrl: "http://localhost:5173" },
          {
            fullName: "Path B Person",
            email: "candidate.pathb@acme.test",
            employeeCode: "ACM-301",
          },
          { source: PROVISIONING_SOURCES.ONBOARDING, existingUserId: candidate._id }
        ),
      (err) => err.status === 409
    );
  });

  it("Path C: preview and import valid/invalid rows with failure isolation", async () => {
    const rows = [
      {
        fullName: "Import Valid",
        email: "import.valid@acme.test",
        employeeCode: "ACM-401",
        department: "Ops",
        jobTitle: "Coordinator",
      },
      {
        fullName: "Import Bad",
        email: "not-an-email",
        employeeCode: "ACM-402",
      },
      {
        fullName: "Import Dup Code",
        email: "import.dup@acme.test",
        employeeCode: "ACM-401",
      },
    ];

    const preview = await request(app)
      .post("/api/employees/import/preview")
      .set("Cookie", hrCookieA)
      .send({ rows });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.summary.totalRows, 3);
    assert.equal(preview.body.summary.validRows, 1);
    assert.equal(preview.body.summary.invalidRows, 2);

    const commit = await request(app)
      .post("/api/employees/import")
      .set("Cookie", hrCookieA)
      .send({ rows, importValidOnly: true });
    assert.equal(commit.status, 201);
    assert.equal(commit.body.summary.createdCount, 1);
    assert.equal(commit.body.summary.failedCount, 2);
    assert.ok(commit.body.created[0].activationLink.includes("/activate?token="));
    // failed payload must not include activation tokens
    assert.equal(commit.body.failed[0].activationLink, undefined);

    const template = await request(app)
      .get("/api/employees/import/template")
      .set("Cookie", hrCookieA);
    assert.equal(template.status, 200);
    assert.match(template.text, /fullName,email,employeeCode/);
  });

  it("ignores client-supplied role overrides on create", async () => {
    const res = await request(app)
      .post("/api/employees")
      .set("Cookie", hrCookieA)
      .send({
        fullName: "Role Attempt",
        email: "role.attempt@acme.test",
        employeeCode: "ACM-501",
        role: "HR_ADMIN",
        password: "ShouldBeIgnored1!",
      });
    assert.equal(res.status, 201);
    const { User } = await getCompanyModels(companyA);
    const user = await User.findOne({ email: "role.attempt@acme.test" });
    assert.equal(user.role, USER_ROLES.EMPLOYEE);
    assert.equal(user.isActive, false);

    // Password from client must not work before activation
    const login = await request(app).post("/api/auth/login").send({
      companyCode: "acme",
      email: "role.attempt@acme.test",
      password: "ShouldBeIgnored1!",
    });
    assert.ok([401, 403].includes(login.status));
  });
});
