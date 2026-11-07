process.env.NODE_ENV = "test";
process.env.MONGOMS_MD5_CHECK = "0";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CANDIDATE_SIGNATURE_FIELDS, HR_SIGNATURE_LETTERHEAD } from "./helpers/offerSignature.js";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { getCentralDbName, getCompanyModels, disconnectAll } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import { emailService } from "../services/emailService.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { encryptSecret } from "../utils/secretCrypto.js";

let mongod;
let app;
let companyAcme;
let companyGlobex;
let hrCookieAcme;
let hrCookieGlobex;
let OfferLetterAcme;
let AuditLogAcme;
let EmployeeAcme;

function cookieFrom(res) {
  const cookieHeader = res.headers["set-cookie"];
  if (!cookieHeader) return "";
  return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
}

async function createDraft(cookie, overrides = {}) {
  const res = await request(app)
    .post("/api/offer-letters")
    .set("Cookie", cookie)
    .send({
      candidate: {
        fullName: overrides.fullName || "Withdrawal Candidate",
        email: overrides.email || `withdraw.${Date.now()}@example.test`,
      },
      position: overrides.position || "Engineer",
      department: "Engineering",
      workLocation: "Remote",
      employmentType: "Full-time Permanent",
      monthlySalary: 80000,
      joiningDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      clauses: [],
    });
  assert.equal(res.status, 201, res.body?.message || "create failed");
  return res.body.offerLetter;
}

async function sendOffer(cookie, offerId) {
  const res = await request(app)
    .post(`/api/offer-letters/${offerId}/send`)
    .set("Cookie", cookie);
  assert.equal(res.status, 200, res.body?.message || "send failed");
  return res.body;
}

