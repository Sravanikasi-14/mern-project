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
import { encryptSecret } from "../utils/secretCrypto.js";
import { provisionTenantDatabase } from "../services/tenantProvisioningService.js";

let mongod;
let app;
let company;
let hrCookie;

function cookieFrom(res) {
  const cookieHeader = res.headers["set-cookie"];
  if (!cookieHeader) return "";
  return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
}

function offerBody(name, email, extra = {}) {
  return {
    candidate: { fullName: name, email },
    position: "Platform Engineer",
    department: "Engineering",
    monthlySalary: 100000,
    joiningDate: new Date(Date.now() + 14 * 86400000).toISOString(),
    ...extra,
  };
}

async function createOffer(name, email, extra) {
  const res = await request(app)
    .post("/api/offer-letters")
    .set("Cookie", hrCookie)
    .send(offerBody(name, email, extra));
  assert.equal(res.status, 201, res.body?.message);
  return res.body.offerLetter;
}

async function sendOffer(id) {
  return request(app)
    .post(`/api/offer-letters/${id}/send`)
    .set("Cookie", hrCookie)
    .send({});
}

describe("Phase 4B: standard offer template, letterhead and issued-document freeze", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "offer_standard_template_jwt_secret_12345!";
    process.env.COOKIE_SECRET = "offer_standard_template_cookie_secret_12345!";
    process.env.CENTRAL_DB_NAME = "central_offer_standard_test";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    company = await Company.create({
      letterhead: HR_SIGNATURE_LETTERHEAD,
      companyName: "Zenith Standard Works",
      slug: "zenith",
      databaseName: "tenant_zenith_standard_offers",
      status: COMPANY_STATUSES.ACTIVE,
      emailSettings: {
        fromName: "Zenith HR",
        fromEmail: "hr@zenith-std.test",
        smtpHost: "smtp.zenith.test",
        smtpPort: 587,
        smtpSecure: false,
        appPasswordEncrypted: encryptSecret("mock-offer-pass-1234"),
        isConfigured: true,
        lastVerifiedAt: new Date(),
      },
    });

    emailService.setTransporter({
      sendMail: async () => ({ messageId: `msg_${Date.now()}` }),
      verify: async () => true,
    });

    const { User } = await getCompanyModels(company);
    await User.create({
      email: "hr@zenith-std.test",
      passwordHash: await hashPassword("ZenithHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    const login = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "zenith", email: "hr@zenith-std.test", password: "ZenithHrSecret123!" });
    assert.equal(login.status, 200);
    hrCookie = cookieFrom(login);
  });

  after(async () => {
    await disconnectAll();
    if (mongod) await mongod.stop();
  });

  beforeEach(() => {
    emailService.setSimulateFailure(false);
  });

  it("1. letterhead settings can be saved and read back", async () => {
    const put = await request(app)
      .put("/api/settings/company")
      .set("Cookie", hrCookie)
      .send({
        letterhead: {
          address: "12 Innovation Park\nBengaluru 560001",
          website: "www.zenith-std.test",
          signatoryName: "Asha Rao",
          signatoryTitle: "Director, People",
        },
      });
    assert.equal(put.status, 200, put.body?.message);

    const get = await request(app).get("/api/settings/company").set("Cookie", hrCookie);
    assert.equal(get.status, 200);
    const lh = get.body.company?.letterhead || get.body.data?.letterhead;
    assert.ok(lh, "letterhead should be returned");
    assert.match(lh.address, /Innovation Park/);
    assert.match(lh.website, /zenith-std\.test/);
    assert.equal(lh.signatoryName, "Asha Rao");
    assert.equal(lh.signatoryTitle, "Director, People");
  });

  it("2. preview and create without templateId use the standard master HTML", async () => {
    const preview = await request(app)
      .post("/api/offer-letters/preview")
      .set("Cookie", hrCookie)
      .send({
        ...offerBody("Preview Person", "preview.person@example.test"),
        templateId: new mongoose.Types.ObjectId().toString(),
        signatoryName: "Override Signer",
      });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.templateId, null);
    assert.match(preview.body.html, /OFFER LETTER/);
    assert.match(preview.body.html, /Zenith Standard Works/);
    assert.match(preview.body.html, /Override Signer/);

    const offer = await createOffer("Standard Person", "standard.person@example.test", {
      templateId: new mongoose.Types.ObjectId().toString(),
    });
    assert.equal(offer.status, OFFER_LETTER_STATUSES.DRAFT);
    assert.equal(offer.templateId ?? null, null);
    assert.equal(offer.templateVersion ?? null, null);
    assert.equal(offer.templateType ?? null, null);
    assert.match(offer.content, /OFFER LETTER|Zenith Standard Works/);
    assert.match(offer.content, /Innovation Park/);
    assert.match(offer.content, /Asha Rao/);
    assert.ok(offer.offerDataSnapshot);
  });

  it("3. first send freezes issuedContent and resend keeps it identical", async () => {
    const offer = await createOffer("Freeze Person", "freeze.person@example.test");
    const { OfferLetter } = await getCompanyModels(company);

    const draft = await OfferLetter.findById(offer._id).lean();
    assert.ok(!draft.issuedContent);

    const first = await sendOffer(offer._id);
    assert.equal(first.status, 200, first.body?.message);
    assert.equal(first.body.offerLetter.status, OFFER_LETTER_STATUSES.SENT);

    const afterFirst = await OfferLetter.findById(offer._id).lean();
    assert.ok(afterFirst.issuedContent && afterFirst.issuedContent.length > 500);
    assert.equal(afterFirst.issuedContent, afterFirst.content);
    assert.ok(afterFirst.offerDataSnapshot);

    const resend = await sendOffer(offer._id);
    assert.equal(resend.status, 200, resend.body?.message);
    const afterResend = await OfferLetter.findById(offer._id).lean();
    assert.equal(afterResend.issuedContent, afterFirst.issuedContent);
    assert.equal(afterResend.emailDelivery.attempts, 2);
  });

  it("4. letterhead change after send does not change issuedContent, resend, or PDF source", async () => {
    const offer = await createOffer("Immutable Person", "immutable.person@example.test");
    const first = await sendOffer(offer._id);
    assert.equal(first.status, 200, first.body?.message);

    const { OfferLetter } = await getCompanyModels(company);
    const frozen = (await OfferLetter.findById(offer._id).lean()).issuedContent;
    assert.match(frozen, /Asha Rao/);

    const put = await request(app)
      .put("/api/settings/company")
      .set("Cookie", hrCookie)
      .send({
        letterhead: {
          address: "999 Totally New Street",
          website: "https://new-site.test",
          signatoryName: "New Signer",
          signatoryTitle: "CEO",
        },
      });
    assert.equal(put.status, 200);

    const resend = await sendOffer(offer._id);
    assert.equal(resend.status, 200, resend.body?.message);

    const after = await OfferLetter.findById(offer._id).lean();
    assert.equal(after.issuedContent, frozen);
    assert.doesNotMatch(after.issuedContent, /Totally New Street/);
    assert.doesNotMatch(after.issuedContent, /New Signer/);

    // Candidate review shows frozen text
    const review = await request(app).get(
      `/api/candidate/offers/review/${resend.body.signingToken}`
    );
    assert.equal(review.status, 200);
    assert.equal(review.body.offer.content, frozen);

    // A brand-new offer picks up the new letterhead
    const fresh = await createOffer("Fresh Person", "fresh.person@example.test");
    assert.match(fresh.content, /Totally New Street/);
    assert.match(fresh.content, /New Signer/);

    // Restore original letterhead for later tests
    await request(app)
      .put("/api/settings/company")
      .set("Cookie", hrCookie)
      .send({
        letterhead: {
          address: "12 Innovation Park\nBengaluru 560001",
          website: "www.zenith-std.test",
          signatoryName: "Asha Rao",
          signatoryTitle: "Director, People",
        },
      });
  });

  it("5. candidate acceptance keeps issuedContent unchanged and stores the signature separately", async () => {
    const offer = await createOffer("Sign Person", "sign.person@example.test");
    const sent = await sendOffer(offer._id);
    assert.equal(sent.status, 200, sent.body?.message);

    const { OfferLetter } = await getCompanyModels(company);
    const frozen = (await OfferLetter.findById(offer._id).lean()).issuedContent;

    const accept = await request(app)
      .post(`/api/candidate/offers/review/${sent.body.signingToken}/accept`)
      .send({ fullName: "Sign Person", legalConsent: true, ...CANDIDATE_SIGNATURE_FIELDS });
    assert.equal(accept.status, 200, accept.body?.message);

    const accepted = await OfferLetter.findById(offer._id).lean();
    assert.equal(accepted.status, OFFER_LETTER_STATUSES.ACCEPTED);
    assert.equal(accepted.issuedContent, frozen);
    assert.equal(accepted.content, frozen);
    assert.equal(accepted.signature.signerName, "Sign Person");
    assert.ok(accepted.signature.documentHash);
  });

  it("6. failed SMTP does not set SENT but keeps the draft sendable", async () => {
    const offer = await createOffer("Smtp Fail", "smtp.fail@example.test");
    emailService.setSimulateFailure(true);
    const failed = await sendOffer(offer._id);
    assert.equal(failed.status, 502);

    const { OfferLetter } = await getCompanyModels(company);
    const doc = await OfferLetter.findById(offer._id);
    assert.equal(doc.status, OFFER_LETTER_STATUSES.DRAFT);
    assert.equal(doc.emailDelivery.status, "DELIVERY_FAILED");
    assert.equal(doc.signingTokenHash, null);

    emailService.setSimulateFailure(false);
    const retry = await sendOffer(offer._id);
    assert.equal(retry.status, 200, retry.body?.message);
    assert.equal(retry.body.offerLetter.status, OFFER_LETTER_STATUSES.SENT);
  });

  it("7. editing a draft after a failed first send re-renders and invalidates the stale freeze", async () => {
    const offer = await createOffer("Edit After Fail", "edit.after.fail@example.test");
    emailService.setSimulateFailure(true);
    const failed = await sendOffer(offer._id);
    assert.equal(failed.status, 502);

    const upd = await request(app)
      .put(`/api/offer-letters/${offer._id}`)
      .set("Cookie", hrCookie)
      .send({ position: "Principal Engineer", signatoryName: "Edited Signer" });
    assert.equal(upd.status, 200, upd.body?.message);
    assert.match(upd.body.offerLetter.content, /Principal Engineer/);
    assert.match(upd.body.offerLetter.content, /Edited Signer/);

    emailService.setSimulateFailure(false);
    const ok = await sendOffer(offer._id);
    assert.equal(ok.status, 200, ok.body?.message);
    const { OfferLetter } = await getCompanyModels(company);
    const doc = await OfferLetter.findById(offer._id).lean();
    assert.match(doc.issuedContent, /Principal Engineer/);
  });

  it("8. PDF download works from frozen content for sent offers", async () => {
    const offer = await createOffer("Pdf Person", "pdf.person@example.test");
    const sent = await sendOffer(offer._id);
    assert.equal(sent.status, 200);
    const pdf = await request(app)
      .get(`/api/offer-letters/${offer._id}/pdf`)
      .set("Cookie", hrCookie);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers["content-type"], "application/pdf");
    assert.ok(pdf.body.length > 100);
  });

  it("9. provisioning does not seed offer_templates documents", async () => {
    const fresh = await Company.create({
      companyName: "Provision Only Co",
      slug: "provonly",
      databaseName: "tenant_provonly_standard_offers",
      status: COMPANY_STATUSES.ACTIVE,
    });
    const models = await getCompanyModels(fresh);
    const outcome = await provisionTenantDatabase(fresh, models.connection);
    assert.ok(outcome);
    const count = await models.connection.db.collection("offer_templates").countDocuments();
    assert.equal(count, 0);

    // Idempotent re-run
    await provisionTenantDatabase(fresh, models.connection);
    const again = await models.connection.db.collection("offer_templates").countDocuments();
    assert.equal(again, 0);
  });

  it("10. /api/offer-templates is no longer mounted", async () => {
    const res = await request(app).get("/api/offer-templates").set("Cookie", hrCookie);
    assert.equal(res.status, 404);
  });
});
