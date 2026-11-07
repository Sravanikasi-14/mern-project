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
import { createCompanyAdmin } from "../services/companyAdminService.js";
import { emailService } from "../services/emailService.js";
import { linkPortalOperatorEmployee } from "../services/portalIdentityLinkService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

const PASSWORD = "IdentityLinkPass1!";
const DB_PATH = "D:/tmp/hrms-mongo/portal-identity-link";

let mongo;
let app;
let acme;
let globex;
let caCookie;
let globexCookie;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

function tokenFrom(link) {
  return new URL(link).searchParams.get("token");
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
  emailService.setTransporter({
    sendMail: async () => ({ messageId: "identity-link" }),
    verify: async () => true,
  });

  acme = await Company.create({
    companyName: "Acme Identity",
    slug: "acme-identity",
    databaseName: "company_acme_identity",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { hrAccessEnforcement: { mode: "OFF" } },
  });
  globex = await Company.create({
    companyName: "Globex Identity",
    slug: "globex-identity",
    databaseName: "company_globex_identity",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { hrAccessEnforcement: { mode: "OFF" } },
  });

  const passwordHash = await hashPassword(PASSWORD);
  const acmeModels = await getCompanyModels(acme);
  const globexModels = await getCompanyModels(globex);
  await createCompanyAdmin(acmeModels.User, {
    email: "ca@acme-identity.test",
    fullName: "Acme Company Admin",
    passwordHash,
    isActive: true,
  });
  await createCompanyAdmin(globexModels.User, {
    email: "ca@globex-identity.test",
    fullName: "Globex Company Admin",
    passwordHash,
    isActive: true,
  });

  caCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-identity",
      email: "ca@acme-identity.test",
      password: PASSWORD,
    })
  );
  globexCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "globex-identity",
      email: "ca@globex-identity.test",
      password: PASSWORD,
    })
  );
  assert.ok(caCookie);
  assert.ok(globexCookie);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("portal operator employee identity linking", () => {
  it("creates an HR Admin employee profile on invitation acceptance and keeps HR_ADMIN", async () => {
    const models = await getCompanyModels(acme);
    const beforeEmployees = await models.Employee.countDocuments();
    const enforcementBefore = (await Company.findById(acme)).config.hrAccessEnforcement.mode;

    const invite = await request(app)
      .post("/api/company-admin/hr-admins/invite")
      .set("Cookie", caCookie)
      .send({ fullName: "Identity HR", email: "hr@acme-identity.test" });
    assert.equal(invite.status, 201, invite.body?.message);
    assert.equal(await models.Employee.countDocuments(), beforeEmployees);
    const invited = await models.User.findOne({ email: "hr@acme-identity.test" });
    assert.equal(invited.role, USER_ROLES.HR_ADMIN);
    assert.equal(invited.employeeId, null);
    invited.hrAccess = {
      version: 1,
      employeeScope: { mode: "COMPANY" },
      permissions: ["dashboard.view", "people.view"],
    };
    await invited.save();

    const complete = await request(app).post("/api/auth/onboarding/complete").send({
      token: tokenFrom(invite.body.inviteLink),
      password: PASSWORD,
    });
    assert.equal(complete.status, 201, complete.body?.message);
    assert.equal(complete.body.user.role, USER_ROLES.HR_ADMIN);
    assert.equal(JSON.stringify(complete.body).includes("passwordHash"), false);

    const user = await models.User.findOne({ email: "hr@acme-identity.test" });
    const employee = await models.Employee.findOne({ email: "hr@acme-identity.test" });
    assert.equal(user.role, USER_ROLES.HR_ADMIN);
    assert.equal(user.isActive, true);
    assert.ok(user.employeeId);
    assert.equal(String(employee.userId), String(user._id));
    assert.equal(String(user.employeeId), String(employee._id));
    assert.equal(employee.job.reportingManagerId, null);
    assert.deepEqual(user.hrAccess.permissions, ["dashboard.view", "people.view"]);
    assert.equal(await models.User.countDocuments({ email: "hr@acme-identity.test" }), 1);
    assert.equal(await models.Employee.countDocuments({ email: "hr@acme-identity.test" }), 1);

    const listed = await request(app)
      .get("/api/company-admin/hr-admins")
      .set("Cookie", caCookie);
    assert.equal(listed.status, 200);
    const row = listed.body.items.find((item) => item.email === "hr@acme-identity.test");
    assert.equal(row.employeeProfile.employeeCode, employee.employeeCode);
    assert.equal(JSON.stringify(listed.body).includes("passwordHash"), false);
    assert.equal(
      (await Company.findById(acme)).config.hrAccessEnforcement.mode,
      enforcementBefore
    );
  });

  it("links a Company Admin employment profile without changing COMPANY_ADMIN or requiring a manager", async () => {
    const saved = await request(app)
      .put("/api/company-admin/me/employee-profile")
      .set("Cookie", caCookie)
      .send({
        fullName: "Acme Company Admin",
        employeeCode: "CA-001",
        jobTitle: "Managing Director",
        department: "Leadership",
        jobGrade: "L1",
        joiningDate: "2024-01-15",
        reportingManagerId: null,
        status: "ACTIVE",
      });
    assert.equal(saved.status, 200, saved.body?.message);
    assert.equal(saved.body.role, USER_ROLES.COMPANY_ADMIN);
    assert.equal(saved.body.employeeProfile.employeeCode, "CA-001");
    assert.equal(saved.body.employeeProfile.reportingManagerId, null);
    assert.equal(JSON.stringify(saved.body).includes("passwordHash"), false);

    const models = await getCompanyModels(acme);
    const user = await models.User.findOne({ email: "ca@acme-identity.test" }).lean();
    const employee = await models.Employee.findById(user.employeeId).lean();
    assert.equal(user.role, USER_ROLES.COMPANY_ADMIN);
    assert.equal(String(employee.userId), String(user._id));
    assert.equal(employee.job.jobTitle, "Managing Director");
    assert.equal(employee.job.department, "Leadership");
    assert.equal(employee.job.jobGrade, "L1");
    assert.equal(employee.job.reportingManagerId, null);
    assert.equal(employee.status, EMPLOYEE_STATUSES.ACTIVE);
  });

  it("leaves an existing consistent link unchanged and does not create a second profile", async () => {
    const models = await getCompanyModels(acme);
    const before = await models.User.findOne({ email: "ca@acme-identity.test" }).lean();
    const beforeEmployee = await models.Employee.findById(before.employeeId).lean();

    const again = await request(app)
      .put("/api/company-admin/me/employee-profile")
      .set("Cookie", caCookie)
      .send({});
    assert.equal(again.status, 200, again.body?.message);
    assert.equal(again.body.created, false);
    assert.equal(again.body.employeeProfile.id, String(before.employeeId));

    const after = await models.User.findOne({ email: "ca@acme-identity.test" }).lean();
    const afterEmployee = await models.Employee.findById(after.employeeId).lean();
    assert.equal(after.role, USER_ROLES.COMPANY_ADMIN);
    assert.equal(String(after.employeeId), String(before.employeeId));
    assert.equal(afterEmployee.employeeCode, beforeEmployee.employeeCode);
    assert.equal(afterEmployee.job.jobTitle, beforeEmployee.job.jobTitle);
    assert.equal(await models.Employee.countDocuments({ email: "ca@acme-identity.test" }), 1);
    assert.equal(await models.User.countDocuments({ email: "ca@acme-identity.test" }), 1);
  });

  it("rejects a duplicate employee code and a conflicting link without writing either side", async () => {
    const models = await getCompanyModels(acme);
    await models.Employee.create({
      employeeCode: "TAKEN-1",
      fullName: "Someone Else",
      email: "someone@acme-identity.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
    });

    const invite = await request(app)
      .post("/api/company-admin/hr-admins/invite")
      .set("Cookie", caCookie)
      .send({ fullName: "Second HR", email: "hr2@acme-identity.test" });
    assert.equal(invite.status, 201, invite.body?.message);
    const hrId = invite.body.hrAdmin.id;

    const duplicateHr = await request(app)
      .put(`/api/company-admin/hr-admins/${hrId}/employee-profile`)
      .set("Cookie", caCookie)
      .send({ employeeCode: "TAKEN-1", fullName: "Second HR" });
    assert.equal(duplicateHr.status, 409);
    assert.equal(duplicateHr.body.code, "DUPLICATE_EMPLOYEE_CODE");
    const pending = await models.User.findById(hrId).lean();
    assert.equal(pending.role, USER_ROLES.HR_ADMIN);
    assert.equal(pending.employeeId, null);
    assert.equal(await models.Employee.countDocuments({ email: "hr2@acme-identity.test" }), 0);

    const profileA = await models.Employee.create({
      employeeCode: "LINK-A",
      fullName: "Profile A",
      email: "profile-a@acme-identity.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
    });
    const profileB = await models.Employee.create({
      employeeCode: "LINK-B",
      fullName: "Second HR",
      email: "hr2@acme-identity.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      userId: hrId,
    });
    await models.User.updateOne({ _id: hrId }, { $set: { employeeId: profileA._id } });

    await assert.rejects(
      () =>
        linkPortalOperatorEmployee({
          models,
          company: acme,
          user: hrId,
          profile: {},
          updateEmployment: false,
        }),
      (error) => error.code === "IDENTITY_LINK_CONFLICT"
    );

    const userAfter = await models.User.findById(hrId).lean();
    const aAfter = await models.Employee.findById(profileA._id).lean();
    const bAfter = await models.Employee.findById(profileB._id).lean();
    assert.equal(String(userAfter.employeeId), String(profileA._id));
    assert.equal(userAfter.role, USER_ROLES.HR_ADMIN);
    assert.equal(aAfter.userId ?? null, null);
    assert.equal(String(bAfter.userId), String(hrId));
  });

  it("rolls back a new employee profile when saving the user link fails", async () => {
    const models = await getCompanyModels(acme);
    const passwordHash = await hashPassword(PASSWORD);
    const hr = await models.User.create({
      email: "hr-rollback@acme-identity.test",
      fullName: "Rollback HR",
      passwordHash,
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });
    const originalSave = models.User.prototype.save;
    models.User.prototype.save = async function saveAndFail(...args) {
      if (this.employeeId) {
        throw new Error("forced user save failure");
      }
      return originalSave.apply(this, args);
    };

    try {
      await assert.rejects(() =>
        linkPortalOperatorEmployee({
          models,
          company: acme,
          user: hr._id,
          profile: { employeeCode: "ROLL-1" },
          updateEmployment: false,
        })
      );
    } finally {
      models.User.prototype.save = originalSave;
    }

    const fresh = await models.User.findById(hr._id).lean();
    assert.equal(fresh.role, USER_ROLES.HR_ADMIN);
    assert.equal(fresh.employeeId, null);
    assert.equal(await models.Employee.countDocuments({ userId: hr._id }), 0);
    assert.equal(await models.Employee.countDocuments({ employeeCode: "ROLL-1" }), 0);
  });

  it("completes a pre-existing employee profile that has no login link", async () => {
    const models = await getCompanyModels(acme);
    const passwordHash = await hashPassword(PASSWORD);
    const hr = await models.User.create({
      email: "hr-existing@acme-identity.test",
      fullName: "Existing Profile HR",
      passwordHash,
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });
    const existing = await models.Employee.create({
      employeeCode: "PRE-1",
      fullName: "Existing Profile HR",
      email: "hr-existing@acme-identity.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "HR Manager", department: "People" },
    });

    const linked = await linkPortalOperatorEmployee({
      models,
      company: acme,
      user: hr._id,
      profile: {},
      updateEmployment: false,
    });
    assert.equal(linked.created, false);
    assert.equal(linked.role, USER_ROLES.HR_ADMIN);
    assert.equal(linked.employeeProfile.id, String(existing._id));
    assert.equal(linked.employeeProfile.jobTitle, "HR Manager");

    const user = await models.User.findById(hr._id).lean();
    const employee = await models.Employee.findById(existing._id).lean();
    assert.equal(String(user.employeeId), String(existing._id));
    assert.equal(String(employee.userId), String(hr._id));
    assert.equal(await models.Employee.countDocuments({ email: hr.email }), 1);
  });

  it("keeps tenant employee profiles isolated", async () => {
    const acmeModels = await getCompanyModels(acme);
    const hr = await acmeModels.User.findOne({ email: "hr@acme-identity.test" }).lean();
    const before = await acmeModels.Employee.countDocuments();

    const cross = await request(app)
      .put(`/api/company-admin/hr-admins/${hr._id}/employee-profile`)
      .set("Cookie", globexCookie)
      .send({ jobTitle: "Should Not Apply" });
    assert.equal(cross.status, 404);

    const employee = await acmeModels.Employee.findOne({ email: "hr@acme-identity.test" }).lean();
    assert.notEqual(employee.job.jobTitle, "Should Not Apply");
    assert.equal(await acmeModels.Employee.countDocuments(), before);
    const globexModels = await getCompanyModels(globex);
    assert.equal(await globexModels.Employee.countDocuments({ email: "hr@acme-identity.test" }), 0);
  });

  it("still provisions an ordinary employee and refuses to demote a linked HR Admin", async () => {
    const created = await request(app)
      .post("/api/employees")
      .set("Cookie", caCookie)
      .send({
        fullName: "Ordinary Employee",
        email: "employee@acme-identity.test",
        employeeCode: "EMP-100",
      });
    assert.equal(created.status, 201, created.body?.message);

    const models = await getCompanyModels(acme);
    const employeeUser = await models.User.findOne({ email: "employee@acme-identity.test" }).lean();
    assert.equal(employeeUser.role, USER_ROLES.EMPLOYEE);
    assert.ok(employeeUser.employeeId);

    const demoteLinked = await request(app)
      .post("/api/employees")
      .set("Cookie", caCookie)
      .send({
        fullName: "Identity HR",
        email: "hr@acme-identity.test",
        employeeCode: "EMP-HR",
      });
    assert.equal(demoteLinked.status, 409);
    assert.equal(demoteLinked.body.code, "DUPLICATE_EMPLOYEE_EMAIL");

    const passwordHash = await hashPassword(PASSWORD);
    await models.User.create({
      email: "hr-unlinked@acme-identity.test",
      fullName: "Unlinked HR",
      passwordHash,
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });
    const demoteUnlinked = await request(app)
      .post("/api/employees")
      .set("Cookie", caCookie)
      .send({
        fullName: "Unlinked HR",
        email: "hr-unlinked@acme-identity.test",
        employeeCode: "EMP-HR-2",
      });
    assert.equal(demoteUnlinked.status, 409);
    assert.equal(demoteUnlinked.body.code, "EMAIL_OWNED_BY_HR_ADMIN");

    const hr = await models.User.findOne({ email: "hr@acme-identity.test" }).lean();
    const unlinked = await models.User.findOne({ email: "hr-unlinked@acme-identity.test" }).lean();
    assert.equal(hr.role, USER_ROLES.HR_ADMIN);
    assert.equal(unlinked.role, USER_ROLES.HR_ADMIN);
    assert.equal(unlinked.employeeId ?? null, null);
    assert.equal(await models.User.countDocuments({ email: "hr@acme-identity.test" }), 1);
    assert.equal(await models.Employee.countDocuments({ email: "hr@acme-identity.test" }), 1);
    assert.equal(await models.Employee.countDocuments({ email: "hr-unlinked@acme-identity.test" }), 0);
  });
});
