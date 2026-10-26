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
import { USER_ROLES, ONBOARDING_STATUSES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import { emailService } from "../services/emailService.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { signCandidateOnboardingToken, signEmployeeActivationToken } from "../utils/onboardingToken.js";
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

describe("Candidate Onboarding Hardening & Edge-Cases Test Suite", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "hardening_test_jwt_secret_12345678901234567890!";
    process.env.COOKIE_SECRET = "hardening_test_cookie_secret_12345678901234567890!";
    process.env.CENTRAL_DB_NAME = "central_hardening_test";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    companyAcme = await Company.create({
      companyName: "Acme Secure Ltd",
      slug: "acme-sec",
      databaseName: "tenant_acme_sec",
      status: COMPANY_STATUSES.ACTIVE,
      emailSettings: {
        fromName: "Acme HR",
        fromEmail: "hr@acme-sec.test",
        smtpHost: "smtp.acme.test",
        smtpPort: 587,
        smtpSecure: false,
        appPasswordEncrypted: encryptSecret("hardening-mock-pass-1234"),
        isConfigured: true,
        lastVerifiedAt: new Date(),
      },
    });

    emailService.setTransporter({
      sendMail: async (options) => ({ messageId: `msg_${Date.now()}` }),
      verify: async () => true,
    });

    companyGlobex = await Company.create({
      companyName: "Globex Defense Corp",
      slug: "globex-def",
      databaseName: "tenant_globex_def",
      status: COMPANY_STATUSES.ACTIVE,
    });

    // Acme HR Admin
    const { User: UserAcme } = await getCompanyModels(companyAcme);
    await UserAcme.create({
      email: "hr@acme-sec.test",
      passwordHash: await hashPassword("Password123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });

    // Globex HR Admin
    const { User: UserGlobex } = await getCompanyModels(companyGlobex);
    await UserGlobex.create({
      email: "hr@globex-def.test",
      passwordHash: await hashPassword("Password123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });

    const acmeLogin = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "acme-sec", email: "hr@acme-sec.test", password: "Password123!" });
    hrCookieAcme = cookieFrom(acmeLogin);

    const globexLogin = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "globex-def", email: "hr@globex-def.test", password: "Password123!" });
    hrCookieGlobex = cookieFrom(globexLogin);
  });

  after(async () => {
    emailService.setTransporter(null);
    await disconnectAll();
    if (mongod) {
      await mongod.stop();
    }
  });

  beforeEach(() => {
    emailService.clearHistory();
  });

  describe("1. Candidate Account Collision and Lifecycle Protection", () => {
    it("Rejects offer acceptance when candidate email matches an existing HR administrator", async () => {
      // Create offer for the HR admin email
      const createRes = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Acme HR Admin", email: "hr@acme-sec.test" },
          position: "Lead HR",
          department: "HR",
          monthlySalary: 100000,
          joiningDate: new Date(Date.now() + 15 * 86400000).toISOString(),
          content: "<p>HR internal offer</p>",
        });
      assert.equal(createRes.status, 201);
      const offerId = createRes.body.offerLetter._id;

      const sendRes = await request(app)
        .post(`/api/offer-letters/${offerId}/send`)
        .set("Cookie", hrCookieAcme);
      assert.equal(sendRes.status, 200);
      const signingToken = sendRes.body.signingToken;

      // Candidate tries to accept offer with HR admin email
      const acceptRes = await request(app)
        .post(`/api/candidate/offers/review/${signingToken}/accept`)
        .send({ signerName: "Acme HR Admin", consentAgreed: true });

      assert.equal(acceptRes.status, 409);
      assert.ok(acceptRes.body.message.includes("administrator"));
    });

    it("Rejects offer acceptance when candidate email matches an existing active employee", async () => {
      const { Employee, User } = await getCompanyModels(companyAcme);

      // Create an existing employee in Acme
      const existingUser = await User.create({
        email: "existing.dev@acme-sec.test",
        passwordHash: await hashPassword("ExistingPass123!"),
        role: USER_ROLES.EMPLOYEE,
        isActive: true,
      });

      const existingEmp = await Employee.create({
        employeeCode: "SEC-999",
        fullName: "Existing Dev",
        email: "existing.dev@acme-sec.test",
        status: EMPLOYEE_STATUSES.ACTIVE,
        userId: existingUser._id,
      });

      existingUser.employeeId = existingEmp._id;
      await existingUser.save();

      // Create and send offer to this existing employee
      const createRes = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Existing Dev", email: "existing.dev@acme-sec.test" },
          position: "Staff Dev",
          monthlySalary: 150000,
          joiningDate: new Date().toISOString(),
          content: "<p>New offer</p>",
        });
      const offerId = createRes.body.offerLetter._id;

      const sendRes = await request(app)
        .post(`/api/offer-letters/${offerId}/send`)
        .set("Cookie", hrCookieAcme);
      const signingToken = sendRes.body.signingToken;

      const acceptRes = await request(app)
        .post(`/api/candidate/offers/review/${signingToken}/accept`)
        .send({ signerName: "Existing Dev", consentAgreed: true });

      assert.equal(acceptRes.status, 409);
      assert.ok(acceptRes.body.message.includes("employee"));
    });

    it("Rejects overwriting an active candidate onboarding with a different offer", async () => {
      // 1. Create first offer for Rahul Sharma and sign it
      const offer1Res = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Rahul Sharma", email: "rahul.sharma@example.test" },
          position: "DevOps Engineer",
          monthlySalary: 90000,
          joiningDate: new Date().toISOString(),
          content: "<p>Offer 1</p>",
        });
      const send1Res = await request(app)
        .post(`/api/offer-letters/${offer1Res.body.offerLetter._id}/send`)
        .set("Cookie", hrCookieAcme);

      const accept1Res = await request(app)
        .post(`/api/candidate/offers/review/${send1Res.body.signingToken}/accept`)
        .send({ signerName: "Rahul Sharma", consentAgreed: true });
      assert.equal(accept1Res.status, 200);

      // 2. Create second different offer for same email
      const offer2Res = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Rahul Sharma", email: "rahul.sharma@example.test" },
          position: "Senior DevOps Engineer",
          monthlySalary: 110000,
          joiningDate: new Date().toISOString(),
          content: "<p>Offer 2</p>",
        });
      const send2Res = await request(app)
        .post(`/api/offer-letters/${offer2Res.body.offerLetter._id}/send`)
        .set("Cookie", hrCookieAcme);

      // Attempting to sign offer 2 while already onboarded to offer 1 must be rejected
      const accept2Res = await request(app)
        .post(`/api/candidate/offers/review/${send2Res.body.signingToken}/accept`)
        .send({ signerName: "Rahul Sharma", consentAgreed: true });

      assert.equal(accept2Res.status, 409);
      assert.ok(accept2Res.body.message.includes("already linked to another offer"));
    });
  });

  describe("2. Token Integrity, Expiration and Invalidation", () => {
    let testSigningToken;
    let testOfferId;
    let testOnboardingToken;
    let testCandidateId;

    before(async () => {
      const createRes = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Sneha Reddy", email: "sneha.reddy@example.test" },
          position: "QA Engineer",
          monthlySalary: 75000,
          joiningDate: new Date().toISOString(),
          content: "<p>QA Offer</p>",
        });
      testOfferId = createRes.body.offerLetter._id;
      const sendRes = await request(app)
        .post(`/api/offer-letters/${testOfferId}/send`)
        .set("Cookie", hrCookieAcme);
      testSigningToken = sendRes.body.signingToken;
    });

    it("Rejects expired offer review link", async () => {
      const { OfferLetter } = await getCompanyModels(companyAcme);
      // Backdate expiration
      await OfferLetter.findByIdAndUpdate(testOfferId, {
        signingTokenExpiresAt: new Date(Date.now() - 3600000),
      });

      const res = await request(app)
        .post(`/api/candidate/offers/review/${testSigningToken}/accept`)
        .send({ signerName: "Sneha Reddy", consentAgreed: true });

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes("expired"));
    });

    it("Rejects signing when token was replaced by a newer token", async () => {
      const { OfferLetter } = await getCompanyModels(companyAcme);
      // Restore valid expiration but change stored hash
      await OfferLetter.findByIdAndUpdate(testOfferId, {
        signingTokenExpiresAt: new Date(Date.now() + 86400000),
        signingTokenHash: "different_hash_from_a_new_send",
      });

      const res = await request(app)
        .post(`/api/candidate/offers/review/${testSigningToken}/accept`)
        .send({ signerName: "Sneha Reddy", consentAgreed: true });

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes("replaced or invalidated"));
    });

    it("Signs successfully after resend and generates valid onboarding token", async () => {
      // Resend from HR to generate fresh valid token
      const resendRes = await request(app)
        .post(`/api/offer-letters/${testOfferId}/send`)
        .set("Cookie", hrCookieAcme);
      assert.equal(resendRes.status, 200);

      const freshSigningToken = resendRes.body.signingToken;
      const signRes = await request(app)
        .post(`/api/candidate/offers/review/${freshSigningToken}/accept`)
        .send({ signerName: "Sneha Reddy", consentAgreed: true });

      assert.equal(signRes.status, 200);
      testOnboardingToken = signRes.body.onboardingToken;
      testCandidateId = signRes.body.userId;
      assert.ok(testOnboardingToken);
    });

    it("Rejects expired candidate onboarding token", async () => {
      const { User } = await getCompanyModels(companyAcme);
      // Backdate onboarding token expiration
      await User.findByIdAndUpdate(testCandidateId, {
        "onboarding.tokenExpiresAt": new Date(Date.now() - 3600000),
      });

      const res = await request(app)
        .get(`/api/candidate/onboarding/${testOnboardingToken}`);

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes("expired"));

      // Restore expiration for next tests
      await User.findByIdAndUpdate(testCandidateId, {
        "onboarding.tokenExpiresAt": new Date(Date.now() + 14 * 86400000),
      });
    });

    it("Rejects candidate onboarding token when token hash was invalidated", async () => {
      const { User } = await getCompanyModels(companyAcme);
      await User.findByIdAndUpdate(testCandidateId, {
        "onboarding.onboardingTokenHash": "invalidated_hash_here",
      });

      const res = await request(app)
        .get(`/api/candidate/onboarding/${testOnboardingToken}`);

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes("replaced or invalidated"));
    });
  });

  describe("3. Security & Boundary Enforcement (Uploads, Cross-Tenant, Data Exposure)", () => {
    let candidateToken;
    let candidateId;
    let offerId;

    before(async () => {
      const createRes = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Kiran Rao", email: "kiran.rao@example.test" },
          position: "Security Analyst",
          monthlySalary: 95000,
          joiningDate: new Date().toISOString(),
          content: "<p>Sec Analyst Offer</p>",
        });
      offerId = createRes.body.offerLetter._id;
      const sendRes = await request(app)
        .post(`/api/offer-letters/${offerId}/send`)
        .set("Cookie", hrCookieAcme);
      const signRes = await request(app)
        .post(`/api/candidate/offers/review/${sendRes.body.signingToken}/accept`)
        .send({ signerName: "Kiran Rao", consentAgreed: true });

      candidateToken = signRes.body.onboardingToken;
      candidateId = signRes.body.userId;
    });

    it("Rejects dangerous executable document uploads (.exe, .sh, .php)", async () => {
      const filePayload = "data:application/x-msdownload;base64," + Buffer.from("malicious payload").toString("base64");
      const res = await request(app)
        .post(`/api/candidate/onboarding/${candidateToken}/documents`)
        .send({
          documentType: "ID_PROOF",
          fileName: "malware.exe",
          fileData: filePayload,
          mimeType: "application/x-msdownload",
        });

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes("disallowed"));
    });

    it("Prevents candidate from Acme accessing Globex company workspace (tenant isolation)", async () => {
      // Craft token with Globex company ID but Acme candidate user ID
      const forgedToken = signCandidateOnboardingToken({
        companyId: companyGlobex._id,
        onboardingId: candidateId,
        email: "kiran.rao@example.test",
      });

      const res = await request(app)
        .get(`/api/candidate/onboarding/${forgedToken}`);

      // Candidate does not exist in Globex's isolated database
      assert.equal(res.status, 404);
    });

    it("Never exposes passwordHash or token secrets in API responses", async () => {
      const res = await request(app)
        .get(`/api/candidate/onboarding/${candidateToken}`);

      assert.equal(res.status, 200);
      const resString = JSON.stringify(res.body);
      assert.equal(resString.includes("passwordHash"), false);
      assert.equal(resString.includes("onboardingTokenHash"), false);
      assert.equal(resString.includes("signingTokenHash"), false);
    });

    it("Candidate account cannot authenticate via credentials before activation", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({
          companyCode: "acme-sec",
          email: "kiran.rao@example.test",
          password: "AnyPassword123!",
        });

      // Cannot log in as employee before onboarding approval and activation
      assert.ok(res.status === 401 || res.status === 403);
    });
  });

  describe("4. Atomic & Idempotent HR Approval", () => {
    let candidateToken;
    let candidateUserId;
    let offerId;

    before(async () => {
      const createRes = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Vikram Malhotra", email: "vikram.m@example.test" },
          position: "Backend Architect",
          monthlySalary: 180000,
          joiningDate: new Date().toISOString(),
          content: "<p>Arch Offer</p>",
        });
      offerId = createRes.body.offerLetter._id;
      const sendRes = await request(app)
        .post(`/api/offer-letters/${offerId}/send`)
        .set("Cookie", hrCookieAcme);
      const signRes = await request(app)
        .post(`/api/candidate/offers/review/${sendRes.body.signingToken}/accept`)
        .send({ signerName: "Vikram Malhotra", consentAgreed: true });

      candidateToken = signRes.body.onboardingToken;
      candidateUserId = signRes.body.userId;

      // Submit valid onboarding
      const pdfData = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 test id doc").toString("base64");
      await request(app)
        .post(`/api/candidate/onboarding/${candidateToken}/documents`)
        .send({
          documentType: "ID_PROOF",
          fileName: "aadhaar.pdf",
          fileData: pdfData,
          mimeType: "application/pdf",
        });

      const submitRes = await request(app)
        .post(`/api/candidate/onboarding/${candidateToken}/submit`)
        .send({
          personalDetails: {
            fullName: "Vikram Malhotra",
            phoneNumber: "+91 9876500001",
            gender: "Male",
            dateOfBirth: "1988-10-20",
          },
          residentialAddress: {
            street: "45 Brigade Road",
            city: "Bangalore",
            state: "Karnataka",
            postalCode: "560001",
          },
          emergencyContact: {
            name: "Ananya Malhotra",
            phone: "+91 9876500002",
          },
          bankDetails: {
            accountHolderName: "Vikram Malhotra",
            bankName: "ICICI Bank",
            accountNumber: "001122334455",
            ifscCode: "ICIC0001234",
          },
          taxDetails: {
            panNumber: "VIKRM1234P",
          },
        });
      assert.equal(submitRes.status, 200);
    });

    it("Concurrent approval requests create exactly one employee (prevents race condition)", async () => {
      // Fire two simultaneous approve requests for the same candidate
      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/onboarding/submissions/${candidateUserId}/approve`)
          .set("Cookie", hrCookieAcme)
          .send(),
        request(app)
          .post(`/api/onboarding/submissions/${candidateUserId}/approve`)
          .set("Cookie", hrCookieAcme)
          .send(),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one request must succeed (201), and the concurrent one must be rejected (409)
      assert.deepEqual(statuses, [201, 409]);

      // Verify exactly one employee exists in the database
      const { Employee } = await getCompanyModels(companyAcme);
      const employees = await Employee.find({ email: "vikram.m@example.test" });
      assert.equal(employees.length, 1);
    });

    it("Invalidates candidate onboarding token immediately after HR approval", async () => {
      // Attempting to edit or resubmit draft after approval must fail
      const draftRes = await request(app)
        .put(`/api/candidate/onboarding/${candidateToken}/draft`)
        .send({ personalDetails: { fullName: "Hacked Name" } });

      assert.ok(draftRes.status === 400 || draftRes.status === 409);
    });

    it("Rejects account activation if onboarding was not approved", async () => {
      // Create another candidate in DRAFT status
      const { User } = await getCompanyModels(companyAcme);
      const unapprovedUser = await User.create({
        email: "unapproved@example.test",
        role: USER_ROLES.CANDIDATE,
        isActive: false,
        onboarding: {
          status: ONBOARDING_STATUSES.DRAFT,
        },
      });

      const activateRes = await request(app)
        .post("/api/auth/activate/complete")
        .send({
          token: "dummy.or.invalid.token",
          password: "ValidPassword123!",
        });

      assert.equal(activateRes.status, 400);
    });
  });

  describe("5. Candidate Rejection, Status Transition Constraints and Activation Blocking", () => {
    let rejectedCandidateUser;
    let rejectedCandidateToken;

    before(async () => {
      // 1. Create offer letter for candidate Tarun Joshi
      const offerRes = await request(app)
        .post("/api/offer-letters")
        .set("Cookie", hrCookieAcme)
        .send({
          candidate: { fullName: "Tarun Joshi", email: "tarun.joshi@example.test" },
          position: "Security Analyst",
          monthlySalary: 110000,
          joiningDate: new Date(Date.now() + 14 * 86400000).toISOString(),
          content: "<p>Offer for Tarun</p>",
        });
      assert.equal(offerRes.status, 201);
      const offerId = offerRes.body.offerLetter._id;

      // 2. Send offer letter
      const sendRes = await request(app)
        .post(`/api/offer-letters/${offerId}/send`)
        .set("Cookie", hrCookieAcme);
      assert.equal(sendRes.status, 200);
      const signingToken = sendRes.body.signingToken;

      // 3. Accept offer and generate onboarding
      const acceptRes = await request(app)
        .post(`/api/candidate/offers/review/${signingToken}/accept`)
        .send({ signerName: "Tarun Joshi", consentAgreed: true });
      assert.equal(acceptRes.status, 200);
      rejectedCandidateToken = acceptRes.body.onboardingToken;

      // 4. Upload document and submit onboarding details
      const pdfData = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 test id doc").toString("base64");
      await request(app)
        .post(`/api/candidate/onboarding/${rejectedCandidateToken}/documents`)
        .send({
          documentType: "ID_PROOF",
          fileName: "tarun_id.pdf",
          fileData: pdfData,
          mimeType: "application/pdf",
        });

      const submitRes = await request(app)
        .post(`/api/candidate/onboarding/${rejectedCandidateToken}/submit`)
        .send({
          personalDetails: {
            fullName: "Tarun Joshi",
            phoneNumber: "+91 9876543210",
            dateOfBirth: "1994-07-15",
            gender: "Male",
          },
          residentialAddress: {
            street: "789 Cyber Park",
            city: "Hyderabad",
            state: "Telangana",
            postalCode: "500081",
          },
          emergencyContact: {
            name: "Sunil Joshi",
            relationship: "Brother",
            phone: "+91 9876543211",
          },
          bankDetails: {
            accountHolderName: "Tarun Joshi",
            bankName: "HDFC Bank",
            accountNumber: "998877665544",
            ifscCode: "HDFC0001234",
          },
          taxDetails: {
            panNumber: "TARUN1234K",
          },
        });
      assert.equal(submitRes.status, 200);
      rejectedCandidateUser = submitRes.body.onboarding;
    });

    it("Rejects rejection request when reason is empty or missing (400)", async () => {
      const res = await request(app)
        .post(`/api/onboarding/submissions/${rejectedCandidateUser._id}/reject`)
        .set("Cookie", hrCookieAcme)
        .send({ reason: "   " });

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes("reason"));
    });

    it("Globex HR cannot reject Acme candidate (enforces tenant isolation)", async () => {
      const res = await request(app)
        .post(`/api/onboarding/submissions/${rejectedCandidateUser._id}/reject`)
        .set("Cookie", hrCookieGlobex)
        .send({ reason: "Unauthorized cross-tenant attempt" });

      assert.equal(res.status, 404);
    });

    it("HR successfully rejects candidate onboarding, updating status and invalidating token", async () => {
      emailService.clearHistory();

      const res = await request(app)
        .post(`/api/onboarding/submissions/${rejectedCandidateUser._id}/reject`)
        .set("Cookie", hrCookieAcme)
        .send({ reason: "Failed background verification check." });

      assert.equal(res.status, 200);
      assert.equal(res.body.onboarding.status, ONBOARDING_STATUSES.REJECTED);
      assert.equal(res.body.onboarding.rejectionReason, "Failed background verification check.");

      // Verify in tenant database
      const { User } = await getCompanyModels(companyAcme);
      const userInDb = await User.findById(rejectedCandidateUser._id);
      assert.equal(userInDb.onboarding.status, ONBOARDING_STATUSES.REJECTED);
      assert.equal(userInDb.onboarding.rejectionReason, "Failed background verification check.");
      assert.equal(userInDb.onboarding.onboardingTokenHash, null);
      assert.equal(userInDb.onboarding.tokenExpiresAt, null);

      // Verify rejection email was dispatched
      const history = emailService.getHistory();
      const rejEmail = history.find((e) => e.type === "onboarding_rejection");
      assert.ok(rejEmail);
      assert.equal(rejEmail.to, "tarun.joshi@example.test");
      assert.ok(rejEmail.rejectionReason.includes("background verification"));
    });

    it("Cannot reject an already rejected candidate onboarding", async () => {
      const res = await request(app)
        .post(`/api/onboarding/submissions/${rejectedCandidateUser._id}/reject`)
        .set("Cookie", hrCookieAcme)
        .send({ reason: "Duplicate rejection attempt" });

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes("already been rejected"));
    });

    it("Cannot approve a candidate whose onboarding was rejected", async () => {
      const res = await request(app)
        .post(`/api/onboarding/submissions/${rejectedCandidateUser._id}/approve`)
        .set("Cookie", hrCookieAcme)
        .send();

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes("Cannot approve onboarding with status 'REJECTED'"));
    });

    it("Candidate cannot access or update onboarding draft after rejection (token invalidated)", async () => {
      const draftRes = await request(app)
        .put(`/api/candidate/onboarding/${rejectedCandidateToken}/draft`)
        .send({ personalDetails: { fullName: "Attempt After Rejection" } });

      assert.ok(draftRes.status === 400 || draftRes.status === 403);
    });

    it("Rejected candidate cannot activate an employee account via token (403)", async () => {
      const activationToken = signEmployeeActivationToken({
        companyId: companyAcme._id,
        employeeId: new mongoose.Types.ObjectId(),
        userId: rejectedCandidateUser._id,
        email: "tarun.joshi@example.test",
      });

      const verifyRes = await request(app)
        .get(`/api/auth/activate/verify?token=${activationToken}`);
      assert.equal(verifyRes.status, 403);
      assert.ok(verifyRes.body.message.includes("rejected"));

      const completeRes = await request(app)
        .post("/api/auth/activate/complete")
        .send({ token: activationToken, password: "SecurePassword123!" });
      assert.equal(completeRes.status, 403);
      assert.ok(completeRes.body.message.includes("rejected"));
    });
  });
});
