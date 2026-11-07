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
import { USER_ROLES, ONBOARDING_STATUSES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import { emailService } from "../services/emailService.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { encryptSecret } from "../utils/secretCrypto.js";
import { approveAllSections } from "./helpers/onboardingReview.js";

let mongod;
let app;
let companyAcme;
let companyGlobex;
let hrCookieAcme;
let hrCookieGlobex;

function cookieFrom(res) {
  const cookieHeader = res.headers["set-cookie"];
  if (!cookieHeader) return "";
  return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
}

async function createAndSendOffer(cookie, email) {
  const createRes = await request(app)
    .post("/api/offer-letters")
    .set("Cookie", cookie)
    .send({
      candidate: { fullName: "Continuity Candidate", email },
      position: "Product Analyst",
      department: "Product",
      workLocation: "Hyderabad",
      employmentType: "Full-time Permanent",
      monthlySalary: 90000,
      joiningDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      clauses: [],
    });
  assert.equal(createRes.status, 201, createRes.body?.message);
  const offerId = createRes.body.offerLetter._id;
  const sendRes = await request(app)
    .post(`/api/offer-letters/${offerId}/send`)
    .set("Cookie", cookie);
  assert.equal(sendRes.status, 200, sendRes.body?.message);
  return { offerId, signingToken: sendRes.body.signingToken };
}

async function minimalOnboardingPayload() {
  return {
    personalDetails: {
      fullName: "Continuity Candidate",
      phoneNumber: "+91 9876543210",
      dateOfBirth: "1995-01-15",
      gender: "Female",
    },
    residentialAddress: {
      street: "12 MG Road",
      city: "Hyderabad",
      state: "Telangana",
      postalCode: "500001",
      country: "India",
    },
    emergencyContact: {
      name: "Parent Candidate",
      relationship: "Parent",
      phone: "+91 9123456780",
    },
    bankDetails: {
      accountHolderName: "Continuity Candidate",
      accountNumber: "123456789012",
      ifscCode: "HDFC0001234",
      bankName: "HDFC Bank",
    },
    taxDetails: {
      panNumber: "ABCDE1234F",
    },
    identityDetails: {
      panNumber: "ABCDE1234F",
      aadhaarNumber: "123412341234",
    },
  };
}

async function uploadIdProof(onboardingToken) {
  const fileData =
    "data:application/pdf;base64," +
    Buffer.from("%PDF-1.4 continuity id proof").toString("base64");
  const res = await request(app)
    .post(`/api/candidate/onboarding/${onboardingToken}/documents`)
    .send({
      documentType: "ID_PROOF",
      title: "PAN Card",
      fileName: "pan_card.pdf",
      fileData,
      mimeType: "application/pdf",
    });
  assert.equal(res.status, 201, res.body?.message);
  return res.body;
}

describe("P1B: Offer-to-onboarding continuity", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "offer_onboarding_continuity_jwt_secret_12345!";
    process.env.COOKIE_SECRET = "offer_onboarding_continuity_cookie_secret_12345!";
    process.env.CENTRAL_DB_NAME = "central_offer_onboarding_continuity";
    process.env.CLIENT_URL = "http://localhost:5173";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    companyAcme = await Company.create({
      letterhead: HR_SIGNATURE_LETTERHEAD,
      companyName: "Acme Continuity Ltd",
      slug: "acme-cont",
      databaseName: "tenant_acme_continuity",
      status: COMPANY_STATUSES.ACTIVE,
      emailSettings: {
        fromName: "Acme HR",
        fromEmail: "hr@acme-cont.test",
        smtpHost: "smtp.acme.test",
        smtpPort: 587,
        smtpSecure: false,
        appPasswordEncrypted: encryptSecret("mock-pass"),
        isConfigured: true,
        lastVerifiedAt: new Date(),
      },
    });

    companyGlobex = await Company.create({
      letterhead: HR_SIGNATURE_LETTERHEAD,
      companyName: "Globex Continuity Corp",
      slug: "globex-cont",
      databaseName: "tenant_globex_continuity",
      status: COMPANY_STATUSES.ACTIVE,
    });

    emailService.setTransporter({
      sendMail: async () => ({ messageId: `msg_${Date.now()}` }),
      verify: async () => true,
    });

    const { User: UserAcme } = await getCompanyModels(companyAcme);
    await UserAcme.create({
      email: "hr@acme-cont.test",
      passwordHash: await hashPassword("AcmeHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    const { User: UserGlobex } = await getCompanyModels(companyGlobex);
    await UserGlobex.create({
      email: "hr@globex-cont.test",
      passwordHash: await hashPassword("GlobexHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    const acmeLogin = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "acme-cont", email: "hr@acme-cont.test", password: "AcmeHrSecret123!" });
    assert.equal(acmeLogin.status, 200);
    hrCookieAcme = cookieFrom(acmeLogin);

    const globexLogin = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "globex-cont", email: "hr@globex-cont.test", password: "GlobexHrSecret123!" });
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

  it("candidate signing does not create an Employee", async () => {
    const { signingToken } = await createAndSendOffer(hrCookieAcme, "no.emp@example.test");
    const accept = await request(app)
      .post(`/api/candidate/offers/review/${signingToken}/accept`)
      .send({ fullName: "Continuity Candidate", legalConsent: true, ...CANDIDATE_SIGNATURE_FIELDS });
    assert.equal(accept.status, 200);

    const { Employee, User } = await getCompanyModels(companyAcme);
    assert.equal(await Employee.countDocuments({ email: "no.emp@example.test" }), 0);
    const user = await User.findOne({ email: "no.emp@example.test" });
    assert.ok(user);
    assert.equal(user.role, USER_ROLES.CANDIDATE);
    assert.equal(user.onboarding.status, ONBOARDING_STATUSES.DRAFT);
  });

  it("offer review after signing returns onboarding continuation that survives refresh", async () => {
    const { offerId, signingToken } = await createAndSendOffer(hrCookieAcme, "refresh.cta@example.test");
    const accept = await request(app)
      .post(`/api/candidate/offers/review/${signingToken}/accept`)
      .send({ fullName: "Continuity Candidate", legalConsent: true, ...CANDIDATE_SIGNATURE_FIELDS });
    assert.equal(accept.status, 200);
    assert.ok(accept.body.onboardingToken);
    const firstToken = accept.body.onboardingToken;

    // Simulated page refresh: GET offer review again with the original signing JWT
    const refresh = await request(app).get(`/api/candidate/offers/review/${signingToken}`);
    assert.equal(refresh.status, 200);
    assert.equal(refresh.body.alreadySigned, true);
    assert.ok(refresh.body.onboardingToken);
    assert.ok(refresh.body.onboardingLink);
    assert.equal(refresh.body.onboardingStatus, ONBOARDING_STATUSES.DRAFT);
    assert.match(refresh.body.onboardingLink, /\/candidate\/onboarding\//);

    // Re-issued token must work for onboarding GET (existing email token may rotate)
    const onboard = await request(app).get(
      `/api/candidate/onboarding/${refresh.body.onboardingToken}`
    );
    assert.equal(onboard.status, 200);
    assert.equal(onboard.body.onboarding.status, ONBOARDING_STATUSES.DRAFT);

    // Original accept token may be rotated; either still works or new token works
    const firstStill = await request(app).get(`/api/candidate/onboarding/${firstToken}`);
    assert.ok(firstStill.status === 200 || firstStill.status === 400);

    // Offer deep-link filter for HR
    const filtered = await request(app)
      .get(`/api/onboarding/submissions?offerId=${offerId}`)
      .set("Cookie", hrCookieAcme);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.submissions.length, 1);
    assert.equal(String(filtered.body.submissions[0].offerLetterId?._id || filtered.body.submissions[0].offerLetterId), String(offerId));
  });

  it("existing accept-issued onboarding token works before refresh rotation", async () => {
    const { signingToken } = await createAndSendOffer(hrCookieAcme, "legacy.token@example.test");
    const accept = await request(app)
      .post(`/api/candidate/offers/review/${signingToken}/accept`)
      .send({ fullName: "Continuity Candidate", legalConsent: true, ...CANDIDATE_SIGNATURE_FIELDS });
    assert.equal(accept.status, 200);
    const res = await request(app).get(`/api/candidate/onboarding/${accept.body.onboardingToken}`);
    assert.equal(res.status, 200);
  });

  it("draft save, submit, corrections, resubmit, approve once, resend activation by submission id", async () => {
    const { offerId, signingToken } = await createAndSendOffer(hrCookieAcme, "full.flow@example.test");
    const accept = await request(app)
      .post(`/api/candidate/offers/review/${signingToken}/accept`)
      .send({ fullName: "Continuity Candidate", legalConsent: true, ...CANDIDATE_SIGNATURE_FIELDS });
    assert.equal(accept.status, 200);
    let onboardingToken = accept.body.onboardingToken;
    const onboardingId = accept.body.onboardingId || accept.body.userId;

    const draft = await request(app)
      .put(`/api/candidate/onboarding/${onboardingToken}/draft`)
      .send(await minimalOnboardingPayload());
    assert.equal(draft.status, 200);
    await uploadIdProof(onboardingToken);

    // Resume after "leaving" portal via offer review refresh continuity
    const refresh = await request(app).get(`/api/candidate/offers/review/${signingToken}`);
    onboardingToken = refresh.body.onboardingToken;
    const resume = await request(app).get(`/api/candidate/onboarding/${onboardingToken}`);
    assert.equal(resume.status, 200);
    assert.equal(resume.body.onboarding.personalDetails?.phoneNumber, "+91 9876543210");

    const submit = await request(app).post(`/api/candidate/onboarding/${onboardingToken}/submit`);
    assert.equal(submit.status, 200, JSON.stringify(submit.body));
    assert.equal(submit.body.onboarding.status, ONBOARDING_STATUSES.SUBMITTED);

    const corrections = await request(app)
      .post(`/api/onboarding/submissions/${onboardingId}/request-corrections`)
      .set("Cookie", hrCookieAcme)
      .send({ reason: "Please correct emergency contact phone." });
    assert.equal(corrections.status, 200);
    if (corrections.body.onboardingToken) {
      onboardingToken = corrections.body.onboardingToken;
    } else {
      // Prefer latest from offer review continuity
      const again = await request(app).get(`/api/candidate/offers/review/${signingToken}`);
      onboardingToken = again.body.onboardingToken;
    }

    const fix = await request(app)
      .put(`/api/candidate/onboarding/${onboardingToken}/draft`)
      .send({
        emergencyContact: {
          name: "Parent Candidate",
          relationship: "Parent",
          phone: "+91 9000000001",
        },
      });
    assert.equal(fix.status, 200);

    const resubmit = await request(app).post(`/api/candidate/onboarding/${onboardingToken}/submit`);
    assert.equal(resubmit.status, 200);
    assert.equal(resubmit.body.onboarding.status, ONBOARDING_STATUSES.SUBMITTED);

    const { Employee } = await getCompanyModels(companyAcme);
    const beforeCount = await Employee.countDocuments({ email: "full.flow@example.test" });

    await approveAllSections(app, hrCookieAcme, onboardingId);

    const approve = await request(app)
      .post(`/api/onboarding/submissions/${onboardingId}/approve`)
      .set("Cookie", hrCookieAcme);
    assert.equal(approve.status, 200, approve.body?.message);
    assert.equal(approve.body.employee, null);

    // Final HR approval must NOT create an Employee
    const afterApprove = await Employee.countDocuments({ email: "full.flow@example.test" });
    assert.equal(afterApprove, beforeCount);

    const dup = await request(app)
      .post(`/api/onboarding/submissions/${onboardingId}/approve`)
      .set("Cookie", hrCookieAcme);
    assert.equal(dup.status, 409);
    assert.equal(await Employee.countDocuments({ email: "full.flow@example.test" }), afterApprove);

    // Resend using submission (User) id — works with no Employee yet (the UI contract)
    emailService.clearHistory();
    const resend = await request(app)
      .post(`/api/onboarding/submissions/${onboardingId}/resend-activation`)
      .set("Cookie", hrCookieAcme);
    assert.equal(resend.status, 200, resend.body?.message);
    assert.equal(resend.body.success, true);
    assert.equal(resend.body.deliverySuccess, true);
    assert.equal(await Employee.countDocuments({ email: "full.flow@example.test" }), afterApprove);

    const history = emailService.getHistory();
    const activation = history.find((e) => e.type === "employee_activation");
    assert.ok(activation);

    // Tenant isolation on offer filter + resend
    const foreign = await request(app)
      .get(`/api/onboarding/submissions?offerId=${offerId}`)
      .set("Cookie", hrCookieGlobex);
    assert.equal(foreign.status, 200);
    assert.equal(foreign.body.submissions.length, 0);

    const foreignResend = await request(app)
      .post(`/api/onboarding/submissions/${onboardingId}/resend-activation`)
      .set("Cookie", hrCookieGlobex);
    assert.equal(foreignResend.status, 404);
  });

  it("failed activation email remains retryable without duplicating employees", async () => {
    const { signingToken } = await createAndSendOffer(hrCookieAcme, "retry.act@example.test");
    const accept = await request(app)
      .post(`/api/candidate/offers/review/${signingToken}/accept`)
      .send({ fullName: "Continuity Candidate", legalConsent: true, ...CANDIDATE_SIGNATURE_FIELDS });
    const onboardingToken = accept.body.onboardingToken;
    const onboardingId = accept.body.onboardingId;

    await request(app)
      .put(`/api/candidate/onboarding/${onboardingToken}/draft`)
      .send(await minimalOnboardingPayload());
    await uploadIdProof(onboardingToken);
    const submitted = await request(app).post(`/api/candidate/onboarding/${onboardingToken}/submit`);
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));

    await approveAllSections(app, hrCookieAcme, onboardingId);
    const approve = await request(app)
      .post(`/api/onboarding/submissions/${onboardingId}/approve`)
      .set("Cookie", hrCookieAcme);
    assert.equal(approve.status, 200, approve.body?.message);

    const { Employee } = await getCompanyModels(companyAcme);
    const count = await Employee.countDocuments({ email: "retry.act@example.test" });
    assert.equal(count, 0);

    emailService.setSimulateFailure(true);
    const failed = await request(app)
      .post(`/api/onboarding/submissions/${onboardingId}/resend-activation`)
      .set("Cookie", hrCookieAcme);
    // Endpoint still returns 200 with deliverySuccess false, or surfaces failure — either is retryable
    assert.ok(failed.status === 200 || failed.status >= 400);
    assert.equal(await Employee.countDocuments({ email: "retry.act@example.test" }), count);

    emailService.setSimulateFailure(false);
    const retry = await request(app)
      .post(`/api/onboarding/submissions/${onboardingId}/resend-activation`)
      .set("Cookie", hrCookieAcme);
    assert.equal(retry.status, 200);
    assert.equal(await Employee.countDocuments({ email: "retry.act@example.test" }), count);
  });
});
