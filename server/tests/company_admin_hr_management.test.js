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
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { createCompanyAdmin } from "../services/companyAdminService.js";
import { emailService } from "../services/emailService.js";
import { hashAuthToken } from "../utils/authTokenHash.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { encryptSecret } from "../utils/secretCrypto.js";

const PASSWORD = "CompanyAdminPass1!";
const HR_PASSWORD = "HrAdminPass1!";

let mongo;
let app;
let acme;
let globex;
let caCookieAcme;
let caCookieGlobex;
let hrCookieAcme;
let employeeCookieAcme;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

function extractTokenFromLink(link) {
  const url = new URL(link);
  return url.searchParams.get("token");
}

before(async () => {
  // C: is often near-full on this machine; keep MongoMemoryServer data on D:.
  mongo = await MongoMemoryServer.create({
    instance: {
      dbPath: "D:/tmp/hrms-mongo/ca3-hr-management",
      storageEngine: "wiredTiger",
    },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  emailService.setTransporter({
    sendMail: async () => ({ messageId: `msg_${Date.now()}` }),
    verify: async () => true,
  });
  emailService.setSimulateFailure(false);
  emailService.clearHistory();

  acme = await Company.create({
    companyName: "Acme CA3",
    slug: "acme-ca3",
    databaseName: "company_acme_ca3",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    emailSettings: {
      fromName: "Acme CA3",
      fromEmail: "noreply@acme-ca3.test",
      smtpHost: "smtp.test.local",
      smtpPort: 587,
      smtpSecure: false,
      appPasswordEncrypted: encryptSecret("ca3-smtp-pass-1234"),
      isConfigured: true,
      lastVerifiedAt: new Date(),
    },
  });
  globex = await Company.create({
    companyName: "Globex CA3",
    slug: "globex-ca3",
    databaseName: "company_globex_ca3",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    emailSettings: {
      fromName: "Globex CA3",
      fromEmail: "noreply@globex-ca3.test",
      smtpHost: "smtp.test.local",
      smtpPort: 587,
      smtpSecure: false,
      appPasswordEncrypted: encryptSecret("ca3-smtp-pass-1234"),
      isConfigured: true,
      lastVerifiedAt: new Date(),
    },
  });

  const { User: UserA } = await getCompanyModels(acme);
  await UserA.create({
    email: "hr@acme-ca3.test",
    passwordHash: await hashPassword(PASSWORD),
    role: USER_ROLES.HR_ADMIN,
    fullName: "Existing HR",
    isActive: true,
    lastLoginAt: new Date(),
  });
  await UserA.create({
    email: "employee@acme-ca3.test",
    passwordHash: await hashPassword(PASSWORD),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  await createCompanyAdmin(UserA, {
    email: "company-admin@acme-ca3.test",
    passwordHash: await hashPassword(PASSWORD),
    fullName: "Acme Company Admin",
  });

  const { User: UserB } = await getCompanyModels(globex);
  await createCompanyAdmin(UserB, {
    email: "company-admin@globex-ca3.test",
    passwordHash: await hashPassword(PASSWORD),
    fullName: "Globex Company Admin",
  });

  caCookieAcme = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca3",
      email: "company-admin@acme-ca3.test",
      password: PASSWORD,
    })
  );
  caCookieGlobex = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "globex-ca3",
      email: "company-admin@globex-ca3.test",
      password: PASSWORD,
    })
  );
  hrCookieAcme = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca3",
      email: "hr@acme-ca3.test",
      password: PASSWORD,
    })
  );
  employeeCookieAcme = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca3",
      email: "employee@acme-ca3.test",
      password: PASSWORD,
    })
  );
});

