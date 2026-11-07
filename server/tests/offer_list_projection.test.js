process.env.NODE_ENV = "test";
process.env.MONGOMS_MD5_CHECK = "0";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { getCentralDbName, getCompanyModels, disconnectAll } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import { OFFER_LETTER_LIST_SELECT } from "../controllers/offerLetterController.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";

let mongod;
let app;
let companyAcme;
let hrCookieAcme;

function cookieFrom(res) {
  const cookieHeader = res.headers["set-cookie"];
  if (!cookieHeader) return "";
  return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
}

describe("Offer list projection (P0 performance)", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "offer_list_projection_jwt_secret_1234567890!";
    process.env.COOKIE_SECRET = "offer_list_projection_cookie_secret_123456!";
    process.env.CENTRAL_DB_NAME = "central_offer_list_projection";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    companyAcme = await Company.create({
      companyName: "Acme List Proj",
      slug: "acme-list-proj",
      databaseName: "tenant_acme_list_proj",
      status: COMPANY_STATUSES.ACTIVE,
    });

    const { User } = await getCompanyModels(companyAcme);
    await User.create({
      email: "hr@acme-list-proj.test",
      passwordHash: await hashPassword("AcmeHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    const login = await request(app).post("/api/auth/login").send({
      companyCode: "acme-list-proj",
      email: "hr@acme-list-proj.test",
      password: "AcmeHrSecret123!",
    });
    assert.equal(login.status, 200);
    hrCookieAcme = cookieFrom(login);

    const { OfferLetter } = await getCompanyModels(companyAcme);
    const hugeHtml = `<div>${"LOGO_DATA_URL_PLACEHOLDER,".repeat(20000)}</div>`;
    await OfferLetter.create({
      candidate: { fullName: "Projection Candidate", email: "proj.cand@example.test" },
      position: "Engineer",
      department: "Engineering",
      monthlySalary: 100000,
      joiningDate: new Date(),
      content: hugeHtml,
      issuedContent: hugeHtml,
      clauses: [{ id: "c1", title: "T", body: "B", isIncluded: true, order: 1 }],
      offerDataSnapshot: { candidate: { fullName: "Projection Candidate" } },
      status: OFFER_LETTER_STATUSES.SENT,
      emailDelivery: {
        status: "SENT",
        attempts: 1,
        sentTo: "proj.cand@example.test",
        history: [],
      },
      signature: {
        signerName: "Should Not Appear In List",
        signedAt: new Date(),
        documentHash: "abc",
      },
    });
  });

  after(async () => {
    await disconnectAll();
    if (mongod) await mongod.stop();
  });

  it("list select constant excludes large HTML and signature fields", () => {
    const select = ` ${OFFER_LETTER_LIST_SELECT} `;
    for (const forbidden of [
      " content",
      " issuedContent",
      " clauses",
      " offerDataSnapshot",
      " signature",
      " signingTokenHash",
      " signingTokenEncrypted",
      " generatedPdf",
    ]) {
      assert.equal(select.includes(forbidden), false, `must exclude${forbidden}`);
    }
    for (const required of [
      "candidate",
      "position",
      "status",
      "emailDelivery",
      "monthlySalary",
      "joiningDate",
      "employeeId",
      "createdAt",
    ]) {
      assert.ok(select.includes(required), `must include ${required}`);
    }
  });

  it("GET /offer-letters omits large fields but keeps list UI fields", async () => {
    const res = await request(app)
      .get("/api/offer-letters?limit=10")
      .set("Cookie", hrCookieAcme);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.offerLetters));
    assert.ok(res.body.offerLetters.length >= 1);
    assert.ok(res.body.pagination);
    assert.ok(res.body.pagination.total >= 1);

    const offer = res.body.offerLetters.find(
      (o) => o.candidate?.email === "proj.cand@example.test"
    );
    assert.ok(offer);
    assert.equal(offer.position, "Engineer");
    assert.equal(offer.status, OFFER_LETTER_STATUSES.SENT);
    assert.equal(offer.monthlySalary, 100000);
    assert.ok(offer.emailDelivery);
    assert.equal(offer.emailDelivery.status, "SENT");
    assert.equal(Object.hasOwn(offer, "content"), false);
    assert.equal(Object.hasOwn(offer, "issuedContent"), false);
    assert.equal(Object.hasOwn(offer, "clauses"), false);
    assert.equal(Object.hasOwn(offer, "offerDataSnapshot"), false);
    assert.equal(Object.hasOwn(offer, "signature"), false);
    assert.equal(Object.hasOwn(offer, "signingTokenHash"), false);
  });

  it("GET /offer-letters supports status filter and pagination metadata", async () => {
    const filtered = await request(app)
      .get("/api/offer-letters?status=SENT&page=1&limit=5")
      .set("Cookie", hrCookieAcme);
    assert.equal(filtered.status, 200);
    assert.ok(filtered.body.offerLetters.every((o) => o.status === "SENT"));
    assert.equal(filtered.body.pagination.page, 1);
    assert.equal(filtered.body.pagination.limit, 5);

    const drafts = await request(app)
      .get("/api/offer-letters?status=DRAFT")
      .set("Cookie", hrCookieAcme);
    assert.equal(drafts.status, 200);
    assert.ok(drafts.body.offerLetters.every((o) => o.status === "DRAFT"));
  });

  it("GET /offer-letters/:id still returns document content", async () => {
    const list = await request(app)
      .get("/api/offer-letters")
      .set("Cookie", hrCookieAcme);
    const offerId = list.body.offerLetters.find(
      (o) => o.candidate?.email === "proj.cand@example.test"
    )._id;

    const detail = await request(app)
      .get(`/api/offer-letters/${offerId}`)
      .set("Cookie", hrCookieAcme);
    assert.equal(detail.status, 200);
    assert.ok(detail.body.offerLetter.content);
    assert.ok(detail.body.offerLetter.content.includes("LOGO_DATA_URL_PLACEHOLDER"));
    assert.ok(detail.body.offerLetter.issuedContent);
  });
});
