process.env.NODE_ENV = "test";
process.env.MONGOMS_MD5_CHECK = "0";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
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
import { encryptSecret } from "../utils/secretCrypto.js";

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

describe("Stage 1: Offer Letter Email Delivery & Safety Module", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "offer_email_delivery_test_jwt_secret_12345!";
    process.env.COOKIE_SECRET = "offer_email_delivery_test_cookie_secret_12345!";
    process.env.CENTRAL_DB_NAME = "central_offer_email_test";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    // 1. Create Acme Company with configured SMTP credentials
    companyAcme = await Company.create({
      companyName: "Acme Innovations Ltd",
      slug: "acme",
      databaseName: "tenant_acme_email_offers",
      status: COMPANY_STATUSES.ACTIVE,
      emailSettings: {
        fromName: "Acme HR",
        fromEmail: "hr@acme-inno.test",
        smtpHost: "smtp.acme.test",
        smtpPort: 587,
        smtpSecure: false,
        appPasswordEncrypted: encryptSecret("mock-offer-pass-1234"),
        isConfigured: true,
        lastVerifiedAt: new Date(),
      },
    });

    // Mock SMTP delivery for automated test safety
    emailService.setTransporter({
      sendMail: async (options) => ({ messageId: `msg_${Date.now()}` }),
      verify: async () => true,
    });

    // 2. Create Globex Company (unconfigured email for tenant isolation and config testing)
    companyGlobex = await Company.create({
      companyName: "Globex Global Corp",
      slug: "globex",
      databaseName: "tenant_globex_email_offers",
      status: COMPANY_STATUSES.ACTIVE,
    });

    // Setup Acme HR Admin
    const { User: UserAcme } = await getCompanyModels(companyAcme);
    await UserAcme.create({
      email: "hr@acme-inno.test",
      passwordHash: await hashPassword("AcmeHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    // Setup Globex HR Admin
    const { User: UserGlobex } = await getCompanyModels(companyGlobex);
    await UserGlobex.create({
      email: "hr@globex-global.test",
      passwordHash: await hashPassword("GlobexHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    // Login Acme HR
    const acmeLogin = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "acme", email: "hr@acme-inno.test", password: "AcmeHrSecret123!" });
    assert.equal(acmeLogin.status, 200);
    hrCookieAcme = cookieFrom(acmeLogin);

    // Login Globex HR
    const globexLogin = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "globex", email: "hr@globex-global.test", password: "GlobexHrSecret123!" });
    assert.equal(globexLogin.status, 200);
    hrCookieGlobex = cookieFrom(globexLogin);
  });

  after(async () => {
    await disconnectAll();
    if (mongod) {
      await mongod.stop();
    }
  });

  beforeEach(() => {
    emailService.setSimulateFailure(false);
  });

  it("1. A valid offer letter draft can be emailed to a candidate with status updated to SENT", async () => {
    // Create draft offer
    const createRes = await request(app)
      .post("/api/offer-letters")
      .set("Cookie", hrCookieAcme)
      .send({
        candidate: {
          fullName: "Priya Sharma",
          email: "priya.sharma@example.test",
        },
        position: "Senior Full Stack Engineer",
        department: "Engineering",
        monthlySalary: 125000,
        joiningDate: new Date(Date.now() + 14 * 86400000).toISOString(),
      });

    assert.equal(createRes.status, 201);
    const offerId = createRes.body.offerLetter._id;
    assert.equal(createRes.body.offerLetter.status, OFFER_LETTER_STATUSES.DRAFT);

    // Send offer letter email
    const sendRes = await request(app)
      .post(`/api/offer-letters/${offerId}/send`)
      .set("Cookie", hrCookieAcme)
      .send({});

    assert.equal(sendRes.status, 200);
    assert.equal(sendRes.body.success, true);
    assert.ok(sendRes.body.message.includes("priya.sharma@example.test"));

    const updatedOffer = sendRes.body.offerLetter;
    assert.equal(updatedOffer.status, OFFER_LETTER_STATUSES.SENT);
    assert.ok(updatedOffer.emailedAt);
    assert.ok(updatedOffer.emailDelivery);
    assert.equal(updatedOffer.emailDelivery.status, "SENT");
    assert.equal(updatedOffer.emailDelivery.sentTo, "priya.sharma@example.test");
    assert.equal(updatedOffer.emailDelivery.attempts, 1);
    assert.equal(updatedOffer.emailDelivery.history.length, 1);
  });

  it("2. Rejects sending an offer if candidate email address is missing or invalid", async () => {
    const { OfferLetter: OfferLetterAcme } = await getCompanyModels(companyAcme);

    const badOffer = await OfferLetterAcme.create({
      candidate: {
        fullName: "Incomplete Candidate",
        email: "incomplete@example.test",
      },
      position: "Junior Analyst",
      monthlySalary: 45000,
      joiningDate: new Date(),
      content: "<div>Draft</div>",
    });

    // Manually set invalid email to simulate corrupt or invalid data
    badOffer.candidate.email = "not-an-email";
    await badOffer.save({ validateBeforeSave: false });

    const sendRes = await request(app)
      .post(`/api/offer-letters/${badOffer._id}/send`)
      .set("Cookie", hrCookieAcme)
      .send({});

    assert.equal(sendRes.status, 400);
    assert.ok(sendRes.body.message.includes("email"));
  });

  it("3. Simulated SMTP failure does NOT falsely mark the offer as SENT and records delivery failure", async () => {
    // Create draft offer
    const createRes = await request(app)
      .post("/api/offer-letters")
      .set("Cookie", hrCookieAcme)
      .send({
        candidate: {
          fullName: "Rohan Patel",
          email: "rohan.patel@example.test",
        },
        position: "Product Designer",
        department: "Design",
        monthlySalary: 95000,
        joiningDate: new Date(Date.now() + 20 * 86400000).toISOString(),
      });

    const offerId = createRes.body.offerLetter._id;

    // Simulate failure
    emailService.setSimulateFailure(true);

    const sendRes = await request(app)
      .post(`/api/offer-letters/${offerId}/send`)
      .set("Cookie", hrCookieAcme)
      .send({});

    assert.equal(sendRes.status, 502);
    assert.equal(sendRes.body.success, false);

    // Verify database state: status must remain DRAFT
    const { OfferLetter: OfferLetterAcme } = await getCompanyModels(companyAcme);
    const offerInDb = await OfferLetterAcme.findById(offerId);

    assert.equal(offerInDb.status, OFFER_LETTER_STATUSES.DRAFT);
    assert.equal(offerInDb.emailDelivery.status, "DELIVERY_FAILED");
    assert.ok(offerInDb.emailDelivery.error.includes("simulated delivery failure"));
    assert.equal(offerInDb.emailDelivery.attempts, 1);
  });

  it("4. Retrying a failed send works safely, updates status to SENT, and preserves history", async () => {
    const { OfferLetter: OfferLetterAcme } = await getCompanyModels(companyAcme);
    const failedOffer = await OfferLetterAcme.findOne({
      "candidate.email": "rohan.patel@example.test",
    });

    assert.ok(failedOffer);
    assert.equal(failedOffer.emailDelivery.status, "DELIVERY_FAILED");

    // Re-enable email service
    emailService.setSimulateFailure(false);

    const retryRes = await request(app)
      .post(`/api/offer-letters/${failedOffer._id}/send`)
      .set("Cookie", hrCookieAcme)
      .send({});

    assert.equal(retryRes.status, 200);
    assert.equal(retryRes.body.success, true);
    assert.equal(retryRes.body.offerLetter.status, OFFER_LETTER_STATUSES.SENT);
    assert.equal(retryRes.body.offerLetter.emailDelivery.status, "SENT");
    assert.equal(retryRes.body.offerLetter.emailDelivery.attempts, 2);
    assert.equal(retryRes.body.offerLetter.emailDelivery.history.length, 2);
    assert.equal(retryRes.body.offerLetter.emailDelivery.history[0].status, "DELIVERY_FAILED");
    assert.equal(retryRes.body.offerLetter.emailDelivery.history[1].status, "SENT");
  });

  it("5. Terminal offers (ACCEPTED or REJECTED) cannot be sent or resent", async () => {
    const { OfferLetter: OfferLetterAcme } = await getCompanyModels(companyAcme);
    const acceptedOffer = await OfferLetterAcme.create({
      candidate: {
        fullName: "Ananya Roy",
        email: "ananya.roy@example.test",
      },
      position: "QA Lead",
      monthlySalary: 110000,
      joiningDate: new Date(),
      content: "<div>Content</div>",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
    });

    const sendRes = await request(app)
      .post(`/api/offer-letters/${acceptedOffer._id}/send`)
      .set("Cookie", hrCookieAcme)
      .send({});

    assert.equal(sendRes.status, 400);
    assert.ok(sendRes.body.message.includes("ACCEPTED"));
  });

  it("6. Tenant isolation: HR of company Globex cannot send an offer belonging to company Acme", async () => {
    const { OfferLetter: OfferLetterAcme } = await getCompanyModels(companyAcme);
    const acmeOffer = await OfferLetterAcme.findOne({
      "candidate.email": "priya.sharma@example.test",
    });

    assert.ok(acmeOffer);

    // Globex HR attempts to send Acme offer
    const crossRes = await request(app)
      .post(`/api/offer-letters/${acmeOffer._id}/send`)
      .set("Cookie", hrCookieGlobex)
      .send({});

    assert.equal(crossRes.status, 404);
    assert.ok(crossRes.body.message.includes("not found"));
  });

  it("7. Existing Save Draft, Preview, and Download PDF functionality still works seamlessly", async () => {
    // 1. Live preview
    const previewRes = await request(app)
      .post("/api/offer-letters/preview")
      .set("Cookie", hrCookieAcme)
      .send({
        candidate: { fullName: "Test Preview", email: "preview@test.com" },
        position: "DevOps Engineer",
        monthlySalary: 130000,
      });

    assert.equal(previewRes.status, 200);
    assert.ok(previewRes.body.html.includes("DevOps Engineer"));

    // 2. Create draft
    const draftRes = await request(app)
      .post("/api/offer-letters")
      .set("Cookie", hrCookieAcme)
      .send({
        candidate: { fullName: "Draft Candidate", email: "draft@test.com" },
        position: "DevOps Engineer",
        monthlySalary: 130000,
        joiningDate: new Date().toISOString(),
      });

    assert.equal(draftRes.status, 201);
    const draftId = draftRes.body.offerLetter._id;

    // 3. Download PDF
    const pdfRes = await request(app)
      .get(`/api/offer-letters/${draftId}/pdf`)
      .set("Cookie", hrCookieAcme);

    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers["content-type"], "application/pdf");
    assert.ok(pdfRes.body.length > 0);
  });

  it("8. Sending offer letter fails with 502 configuration error if company email is unconfigured", async () => {
    // Globex has no emailSettings configured
    const draftRes = await request(app)
      .post("/api/offer-letters")
      .set("Cookie", hrCookieGlobex)
      .send({
        candidate: { fullName: "Globex Candidate", email: "globex.cand@example.test" },
        position: "Security Analyst",
        department: "Security",
        monthlySalary: 80000,
        joiningDate: new Date().toISOString(),
      });

    assert.equal(draftRes.status, 201);
    const offerId = draftRes.body.offerLetter._id;

    // Attempt to send without custom mock
    emailService.setTransporter(null);

    const sendRes = await request(app)
      .post(`/api/offer-letters/${offerId}/send`)
      .set("Cookie", hrCookieGlobex)
      .send({});

    assert.equal(sendRes.status, 502);
    assert.equal(sendRes.body.success, false);
    assert.ok(sendRes.body.message.toLowerCase().includes("not configured"));

    // Reset mock for following tests
    emailService.setTransporter({
      sendMail: async () => ({ messageId: `msg_${Date.now()}` }),
      verify: async () => true,
    });
  });
});
