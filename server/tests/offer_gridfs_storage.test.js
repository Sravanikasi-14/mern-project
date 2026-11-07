process.env.MONGOMS_MD5_CHECK = "0";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import PizZip from "pizzip";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { getCentralDbName, getCompanyModels, disconnectAll } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import {
  OFFER_DOCS_BUCKET,
  PURPOSE_ISSUED_PDF,
  PURPOSE_TEMPLATE_SOURCE,
  getOfferDocxMaxBytes,
  getOfferFileBuffer,
  getStorageFileId,
  getTemplateVersionRetention,
  putOfferFile,
  setOfferStorageAdapter,
} from "../services/offerGridFsStorageService.js";
import { storeIssuedPdfIfNeeded } from "../services/offerDocumentService.js";

let mongod;
let app;
let companyAcme;
let companyGlobex;
let hrCookieAcme;
let hrCookieGlobex;
let connectionAcme;

function cookieFrom(res) {
  const cookieHeader = res.headers["set-cookie"];
  if (!cookieHeader) return "";
  return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
}

function buildMinimalDocx(placeholders = ["candidate_name", "designation", "monthly_salary"], marker = "") {
  const zip = new PizZip();
  const body =
    (marker ? `<w:p><w:r><w:t>${marker}</w:t></w:r></w:p>` : "") +
    placeholders.map((p) => `<w:p><w:r><w:t>{{${p}}}</w:t></w:r></w:p>`).join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr/></w:body>
</w:document>`
  );
  return zip.generate({ type: "nodebuffer" });
}

describe("Offer GridFS storage (Phase 1)", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "offer_gridfs_test_secret_key_1234567890!";
    process.env.COOKIE_SECRET = "offer_gridfs_cookie_secret_1234567890!";
    process.env.CENTRAL_DB_NAME = "central_offer_gridfs_test";
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.LIBREOFFICE_CONVERT_URL;
    process.env.OFFER_TEMPLATE_VERSION_RETENTION = "5";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();
    setOfferStorageAdapter(null);

    companyAcme = await Company.create({
      companyName: "Acme GridFS Co",
      slug: "acme-gfs",
      databaseName: "tenant_acme_gfs",
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
    });
    companyGlobex = await Company.create({
      companyName: "Globex GridFS Co",
      slug: "globex-gfs",
      databaseName: "tenant_globex_gfs",
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
    });

    const modelsA = await getCompanyModels(companyAcme, { provision: true });
    connectionAcme = modelsA.connection;
    await modelsA.User.create({
      email: "hr@acme-gfs.test",
      passwordHash: await hashPassword("AcmeHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });
    const modelsB = await getCompanyModels(companyGlobex, { provision: true });
    await modelsB.User.create({
      email: "hr@globex-gfs.test",
      passwordHash: await hashPassword("GlobexHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    const loginA = await request(app)
      .post("/api/auth/login")
      .send({ email: "hr@acme-gfs.test", password: "AcmeHrSecret123!", companyCode: "acme-gfs" });
    assert.equal(loginA.status, 200);
    hrCookieAcme = cookieFrom(loginA);

    const loginB = await request(app)
      .post("/api/auth/login")
      .send({ email: "hr@globex-gfs.test", password: "GlobexHrSecret123!", companyCode: "globex-gfs" });
    assert.equal(loginB.status, 200);
    hrCookieGlobex = cookieFrom(loginB);
  });

  after(async () => {
    setOfferStorageAdapter(null);
    await disconnectAll();
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  it("defaults DOCX max to 2 MB and version retention to 5", () => {
    assert.equal(getOfferDocxMaxBytes(), 2 * 1024 * 1024);
    assert.equal(getTemplateVersionRetention(), 5);
  });

  it("deduplicates identical template_source uploads by checksum", async () => {
    const body = buildMinimalDocx(undefined, "same-content");
    const first = await putOfferFile({
      connection: connectionAcme,
      body,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "a.docx",
      purpose: PURPOSE_TEMPLATE_SOURCE,
      metadata: { templateId: "t1" },
    });
    const second = await putOfferFile({
      connection: connectionAcme,
      body,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "b.docx",
      purpose: PURPOSE_TEMPLATE_SOURCE,
      metadata: { templateId: "t2" },
    });
    assert.equal(String(first.fileId), String(second.fileId));
    assert.equal(second.deduped, true);

    const files = await connectionAcme.db.collection(`${OFFER_DOCS_BUCKET}.files`).countDocuments({
      "metadata.purpose": PURPOSE_TEMPLATE_SOURCE,
      "metadata.checksumSha256": first.checksumSha256,
    });
    assert.equal(files, 1);
  });

  it("never deduplicates issued PDFs — each offer gets a unique file", async () => {
    const pdf = Buffer.from("%PDF-1.4 identical-bytes\n%%EOF");
    const a = await putOfferFile({
      connection: connectionAcme,
      body: pdf,
      contentType: "application/pdf",
      filename: "offer_a.pdf",
      purpose: PURPOSE_ISSUED_PDF,
      metadata: { offerId: "1" },
    });
    const b = await putOfferFile({
      connection: connectionAcme,
      body: pdf,
      contentType: "application/pdf",
      filename: "offer_b.pdf",
      purpose: PURPOSE_ISSUED_PDF,
      metadata: { offerId: "2" },
    });
    assert.notEqual(String(a.fileId), String(b.fileId));
  });

  it("stores issued PDF once and refuses overwrite (immutable)", async () => {
    const models = await getCompanyModels(companyAcme, { provision: true });
    const offer = await models.OfferLetter.create({
      candidate: { fullName: "Immutable", email: "imm@gfs.test" },
      position: "Engineer",
      monthlySalary: 50000,
      annualSalary: 600000,
      joiningDate: new Date("2026-06-01"),
      content: "<p>x</p>",
      status: "SENT",
      createdBy: null,
    });

    const first = await storeIssuedPdfIfNeeded({
      OfferLetter: models.OfferLetter,
      offerLetter: offer.toObject(),
      pdfBuffer: Buffer.from("%PDF-1.4 first-issued\n%%EOF"),
      connection: models.connection,
    });
    assert.equal(first.reused, false);
    assert.ok(getStorageFileId(first.storage));

    const refreshed = await models.OfferLetter.findById(offer._id).lean();
    const second = await storeIssuedPdfIfNeeded({
      OfferLetter: models.OfferLetter,
      offerLetter: refreshed,
      pdfBuffer: Buffer.from("%PDF-1.4 second-should-not-replace\n%%EOF"),
      connection: models.connection,
    });
    assert.equal(second.reused, true);
    assert.equal(String(getStorageFileId(second.storage)), String(getStorageFileId(first.storage)));

    const stored = await getOfferFileBuffer({
      connection: models.connection,
      fileId: getStorageFileId(first.storage),
    });
    assert.ok(stored.toString().includes("first-issued"));
    assert.equal(stored.toString().includes("second-should-not"), false);
  });

  // Phase 4B: /api/offer-templates is unmounted and tenants are no longer seeded with templates.
  it.skip("uploads DOCX via API into tenant GridFS and streams source download", async () => {
    const create = await request(app)
      .post("/api/offer-templates")
      .set("Cookie", hrCookieAcme)
      .send({ name: "GridFS Word", type: "UPLOADED_DOCX" });
    assert.equal(create.status, 201);
    const templateId = create.body.template.id;

    const docx = buildMinimalDocx(undefined, "api-upload");
    const upload = await request(app)
      .post(`/api/offer-templates/${templateId}/docx`)
      .set("Cookie", hrCookieAcme)
      .send({
        fileName: "offer.docx",
        fileData: docx.toString("base64"),
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    assert.equal(upload.status, 200);
    assert.equal(upload.body.template.storage.provider, "gridfs");
    assert.equal(upload.body.template.storage.bucket, "offer_docs");
    assert.ok(upload.body.template.storage.fileId);

    const dl = await request(app)
      .get(`/api/offer-templates/${templateId}/source-download`)
      .set("Cookie", hrCookieAcme)
      .buffer(true)
      .parse((res, cb) => {
        const data = [];
        res.on("data", (c) => data.push(c));
        res.on("end", () => cb(null, Buffer.concat(data)));
      });
    assert.equal(dl.status, 200);
    assert.match(String(dl.headers["content-type"]), /wordprocessingml|octet-stream/);
    assert.ok(Buffer.isBuffer(dl.body));
    assert.equal(dl.body[0], 0x50); // PK zip magic
  });

  // Phase 4B: /api/offer-templates is unmounted and tenants are no longer seeded with templates.
  it.skip("enforces tenant isolation on template source download", async () => {
    const list = await request(app).get("/api/offer-templates").set("Cookie", hrCookieAcme);
    const tmpl = list.body.templates.find((t) => t.type === "UPLOADED_DOCX" && t.storage?.fileId);
    assert.ok(tmpl);

    const denied = await request(app)
      .get(`/api/offer-templates/${tmpl.id}/source-download`)
      .set("Cookie", hrCookieGlobex);
    assert.ok(denied.status === 404 || denied.status === 403);
  });

  // Phase 4B: /api/offer-templates is unmounted and tenants are no longer seeded with templates.
  it.skip("retains only the latest 5 template version binaries", async () => {
    process.env.OFFER_TEMPLATE_VERSION_RETENTION = "5";
    const create = await request(app)
      .post("/api/offer-templates")
      .set("Cookie", hrCookieAcme)
      .send({ name: "Versioned DOCX", type: "UPLOADED_DOCX" });
    const templateId = create.body.template.id;

    for (let i = 0; i < 6; i++) {
      const docx = buildMinimalDocx(undefined, `version-marker-${i}`);
      const upload = await request(app)
        .post(`/api/offer-templates/${templateId}/docx`)
        .set("Cookie", hrCookieAcme)
        .send({
          fileName: `v${i}.docx`,
          fileData: docx.toString("base64"),
        });
      assert.equal(upload.status, 200, upload.body?.message);
    }

    const detail = await request(app).get(`/api/offer-templates/${templateId}`).set("Cookie", hrCookieAcme);
    assert.equal(detail.status, 200);
    assert.ok(detail.body.template.versions.length <= 5);
    assert.equal(detail.body.template.version, 6);
  });

  // Phase 4B: /api/offer-templates is unmounted and tenants are no longer seeded with templates.
  it.skip("cleans up draft template GridFS files on delete", async () => {
    const create = await request(app)
      .post("/api/offer-templates")
      .set("Cookie", hrCookieAcme)
      .send({ name: "Disposable Draft", type: "UPLOADED_DOCX" });
    const templateId = create.body.template.id;
    const docx = buildMinimalDocx(undefined, "disposable-unique");
    const upload = await request(app)
      .post(`/api/offer-templates/${templateId}/docx`)
      .set("Cookie", hrCookieAcme)
      .send({ fileName: "d.docx", fileData: docx.toString("base64") });
    assert.equal(upload.status, 200);
    const fileId = upload.body.template.storage.fileId;

    const del = await request(app).delete(`/api/offer-templates/${templateId}`).set("Cookie", hrCookieAcme);
    assert.equal(del.status, 200);

    await assert.rejects(
      () => getOfferFileBuffer({ connection: connectionAcme, fileId }),
      (err) => err.status === 404 || /not found/i.test(err.message)
    );
  });

  it("rejects DOCX larger than configured max", async () => {
    const prev = process.env.OFFER_DOCX_MAX_BYTES;
    process.env.OFFER_DOCX_MAX_BYTES = "1000";
    try {
      await assert.rejects(
        () =>
          putOfferFile({
            connection: connectionAcme,
            body: Buffer.alloc(1500, 1),
            contentType: "application/octet-stream",
            filename: "big.docx",
            purpose: PURPOSE_TEMPLATE_SOURCE,
          }),
        (err) => err.status === 400 && err.code === "FILE_TOO_LARGE"
      );
    } finally {
      if (prev == null) delete process.env.OFFER_DOCX_MAX_BYTES;
      else process.env.OFFER_DOCX_MAX_BYTES = prev;
    }
  });

  // Phase 4B: /api/offer-templates is unmounted and tenants are no longer seeded with templates.
  it.skip("does not require R2 — storageConfigured is true with tenant Mongo only", async () => {
    assert.equal(Boolean(process.env.R2_ACCESS_KEY_ID), false);
    const list = await request(app).get("/api/offer-templates").set("Cookie", hrCookieAcme);
    assert.equal(list.status, 200);
    assert.equal(list.body.storageConfigured, true);
    assert.equal(list.body.storageProvider, "gridfs");
  });
});