describe("P1A: Offer letter withdrawal lifecycle", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "offer_withdrawal_test_jwt_secret_12345!";
    process.env.COOKIE_SECRET = "offer_withdrawal_test_cookie_secret_12345!";
    process.env.CENTRAL_DB_NAME = "central_offer_withdrawal_test";
    process.env.CLIENT_URL = "http://localhost:5173";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    companyAcme = await Company.create({
      letterhead: HR_SIGNATURE_LETTERHEAD,
      companyName: "Acme Withdrawal Ltd",
      slug: "acme-wd",
      databaseName: "tenant_acme_withdrawal",
      status: COMPANY_STATUSES.ACTIVE,
      emailSettings: {
        fromName: "Acme HR",
        fromEmail: "hr@acme-wd.test",
        smtpHost: "smtp.acme.test",
        smtpPort: 587,
        smtpSecure: false,
        appPasswordEncrypted: encryptSecret("mock-offer-pass-1234"),
        isConfigured: true,
        lastVerifiedAt: new Date(),
      },
    });

    companyGlobex = await Company.create({
      letterhead: HR_SIGNATURE_LETTERHEAD,
      companyName: "Globex Withdrawal Corp",
      slug: "globex-wd",
      databaseName: "tenant_globex_withdrawal",
      status: COMPANY_STATUSES.ACTIVE,
      emailSettings: {
        fromName: "Globex HR",
        fromEmail: "hr@globex-wd.test",
        smtpHost: "smtp.globex.test",
        smtpPort: 587,
        smtpSecure: false,
        appPasswordEncrypted: encryptSecret("mock-globex-pass"),
        isConfigured: true,
        lastVerifiedAt: new Date(),
      },
    });

    emailService.setTransporter({
      sendMail: async () => ({ messageId: `msg_${Date.now()}` }),
      verify: async () => true,
    });

    const acmeModels = await getCompanyModels(companyAcme);
    OfferLetterAcme = acmeModels.OfferLetter;
    AuditLogAcme = acmeModels.AuditLog;
    EmployeeAcme = acmeModels.Employee;
    await acmeModels.User.create({
      email: "hr@acme-wd.test",
      passwordHash: await hashPassword("AcmeHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    const globexModels = await getCompanyModels(companyGlobex);
    await globexModels.User.create({
      email: "hr@globex-wd.test",
      passwordHash: await hashPassword("GlobexHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    const acmeLogin = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "acme-wd", email: "hr@acme-wd.test", password: "AcmeHrSecret123!" });
    assert.equal(acmeLogin.status, 200);
    hrCookieAcme = cookieFrom(acmeLogin);

    const globexLogin = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "globex-wd", email: "hr@globex-wd.test", password: "GlobexHrSecret123!" });
    assert.equal(globexLogin.status, 200);
    hrCookieGlobex = cookieFrom(globexLogin);
  });

  after(async () => {
    await disconnectAll();
    if (mongod) await mongod.stop();
  });

  beforeEach(() => {
    emailService.setSimulateFailure(false);
  });

  it("sent unsigned offer can be withdrawn with reason and audit", async () => {
    const draft = await createDraft(hrCookieAcme, { email: "ok.withdraw@example.test" });
    const sent = await sendOffer(hrCookieAcme, draft._id);
    const priorContent = (await OfferLetterAcme.findById(draft._id)).content;
    const priorEmailHistory = (await OfferLetterAcme.findById(draft._id)).emailDelivery?.history || [];

    const res = await request(app)
      .post(`/api/offer-letters/${draft._id}/withdraw`)
      .set("Cookie", hrCookieAcme)
      .send({ reason: "Role filled internally" });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.offerLetter.status, OFFER_LETTER_STATUSES.WITHDRAWN);
    assert.equal(res.body.offerLetter.withdrawal.reason, "Role filled internally");
    assert.ok(res.body.offerLetter.withdrawal.withdrawnAt);
    assert.equal(res.body.offerLetter.withdrawal.withdrawnByEmail, "hr@acme-wd.test");

    const inDb = await OfferLetterAcme.findById(draft._id).select("+signingTokenEncrypted");
    assert.equal(inDb.status, OFFER_LETTER_STATUSES.WITHDRAWN);
    assert.equal(inDb.signingTokenHash, null);
    assert.equal(inDb.signingTokenEncrypted, null);
    assert.equal(inDb.content, priorContent);
    assert.deepEqual(
      (inDb.emailDelivery?.history || []).map((h) => h.messageId),
      priorEmailHistory.map((h) => h.messageId)
    );

    const audit = await AuditLogAcme.findOne({
      action: AUDIT_ACTIONS.OFFER_LETTER_WITHDRAWN,
      targetId: draft._id,
    }).lean();
    assert.ok(audit);
    assert.equal(audit.changes?.reason, "Role filled internally");
    assert.equal(sent.signingToken != null, true);
  });

  it("draft delete behavior remains unchanged; draft cannot be withdrawn", async () => {
    const draft = await createDraft(hrCookieAcme, { email: "draft.only@example.test" });

    const withdrawRes = await request(app)
      .post(`/api/offer-letters/${draft._id}/withdraw`)
      .set("Cookie", hrCookieAcme)
      .send({ reason: "Not needed" });
    assert.equal(withdrawRes.status, 400);
    assert.match(withdrawRes.body.message, /draft/i);

    const deleteRes = await request(app)
      .delete(`/api/offer-letters/${draft._id}`)
      .set("Cookie", hrCookieAcme);
    assert.equal(deleteRes.status, 200);
    assert.equal(await OfferLetterAcme.findById(draft._id), null);
  });

  it("signed/accepted offer cannot be ordinarily withdrawn", async () => {
    const draft = await createDraft(hrCookieAcme, { email: "signed.block@example.test" });
    await sendOffer(hrCookieAcme, draft._id);

    const offer = await OfferLetterAcme.findById(draft._id);
    offer.status = OFFER_LETTER_STATUSES.ACCEPTED;
    offer.decisionAt = new Date();
    offer.signature = {
      signerName: "Signed Candidate",
      signerEmail: "signed.block@example.test",
      signedAt: new Date(),
      documentHash: "abc",
    };
    await offer.save();

    const res = await request(app)
      .post(`/api/offer-letters/${draft._id}/withdraw`)
      .set("Cookie", hrCookieAcme)
      .send({ reason: "Changed mind" });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /accepted|signed/i);

    const still = await OfferLetterAcme.findById(draft._id);
    assert.equal(still.status, OFFER_LETTER_STATUSES.ACCEPTED);
    assert.ok(still.signature?.signedAt);
  });

  it("withdrawn offer cannot be signed and candidate portal shows withdrawn", async () => {
    const draft = await createDraft(hrCookieAcme, { email: "portal.wd@example.test" });
    const sent = await sendOffer(hrCookieAcme, draft._id);
    const token = sent.signingToken;

    await request(app)
      .post(`/api/offer-letters/${draft._id}/withdraw`)
      .set("Cookie", hrCookieAcme)
      .send({ reason: "Budget freeze" });

    const review = await request(app).get(`/api/candidate/offers/review/${encodeURIComponent(token)}`);
    assert.equal(review.status, 200);
    assert.equal(review.body.alreadyWithdrawn, true);
    assert.equal(review.body.offer.status, OFFER_LETTER_STATUSES.WITHDRAWN);
    assert.equal(review.body.offer.decisionNotes, "");
    assert.equal(Object.hasOwn(review.body.offer, "withdrawal"), false);

    const accept = await request(app)
      .post(`/api/candidate/offers/review/${encodeURIComponent(token)}/accept`)
      .send({ fullName: "Portal Candidate", legalConsent: true, ...CANDIDATE_SIGNATURE_FIELDS });
    assert.ok(accept.status === 400 || accept.status === 409);
    assert.match(accept.body.message, /withdrawn/i);

    const after = await OfferLetterAcme.findById(draft._id);
    assert.equal(after.status, OFFER_LETTER_STATUSES.WITHDRAWN);
  });

  it("repeated withdrawal is safely handled", async () => {
    const draft = await createDraft(hrCookieAcme, { email: "repeat.wd@example.test" });
    await sendOffer(hrCookieAcme, draft._id);

    const first = await request(app)
      .post(`/api/offer-letters/${draft._id}/withdraw`)
      .set("Cookie", hrCookieAcme)
      .send({ reason: "First withdrawal" });
    assert.equal(first.status, 200);

    const second = await request(app)
      .post(`/api/offer-letters/${draft._id}/withdraw`)
      .set("Cookie", hrCookieAcme)
      .send({ reason: "Second attempt" });
    assert.equal(second.status, 200);
    assert.equal(second.body.alreadyWithdrawn, true);
    assert.equal(second.body.offerLetter.withdrawal.reason, "First withdrawal");
  });

  it("concurrent signing and withdrawal cannot both succeed", async () => {
    const draft = await createDraft(hrCookieAcme, { email: "race.wd@example.test" });
    const sent = await sendOffer(hrCookieAcme, draft._id);
    const token = sent.signingToken;

    const [withdrawRes, acceptRes] = await Promise.all([
      request(app)
        .post(`/api/offer-letters/${draft._id}/withdraw`)
        .set("Cookie", hrCookieAcme)
        .send({ reason: "Race withdraw" }),
      request(app)
        .post(`/api/candidate/offers/review/${encodeURIComponent(token)}/accept`)
        .send({ fullName: "Race Candidate", legalConsent: true, ...CANDIDATE_SIGNATURE_FIELDS }),
    ]);

    const final = await OfferLetterAcme.findById(draft._id);
    const terminal = [OFFER_LETTER_STATUSES.WITHDRAWN, OFFER_LETTER_STATUSES.ACCEPTED];
    assert.ok(terminal.includes(final.status), `unexpected status ${final.status}`);

    if (final.status === OFFER_LETTER_STATUSES.WITHDRAWN) {
      assert.equal(withdrawRes.status, 200);
      assert.ok(acceptRes.status >= 400);
      assert.equal(final.signature?.signedAt == null, true);
    } else {
      assert.equal(acceptRes.status, 200);
      assert.ok(withdrawRes.status >= 400 || withdrawRes.body.alreadyWithdrawn !== true);
      assert.notEqual(final.status, OFFER_LETTER_STATUSES.WITHDRAWN);
      assert.ok(final.signature?.signedAt);
    }
  });

  it("tenant isolation: Globex cannot withdraw Acme offer", async () => {
    const draft = await createDraft(hrCookieAcme, { email: "tenant.wd@example.test" });
    await sendOffer(hrCookieAcme, draft._id);

    const res = await request(app)
      .post(`/api/offer-letters/${draft._id}/withdraw`)
      .set("Cookie", hrCookieGlobex)
      .send({ reason: "Cross-tenant attempt" });

    assert.ok(res.status === 404 || res.status === 403);
    const still = await OfferLetterAcme.findById(draft._id);
    assert.equal(still.status, OFFER_LETTER_STATUSES.SENT);
  });

  it("withdrawal does not delete employee or alter linked employee records", async () => {
    const draft = await createDraft(hrCookieAcme, { email: "employee.link@example.test" });
    await sendOffer(hrCookieAcme, draft._id);

    const employee = await EmployeeAcme.create({
      fullName: "Existing Employee",
      email: "existing.employee.wd@example.test",
      employeeCode: "EMP-WD-1",
      status: "ACTIVE",
      joiningDate: new Date(),
    });

    const offer = await OfferLetterAcme.findById(draft._id);
    offer.employeeId = employee._id;
    await offer.save();

    const res = await request(app)
      .post(`/api/offer-letters/${draft._id}/withdraw`)
      .set("Cookie", hrCookieAcme)
      .send({ reason: "Should be blocked" });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /employee/i);

    const stillEmployee = await EmployeeAcme.findById(employee._id);
    assert.ok(stillEmployee);
    assert.equal(stillEmployee.email, "existing.employee.wd@example.test");

    const stillOffer = await OfferLetterAcme.findById(draft._id);
    assert.equal(stillOffer.status, OFFER_LETTER_STATUSES.SENT);
    assert.equal(String(stillOffer.employeeId), String(employee._id));
  });

  it("active list hides withdrawn; WITHDRAWN filter returns them", async () => {
    const draft = await createDraft(hrCookieAcme, {
      email: "list.hide@example.test",
      fullName: "List Hide Candidate",
    });
    await sendOffer(hrCookieAcme, draft._id);
    await request(app)
      .post(`/api/offer-letters/${draft._id}/withdraw`)
      .set("Cookie", hrCookieAcme)
      .send({ reason: "Hide from active" });

    const active = await request(app)
      .get("/api/offer-letters?limit=100")
      .set("Cookie", hrCookieAcme);
    assert.equal(active.status, 200);
    assert.ok(!active.body.offerLetters.some((o) => o._id === draft._id || String(o._id) === String(draft._id)));

    const filtered = await request(app)
      .get("/api/offer-letters?status=WITHDRAWN&limit=100")
      .set("Cookie", hrCookieAcme);
    assert.equal(filtered.status, 200);
    const found = filtered.body.offerLetters.find((o) => String(o._id) === String(draft._id));
    assert.ok(found);
    assert.equal(found.status, OFFER_LETTER_STATUSES.WITHDRAWN);
    assert.equal(found.withdrawal?.reason, "Hide from active");

    const summary = await request(app)
      .get("/api/offer-letters/summary")
      .set("Cookie", hrCookieAcme);
    assert.ok(summary.body.summary.withdrawn >= 1);
  });

  it("requires a withdrawal reason", async () => {
    const draft = await createDraft(hrCookieAcme, { email: "reason.required@example.test" });
    await sendOffer(hrCookieAcme, draft._id);

    const res = await request(app)
      .post(`/api/offer-letters/${draft._id}/withdraw`)
      .set("Cookie", hrCookieAcme)
      .send({ reason: "ab" });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /reason/i);
  });
});
