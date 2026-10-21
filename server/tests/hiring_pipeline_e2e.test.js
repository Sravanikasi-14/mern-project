process.env.MONGOMS_MD5_CHECK = "0";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
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
import { decodeAuthToken } from "../utils/token.js";

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

describe("Hiring Pipeline End-to-End: Offer Signing -> Onboarding -> HR Approval -> Employee Creation -> Activation -> Login", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "hiring_pipeline_test_jwt_secret_987654321!";
    process.env.COOKIE_SECRET = "hiring_pipeline_test_cookie_secret_987654321!";
    process.env.CENTRAL_DB_NAME = "central_hiring_pipeline_test";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    // 1. Create Acme Company
    companyAcme = await Company.create({
      companyName: "Acme Innovations Ltd",
      slug: "acme",
      databaseName: "tenant_acme_hiring_pipeline",
      status: COMPANY_STATUSES.ACTIVE,
    });

    // 2. Create Globex Company
    companyGlobex = await Company.create({
      companyName: "Globex Global Corp",
      slug: "globex",
      databaseName: "tenant_globex_hiring_pipeline",
      status: COMPANY_STATUSES.ACTIVE,
    });

    // 3. Setup Acme HR Admin
    const { User: UserAcme } = await getCompanyModels(companyAcme);
    await UserAcme.create({
      email: "hr@acme.test",
      passwordHash: await hashPassword("AcmeHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    // 4. Setup Globex HR Admin
    const { User: UserGlobex } = await getCompanyModels(companyGlobex);
    await UserGlobex.create({
      email: "hr@globex.test",
      passwordHash: await hashPassword("GlobexHrSecret123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });

    // Login Acme HR
    const acmeLogin = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "acme", email: "hr@acme.test", password: "AcmeHrSecret123!" });
    assert.equal(acmeLogin.status, 200);
    hrCookieAcme = cookieFrom(acmeLogin);

    // Login Globex HR
    const globexLogin = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "globex", email: "hr@globex.test", password: "GlobexHrSecret123!" });
    assert.equal(globexLogin.status, 200);
    hrCookieGlobex = cookieFrom(globexLogin);
  });

  after(async () => {
    await disconnectAll();
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  });

  let offerId;
  let signingToken;
  let onboardingToken;
  let onboardingId;
  let activationToken;
  let createdEmployeeCode;

  describe("Stage 1: Offer Letter Generation, Emailing, and Candidate Review & Signing", () => {
    it("HR creates an offer letter draft for candidate Anita Desai", async () => {
      const res = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: {
            fullName: "Anita Desai",
            email: "anita.desai@example.test",
          },
          position: "Senior Frontend Engineer",
          department: "Engineering",
          employmentType: "Full-time Permanent",
          joiningDate: "2026-11-01",
          monthlySalary: 120000,
          workLocation: "Bangalore",
        });

      assert.equal(res.status, 201);
      assert.ok(res.body.offerLetter);
      assert.equal(res.body.offerLetter.candidate.fullName, "Anita Desai");
      assert.equal(res.body.offerLetter.status, OFFER_LETTER_STATUSES.DRAFT);
      offerId = res.body.offerLetter._id;
    });

    it("HR sends the offer letter email; signing token is generated and review link is sent", async () => {
      emailService.clearHistory();

      const res = await request(app)
        .post(`/api/offer-letters/${offerId}/send`)
        .set("Cookie", hrCookieAcme)
        .send();

      assert.equal(res.status, 200);
      assert.equal(res.body.offerLetter.status, OFFER_LETTER_STATUSES.SENT);
      assert.ok(res.body.reviewLink);
      assert.ok(res.body.signingToken);
      signingToken = res.body.signingToken;

      const history = emailService.getHistory();
      assert.ok(history.length >= 1);
      const email = history[0];
      assert.equal(email.to, "anita.desai@example.test");
      assert.ok(email.reviewLink.includes(signingToken));
      assert.ok(email.attachments && email.attachments.length > 0);
    });

    it("Candidate accesses offer review via secure signing token", async () => {
      const res = await request(app)
        .get(`/api/candidate/offers/review/${signingToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.candidateName, "Anita Desai");
      assert.equal(res.body.jobTitle, "Senior Frontend Engineer");
      assert.equal(res.body.status, OFFER_LETTER_STATUSES.SENT);
      assert.ok(res.body.company);
      assert.equal(res.body.company.name, "Acme Innovations Ltd");
      assert.ok(res.body.legalStatement);
    });

    it("Candidate downloads PDF offer letter via token endpoint", async () => {
      const res = await request(app)
        .get(`/api/candidate/offers/review/${signingToken}/pdf`);

      assert.equal(res.status, 200);
      assert.equal(res.headers["content-type"], "application/pdf");
      assert.ok(res.body && res.body.length > 0);
    });

    it("Candidate accepts and signs offer electronically", async () => {
      emailService.clearHistory();

      const res = await request(app)
        .post(`/api/candidate/offers/review/${signingToken}/accept`)
        .send({
          signerName: "Anita Desai",
          consentAgreed: true,
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.offerLetter.status, OFFER_LETTER_STATUSES.ACCEPTED);
      assert.ok(res.body.offerLetter.signature);
      assert.equal(res.body.offerLetter.signature.signerName, "Anita Desai");
      assert.ok(res.body.offerLetter.signature.documentHash);
      assert.ok(res.body.offerLetter.content.includes("Accepted Electronically"));
      assert.ok(res.body.offerLetter.content.includes("Electronically Signed By:"));
      assert.ok(res.body.offerLetter.content.includes("Anita Desai"));
      assert.ok(!res.body.offerLetter.content.includes("Signature: _______________________"));
      assert.ok(res.body.onboardingToken);
      onboardingToken = res.body.onboardingToken;

      // Verify onboarding invitation email was dispatched to candidate
      const history = emailService.getHistory();
      const onboardingEmail = history.find((e) => e.type === "candidate_onboarding_invite");
      assert.ok(onboardingEmail, "Onboarding invitation email should be sent");
      assert.equal(onboardingEmail.to, "anita.desai@example.test");
      assert.ok(onboardingEmail.onboardingLink.includes(onboardingToken));
    });

    it("Offer review endpoint returns recorded electronic signature in content", async () => {
      const res = await request(app)
        .get(`/api/candidate/offers/review/${signingToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.offer.status, OFFER_LETTER_STATUSES.ACCEPTED);
      assert.ok(res.body.offer.content.includes("Accepted Electronically"));
      assert.ok(res.body.offer.content.includes("Electronically Signed By:"));
      assert.ok(res.body.offer.content.includes("Anita Desai"));
      assert.ok(!res.body.offer.content.includes("Signature: _______________________"));
    });

    it("Candidate cannot sign an already accepted offer (prevents duplicate signing)", async () => {
      const res = await request(app)
        .post(`/api/candidate/offers/review/${signingToken}/accept`)
        .send({
          signerName: "Anita Desai",
          consentAgreed: true,
        });

      assert.equal(res.status, 409);
    });

    it("Invalid or tampered signing token is rejected", async () => {
      const res = await request(app)
        .get("/api/candidate/offers/review/invalid.token.here");

      assert.equal(res.status, 400);
    });
  });

  describe("Stage 2 & 3: Candidate Onboarding Access, Form Drafting, Uploads & Submission", () => {
    it("Candidate fetches onboarding record using onboarding token", async () => {
      const res = await request(app)
        .get(`/api/candidate/onboarding/${onboardingToken}`);

      assert.equal(res.status, 200);
      assert.ok(res.body.onboarding);
      assert.equal(res.body.onboarding.status, ONBOARDING_STATUSES.DRAFT);
      assert.equal(res.body.onboarding.candidateName, "Anita Desai");
      assert.equal(res.body.onboarding.candidateEmail, "anita.desai@example.test");
      // Read-only offer terms must be present
      assert.equal(res.body.onboarding.offerTerms.jobTitle, "Senior Frontend Engineer");
      assert.equal(res.body.onboarding.offerTerms.department, "Engineering");
      assert.equal(res.body.onboarding.offerTerms.monthlySalary, 120000);
      onboardingId = res.body.onboarding._id;
    });

    it("Candidate saves onboarding form draft progress", async () => {
      const res = await request(app)
        .put(`/api/candidate/onboarding/${onboardingToken}/draft`)
        .send({
          personalDetails: {
            phone: "+91 9876543210",
            gender: "Female",
            dateOfBirth: "1994-05-15",
          },
          residentialAddress: {
            addressLine1: "123 Tech Park Residency",
            city: "Bangalore",
            state: "Karnataka",
            postalCode: "560100",
            country: "India",
          },
          emergencyContact: {
            name: "Rajesh Desai",
            relationship: "Spouse",
            phone: "+91 9876543211",
          },
          bankDetails: {
            accountHolderName: "Anita Desai",
            bankName: "HDFC Bank",
            accountNumber: "50100234567890",
            ifscCode: "HDFC0001234",
          },
          identityDetails: {
            panNumber: "ABCDE1234F",
            aadhaarNumber: "123456789012",
          },
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.onboarding.personalDetails.phone, "+91 9876543210");
      assert.equal(res.body.onboarding.residentialAddress.city, "Bangalore");
      assert.equal(res.body.onboarding.bankDetails.bankName, "HDFC Bank");
    });

    let uploadedDocId;
    it("Candidate uploads required identification document", async () => {
      const fileData = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 test pan card document").toString("base64");
      const res = await request(app)
        .post(`/api/candidate/onboarding/${onboardingToken}/documents`)
        .send({
          documentType: "ID_PROOF",
          title: "PAN Card",
          fileName: "pan_card.pdf",
          fileData,
          mimeType: "application/pdf",
        });

      assert.equal(res.status, 201);
      assert.ok(res.body.documents);
      assert.equal(res.body.documents.length, 1);
      assert.equal(res.body.documents[0].documentType, "ID_PROOF");
      uploadedDocId = res.body.documents[0]._id;
    });

    it("Candidate can download their own uploaded document securely via token", async () => {
      const res = await request(app)
        .get(`/api/candidate/onboarding/${onboardingToken}/documents/${uploadedDocId}/download`);

      assert.equal(res.status, 200);
      assert.equal(res.headers["content-type"], "application/pdf");
    });

    it("Attempting to submit onboarding without completing all required fields fails with 400", async () => {
      // Temporarily remove residential address to test validation failure
      await request(app)
        .put(`/api/candidate/onboarding/${onboardingToken}/draft`)
        .send({
          residentialAddress: {
            street: "",
            city: "",
          },
        });

      const res = await request(app)
        .post(`/api/candidate/onboarding/${onboardingToken}/submit`);

      assert.equal(res.status, 400);
      assert.ok(res.body.missingFields);
      assert.ok(res.body.missingFields.length > 0);
    });

    it("Candidate completes all required details and successfully submits onboarding", async () => {
      // Re-supply full valid data
      await request(app)
        .put(`/api/candidate/onboarding/${onboardingToken}/draft`)
        .send({
          personalDetails: {
            fullName: "Anita Desai",
            phoneNumber: "+91 9876543210",
            gender: "Female",
            dateOfBirth: "1994-05-15",
          },
          residentialAddress: {
            street: "123 Tech Park Residency",
            city: "Bangalore",
            state: "Karnataka",
            postalCode: "560100",
            country: "India",
          },
          emergencyContact: {
            name: "Rajesh Desai",
            relationship: "Spouse",
            phone: "+91 9876543211",
          },
          bankDetails: {
            accountHolderName: "Anita Desai",
            bankName: "HDFC Bank",
            accountNumber: "50100234567890",
            ifscCode: "HDFC0001234",
          },
          taxDetails: {
            panNumber: "ABCDE1234F",
          },
        });

      const res = await request(app)
        .post(`/api/candidate/onboarding/${onboardingToken}/submit`);

      assert.equal(res.status, 200);
      assert.equal(res.body.onboarding.status, ONBOARDING_STATUSES.SUBMITTED);
      assert.ok(res.body.onboarding.submittedAt);
    });

    it("Candidate cannot edit draft once in SUBMITTED status", async () => {
      const res = await request(app)
        .put(`/api/candidate/onboarding/${onboardingToken}/draft`)
        .send({
          personalDetails: { phone: "+91 0000000000" },
        });

      assert.equal(res.status, 409);
    });
  });

  describe("Stage 4: HR Onboarding Review & Correction Request Workflow", () => {
    it("HR views submitted candidates in the onboarding review dashboard", async () => {
      const res = await request(app)
        .get("/api/onboarding/submissions")
        .set("Cookie", hrCookieAcme);

      assert.equal(res.status, 200);
      assert.ok(res.body.submissions);
      assert.ok(res.body.submissions.length >= 1);
      const sub = res.body.submissions.find((s) => s.candidateEmail === "anita.desai@example.test");
      assert.ok(sub);
      assert.equal(sub.status, ONBOARDING_STATUSES.SUBMITTED);
    });

    it("HR requests correction with a specific reason", async () => {
      emailService.clearHistory();

      const res = await request(app)
        .post(`/api/onboarding/submissions/${onboardingId}/request-corrections`)
        .set("Cookie", hrCookieAcme)
        .send({
          reason: "Please update emergency contact phone number to a 10-digit number.",
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.onboarding.status, ONBOARDING_STATUSES.CHANGES_REQUESTED);

      // Verify correction request email sent to candidate
      const history = emailService.getHistory();
      const correctionEmail = history.find((e) => e.type === "onboarding_correction_request");
      assert.ok(correctionEmail);
      assert.equal(correctionEmail.to, "anita.desai@example.test");
      assert.ok(correctionEmail.correctionReason.includes("emergency contact"));
      if (correctionEmail?.updateLink) {
        onboardingToken = correctionEmail.updateLink.split("/").pop();
      } else if (res.body.onboardingToken) {
        onboardingToken = res.body.onboardingToken;
      }
    });

    it("Candidate can now update fields and resubmit", async () => {
      const updateRes = await request(app)
        .put(`/api/candidate/onboarding/${onboardingToken}/draft`)
        .send({
          emergencyContact: {
            name: "Rajesh Desai",
            relationship: "Spouse",
            phone: "+91 9999988888",
          },
        });
      assert.equal(updateRes.status, 200);

      const submitRes = await request(app)
        .post(`/api/candidate/onboarding/${onboardingToken}/submit`);
      assert.equal(submitRes.status, 200);
      assert.equal(submitRes.body.onboarding.status, ONBOARDING_STATUSES.SUBMITTED);
    });

    it("Globex HR cannot review or request corrections for Acme candidate (tenant isolation)", async () => {
      const res = await request(app)
        .post(`/api/onboarding/submissions/${onboardingId}/request-corrections`)
        .set("Cookie", hrCookieGlobex)
        .send({ reason: "Unauthorized attempt" });

      assert.equal(res.status, 404);
    });
  });

  describe("Stage 5: Approval-Driven Employee Creation in Tenant Database", () => {
    it("HR approves onboarding; employee, compensation, and inactive user are created in tenant DB", async () => {
      emailService.clearHistory();

      const res = await request(app)
        .post(`/api/onboarding/submissions/${onboardingId}/approve`)
        .set("Cookie", hrCookieAcme)
        .send();

      assert.ok(res.status === 200 || res.status === 201);
      assert.equal(res.body.success, true);
      assert.ok(res.body.employee);
      assert.ok(res.body.employee.employeeCode);
      assert.equal(res.body.employee.fullName, "Anita Desai");
      assert.equal(res.body.employee.email, "anita.desai@example.test");
      createdEmployeeCode = res.body.employee.employeeCode;

      // Verify employee exists in Acme tenant database
      const { Employee, EmployeeCompensation, User } = await getCompanyModels(companyAcme);
      const empInDb = await Employee.findById(res.body.employee._id);
      assert.ok(empInDb);
      assert.equal(empInDb.fullName, "Anita Desai");
      assert.equal(empInDb.status, "ACTIVE");

      // Verify compensation record created with offer terms
      const compInDb = await EmployeeCompensation.findOne({ employeeId: empInDb._id });
      assert.ok(compInDb);
      assert.ok(compInDb.revisions && compInDb.revisions.length > 0);
      assert.equal(parseFloat(compInDb.revisions[0].monthlyCostToCompany.toString()), 120000);

      // Verify user account was provisioned in tenant DB with isActive=false
      const userInDb = await User.findOne({ email: "anita.desai@example.test" });
      assert.ok(userInDb);
      assert.equal(userInDb.role, USER_ROLES.EMPLOYEE);
      assert.equal(userInDb.isActive, false, "Provisioned user must be inactive until employee activates");

      // Verify employee activation email sent
      const history = emailService.getHistory();
      const activationEmail = history.find((e) => e.type === "employee_activation");
      assert.ok(activationEmail, "Activation email must be sent to employee");
      assert.equal(activationEmail.to, "anita.desai@example.test");
      assert.ok(activationEmail.activationLink.includes("/activate?token="));

      // Extract activation token from activation link
      const url = new URL(activationEmail.activationLink);
      activationToken = url.searchParams.get("token");
      assert.ok(activationToken);
    });

    it("Prevents duplicate employee creation if approve is retried", async () => {
      const res = await request(app)
        .post(`/api/onboarding/submissions/${onboardingId}/approve`)
        .set("Cookie", hrCookieAcme)
        .send();

      assert.equal(res.status, 409);
    });

    it("Newly created employee appears in HR People Management", async () => {
      const res = await request(app)
        .get("/api/employees")
        .set("Cookie", hrCookieAcme);

      assert.equal(res.status, 200);
      const employees = res.body.employees || res.body;
      const found = employees.find((e) => e.email === "anita.desai@example.test");
      assert.ok(found, "Created employee must appear in People Management list");
      assert.equal(found.employeeCode, createdEmployeeCode);
    });
  });

  describe("Stage 6: Employee Portal Activation and Login", () => {
    it("Verifies activation link and loads employee account summary", async () => {
      const res = await request(app)
        .get(`/api/auth/activate/verify?token=${encodeURIComponent(activationToken)}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.email, "anita.desai@example.test");
      assert.equal(res.body.fullName, "Anita Desai");
      assert.equal(res.body.employeeCode, createdEmployeeCode);
      assert.equal(res.body.company.name, "Acme Innovations Ltd");
    });

    it("Rejects password shorter than 8 characters", async () => {
      const res = await request(app)
        .post("/api/auth/activate/complete")
        .send({
          token: activationToken,
          password: "short",
        });

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes("at least 8 characters"));
    });

    it("Completes account activation with secure password and returns session", async () => {
      const res = await request(app)
        .post("/api/auth/activate/complete")
        .send({
          token: activationToken,
          password: "SecureAnitaPassword2026!",
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.token);
      assert.equal(res.body.user.role, USER_ROLES.EMPLOYEE);
      assert.equal(res.body.user.email, "anita.desai@example.test");

      // Verify user in tenant database is now active
      const { User } = await getCompanyModels(companyAcme);
      const userInDb = await User.findOne({ email: "anita.desai@example.test" });
      assert.equal(userInDb.isActive, true);
    });

    it("Invalidates activation token after single use (prevents replay)", async () => {
      const res = await request(app)
        .post("/api/auth/activate/complete")
        .send({
          token: activationToken,
          password: "SecureAnitaPassword2026!",
        });

      assert.equal(res.status, 409);
    });

    it("Employee logs in successfully with new credentials and accesses portal", async () => {
      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({
          companyCode: "acme",
          email: "anita.desai@example.test",
          password: "SecureAnitaPassword2026!",
        });

      assert.equal(loginRes.status, 200);
      assert.equal(loginRes.body.user.role, USER_ROLES.EMPLOYEE);
      assert.equal(loginRes.body.user.email, "anita.desai@example.test");

      const employeeCookie = cookieFrom(loginRes);

      // Verify employee can access /api/auth/me
      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Cookie", employeeCookie);

      assert.equal(meRes.status, 200);
      assert.equal(meRes.body.user.role, USER_ROLES.EMPLOYEE);
      assert.equal(meRes.body.user.email, "anita.desai@example.test");
      assert.equal(meRes.body.company.slug, "acme");
    });
  });
});
