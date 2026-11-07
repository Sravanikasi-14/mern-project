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
import { injectCandidateSignature, buildMasterOfferHtml } from "../assets/offer-templates/hrms-default-master.js";
import { toBuffer } from "../utils/signatureImage.js";
import { TINY_PNG_DATA_URL, CANDIDATE_SIGNATURE_FIELDS } from "./helpers/offerSignature.js";

let mongod;
let app;
let company;
let hrCookie;

const SEND_BLOCKED_MESSAGE =
  "Save your electronic signature in Settings before sending offer letters.";

function cookieFrom(res) {
  const cookieHeader = res.headers["set-cookie"];
  if (!cookieHeader) return "";
  return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
}

function offerBody(name, email) {
  return {
    candidate: { fullName: name, email },
    position: "Platform Engineer",
    department: "Engineering",
    monthlySalary: 100000,
    joiningDate: new Date(Date.now() + 14 * 86400000).toISOString(),
  };
}

async function createOffer(name, email) {
  const res = await request(app).post("/api/offer-letters").set("Cookie", hrCookie).send(offerBody(name, email));
  assert.equal(res.status, 201, res.body?.message);
  return res.body.offerLetter;
}

const sendOffer = (id) =>
  request(app).post(`/api/offer-letters/${id}/send`).set("Cookie", hrCookie).send({});

const saveHrSignature = (body) =>
  request(app).post("/api/settings/company/signature").set("Cookie", hrCookie).send(body);

const accept = (token, body) =>
  request(app).post(`/api/candidate/offers/review/${token}/accept`).send(body);

