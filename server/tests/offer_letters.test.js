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

let mongod;
let app;
let companyAcme;
let companyGlobex;
let hrCookieAcme;
let employeeCookieAcme;
let hrCookieGlobex;

function cookieFrom(res) {
  const cookieHeader = res.headers["set-cookie"];
  if (!cookieHeader) return "";
  return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
}

describe("Offer Letter Generation & Lifecycle Management Module", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "offer_letter_test_secret_key_1234567890!";
    process.env.COOKIE_SECRET = "offer_letter_cookie_secret_1234567890!";
    process.env.CENTRAL_DB_NAME = "central_offer_test";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    // 1. Create Acme Company
    companyAcme = await Company.create({
      companyName: "Acme Technologies India Pvt Ltd",
      slug: "acme",
      databaseName: "tenant_acme_offers",
      status: COMPANY_STATUSES.ACTIVE,
      config: {
        timezone: "Asia/Kolkata",
        currencyCode: "INR",
      },
    });

    // 2. Create Globex Company (for tenant isolation tests)
    companyGlobex = await Company.create({
      companyName: "Globex Enterprise Solutions",
      slug: "globex",
      databaseName: "tenant_globex_offers",
      status: COMPANY_STATUSES.ACTIVE,
      config: {
        timezone: "Asia/Kolkata",
        currencyCode: "INR",
      },
    });

    // Setup Acme Users: HR_ADMIN and EMPLOYEE
    const { User: UserAcme, Employee: EmployeeAcme } = await getCompanyModels(companyAcme);

    await UserAcme.create({
      email: "hr@acme.test",
      passwordHash: await hashPassword("AcmeHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    const empUser = await UserAcme.create({
      email: "emp@acme.test",
      passwordHash: await hashPassword("AcmeEmpSecret123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
      schemaVersion: 1,
    });

    await EmployeeAcme.create({
      userId: empUser._id,
      employeeCode: "ACM-001",
      fullName: "Maya Rao",
      email: "emp@acme.test",
      status: "ACTIVE",
      job: {
        jobTitle: "Software Engineer",
        department: "Engineering",
        joiningDate: new Date("2026-01-01"),
      },
      schemaVersion: 1,
    });

    // Setup Globex HR User
    const { User: UserGlobex } = await getCompanyModels(companyGlobex);
    await UserGlobex.create({
      email: "hr@globex.test",
      passwordHash: await hashPassword("GlobexHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    // Login Acme HR
    const hrLogin = await request(app)
      .post("/api/auth/login")
      .send({
        companyCode: "acme",
        email: "hr@acme.test",
        password: "AcmeHrSecret123!",
      });
    assert.equal(hrLogin.status, 200);
    hrCookieAcme = cookieFrom(hrLogin);

    // Login Acme Employee
    const empLogin = await request(app)
      .post("/api/auth/login")
      .send({
        companyCode: "acme",
        email: "emp@acme.test",
        password: "AcmeEmpSecret123!",
      });
    assert.equal(empLogin.status, 200);
    employeeCookieAcme = cookieFrom(empLogin);

    // Login Globex HR
    const globexLogin = await request(app)
      .post("/api/auth/login")
      .send({
        companyCode: "globex",
        email: "hr@globex.test",
        password: "GlobexHrSecret123!",
      });
    assert.equal(globexLogin.status, 200);
    hrCookieGlobex = cookieFrom(globexLogin);
  });

  after(async () => {
    await disconnectAll();
    if (mongod) await mongod.stop();
  });

  describe("1. Predefined Clause Library & Deterministic Preview", () => {
    it("should return the standard library of predefined clauses", async () => {
      const res = await request(app)
        .get("/api/offer-letters/clauses")
        .set("Cookie", hrCookieAcme);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(Array.isArray(res.body.clauses));
      assert.ok(res.body.clauses.length >= 10);

      const clauseIds = res.body.clauses.map((c) => c.clauseId || c.id);
      assert.ok(clauseIds.includes("probation_period"));
      assert.ok(clauseIds.includes("notice_period"));
      assert.ok(clauseIds.includes("confidentiality"));
      assert.ok(clauseIds.includes("intellectual_property"));
    });

    it("should generate a deterministic live HTML preview with placeholders safely resolved", async () => {
      const payload = {
        candidate: {
          fullName: "Aarav Sharma",
          email: "aarav.sharma@example.com",
        },
        position: "Lead Cloud Architect",
        department: "Infrastructure",
        employmentType: "Full-time",
        joiningDate: "2026-11-15",
        monthlySalary: 125000,
        workLocation: "Bengaluru, Karnataka",
        reportingManager: "VP of Engineering",
        clauses: [
          {
            clauseId: "probation",
            title: "1. Probationary Evaluation",
            body: "A probation period of six (6) months shall apply.",
            enabled: true,
            order: 0,
          },
          {
            clauseId: "confidentiality",
            title: "2. Data Protection & Confidentiality",
            body: "Strict confidentiality must be maintained at all times.",
            enabled: true,
            order: 1,
          },
        ],
      };

      const res = await request(app)
        .post("/api/offer-letters/preview")
        .set("Cookie", hrCookieAcme)
        .send(payload);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.html);
      assert.ok(res.body.html.includes("Aarav Sharma"));
      assert.ok(res.body.html.includes("Lead Cloud Architect"));
      assert.ok(res.body.html.includes("Acme Technologies India Pvt Ltd"));
      assert.ok(res.body.html.includes("1,25,000") || res.body.html.includes("125,000"));
      assert.ok(res.body.html.includes("1. Probationary Evaluation"));
      assert.ok(res.body.html.includes("A probation period of six (6) months"));
    });
  });

  describe("2. Validation & Draft Creation", () => {
    it("should reject creation when required candidate fields are missing", async () => {
      const res = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "", email: "" },
          position: "",
          joiningDate: "",
          monthlySalary: 0,
        });

      assert.equal(res.status, 400);
      assert.ok(res.body.errors);
      assert.ok(res.body.errors.fullName);
      assert.ok(res.body.errors.position);
      assert.ok(res.body.errors.monthlySalary);
    });

    it("should reject creation when monthly salary is negative or non-numeric", async () => {
      const res = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Aarav Sharma", email: "aarav@example.com" },
          position: "Architect",
          joiningDate: "2026-11-15",
          monthlySalary: -5000,
        });

      assert.equal(res.status, 400);
      assert.ok(res.body.errors.monthlySalary);
    });

    it("should successfully create an offer draft and preserve structured clauses", async () => {
      const res = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Priya Menon", email: "priya.menon@example.com" },
          position: "Product Designer",
          department: "Product Design",
          employmentType: "Full-time",
          workLocation: "Hyderabad, India",
          joiningDate: "2026-12-01",
          monthlySalary: 85000,
          clauses: [
            {
              clauseId: "probation",
              title: "1. Probation Period",
              body: "Three months probation period.",
              enabled: true,
              order: 0,
            },
            {
              clauseId: "custom_bonus",
              title: "2. Performance Milestones",
              body: "Eligibility for quarterly performance reviews.",
              enabled: true,
              order: 1,
            },
          ],
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      const offer = res.body.offerLetter;
      assert.ok(offer._id);
      assert.equal(offer.status, "DRAFT");
      assert.equal(offer.candidate.fullName, "Priya Menon");
      assert.equal(offer.monthlySalary, 85000);
      assert.equal(offer.clauses.length, 2);
      assert.equal(offer.clauses[1].clauseId, "custom_bonus");
      assert.ok(offer.content);
      assert.ok(offer.content.includes("Product Designer"));
    });

    it("should restore previous clause customizations when draft is reopened", async () => {
      // 1. Create a draft with a specific custom clause
      const createRes = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Devendra Patel", email: "devendra@example.com" },
          position: "Frontend Specialist",
          department: "Engineering",
          joiningDate: "2026-11-20",
          monthlySalary: 95000,
          clauses: [
            {
              clauseId: "custom_ip",
              title: "Special Open Source Clause",
              body: "Custom open-source contribution rights granted by HR.",
              enabled: true,
              order: 0,
            },
          ],
        });

      const offerId = createRes.body.offerLetter._id;

      // 2. Reopen draft
      const getRes = await request(app)
        .get(`/api/offer-letters/${offerId}`)
        .set("Cookie", hrCookieAcme);

      assert.equal(getRes.status, 200);
      const reopened = getRes.body.offerLetter;
      assert.equal(reopened.candidate.fullName, "Devendra Patel");
      assert.equal(reopened.clauses.length, 1);
      assert.equal(reopened.clauses[0].title, "Special Open Source Clause");
      assert.equal(reopened.clauses[0].body, "Custom open-source contribution rights granted by HR.");
    });
  });

  describe("3. Status Lifecycle & Locking Content", () => {
    let draftOfferId;

    before(async () => {
      const res = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Rohan Verma", email: "rohan.verma@example.com" },
          position: "DevOps Engineer",
          department: "Cloud Operations",
          joiningDate: "2026-12-15",
          monthlySalary: 110000,
        });
      draftOfferId = res.body.offerLetter._id;
    });

    it("should allow editing content while still in DRAFT status", async () => {
      const res = await request(app)
        .put(`/api/offer-letters/${draftOfferId}`)
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Rohan Verma", email: "rohan.verma@example.com" },
          position: "Senior DevOps Engineer", // Updated title
          department: "Cloud Operations",
          joiningDate: "2026-12-15",
          monthlySalary: 120000, // Updated salary
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.offerLetter.position, "Senior DevOps Engineer");
      assert.equal(res.body.offerLetter.monthlySalary, 120000);
    });

    it("should transition from DRAFT to SENT when HR explicitly marks as sent", async () => {
      const res = await request(app)
        .patch(`/api/offer-letters/${draftOfferId}/status`)
        .set("Cookie", hrCookieAcme)
        .send({
          status: "SENT",
          notes: "Generated PDF and issued via manual corporate dispatch.",
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.offerLetter.status, "SENT");
    });

    it("should lock offer content from further edits once status is SENT", async () => {
      const res = await request(app)
        .put(`/api/offer-letters/${draftOfferId}`)
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Rohan Verma Tampered", email: "rohan@example.com" },
          position: "Senior DevOps Engineer",
          monthlySalary: 150000,
          joiningDate: "2026-12-15",
        });

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes("Cannot edit an offer letter") || res.body.message.includes("locked"));
    });

    it("should reject transitioning back to DRAFT or to an unapproved status", async () => {
      const res = await request(app)
        .patch(`/api/offer-letters/${draftOfferId}/status`)
        .set("Cookie", hrCookieAcme)
        .send({ status: "DRAFT" });

      assert.equal(res.status, 400);
    });

    it("should record candidate response as ACCEPTED", async () => {
      const res = await request(app)
        .patch(`/api/offer-letters/${draftOfferId}/status`)
        .set("Cookie", hrCookieAcme)
        .send({
          status: "ACCEPTED",
          notes: "Candidate signed duplicate offer acceptance copy.",
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.offerLetter.status, "ACCEPTED");
    });
  });

  describe("4. PDF Generation & Download", () => {
    it("should generate a valid binary PDF document matching the offer letter", async () => {
      const createRes = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Kavita Reddy", email: "kavita.reddy@example.com" },
          position: "Quality Assurance Architect",
          department: "Quality Engineering",
          joiningDate: "2026-11-30",
          monthlySalary: 90000,
        });

      const offerId = createRes.body.offerLetter._id;

      const pdfRes = await request(app)
        .get(`/api/offer-letters/${offerId}/pdf`)
        .set("Cookie", hrCookieAcme);

      assert.equal(pdfRes.status, 200);
      assert.equal(pdfRes.headers["content-type"], "application/pdf");
      assert.ok(pdfRes.headers["content-disposition"].includes("Offer_Letter_Kavita_Reddy.pdf"));
      // Valid PDF files start with binary header '%PDF-'
      assert.ok(pdfRes.body.length > 1000);
      const pdfHeader = pdfRes.body.slice(0, 5).toString("utf-8");
      assert.equal(pdfHeader, "%PDF-");
    });
  });

  describe("5. Acceptance & Employee Onboarding Integration", () => {
    let acceptedOfferId;
    let draftOfferId;

    before(async () => {
      // 1. Create and accept an offer
      const res1 = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Siddharth Jain", email: "siddharth.jain@example.com" },
          position: "Principal Data Scientist",
          department: "Analytics",
          joiningDate: "2026-12-01",
          monthlySalary: 140000,
        });
      acceptedOfferId = res1.body.offerLetter._id;

      await request(app)
        .patch(`/api/offer-letters/${acceptedOfferId}/status`)
        .set("Cookie", hrCookieAcme)
        .send({ status: "SENT" });

      await request(app)
        .patch(`/api/offer-letters/${acceptedOfferId}/status`)
        .set("Cookie", hrCookieAcme)
        .send({ status: "ACCEPTED" });

      // 2. Create a DRAFT offer
      const res2 = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Draft Candidate", email: "draft@example.com" },
          position: "Intern",
          joiningDate: "2026-12-01",
          monthlySalary: 25000,
        });
      draftOfferId = res2.body.offerLetter._id;
    });

    it("should reject onboarding when trying to link a DRAFT offer letter", async () => {
      const res = await request(app)
        .post("/api/employees")
        .set("Cookie", hrCookieAcme)
        .send({
          fullName: "Draft Candidate",
          email: "draft.candidate@example.com",
          employeeCode: "ACM-099",
          jobTitle: "Intern",
          offerLetterId: draftOfferId,
        });

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes("Only ACCEPTED offers can be onboarded"));
    });

    it("should successfully onboard employee from accepted offer and link employeeId", async () => {
      const res = await request(app)
        .post("/api/employees")
        .set("Cookie", hrCookieAcme)
        .send({
          fullName: "Siddharth Jain",
          email: "siddharth.jain@example.com",
          employeeCode: "ACM-002",
          jobTitle: "Principal Data Scientist",
          department: "Analytics",
          monthlySalary: 140000,
          offerLetterId: acceptedOfferId,
        });

      assert.equal(res.status, 201);
      const employee = res.body.employee;
      assert.ok(employee._id);

      // Verify the offer letter was linked
      const offerRes = await request(app)
        .get(`/api/offer-letters/${acceptedOfferId}`)
        .set("Cookie", hrCookieAcme);

      assert.equal(offerRes.status, 200);
      const linkedEmpId = offerRes.body.offerLetter.employeeId?._id || offerRes.body.offerLetter.employeeId;
      assert.equal(String(linkedEmpId), String(employee._id));
    });

    it("should reject duplicate onboarding linking against the same offer letter", async () => {
      const res = await request(app)
        .post("/api/employees")
        .set("Cookie", hrCookieAcme)
        .send({
          fullName: "Duplicate Siddharth",
          email: "duplicate.siddharth@example.com",
          employeeCode: "ACM-003",
          jobTitle: "Data Scientist",
          offerLetterId: acceptedOfferId,
        });

      assert.equal(res.status, 409);
      assert.ok(res.body.message.includes("already been linked"));
    });
  });

  describe("6. Authorization & Multi-Tenant Isolation", () => {
    it("should reject unauthenticated requests to offer letter endpoints", async () => {
      const res = await request(app).get("/api/offer-letters");
      assert.equal(res.status, 401);
    });

    it("should reject employee role from managing offer letters", async () => {
      const res = await request(app)
        .get("/api/offer-letters")
        .set("Cookie", employeeCookieAcme);

      assert.equal(res.status, 403);
    });

    it("should enforce multi-tenant isolation: Globex HR cannot view Acme offers", async () => {
      // 1. Fetch offers as Acme HR
      const acmeRes = await request(app)
        .get("/api/offer-letters")
        .set("Cookie", hrCookieAcme);
      assert.equal(acmeRes.status, 200);
      assert.ok(acmeRes.body.offerLetters.length > 0);
      const acmeOfferId = acmeRes.body.offerLetters[0]._id;

      // 2. Fetch offers as Globex HR
      const globexRes = await request(app)
        .get("/api/offer-letters")
        .set("Cookie", hrCookieGlobex);
      assert.equal(globexRes.status, 200);
      assert.equal(globexRes.body.offerLetters.length, 0); // No offers in Globex DB

      // 3. Globex HR attempting to read Acme offer by ID gets 404
      const crossRes = await request(app)
        .get(`/api/offer-letters/${acmeOfferId}`)
        .set("Cookie", hrCookieGlobex);
      assert.equal(crossRes.status, 404);
    });
  });
});