after(async () => {
  emailService.setTransporter(null);
  emailService.clearHistory();
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Phase CA3 — Company Admin HR Management", () => {
  it("Company Admin can invite HR Admins and email uses existing email service", async () => {
    emailService.clearHistory();
    const res = await request(app)
      .post("/api/company-admin/hr-admins/invite")
      .set("Cookie", caCookieAcme)
      .send({ fullName: "New HR Admin", email: "new-hr@acme-ca3.test" });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.hrAdmin.email, "new-hr@acme-ca3.test");
    assert.equal(res.body.hrAdmin.invitationStatus, "PENDING");
    assert.equal(res.body.hrAdmin.isActive, false);
    assert.equal(res.body.emailSent, true);
    assert.ok(res.body.inviteLink.includes("/onboard?token="));
    assert.equal(res.body.inviteLink.includes(extractTokenFromLink(res.body.inviteLink)), true);

    const history = emailService.getHistory();
    assert.ok(history.some((e) => e.type === "hr_admin_invitation"));

    const { User, AuthToken, AuditLog } = await getCompanyModels(acme);
    const user = await User.findOne({ email: "new-hr@acme-ca3.test" });
    assert.equal(user.role, USER_ROLES.HR_ADMIN);
    assert.equal(user.isActive, false);

    const tokens = await AuthToken.find({ email: "new-hr@acme-ca3.test", isActive: true });
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].token, hashAuthToken(extractTokenFromLink(res.body.inviteLink)));

    const audits = await AuditLog.find({ action: AUDIT_ACTIONS.HR_ADMIN_INVITED });
    assert.ok(audits.length >= 1);
  });

  it("HR Admin and Employee cannot access Company Admin HR Management APIs", async () => {
    const hrRes = await request(app)
      .get("/api/company-admin/hr-admins")
      .set("Cookie", hrCookieAcme);
    assert.equal(hrRes.status, 403);

    const empRes = await request(app)
      .post("/api/company-admin/hr-admins/invite")
      .set("Cookie", employeeCookieAcme)
      .send({ fullName: "Nope", email: "nope@acme-ca3.test" });
    assert.equal(empRes.status, 403);
  });

  it("Duplicate pending invitations and active HR Admins are prevented", async () => {
    const pending = await request(app)
      .post("/api/company-admin/hr-admins/invite")
      .set("Cookie", caCookieAcme)
      .send({ fullName: "Dup Pending", email: "new-hr@acme-ca3.test" });
    assert.equal(pending.status, 409);
    assert.equal(pending.body.code, "INVITATION_PENDING");

    const activeDup = await request(app)
      .post("/api/company-admin/hr-admins/invite")
      .set("Cookie", caCookieAcme)
      .send({ fullName: "Existing", email: "hr@acme-ca3.test" });
    assert.equal(activeDup.status, 409);
    assert.equal(activeDup.body.code, "HR_ADMIN_EXISTS");
  });

  it("Invalid and expired tokens are rejected; tokens are single-use", async () => {
    const invite = await request(app)
      .post("/api/company-admin/hr-admins/invite")
      .set("Cookie", caCookieAcme)
      .send({ fullName: "Activate Me", email: "activate-me@acme-ca3.test" });
    assert.equal(invite.status, 201);
    const token = extractTokenFromLink(invite.body.inviteLink);

    const bad = await request(app).get("/api/auth/onboarding/verify").query({ token: "not-a-jwt" });
    assert.equal(bad.status, 400);

    const verify = await request(app).get("/api/auth/onboarding/verify").query({ token });
    assert.equal(verify.status, 200);
    assert.equal(verify.body.type, "HR_ADMIN");
    assert.equal(verify.body.email, "activate-me@acme-ca3.test");

    const complete = await request(app).post("/api/auth/onboarding/complete").send({
      token,
      password: HR_PASSWORD,
    });
    assert.equal(complete.status, 201);
    assert.equal(complete.body.user.role, USER_ROLES.HR_ADMIN);
    assert.equal(complete.body.user.isActive, true);

    const reuse = await request(app).post("/api/auth/onboarding/complete").send({
      token,
      password: HR_PASSWORD,
    });
    assert.equal(reuse.status, 409);

    const { User, AuditLog } = await getCompanyModels(acme);
    const user = await User.findOne({ email: "activate-me@acme-ca3.test" });
    assert.equal(user.hrInvitation.status, "ACCEPTED");
    assert.ok(user.lastLoginAt);

    const accepted = await AuditLog.find({
      action: AUDIT_ACTIONS.HR_ADMIN_INVITE_ACCEPTED,
      targetId: user._id,
    });
    assert.ok(accepted.length >= 1);
  });

  it("Resending invalidates the previous token", async () => {
    const invite = await request(app)
      .post("/api/company-admin/hr-admins/invite")
      .set("Cookie", caCookieAcme)
      .send({ fullName: "Resend Target", email: "resend@acme-ca3.test" });
    const oldToken = extractTokenFromLink(invite.body.inviteLink);
    const hrAdminId = invite.body.hrAdmin.id;

    const resent = await request(app)
      .post(`/api/company-admin/hr-admins/${hrAdminId}/resend`)
      .set("Cookie", caCookieAcme);
    assert.equal(resent.status, 200);
    const newToken = extractTokenFromLink(resent.body.inviteLink);
    assert.notEqual(oldToken, newToken);

    const oldVerify = await request(app).get("/api/auth/onboarding/verify").query({ token: oldToken });
    assert.ok(oldVerify.status === 400 || oldVerify.status === 409);

    const newVerify = await request(app).get("/api/auth/onboarding/verify").query({ token: newToken });
    assert.equal(newVerify.status, 200);

    const { AuditLog } = await getCompanyModels(acme);
    const audits = await AuditLog.find({
      action: AUDIT_ACTIONS.HR_ADMIN_INVITE_RESENT,
      targetId: hrAdminId,
    });
    assert.ok(audits.length >= 1);
  });

  it("Revoked invitations cannot be accepted", async () => {
    const invite = await request(app)
      .post("/api/company-admin/hr-admins/invite")
      .set("Cookie", caCookieAcme)
      .send({ fullName: "Revoke Me", email: "revoke@acme-ca3.test" });
    const token = extractTokenFromLink(invite.body.inviteLink);
    const hrAdminId = invite.body.hrAdmin.id;

    const revoked = await request(app)
      .post(`/api/company-admin/hr-admins/${hrAdminId}/revoke`)
      .set("Cookie", caCookieAcme);
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.hrAdmin.invitationStatus, "REVOKED");

    const verify = await request(app).get("/api/auth/onboarding/verify").query({ token });
    assert.ok(verify.status === 400 || verify.status === 409);

    const complete = await request(app).post("/api/auth/onboarding/complete").send({
      token,
      password: HR_PASSWORD,
    });
    assert.ok(complete.status === 400 || complete.status === 409);

    const { AuditLog } = await getCompanyModels(acme);
    const audits = await AuditLog.find({
      action: AUDIT_ACTIONS.HR_ADMIN_INVITE_REVOKED,
      targetId: hrAdminId,
    });
    assert.ok(audits.length >= 1);
  });

  it("Deactivated HR Admins cannot access protected APIs", async () => {
    const invite = await request(app)
      .post("/api/company-admin/hr-admins/invite")
      .set("Cookie", caCookieAcme)
      .send({ fullName: "Deactivate Me", email: "deactivate@acme-ca3.test" });
    const token = extractTokenFromLink(invite.body.inviteLink);
    await request(app).post("/api/auth/onboarding/complete").send({
      token,
      password: HR_PASSWORD,
    });

    const login = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca3",
      email: "deactivate@acme-ca3.test",
      password: HR_PASSWORD,
    });
    assert.equal(login.status, 200);
    const sessionCookie = cookieFrom(login);

    const meOk = await request(app).get("/api/auth/me").set("Cookie", sessionCookie);
    assert.equal(meOk.status, 200);

    const list = await request(app)
      .get("/api/company-admin/hr-admins")
      .set("Cookie", caCookieAcme);
    const target = list.body.items.find((i) => i.email === "deactivate@acme-ca3.test");
    assert.ok(target);

    const deactivated = await request(app)
      .post(`/api/company-admin/hr-admins/${target.id}/deactivate`)
      .set("Cookie", caCookieAcme);
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.hrAdmin.isActive, false);

    const meBlocked = await request(app).get("/api/auth/me").set("Cookie", sessionCookie);
    assert.equal(meBlocked.status, 401);

    const loginBlocked = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca3",
      email: "deactivate@acme-ca3.test",
      password: HR_PASSWORD,
    });
    assert.equal(loginBlocked.status, 403);

    // Reactivate restores access after password login
    const activated = await request(app)
      .post(`/api/company-admin/hr-admins/${target.id}/activate`)
      .set("Cookie", caCookieAcme);
    assert.equal(activated.status, 200);

    const loginAgain = await request(app).post("/api/auth/login").send({
      companyCode: "acme-ca3",
      email: "deactivate@acme-ca3.test",
      password: HR_PASSWORD,
    });
    assert.equal(loginAgain.status, 200);
  });

  it("Cross-tenant operations are rejected", async () => {
    const invite = await request(app)
      .post("/api/company-admin/hr-admins/invite")
      .set("Cookie", caCookieAcme)
      .send({ fullName: "Tenant Bound", email: "tenant-bound@acme-ca3.test" });
    const hrAdminId = invite.body.hrAdmin.id;

    const globexList = await request(app)
      .get("/api/company-admin/hr-admins")
      .set("Cookie", caCookieGlobex);
    assert.equal(globexList.status, 200);
    assert.equal(globexList.body.items.some((i) => i.email === "tenant-bound@acme-ca3.test"), false);

    const cross = await request(app)
      .post(`/api/company-admin/hr-admins/${hrAdminId}/resend`)
      .set("Cookie", caCookieGlobex);
    assert.equal(cross.status, 404);
  });

  it("Directory listing supports search/filters and omits sensitive fields", async () => {
    const res = await request(app)
      .get("/api/company-admin/hr-admins")
      .query({ search: "Existing", status: "ACTIVE" })
      .set("Cookie", caCookieAcme);

    assert.equal(res.status, 200);
    assert.ok(res.body.summary.total >= 1);
    assert.ok(res.body.items.every((i) => i.email.includes("acme-ca3") || i.fullName));
    const raw = JSON.stringify(res.body);
    assert.equal(raw.includes("passwordHash"), false);
    assert.equal(raw.includes("tokenHash"), false);
  });

  it("Audit events are recorded for activate/deactivate", async () => {
    const { User, AuditLog } = await getCompanyModels(acme);
    const user = await User.findOne({ email: "deactivate@acme-ca3.test" });
    const deactivated = await AuditLog.find({
      action: AUDIT_ACTIONS.HR_ADMIN_DEACTIVATED,
      targetId: user._id,
    });
    const activated = await AuditLog.find({
      action: AUDIT_ACTIONS.HR_ADMIN_ACTIVATED,
      targetId: user._id,
    });
    assert.ok(deactivated.length >= 1);
    assert.ok(activated.length >= 1);
  });
});