describe("Offer e-signatures: HR settings, send gate, candidate accept, signed PDF", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "offer_signature_jwt_secret_12345!";
    process.env.COOKIE_SECRET = "offer_signature_cookie_secret_12345!";
    process.env.CENTRAL_DB_NAME = "central_offer_signature_test";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    company = await Company.create({
      companyName: "Sigma Signatures Ltd",
      slug: "sigma",
      databaseName: "tenant_sigma_signatures",
      status: COMPANY_STATUSES.ACTIVE,
      emailSettings: {
        fromName: "Sigma HR",
        fromEmail: "hr@sigma-sig.test",
        smtpHost: "smtp.sigma.test",
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
      email: "hr@sigma-sig.test",
      passwordHash: await hashPassword("SigmaHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    const login = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "sigma", email: "hr@sigma-sig.test", password: "SigmaHrSecret123!" });
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

  it("1. send without an HR signature is blocked with 400 and the Settings message", async () => {
    const offer = await createOffer("No Sig Person", "no.sig@example.test");
    const res = await sendOffer(offer._id);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "HR_SIGNATURE_REQUIRED");
    assert.equal(res.body.message, SEND_BLOCKED_MESSAGE);

    const bypass = await request(app)
      .patch(`/api/offer-letters/${offer._id}/status`)
      .set("Cookie", hrCookie)
      .send({ status: "SENT" });
    assert.equal(bypass.status, 400);
    assert.equal(bypass.body.code, "HR_SIGNATURE_REQUIRED");

    const { OfferLetter } = await getCompanyModels(company);
    const doc = await OfferLetter.findById(offer._id).lean();
    assert.equal(doc.status, OFFER_LETTER_STATUSES.DRAFT);
    assert.ok(!doc.issuedContent);
  });

  it("2. settings API validates and stores the HR signature without leaking bytes", async () => {
    const before = await request(app).get("/api/settings/company").set("Cookie", hrCookie);
    assert.equal(before.status, 200);
    assert.equal(before.body.company.letterhead.hasSignature, false);
    const missing = await request(app).get("/api/settings/company/signature").set("Cookie", hrCookie);
    assert.equal(missing.status, 404);

    // Invalid inputs
    assert.equal((await saveHrSignature({ method: "NOPE" })).status, 400);
    assert.equal((await saveHrSignature({ method: "DRAW" })).status, 400);
    assert.equal(
      (await saveHrSignature({ method: "UPLOAD", fileData: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" })).status,
      400
    );
    assert.equal(
      (await saveHrSignature({ method: "UPLOAD", fileData: "data:image/png;base64,bm90LWEtcG5nLWF0LWFsbA==" })).status,
      400
    );
    const huge = `data:image/png;base64,${Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(600 * 1024, 1),
    ]).toString("base64")}`;
    const tooBig = await saveHrSignature({ method: "UPLOAD", fileData: huge });
    assert.equal(tooBig.status, 400);
    assert.match(tooBig.body.message, /500 KB/);
    assert.equal((await saveHrSignature({ method: "TYPE", typedText: "   " })).status, 400);

    const ok = await saveHrSignature({ method: "DRAW", fileData: TINY_PNG_DATA_URL, mimeType: "image/png" });
    assert.equal(ok.status, 200, ok.body?.message);
    assert.equal(ok.body.hasSignature, true);
    assert.equal(ok.body.signatureMethod, "DRAW");

    const get = await request(app).get("/api/settings/company").set("Cookie", hrCookie);
    const lh = get.body.company.letterhead;
    assert.equal(lh.hasSignature, true);
    assert.equal(lh.signatureMethod, "DRAW");
    assert.ok(lh.signatureUpdatedAt);
    assert.equal(lh.signatureData, undefined);
    assert.doesNotMatch(JSON.stringify(get.body), /iVBORw0KGgo/);

    const img = await request(app)
      .get("/api/settings/company/signature")
      .set("Cookie", hrCookie)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(img.status, 200);
    assert.equal(img.headers["content-type"], "image/png");
    assert.ok(Buffer.isBuffer(img.body) && img.body.length > 20);

    // TYPE generates an SVG so Puppeteer always has an image to embed
    const typed = await saveHrSignature({ method: "TYPE", typedText: "Asha <Rao> & Co" });
    assert.equal(typed.status, 200, typed.body?.message);
    assert.equal(typed.body.signatureTypedText, "Asha <Rao> & Co");
    const stored = await Company.findById(company._id).select("+letterhead.signatureData").lean();
    assert.equal(stored.letterhead.signatureMimeType, "image/svg+xml");
    const svg = toBuffer(stored.letterhead.signatureData).toString("utf8");
    assert.match(svg, /<svg[^>]+xmlns/);
    assert.match(svg, /Asha &lt;Rao&gt; &amp; Co/);
    assert.doesNotMatch(svg, /<Rao>/);

    // DELETE
    const del = await request(app).delete("/api/settings/company/signature").set("Cookie", hrCookie);
    assert.equal(del.status, 200);
    assert.equal(del.body.hasSignature, false);
    const after = await request(app).get("/api/settings/company").set("Cookie", hrCookie);
    assert.equal(after.body.company.letterhead.hasSignature, false);
    const gone = await request(app).get("/api/settings/company/signature").set("Cookie", hrCookie);
    assert.equal(gone.status, 404);
  });

  it("3. send freezes the HR signature image into issuedContent; later changes cannot alter it", async () => {
    const saved = await saveHrSignature({ method: "UPLOAD", fileData: TINY_PNG_DATA_URL });
    assert.equal(saved.status, 200);

    const offer = await createOffer("Frozen Sig", "frozen.sig@example.test");
    const sent = await sendOffer(offer._id);
    assert.equal(sent.status, 200, sent.body?.message);

    const { OfferLetter } = await getCompanyModels(company);
    const doc = await OfferLetter.findById(offer._id).lean();
    assert.match(doc.issuedContent, /<img class="sig-img" src="data:image\/png;base64,/);
    assert.ok(doc.offerDataSnapshot.hrSignatureDataUrl.startsWith("data:image/png;base64,"));
    const frozen = doc.issuedContent;

    // API payloads never expose the frozen signature data URL
    assert.equal(sent.body.offerLetter.offerDataSnapshot.hrSignatureDataUrl, undefined);
    const got = await request(app).get(`/api/offer-letters/${offer._id}`).set("Cookie", hrCookie);
    assert.equal(got.body.offerLetter.offerDataSnapshot.hrSignatureDataUrl, undefined);

    await request(app).delete("/api/settings/company/signature").set("Cookie", hrCookie);
    // Gate now blocks (company has no signature) but the frozen document is untouched.
    const blocked = await sendOffer(offer._id);
    assert.equal(blocked.status, 400);
    const after = await OfferLetter.findById(offer._id).lean();
    assert.equal(after.issuedContent, frozen);

    await saveHrSignature({ method: "UPLOAD", fileData: TINY_PNG_DATA_URL });
  });

  it("4. candidate accept requires a signature; issuedContent is unchanged and a signed PDF is stored separately", async () => {
    const offer = await createOffer("Accept Sig", "accept.sig@example.test");
    const sent = await sendOffer(offer._id);
    assert.equal(sent.status, 200, sent.body?.message);
    const token = sent.body.signingToken;

    const { OfferLetter } = await getCompanyModels(company);
    const before = await OfferLetter.findById(offer._id).lean();
    const frozen = before.issuedContent;

    // Missing / invalid candidate signature -> 400, offer stays SENT
    const none = await accept(token, { fullName: "Accept Sig", legalConsent: true });
    assert.equal(none.status, 400);
    assert.match(none.body.message, /signature method/i);
    const noImage = await accept(token, { fullName: "Accept Sig", legalConsent: true, signatureMethod: "DRAW" });
    assert.equal(noImage.status, 400);
    const noText = await accept(token, { fullName: "Accept Sig", legalConsent: true, signatureMethod: "TYPE" });
    assert.equal(noText.status, 400);
    const badMime = await accept(token, {
      fullName: "Accept Sig",
      legalConsent: true,
      signatureMethod: "UPLOAD",
      imageDataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    });
    assert.equal(badMime.status, 400);
    assert.equal((await OfferLetter.findById(offer._id).lean()).status, OFFER_LETTER_STATUSES.SENT);

    const ok = await accept(token, {
      fullName: "Accept Sig",
      legalConsent: true,
      ...CANDIDATE_SIGNATURE_FIELDS,
    });
    assert.equal(ok.status, 200, ok.body?.message);
    assert.equal(ok.body.offerLetter.signature.imageData, undefined);

    const accepted = await OfferLetter.findById(offer._id).select("+signature.imageData").lean();
    assert.equal(accepted.status, OFFER_LETTER_STATUSES.ACCEPTED);
    assert.equal(accepted.issuedContent, frozen, "issuedContent must not change on accept");
    assert.equal(accepted.content, frozen);
    assert.equal(accepted.signature.method, "DRAW");
    assert.equal(accepted.signature.hasImage, true);
    assert.equal(accepted.signature.imageMimeType, "image/png");
    assert.ok(accepted.signature.imageData);
    assert.ok(accepted.signature.signedAt);
    assert.equal(accepted.signature.documentHash.length, 64);

    // Signed PDF is a separate stored file; the issued PDF pointer is untouched.
    assert.ok(accepted.signedPdf?.fileId, "signedPdf should be stored at accept time");
    assert.equal(String(accepted.generatedPdf.fileId), String(before.generatedPdf.fileId));
    assert.notEqual(String(accepted.signedPdf.fileId), String(accepted.generatedPdf.fileId));

    // HR download prefers the signed PDF
    const pdf = await request(app).get(`/api/offer-letters/${offer._id}/pdf`).set("Cookie", hrCookie);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers["content-type"], "application/pdf");
    assert.match(pdf.headers["content-disposition"], /_signed\.pdf/);

    // Candidate review download too, and review API exposes only a summary
    const review = await request(app).get(`/api/candidate/offers/review/${token}`);
    assert.equal(review.status, 200);
    assert.equal(review.body.offer.signature.method, "DRAW");
    assert.equal(review.body.offer.signature.imageData, undefined);
    assert.equal(review.body.offer.content, frozen);
  });

  it("5. TYPE candidate signature without an image is accepted and rendered from generated SVG", async () => {
    const offer = await createOffer("Typed Sig", "typed.sig@example.test");
    const sent = await sendOffer(offer._id);
    assert.equal(sent.status, 200, sent.body?.message);
    const res = await accept(sent.body.signingToken, {
      fullName: "Typed Sig",
      legalConsent: true,
      signatureMethod: "TYPE",
      typedText: "Typed Sig",
    });
    assert.equal(res.status, 200, res.body?.message);
    const { OfferLetter } = await getCompanyModels(company);
    const doc = await OfferLetter.findById(offer._id).select("+signature.imageData").lean();
    assert.equal(doc.signature.method, "TYPE");
    assert.equal(doc.signature.typedText, "Typed Sig");
    assert.equal(doc.signature.imageMimeType, "image/svg+xml");
  });

  it("6. master HTML: signature slots, safe data URLs only, injection leaves legal text untouched", () => {
    const base = {
      companyName: "Marker Co",
      candidateName: "Marker Candidate",
      designation: "Engineer",
      monthlySalary: 50000,
      joiningDate: new Date("2026-12-01"),
      signatoryName: "Hr Person",
      signatoryTitle: "Director",
    };
    const unsigned = buildMasterOfferHtml({
      ...base,
      hrSignatureDataUrl: TINY_PNG_DATA_URL,
      candidateSignatureDataUrl: "javascript:alert(1)",
    });
    assert.match(unsigned, /class="sig-img"/);
    assert.doesNotMatch(unsigned, /javascript:/);
    assert.match(unsigned, /@page \{ size: Letter portrait; margin: 0; \}/);
    assert.match(unsigned, /\(Hr Person\)/);
    assert.match(unsigned, /Rs\. 50,000/);

    const typedOnly = buildMasterOfferHtml({ ...base, hrTypedSignature: "Hr <b>Person</b>" });
    assert.match(typedOnly, /class="sig-typed"/);
    assert.doesNotMatch(typedOnly, /<b>Person<\/b>/);

    const { html: signed, injected } = injectCandidateSignature(unsigned, {
      dataUrl: TINY_PNG_DATA_URL,
      signedAt: new Date("2026-10-11T10:00:00Z"),
    });
    assert.equal(injected, true);
    assert.match(signed, /data-sig-slot="candidate"><img class="sig-img"/);
    assert.match(signed, /11-10-2026/);
    // Removing the injected parts yields the original document byte-for-byte.
    const legal = (h) => h.slice(h.indexOf('data-section="terms"'), h.indexOf('data-section="execution"'));
    assert.equal(legal(signed), legal(unsigned));

    const legacy = injectCandidateSignature("<html><body>old doc</body></html>", { dataUrl: TINY_PNG_DATA_URL });
    assert.equal(legacy.injected, false);
  });
});
