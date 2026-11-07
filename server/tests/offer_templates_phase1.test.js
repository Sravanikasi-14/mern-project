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
  ensureCompanyDefaultTemplate,
  ensureMasterTemplate,
} from "../services/offerTemplateProvisioningService.js";
import { MASTER_TEMPLATE_CODE } from "../assets/offer-templates/hrms-default-master.js";
import {
  inspectDocx,
  fillDocxTemplate,
  validateMappings,
  findMissingMappings,
} from "../services/offerDocxTemplateService.js";
import { setConverter, isConversionConfigured, getConversionStatus } from "../services/docxConversionService.js";
import { generatePureJsPdf } from "../services/pdfService.js";
import {
  renderBuilderHtml,
  buildBuilderSnapshot,
  SAMPLE_OFFER_DATA,
} from "../services/offerTemplateRenderService.js";
import {
  getMasterSectionConfig,
  getDefaultLegalSections,
} from "../assets/offer-templates/hrms-default-master.js";
import { setOfferStorageAdapter } from "../services/offerGridFsStorageService.js";
import { storeIssuedPdfIfNeeded } from "../services/offerDocumentService.js";
import { getStorageFileId } from "../services/offerGridFsStorageService.js";

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

function buildMinimalDocx(placeholders = ["candidate_name", "designation", "monthly_salary"]) {
  const zip = new PizZip();
  const body = placeholders.map((p) => `<w:p><w:r><w:t>{{${p}}}</w:t></w:r></w:p>`).join("");
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

describe("Offer Template System Phase 1", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "offer_template_test_secret_key_1234567890!";
    process.env.COOKIE_SECRET = "offer_template_cookie_secret_1234567890!";
    process.env.CENTRAL_DB_NAME = "central_offer_template_test";
    delete process.env.LIBREOFFICE_CONVERT_URL;
    delete process.env.CONVERTAPI_SECRET;
    delete process.env.R2_ACCESS_KEY_ID;
    setOfferStorageAdapter(null);

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    companyAcme = await Company.create({
      companyName: "Acme Template Co",
      slug: "acme-tmpl",
      databaseName: "tenant_acme_tmpl",
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
    });
    companyGlobex = await Company.create({
      companyName: "Globex Template Co",
      slug: "globex-tmpl",
      databaseName: "tenant_globex_tmpl",
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
    });

    const { User: UserAcme } = await getCompanyModels(companyAcme, { provision: true });
    await UserAcme.create({
      email: "hr@acme-tmpl.test",
      passwordHash: await hashPassword("AcmeHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });
    const { User: UserGlobex } = await getCompanyModels(companyGlobex, { provision: true });
    await UserGlobex.create({
      email: "hr@globex-tmpl.test",
      passwordHash: await hashPassword("GlobexHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    const loginAcme = await request(app)
      .post("/api/auth/login")
      .send({ email: "hr@acme-tmpl.test", password: "AcmeHrSecret123!", companyCode: "acme-tmpl" });
    assert.equal(loginAcme.status, 200);
    hrCookieAcme = cookieFrom(loginAcme);

    const loginGlobex = await request(app)
      .post("/api/auth/login")
      .send({ email: "hr@globex-tmpl.test", password: "GlobexHrSecret123!", companyCode: "globex-tmpl" });
    assert.equal(loginGlobex.status, 200);
    hrCookieGlobex = cookieFrom(loginGlobex);
  });

  after(async () => {
    setConverter(null);
    setOfferStorageAdapter(null);
    await disconnectAll();
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  it("provisions a global master and company system-default without overwriting customisations", async () => {
    const first = await ensureMasterTemplate();
    assert.equal(first.master.code, MASTER_TEMPLATE_CODE);
    assert.equal(first.master.currentVersion, 1);

    const models = await getCompanyModels(companyAcme, { provision: true });
    const created = await ensureCompanyDefaultTemplate(companyAcme, models);
    assert.equal(created.created || created.skipped, true);

    const again = await ensureCompanyDefaultTemplate(companyAcme, models);
    assert.equal(again.skipped, true);

    await models.OfferTemplate.create({
      name: "Company Custom",
      type: "DEFAULT_BUILDER",
      source: "COMPANY",
      status: "ACTIVE",
      isDefault: false,
      isSystemDefault: false,
      version: 1,
      versions: [
        {
          version: 1,
          snapshot: buildBuilderSnapshot({
            sectionConfig: getMasterSectionConfig(),
            legalSections: getDefaultLegalSections(),
            settings: { signatoryName: "Custom Signer" },
          }),
          createdAt: new Date(),
        },
      ],
    });

    const bumped = await ensureMasterTemplate({ bumpVersion: true, notes: "v2" });
    assert.equal(bumped.bumped, true);
    assert.equal(bumped.master.currentVersion, 2);

    const afterBump = await ensureCompanyDefaultTemplate(companyAcme, models);
    assert.equal(afterBump.skipped, true);

    const systemDefault = await models.OfferTemplate.findOne({ isSystemDefault: true }).lean();
    assert.ok(systemDefault);
    assert.equal(systemDefault.masterVersion, 1);
  });

  // Phase 4B: /api/offer-templates is unmounted and tenants are no longer seeded with templates.
  it.skip("lists templates with tenant isolation", async () => {
    const acmeList = await request(app).get("/api/offer-templates").set("Cookie", hrCookieAcme);
    assert.equal(acmeList.status, 200);
    assert.ok(Array.isArray(acmeList.body.templates));
    assert.ok(acmeList.body.templates.some((t) => t.isSystemDefault));
    assert.equal(acmeList.body.storageProvider, "gridfs");

    const globexList = await request(app).get("/api/offer-templates").set("Cookie", hrCookieGlobex);
    assert.equal(globexList.status, 200);

    const acmeIds = new Set(acmeList.body.templates.map((t) => t.id));
    for (const t of globexList.body.templates) {
      assert.equal(acmeIds.has(t.id), false);
    }
  });

  it("validates DOCX placeholders and refuses incomplete mappings", () => {
    const buffer = buildMinimalDocx();
    const { placeholders } = inspectDocx(buffer);
    assert.deepEqual(placeholders.sort(), ["candidate_name", "designation", "monthly_salary"]);

    const mappings = validateMappings(
      [
        { placeholder: "candidate_name", field: "candidate_name" },
        { placeholder: "designation", field: "designation" },
        { placeholder: "monthly_salary", field: "monthly_salary" },
      ],
      placeholders
    );
    assert.equal(findMissingMappings(placeholders, mappings).length, 0);
    assert.equal(findMissingMappings(placeholders, mappings.slice(0, 1)).length, 2);

    const filled = fillDocxTemplate(
      buffer,
      mappings,
      {
        candidate: { fullName: "Ada Lovelace", email: "ada@example.com" },
        position: "Engineer",
        monthlySalary: 100000,
      },
      { companyName: "Acme" }
    );
    assert.ok(Buffer.isBuffer(filled));
    assert.equal(filled[0], 0x50);
  });

  // Phase 4B: /api/offer-templates is unmounted and tenants are no longer seeded with templates.
  it.skip("uploads DOCX template to GridFS and generates filled DOCX without PDF", async () => {
    assert.equal(isConversionConfigured(), false);
    assert.match(getConversionStatus().message, /LIBREOFFICE_CONVERT_URL/);

    const create = await request(app)
      .post("/api/offer-templates")
      .set("Cookie", hrCookieAcme)
      .send({ name: "Word Offer", type: "UPLOADED_DOCX" });
    assert.equal(create.status, 201);
    const templateId = create.body.template.id;

    const docx = buildMinimalDocx();
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
    assert.ok(upload.body.template.storage.fileId);
    assert.ok(upload.body.placeholders.includes("candidate_name"));

    const activate = await request(app)
      .patch(`/api/offer-templates/${templateId}`)
      .set("Cookie", hrCookieAcme)
      .send({
        status: "ACTIVE",
        placeholderMappings: upload.body.suggestedMappings,
      });
    assert.equal(activate.status, 200);
    assert.equal(activate.body.template.status, "ACTIVE");

    const genDocx = await request(app)
      .post(`/api/offer-templates/${templateId}/generate-docx`)
      .set("Cookie", hrCookieAcme)
      .send({
        offerData: {
          candidate: { fullName: "Ada Lovelace", email: "ada@example.com" },
          position: "Engineer",
          monthlySalary: 120000,
        },
      });
    assert.equal(genDocx.status, 200);
    assert.match(genDocx.headers["content-type"], /wordprocessingml/);

    const genPdf = await request(app)
      .post(`/api/offer-templates/${templateId}/generate-pdf`)
      .set("Cookie", hrCookieAcme)
      .send({});
    assert.equal(genPdf.status, 503);
    assert.equal(genPdf.body.code, "CONVERSION_NOT_CONFIGURED");
  });

  // Phase 4B: /api/offer-templates is unmounted and tenants are no longer seeded with templates.
  it.skip("renders DEFAULT_BUILDER HTML and produces a PDF buffer", async () => {
    const snapshot = buildBuilderSnapshot({
      sectionConfig: getMasterSectionConfig(),
      legalSections: getDefaultLegalSections(),
      settings: { signatoryName: "HR Admin", companyEmail: "hr@acme.test" },
      masterCode: MASTER_TEMPLATE_CODE,
      masterVersion: 1,
    });
    const html = renderBuilderHtml({
      snapshot,
      offerData: {
        ...SAMPLE_OFFER_DATA,
        joiningDate: new Date("2026-04-01"),
        createdAt: new Date("2026-03-01"),
        monthlySalary: 100000,
        annualSalary: 1200000,
      },
      company: { companyName: "Acme Template Co" },
    });
    assert.match(html, /OFFER LETTER/i);
    assert.match(html, /Acme Template Co/);

    const pdf = generatePureJsPdf(html);
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.subarray(0, 4).toString("latin1"), "%PDF");

    const list = await request(app).get("/api/offer-templates").set("Cookie", hrCookieAcme);
    const builder = list.body.templates.find((t) => t.type === "DEFAULT_BUILDER" && t.isSystemDefault);
    assert.ok(builder);

    const preview = await request(app)
      .post(`/api/offer-templates/${builder.id}/preview`)
      .set("Cookie", hrCookieAcme)
      .send({});
    assert.equal(preview.status, 200);
    assert.match(preview.body.html, /OFFER LETTER/i);
  });

  // Phase 4B: /api/offer-templates is unmounted and tenants are no longer seeded with templates.
  it.skip("keeps issued PDF immutable in GridFS without ConvertAPI", async () => {
    assert.equal(Boolean(process.env.CONVERTAPI_SECRET), false);
    assert.equal(Boolean(process.env.R2_ACCESS_KEY_ID), false);

    const models = await getCompanyModels(companyAcme, { provision: true });
    const template = await models.OfferTemplate.findOne({ type: "UPLOADED_DOCX" }).lean();
    assert.ok(template);

    const offer = await models.OfferLetter.create({
      candidate: { fullName: "Immutable Test", email: "imm@example.com" },
      position: "Engineer",
      department: "Eng",
      workLocation: "HQ",
      employmentType: "Full-time Permanent",
      monthlySalary: 50000,
      annualSalary: 600000,
      joiningDate: new Date("2026-05-01"),
      content: "<p>summary</p>",
      status: "SENT",
      templateId: template._id,
      templateVersion: template.version,
      templateType: "UPLOADED_DOCX",
      offerDataSnapshot: {
        candidate: { fullName: "Immutable Test", email: "imm@example.com" },
        position: "Engineer",
        monthlySalary: 50000,
      },
      createdBy: null,
    });

    const first = await storeIssuedPdfIfNeeded({
      OfferLetter: models.OfferLetter,
      offerLetter: offer.toObject(),
      pdfBuffer: Buffer.from("%PDF-1.4 first\n%%EOF"),
      connection: models.connection,
    });
    assert.equal(first.reused, false);
    assert.ok(getStorageFileId(first.storage));

    const refreshed = await models.OfferLetter.findById(offer._id).lean();
    const second = await storeIssuedPdfIfNeeded({
      OfferLetter: models.OfferLetter,
      offerLetter: refreshed,
      pdfBuffer: Buffer.from("%PDF-1.4 second should not replace\n%%EOF"),
      connection: models.connection,
    });
    assert.equal(second.reused, true);
    assert.equal(String(getStorageFileId(second.storage)), String(getStorageFileId(first.storage)));
  });
});
