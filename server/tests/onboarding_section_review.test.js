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
import { USER_ROLES, ONBOARDING_STATUSES, SECTION_REVIEW_STATUSES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import { emailService } from "../services/emailService.js";
import { onboardingEvents } from "../services/onboardingEventsService.js";
import { encryptSecret } from "../utils/secretCrypto.js";
import { CANDIDATE_SIGNATURE_FIELDS, HR_SIGNATURE_LETTERHEAD } from "./helpers/offerSignature.js";
import { ONBOARDING_SECTIONS, approveAllSections, approveSection } from "./helpers/onboardingReview.js";

let mongod;
let app;
let companyAcme;
let companyGlobex;
let hrCookieAcme;
let hrCookieGlobex;

function cookieFrom(res) {
  const header = res.headers["set-cookie"];
  if (!header) return "";
  return Array.isArray(header) ? header[0] : header;
}

function reviewSection(cookie, submissionId, section, body) {
  return request(app)
    .post(`/api/onboarding/submissions/${submissionId}/sections/${section}/review`)
    .set("Cookie", cookie)
    .send(body);
}

function collectEvents() {
  const events = [];
  const listener = (event) => events.push(event);
  onboardingEvents.on("onboarding_update", listener);
  return {
    events,
    stop: () => onboardingEvents.off("onboarding_update", listener),
  };
}

async function createSubmittedCandidate(fullName, email) {
  const createRes = await request(app)
    .post("/api/offer-letters")
    .set("Cookie", hrCookieAcme)
    .send({
      candidate: { fullName, email },
      position: "Platform Engineer",
      department: "Engineering",
      monthlySalary: 100000,
      joiningDate: new Date(Date.now() + 10 * 86400000).toISOString(),
      content: "<p>Offer</p>",
    });
  assert.equal(createRes.status, 201);
  const offerId = createRes.body.offerLetter._id;

  const sendRes = await request(app)
    .post(`/api/offer-letters/${offerId}/send`)
    .set("Cookie", hrCookieAcme);
  assert.equal(sendRes.status, 200);

  const acceptRes = await request(app)
    .post(`/api/candidate/offers/review/${sendRes.body.signingToken}/accept`)
    .send({ signerName: fullName, consentAgreed: true, ...CANDIDATE_SIGNATURE_FIELDS });
  assert.equal(acceptRes.status, 200);

  let token = acceptRes.body.onboardingToken;
  const submissionId = acceptRes.body.userId;

  const pdf = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 id").toString("base64");
  const upload = await request(app)
    .post(`/api/candidate/onboarding/${token}/documents`)
    .send({ documentType: "ID_PROOF", fileName: "id.pdf", fileData: pdf, mimeType: "application/pdf" });
  assert.equal(upload.status, 201);

  const submit = await request(app)
    .post(`/api/candidate/onboarding/${token}/submit`)
    .send({
      personalDetails: {
        fullName,
        phoneNumber: "+91 9876500001",
        gender: "Female",
        dateOfBirth: "1992-03-04",
      },
      residentialAddress: { street: "1 Main Rd", city: "Pune", state: "MH", postalCode: "411001" },
      emergencyContact: { name: "Kin Person", relationship: "Sibling", phone: "+91 9876500002" },
      bankDetails: {
        accountHolderName: fullName,
        bankName: "HDFC Bank",
        accountNumber: "123456789012",
        ifscCode: "HDFC0001234",
      },
      taxDetails: { panNumber: "ABCDE1234F" },
    });
  assert.equal(submit.status, 200, JSON.stringify(submit.body));

  return { token, submissionId };
}

describe("Onboarding Section-Wise Review, Gated Final Approval and Realtime Events", () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "section_review_jwt_secret_12345678901234567890!";
    process.env.COOKIE_SECRET = "section_review_cookie_secret_12345678901234567890!";
    process.env.CENTRAL_DB_NAME = "central_section_review_test";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    companyAcme = await Company.create({
      letterhead: HR_SIGNATURE_LETTERHEAD,
      companyName: "Acme Sections Ltd",
      slug: "acme-sections",
      databaseName: "tenant_acme_sections",
      status: COMPANY_STATUSES.ACTIVE,
      emailSettings: {
        fromName: "Acme HR",
        fromEmail: "hr@acme-sections.test",
        smtpHost: "smtp.acme.test",
        smtpPort: 587,
        smtpSecure: false,
        appPasswordEncrypted: encryptSecret("section-review-pass-1234"),
        isConfigured: true,
        lastVerifiedAt: new Date(),
      },
    });
    companyGlobex = await Company.create({
      letterhead: HR_SIGNATURE_LETTERHEAD,
      companyName: "Globex Sections Corp",
      slug: "globex-sections",
      databaseName: "tenant_globex_sections",
      status: COMPANY_STATUSES.ACTIVE,
    });

    emailService.setTransporter({
      sendMail: async () => ({ messageId: `msg_${Date.now()}` }),
      verify: async () => true,
    });

    const { User: UserAcme } = await getCompanyModels(companyAcme);
    await UserAcme.create({
      email: "hr@acme-sections.test",
      passwordHash: await hashPassword("Password123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });
    const { User: UserGlobex } = await getCompanyModels(companyGlobex);
    await UserGlobex.create({
      email: "hr@globex-sections.test",
      passwordHash: await hashPassword("Password123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });

    const acmeLogin = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "acme-sections", email: "hr@acme-sections.test", password: "Password123!" });
    hrCookieAcme = cookieFrom(acmeLogin);
    const globexLogin = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "globex-sections", email: "hr@globex-sections.test", password: "Password123!" });
    hrCookieGlobex = cookieFrom(globexLogin);
  });

  after(async () => {
    emailService.setTransporter(null);
    await disconnectAll();
    if (mongod) await mongod.stop();
  });

  beforeEach(() => {
    emailService.clearHistory();
  });

  describe("Submission initialises every section as PENDING_REVIEW", () => {
    it("exposes sectionReviews to HR (list + detail) and candidate", async () => {
      const collector = collectEvents();
      const { token, submissionId } = await createSubmittedCandidate("Sec Init", "sec.init@example.test");
      collector.stop();

      const submissionEvent = collector.events.find(
        (e) => e.type === "SUBMISSION" && e.submissionId === String(submissionId)
      );
      assert.ok(submissionEvent, "SUBMISSION event must be emitted on submit");
      assert.equal(submissionEvent.companyId, String(companyAcme._id));
      assert.equal(submissionEvent.status, ONBOARDING_STATUSES.SUBMITTED);
      // No PII in event payload
      assert.equal(JSON.stringify(submissionEvent).includes("sec.init@example.test"), false);

      const detail = await request(app)
        .get(`/api/onboarding/submissions/${submissionId}`)
        .set("Cookie", hrCookieAcme);
      assert.equal(detail.status, 200);
      for (const key of ONBOARDING_SECTIONS) {
        assert.equal(detail.body.submission.sectionReviews[key].status, SECTION_REVIEW_STATUSES.PENDING_REVIEW);
      }

      const list = await request(app).get("/api/onboarding/submissions").set("Cookie", hrCookieAcme);
      const row = list.body.submissions.find((s) => s.candidateEmail === "sec.init@example.test");
      assert.ok(row);
      assert.equal(row.sectionReviews.documents.status, SECTION_REVIEW_STATUSES.PENDING_REVIEW);
      assert.equal(JSON.stringify(list.body).includes("onboardingTokenHash"), false);

      const candidateView = await request(app).get(`/api/candidate/onboarding/${token}`);
      assert.equal(candidateView.status, 200);
      assert.equal(
        candidateView.body.onboarding.sectionReviews.personalDetails.status,
        SECTION_REVIEW_STATUSES.PENDING_REVIEW
      );
    });
  });

  describe("Section decisions", () => {
    let submissionId;
    let candidateToken;

    before(async () => {
      ({ submissionId, token: candidateToken } = await createSubmittedCandidate(
        "Sec Decisions",
        "sec.decisions@example.test"
      ));
    });

    it("requires a note for REJECT and REQUEST_CORRECTION, validates decision and section", async () => {
      const noNote = await reviewSection(hrCookieAcme, submissionId, "personalDetails", {
        decision: "REQUEST_CORRECTION",
      });
      assert.equal(noNote.status, 400);
      const noNoteReject = await reviewSection(hrCookieAcme, submissionId, "personalDetails", {
        decision: "REJECT",
        note: "   ",
      });
      assert.equal(noNoteReject.status, 400);
      const badDecision = await reviewSection(hrCookieAcme, submissionId, "personalDetails", {
        decision: "MAYBE",
      });
      assert.equal(badDecision.status, 400);
      const badSection = await reviewSection(hrCookieAcme, submissionId, "nonsense", { decision: "APPROVE" });
      assert.equal(badSection.status, 400);
    });

    it("tenant isolation: other tenant HR cannot review", async () => {
      const res = await reviewSection(hrCookieGlobex, submissionId, "personalDetails", { decision: "APPROVE" });
      assert.equal(res.status, 404);
    });

    it("approving one section does not auto-approve any other", async () => {
      const res = await approveSection(app, hrCookieAcme, submissionId, "personalDetails");
      assert.equal(res.status, 200);
      assert.equal(res.body.sectionStatus, SECTION_REVIEW_STATUSES.APPROVED);
      assert.equal(res.body.allSectionsApproved, false);
      assert.equal(res.body.status, ONBOARDING_STATUSES.SUBMITTED);
      assert.equal(res.body.sectionReviews.residentialAddress.status, SECTION_REVIEW_STATUSES.PENDING_REVIEW);
      assert.equal(res.body.sectionReviews.documents.status, SECTION_REVIEW_STATUSES.PENDING_REVIEW);
    });

    it("request-correction on a section flips overall to CHANGES_REQUESTED, emails section notes and emits events", async () => {
      const collector = collectEvents();
      const res = await reviewSection(hrCookieAcme, submissionId, "emergencyContact", {
        decision: "REQUEST_CORRECTION",
        note: "Emergency phone must be 10 digits.",
      });
      collector.stop();

      assert.equal(res.status, 200);
      assert.equal(res.body.status, ONBOARDING_STATUSES.CHANGES_REQUESTED);
      assert.equal(res.body.sectionReviews.emergencyContact.status, SECTION_REVIEW_STATUSES.CORRECTION_REQUESTED);
      assert.equal(res.body.sectionReviews.emergencyContact.note, "Emergency phone must be 10 digits.");
      assert.equal(res.body.sectionReviews.personalDetails.status, SECTION_REVIEW_STATUSES.APPROVED);
      assert.ok(res.body.onboardingToken);
      assert.equal(JSON.stringify(res.body).includes("onboardingTokenHash"), false);

      const email = emailService.getHistory().find((e) => e.type === "onboarding_correction_request");
      assert.ok(email);
      assert.equal(email.to, "sec.decisions@example.test");
      assert.ok(email.correctionReason.includes("Emergency contact"));
      assert.ok(email.correctionReason.includes("10 digits"));

      assert.ok(collector.events.some((e) => e.type === "SECTION_REVIEW" && e.section === "emergencyContact"));
      assert.ok(collector.events.some((e) => e.type === "CORRECTION_REQUESTED"));

      candidateToken = res.body.onboardingToken;
    });

    it("final approval is blocked while any section is not approved", async () => {
      const res = await request(app)
        .post(`/api/onboarding/submissions/${submissionId}/approve`)
        .set("Cookie", hrCookieAcme)
        .send();
      assert.equal(res.status, 400);
    });

    it("candidate sees the section note; approved sections are locked, flagged section is editable", async () => {
      const view = await request(app).get(`/api/candidate/onboarding/${candidateToken}`);
      assert.equal(view.status, 200);
      assert.equal(view.body.onboarding.status, ONBOARDING_STATUSES.CHANGES_REQUESTED);
      assert.equal(view.body.onboarding.sectionReviews.emergencyContact.note, "Emergency phone must be 10 digits.");
      assert.equal(view.body.onboarding.editableSections.emergencyContact, true);
      assert.equal(view.body.onboarding.editableSections.personalDetails, false);

      // Approved section is locked
      const locked = await request(app)
        .put(`/api/candidate/onboarding/${candidateToken}/draft`)
        .send({ personalDetails: { fullName: "Tampered Name" } });
      assert.equal(locked.status, 409);

      // Section still pending review (not flagged) is also locked while changes are requested
      const pendingLocked = await request(app)
        .put(`/api/candidate/onboarding/${candidateToken}/draft`)
        .send({ residentialAddress: { city: "Mumbai" } });
      assert.equal(pendingLocked.status, 409);

      // Documents section is locked too (not flagged)
      const pdf = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 x").toString("base64");
      const docLocked = await request(app)
        .post(`/api/candidate/onboarding/${candidateToken}/documents`)
        .send({ documentType: "OTHER", fileName: "x.pdf", fileData: pdf, mimeType: "application/pdf" });
      assert.equal(docLocked.status, 409);

      // Flagged section can be edited
      const ok = await request(app)
        .put(`/api/candidate/onboarding/${candidateToken}/draft`)
        .send({ emergencyContact: { name: "Kin Person", relationship: "Sibling", phone: "+91 9000000009" } });
      assert.equal(ok.status, 200);
    });

    it("candidate resubmission marks only corrected sections RESUBMITTED and restores SUBMITTED", async () => {
      const collector = collectEvents();
      const submit = await request(app).post(`/api/candidate/onboarding/${candidateToken}/submit`);
      collector.stop();
      assert.equal(submit.status, 200);
      assert.equal(submit.body.onboarding.status, ONBOARDING_STATUSES.SUBMITTED);
      assert.equal(submit.body.onboarding.sectionReviews.emergencyContact.status, SECTION_REVIEW_STATUSES.RESUBMITTED);
      assert.equal(submit.body.onboarding.sectionReviews.personalDetails.status, SECTION_REVIEW_STATUSES.APPROVED);
      assert.ok(collector.events.some((e) => e.type === "RESUBMITTED"));
    });

    it("REJECT on a section also requires candidate action; approving it again after resubmit works", async () => {
      const rej = await reviewSection(hrCookieAcme, submissionId, "documents", {
        decision: "REJECT",
        note: "ID proof is blurry.",
      });
      assert.equal(rej.status, 200);
      assert.equal(rej.body.status, ONBOARDING_STATUSES.CHANGES_REQUESTED);
      assert.equal(rej.body.sectionReviews.documents.status, SECTION_REVIEW_STATUSES.REJECTED);

      // A rejected section cannot be approved until the candidate resubmits it
      const premature = await approveSection(app, hrCookieAcme, submissionId, "documents");
      assert.equal(premature.status, 409);

      candidateToken = rej.body.onboardingToken;
      const pdf = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 clear").toString("base64");
      const up = await request(app)
        .post(`/api/candidate/onboarding/${candidateToken}/documents`)
        .send({ documentType: "ID_PROOF", fileName: "clear.pdf", fileData: pdf, mimeType: "application/pdf" });
      assert.equal(up.status, 201);

      const resubmit = await request(app).post(`/api/candidate/onboarding/${candidateToken}/submit`);
      assert.equal(resubmit.status, 200);
      assert.equal(resubmit.body.onboarding.sectionReviews.documents.status, SECTION_REVIEW_STATUSES.RESUBMITTED);
    });

    it("final approval gate: only passes once ALL sections are approved; creates no employee", async () => {
      const early = await request(app)
        .post(`/api/onboarding/submissions/${submissionId}/approve`)
        .set("Cookie", hrCookieAcme)
        .send();
      assert.equal(early.status, 400);

      await approveAllSections(app, hrCookieAcme, submissionId, [
        "residentialAddress",
        "emergencyContact",
        "bankAndTax",
        "documents",
      ]);

      emailService.clearHistory();
      const collector = collectEvents();
      const approve = await request(app)
        .post(`/api/onboarding/submissions/${submissionId}/approve`)
        .set("Cookie", hrCookieAcme)
        .send();
      collector.stop();

      assert.equal(approve.status, 200, JSON.stringify(approve.body));
      assert.equal(approve.body.employee, null);
      assert.ok(collector.events.some((e) => e.type === "HR_APPROVED"));
      assert.ok(collector.events.some((e) => e.type === "INVITE_SENT"));

      const { Employee, User } = await getCompanyModels(companyAcme);
      assert.equal(await Employee.countDocuments({ email: "sec.decisions@example.test" }), 0);
      const user = await User.findById(submissionId);
      assert.equal(user.onboarding.status, ONBOARDING_STATUSES.ACCOUNT_SETUP_SENT);
      assert.ok(user.onboarding.invitationSentAt);
      assert.equal(user.onboarding.onboardingTokenHash, null);

      // Frozen: no further section reviews or candidate edits
      const frozenReview = await reviewSection(hrCookieAcme, submissionId, "personalDetails", {
        decision: "REQUEST_CORRECTION",
        note: "too late",
      });
      assert.equal(frozenReview.status, 409);

      const invite = emailService.getHistory().find((e) => e.type === "employee_activation");
      assert.ok(invite);
      assert.ok(invite.activationLink.includes("/activate?token="));
      const activationToken = new URL(invite.activationLink).searchParams.get("token");

      // Activation creates the employee, once
      const collector2 = collectEvents();
      const activate = await request(app)
        .post("/api/auth/activate/complete")
        .send({ token: activationToken, password: "Section!Pass2026" });
      collector2.stop();
      assert.equal(activate.status, 200, JSON.stringify(activate.body));
      assert.equal(await Employee.countDocuments({ email: "sec.decisions@example.test" }), 1);
      assert.ok(collector2.events.some((e) => e.type === "EMPLOYEE_CREATED"));
      assert.ok(collector2.events.some((e) => e.type === "ACCOUNT_ACTIVATED"));

      const activated = await User.findById(submissionId);
      assert.equal(activated.onboarding.status, ONBOARDING_STATUSES.ACTIVATED);
      assert.equal(activated.role, USER_ROLES.EMPLOYEE);
      assert.equal(activated.isActive, true);

      // Resend after activation is refused
      const resend = await request(app)
        .post(`/api/onboarding/submissions/${submissionId}/resend-activation`)
        .set("Cookie", hrCookieAcme);
      assert.equal(resend.status, 400);
    });
  });

  describe("Whole-submission correction request", () => {
    it("flags all unapproved sections but keeps approved ones locked", async () => {
      const { submissionId } = await createSubmittedCandidate("Sec Global", "sec.global@example.test");
      await approveSection(app, hrCookieAcme, submissionId, "bankAndTax");

      const res = await request(app)
        .post(`/api/onboarding/submissions/${submissionId}/request-corrections`)
        .set("Cookie", hrCookieAcme)
        .send({ reason: "Please re-check the form." });
      assert.equal(res.status, 200);
      assert.equal(res.body.onboarding.sectionReviews.bankAndTax.status, SECTION_REVIEW_STATUSES.APPROVED);
      assert.equal(res.body.onboarding.sectionReviews.personalDetails.status, SECTION_REVIEW_STATUSES.CORRECTION_REQUESTED);

      const view = await request(app).get(`/api/candidate/onboarding/${res.body.onboardingToken}`);
      assert.equal(view.body.onboarding.editableSections.bankAndTax, false);
      assert.equal(view.body.onboarding.editableSections.personalDetails, true);
    });
  });

  describe("Realtime SSE endpoint", () => {
    it("requires HR authentication", async () => {
      const res = await request(app).get("/api/onboarding/events?probe=1");
      assert.ok(res.status === 401 || res.status === 403);
    });

    it("HR receives a CONNECTED ack scoped to their company", async () => {
      const res = await request(app)
        .get("/api/onboarding/events?probe=1")
        .set("Cookie", hrCookieAcme);
      assert.equal(res.status, 200);
      assert.ok(res.headers["content-type"].includes("text/event-stream"));
      assert.ok(res.text.includes("CONNECTED"));
      assert.ok(res.text.includes(String(companyAcme._id)));
    });

    it("the events route is not shadowed by /submissions/:id", async () => {
      const res = await request(app)
        .get("/api/onboarding/events?probe=1")
        .set("Cookie", hrCookieGlobex);
      assert.equal(res.status, 200);
      assert.ok(res.text.includes(String(companyGlobex._id)));
      assert.equal(res.text.includes(String(companyAcme._id)), false);
    });
  });
});
