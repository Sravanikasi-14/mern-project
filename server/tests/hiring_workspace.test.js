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
import { encryptSecret } from "../utils/secretCrypto.js";
import { CANDIDATE_SIGNATURE_FIELDS, HR_SIGNATURE_LETTERHEAD } from "./helpers/offerSignature.js";
import { approveAllSections } from "./helpers/onboardingReview.js";
import { deriveHiringStage, HIRING_STAGES } from "../controllers/hiringWorkspaceController.js";

let mongod;
let app;
let companyAcme;
let companyGlobex;
let hrCookieAcme;
let hrCookieGlobex;
let employeeCookie;

function cookieFrom(res) {
  const header = res.headers["set-cookie"];
  if (!header) return "";
  return Array.isArray(header) ? header[0] : header;
}

const HUGE_HTML = `<div>${"LOGO_DATA_URL_PLACEHOLDER,".repeat(8000)}</div>`;

async function createOffer(fullName, email, extra = {}) {
  const res = await request(app)
    .post("/api/offer-letters")
    .set("Cookie", hrCookieAcme)
    .send({
      candidate: { fullName, email },
      position: "Platform Engineer",
      department: "Engineering",
      monthlySalary: 100000,
      joiningDate: new Date(Date.now() + 10 * 86400000).toISOString(),
      content: `<p>Offer</p>${HUGE_HTML}`,
      ...extra,
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.offerLetter._id;
}

async function sendOffer(offerId) {
  const res = await request(app)
    .post(`/api/offer-letters/${offerId}/send`)
    .set("Cookie", hrCookieAcme);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.signingToken;
}

async function acceptOffer(signingToken, fullName) {
  const res = await request(app)
    .post(`/api/candidate/offers/review/${signingToken}/accept`)
    .send({ signerName: fullName, consentAgreed: true, ...CANDIDATE_SIGNATURE_FIELDS });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { token: res.body.onboardingToken, submissionId: res.body.userId };
}

async function submitOnboarding(token, fullName) {
  const pdf = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 id").toString("base64");
  const upload = await request(app)
    .post(`/api/candidate/onboarding/${token}/documents`)
    .send({ documentType: "ID_PROOF", fileName: "id.pdf", fileData: pdf, mimeType: "application/pdf" });
  assert.equal(upload.status, 201);
  const submit = await request(app)
    .post(`/api/candidate/onboarding/${token}/submit`)
    .send({
      personalDetails: { fullName, phoneNumber: "+91 9876500001", gender: "Female", dateOfBirth: "1992-03-04" },
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
}

function listHiring(query = "", cookie = hrCookieAcme) {
  return request(app).get(`/api/hiring/candidates${query}`).set("Cookie", cookie);
}

describe("Unified Hiring & Onboarding workspace API", () => {
  const ids = {};

  before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = "hiring_workspace_jwt_secret_12345678901234567890!";
    process.env.COOKIE_SECRET = "hiring_workspace_cookie_secret_12345678901234567890!";
    process.env.CENTRAL_DB_NAME = "central_hiring_workspace_test";

    await mongoose.connect(process.env.MONGO_URI, { dbName: getCentralDbName() });
    app = createApp();

    companyAcme = await Company.create({
      letterhead: HR_SIGNATURE_LETTERHEAD,
      companyName: "Acme Hiring Ltd",
      slug: "acme-hiring",
      databaseName: "tenant_acme_hiring",
      status: COMPANY_STATUSES.ACTIVE,
      emailSettings: {
        fromName: "Acme HR",
        fromEmail: "hr@acme-hiring.test",
        smtpHost: "smtp.acme.test",
        smtpPort: 587,
        smtpSecure: false,
        appPasswordEncrypted: encryptSecret("hiring-workspace-pass-1234"),
        isConfigured: true,
        lastVerifiedAt: new Date(),
      },
    });
    companyGlobex = await Company.create({
      letterhead: HR_SIGNATURE_LETTERHEAD,
      companyName: "Globex Hiring Corp",
      slug: "globex-hiring",
      databaseName: "tenant_globex_hiring",
      status: COMPANY_STATUSES.ACTIVE,
    });

    emailService.setTransporter({
      sendMail: async () => ({ messageId: `msg_${Date.now()}` }),
      verify: async () => true,
    });

    const { User: UserAcme } = await getCompanyModels(companyAcme);
    await UserAcme.create({
      email: "hr@acme-hiring.test",
      passwordHash: await hashPassword("Password123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });
    await UserAcme.create({
      email: "emp@acme-hiring.test",
      passwordHash: await hashPassword("Password123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
    });
    const { User: UserGlobex } = await getCompanyModels(companyGlobex);
    await UserGlobex.create({
      email: "hr@globex-hiring.test",
      passwordHash: await hashPassword("Password123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });

    const login = (companyCode, email) =>
      request(app).post("/api/auth/login").send({ companyCode, email, password: "Password123!" });
    hrCookieAcme = cookieFrom(await login("acme-hiring", "hr@acme-hiring.test"));
    employeeCookie = cookieFrom(await login("acme-hiring", "emp@acme-hiring.test"));
    hrCookieGlobex = cookieFrom(await login("globex-hiring", "hr@globex-hiring.test"));

    // 1. DRAFT offer
    ids.draft = await createOffer("Draft Dana", "draft.dana@example.test");

    // 2. SENT offer (awaiting signature)
    ids.sent = await createOffer("Sent Sam", "sent.sam@example.test");
    await sendOffer(ids.sent);

    // 3. ACCEPTED, onboarding not submitted yet
    ids.onboarding = await createOffer("Onboard Olu", "onboard.olu@example.test");
    const tokOnboarding = await sendOffer(ids.onboarding);
    const acc1 = await acceptOffer(tokOnboarding, "Onboard Olu");
    ids.onboardingUser = acc1.submissionId;

    // 4. SUBMITTED -> HR review
    ids.review = await createOffer("Review Rae", "review.rae@example.test");
    const tokReview = await sendOffer(ids.review);
    const acc2 = await acceptOffer(tokReview, "Review Rae");
    await submitOnboarding(acc2.token, "Review Rae");
    ids.reviewUser = acc2.submissionId;

    // 5. CHANGES_REQUESTED -> corrections
    ids.corr = await createOffer("Correct Cy", "correct.cy@example.test");
    const tokCorr = await sendOffer(ids.corr);
    const acc3 = await acceptOffer(tokCorr, "Correct Cy");
    await submitOnboarding(acc3.token, "Correct Cy");
    ids.corrUser = acc3.submissionId;
    const corrRes = await request(app)
      .post(`/api/onboarding/submissions/${acc3.submissionId}/request-corrections`)
      .set("Cookie", hrCookieAcme)
      .send({ reason: "Please fix phone" });
    assert.equal(corrRes.status, 200, JSON.stringify(corrRes.body));

    // 6. APPROVED -> account setup (invite only, no employee)
    ids.setup = await createOffer("Setup Sia", "setup.sia@example.test");
    const tokSetup = await sendOffer(ids.setup);
    const acc4 = await acceptOffer(tokSetup, "Setup Sia");
    await submitOnboarding(acc4.token, "Setup Sia");
    ids.setupUser = acc4.submissionId;
    await approveAllSections(app, hrCookieAcme, acc4.submissionId);
    const approve = await request(app)
      .post(`/api/onboarding/submissions/${acc4.submissionId}/approve`)
      .set("Cookie", hrCookieAcme);
    assert.equal(approve.status, 200, JSON.stringify(approve.body));
    assert.equal(approve.body.employee, null);
  });

  after(async () => {
    emailService.setTransporter(null);
    await disconnectAll();
    if (mongod) await mongod.stop();
  });

  beforeEach(() => {
    emailService.clearHistory();
  });

  describe("auth & tenant isolation", () => {
    it("rejects unauthenticated requests", async () => {
      const res = await request(app).get("/api/hiring/candidates");
      assert.equal(res.status, 401);
      const detail = await request(app).get(`/api/hiring/candidates/${ids.draft}`);
      assert.equal(detail.status, 401);
    });

    it("rejects non HR_ADMIN roles", async () => {
      const res = await listHiring("", employeeCookie);
      assert.equal(res.status, 403);
      const detail = await request(app)
        .get(`/api/hiring/candidates/${ids.draft}`)
        .set("Cookie", employeeCookie);
      assert.equal(detail.status, 403);
    });

    it("does not leak other tenants' candidates", async () => {
      const res = await listHiring("", hrCookieGlobex);
      assert.equal(res.status, 200);
      assert.equal(res.body.candidates.length, 0);
      assert.equal(res.body.summary.all, 0);

      const detail = await request(app)
        .get(`/api/hiring/candidates/${ids.draft}`)
        .set("Cookie", hrCookieGlobex);
      assert.equal(detail.status, 404);
    });
  });

  describe("GET /api/hiring/candidates (light list)", () => {
    it("returns light rows without HTML, signature blobs or onboarding section data", async () => {
      const res = await listHiring();
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.candidates.length, 6);

      const raw = JSON.stringify(res.body);
      for (const forbidden of [
        "LOGO_DATA_URL_PLACEHOLDER",
        "issuedContent",
        "offerDataSnapshot",
        "clauses",
        "onboardingTokenHash",
        "imageData",
        "bankDetails",
        "accountNumber",
        "1 Main Rd",
        "hrSignatureDataUrl",
      ]) {
        assert.equal(raw.includes(forbidden), false, `list must not include ${forbidden}`);
      }

      for (const row of res.body.candidates) {
        for (const key of [
          "offerId",
          "candidateUserId",
          "name",
          "email",
          "position",
          "offerStatus",
          "onboardingStatus",
          "stage",
          "sectionsPendingCount",
          "docsCount",
          "hasSignedPdf",
          "updatedAt",
          "emailDeliveryStatus",
        ]) {
          assert.ok(Object.hasOwn(row, key), `row must include ${key}`);
        }
        assert.equal(Object.hasOwn(row, "content"), false);
        assert.equal(Object.hasOwn(row, "issuedContent"), false);
      }
      // Whole payload stays tiny even though every offer stores ~200KB HTML.
      assert.ok(raw.length < 20000, `list payload too large: ${raw.length}`);
    });

    it("derives the lifecycle stage and section counters", async () => {
      const res = await listHiring();
      const byEmail = Object.fromEntries(res.body.candidates.map((r) => [r.email, r]));

      assert.equal(byEmail["draft.dana@example.test"].stage, HIRING_STAGES.OFFERS);
      assert.equal(byEmail["draft.dana@example.test"].offerStatus, "DRAFT");
      assert.equal(byEmail["draft.dana@example.test"].onboardingStatus, null);

      assert.equal(byEmail["sent.sam@example.test"].stage, HIRING_STAGES.OFFERS);
      assert.equal(byEmail["sent.sam@example.test"].offerStatus, "SENT");
      assert.equal(byEmail["sent.sam@example.test"].emailDeliveryStatus, "SENT");

      const onboarding = byEmail["onboard.olu@example.test"];
      assert.equal(onboarding.stage, HIRING_STAGES.ONBOARDING);
      assert.equal(onboarding.offerStatus, "ACCEPTED");
      assert.equal(String(onboarding.candidateUserId), String(ids.onboardingUser));

      const review = byEmail["review.rae@example.test"];
      assert.equal(review.stage, HIRING_STAGES.HR_REVIEW);
      assert.equal(review.onboardingStatus, ONBOARDING_STATUSES.SUBMITTED);
      assert.equal(review.sectionsPendingCount, 5);
      assert.equal(review.docsCount, 1);

      assert.equal(byEmail["correct.cy@example.test"].stage, HIRING_STAGES.CORRECTIONS);

      const setup = byEmail["setup.sia@example.test"];
      assert.equal(setup.stage, HIRING_STAGES.ACCOUNT_SETUP);
      assert.equal(setup.sectionsPendingCount, 0);
      assert.equal(setup.employeeId, null, "employee must not exist before activation");
    });

    it("returns summary counters and pagination in one response", async () => {
      const res = await listHiring("?limit=2&page=2");
      assert.equal(res.status, 200);
      assert.deepEqual(
        {
          all: res.body.summary.all,
          offers: res.body.summary.offers,
          onboarding: res.body.summary.onboarding,
          hrReview: res.body.summary.hrReview,
          corrections: res.body.summary.corrections,
          accountSetup: res.body.summary.accountSetup,
          completed: res.body.summary.completed,
        },
        { all: 6, offers: 2, onboarding: 1, hrReview: 1, corrections: 1, accountSetup: 1, completed: 0 }
      );
      assert.equal(res.body.candidates.length, 2);
      assert.equal(res.body.pagination.page, 2);
      assert.equal(res.body.pagination.limit, 2);
      assert.equal(res.body.pagination.total, 6);
      assert.equal(res.body.pagination.totalPages, 3);
    });

    it("defaults to limit 20 and caps limit at 100", async () => {
      const def = await listHiring();
      assert.equal(def.body.pagination.limit, 20);
      const capped = await listHiring("?limit=9999");
      assert.equal(capped.body.pagination.limit, 100);
    });

    it("filters by stage while counters stay global", async () => {
      const expectations = {
        OFFERS: ["draft.dana@example.test", "sent.sam@example.test"],
        ONBOARDING: ["onboard.olu@example.test"],
        HR_REVIEW: ["review.rae@example.test"],
        CORRECTIONS: ["correct.cy@example.test"],
        ACCOUNT_SETUP: ["setup.sia@example.test"],
        COMPLETED: [],
      };
      for (const [stage, emails] of Object.entries(expectations)) {
        const res = await listHiring(`?stage=${stage}`);
        assert.equal(res.status, 200, stage);
        assert.deepEqual(res.body.candidates.map((r) => r.email).sort(), [...emails].sort(), stage);
        assert.ok(res.body.candidates.every((r) => r.stage === stage));
        assert.equal(res.body.pagination.total, emails.length);
        assert.equal(res.body.summary.all, 6, "summary is independent of stage filter");
      }
      const all = await listHiring("?stage=ALL");
      assert.equal(all.body.candidates.length, 6);
    });

    it("rejects unknown stage values", async () => {
      const res = await listHiring("?stage=NOPE");
      assert.equal(res.status, 400);
    });

    it("supports search across name, email and position", async () => {
      const byName = await listHiring("?search=review%20rae");
      assert.equal(byName.body.candidates.length, 1);
      assert.equal(byName.body.candidates[0].email, "review.rae@example.test");
      const byEmail = await listHiring("?search=sent.sam");
      assert.equal(byEmail.body.candidates.length, 1);
      const byRole = await listHiring("?search=Platform&stage=OFFERS");
      assert.equal(byRole.body.candidates.length, 2);
      const none = await listHiring("?search=zzzz-no-match");
      assert.equal(none.body.candidates.length, 0);
      assert.equal(none.body.pagination.total, 0);
    });

    it("hides withdrawn offers from ALL but exposes them via stage=WITHDRAWN", async () => {
      const wId = await createOffer("Withdrawn Wes", "withdrawn.wes@example.test");
      await sendOffer(wId);
      const w = await request(app)
        .post(`/api/offer-letters/${wId}/withdraw`)
        .set("Cookie", hrCookieAcme)
        .send({ reason: "Role cancelled" });
      assert.equal(w.status, 200, JSON.stringify(w.body));

      const all = await listHiring("?limit=100");
      assert.equal(all.body.candidates.some((r) => r.email === "withdrawn.wes@example.test"), false);
      assert.equal(all.body.summary.all, 6);
      assert.equal(all.body.summary.withdrawn, 1);

      const withdrawn = await listHiring("?stage=WITHDRAWN");
      assert.equal(withdrawn.body.candidates.length, 1);
      assert.equal(withdrawn.body.candidates[0].stage, HIRING_STAGES.WITHDRAWN);
    });
  });

  describe("GET /api/hiring/candidates/:offerId (summary)", () => {
    it("returns a light header without HTML or section field data", async () => {
      const res = await request(app)
        .get(`/api/hiring/candidates/${ids.review}`)
        .set("Cookie", hrCookieAcme);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const c = res.body.candidate;
      assert.equal(c.stage, HIRING_STAGES.HR_REVIEW);
      assert.equal(c.offer.status, "ACCEPTED");
      assert.equal(c.offer.signature.method, "DRAW");
      assert.ok(c.offer.signature.signedAt);
      assert.equal(c.onboarding.status, ONBOARDING_STATUSES.SUBMITTED);
      assert.equal(c.onboarding.docsCount, 1);
      assert.equal(c.onboarding.sectionStatuses.personalDetails, "PENDING_REVIEW");
      assert.equal(c.onboarding.sectionStatuses.documents, "PENDING_REVIEW");
      assert.equal(c.employeeId, null);
      assert.equal(c.nextActions.canReviewOnboarding, true);
      assert.equal(c.nextActions.canApprove, false);
      assert.equal(c.nextActions.canResendActivation, false);

      const raw = JSON.stringify(res.body);
      for (const forbidden of [
        "LOGO_DATA_URL_PLACEHOLDER",
        "issuedContent",
        "content",
        "clauses",
        "bankDetails",
        "accountNumber",
        "onboardingTokenHash",
        "imageData",
      ]) {
        assert.equal(raw.includes(forbidden), false, `summary must not include ${forbidden}`);
      }
    });

    it("flags offer actions for DRAFT / SENT and invite actions for ACCOUNT_SETUP", async () => {
      const draft = await request(app)
        .get(`/api/hiring/candidates/${ids.draft}`)
        .set("Cookie", hrCookieAcme);
      assert.equal(draft.body.candidate.nextActions.canSendOffer, true);
      assert.equal(draft.body.candidate.nextActions.canResendOffer, false);
      assert.equal(draft.body.candidate.onboarding, null);

      const sent = await request(app)
        .get(`/api/hiring/candidates/${ids.sent}`)
        .set("Cookie", hrCookieAcme);
      assert.equal(sent.body.candidate.nextActions.canResendOffer, true);
      assert.equal(sent.body.candidate.nextActions.canWithdrawOffer, true);

      const setup = await request(app)
        .get(`/api/hiring/candidates/${ids.setup}`)
        .set("Cookie", hrCookieAcme);
      assert.equal(setup.body.candidate.stage, HIRING_STAGES.ACCOUNT_SETUP);
      assert.equal(setup.body.candidate.nextActions.canResendActivation, true);
      assert.equal(setup.body.candidate.employeeId, null);
      assert.equal(setup.body.candidate.onboarding.sectionsApprovedCount, 5);
    });

    it("validates and 404s unknown offers", async () => {
      const bad = await request(app).get("/api/hiring/candidates/not-an-id").set("Cookie", hrCookieAcme);
      assert.equal(bad.status, 400);
      const missing = await request(app)
        .get(`/api/hiring/candidates/${new mongoose.Types.ObjectId()}`)
        .set("Cookie", hrCookieAcme);
      assert.equal(missing.status, 404);
    });

    it("resolves the onboarding submission id for an offer", async () => {
      const res = await request(app)
        .get(`/api/hiring/candidates/${ids.review}/onboarding`)
        .set("Cookie", hrCookieAcme);
      assert.equal(res.status, 200);
      assert.equal(String(res.body.submissionId), String(ids.reviewUser));
      assert.equal(res.body.hasOnboarding, true);

      const none = await request(app)
        .get(`/api/hiring/candidates/${ids.draft}/onboarding`)
        .set("Cookie", hrCookieAcme);
      assert.equal(none.body.hasOnboarding, false);
    });
  });

  describe("Onboarding endpoints payload (performance fixes)", () => {
    it("detail populates only light offer fields and caps history", async () => {
      const res = await request(app)
        .get(`/api/onboarding/submissions/${ids.reviewUser}`)
        .set("Cookie", hrCookieAcme);
      assert.equal(res.status, 200);
      const offer = res.body.submission.offerLetterId;
      assert.equal(offer.position, "Platform Engineer");
      assert.equal(offer.signature.method, "DRAW");
      for (const key of ["content", "issuedContent", "offerDataSnapshot", "clauses", "generatedPdf"]) {
        assert.equal(Object.hasOwn(offer, key), false, `offer must not include ${key}`);
      }
      assert.equal(Object.hasOwn(offer.signature || {}, "imageData"), false);
      assert.equal(JSON.stringify(res.body).includes("LOGO_DATA_URL_PLACEHOLDER"), false);
      assert.ok(res.body.submission.history.length <= 30);
      assert.ok(res.body.submission.documents.length >= 1);
      assert.ok(res.body.submission.bankDetails);

      const fullOffer = await request(app)
        .get(`/api/offer-letters/${ids.review}`)
        .set("Cookie", hrCookieAcme);
      const lightBytes = Buffer.byteLength(JSON.stringify(res.body));
      const heavyBytes = Buffer.byteLength(JSON.stringify(fullOffer.body));
      assert.ok(lightBytes * 5 < heavyBytes, `detail ${lightBytes}B should be far smaller than full offer ${heavyBytes}B`);
      console.log(`[perf] onboarding detail=${lightBytes}B, full offer detail=${heavyBytes}B`);
    });

    it("slices history to the most recent 30 entries", async () => {
      const { User } = await getCompanyModels(companyAcme);
      const history = Array.from({ length: 45 }, (_, i) => ({
        action: `NOTE_${i}`,
        timestamp: new Date(Date.now() + i * 1000),
        actorRole: "SYSTEM",
        notes: `n${i}`,
      }));
      await User.updateOne({ _id: ids.onboardingUser }, { $push: { "onboarding.history": { $each: history } } });
      const res = await request(app)
        .get(`/api/onboarding/submissions/${ids.onboardingUser}`)
        .set("Cookie", hrCookieAcme);
      assert.equal(res.body.submission.history.length, 30);
      assert.equal(res.body.submission.history.at(-1).action, "NOTE_44");
      assert.ok(res.body.submission.historyTotal >= 45);
    });

    it("list defaults to summary projection (no bank / tax / address / full documents / history)", async () => {
      const res = await request(app).get("/api/onboarding/submissions").set("Cookie", hrCookieAcme);
      assert.equal(res.status, 200);
      assert.equal(res.body.include, "summary");
      const row = res.body.submissions.find((s) => s.candidateEmail === "review.rae@example.test");
      assert.ok(row);
      assert.equal(row.status, ONBOARDING_STATUSES.SUBMITTED);
      assert.equal(row.documentsCount, 1);
      assert.equal(row.sectionReviews.documents.status, "PENDING_REVIEW");
      for (const key of [
        "bankDetails",
        "taxDetails",
        "residentialAddress",
        "emergencyContact",
        "identityDetails",
        "documents",
        "history",
      ]) {
        assert.equal(Object.hasOwn(row, key), false, `list must not include ${key}`);
      }
      const raw = JSON.stringify(res.body);
      assert.equal(raw.includes("accountNumber"), false);
      assert.equal(raw.includes("LOGO_DATA_URL_PLACEHOLDER"), false);
      assert.equal(raw.includes("onboardingTokenHash"), false);
      assert.equal(String(row.offerLetterId._id), String(ids.review));
      assert.equal(Object.hasOwn(row.offerLetterId, "content"), false);
    });

    it("include=full keeps the legacy heavy list shape for older clients", async () => {
      const res = await request(app)
        .get("/api/onboarding/submissions?include=full")
        .set("Cookie", hrCookieAcme);
      assert.equal(res.status, 200);
      const row = res.body.submissions.find((s) => s.candidateEmail === "review.rae@example.test");
      assert.ok(row.bankDetails);
      assert.ok(Array.isArray(row.documents));
      assert.ok(Array.isArray(row.history));
    });
  });

  describe("Lifecycle rules preserved", () => {
    it("final approve is invite-only: no Employee until activation", async () => {
      const { Employee } = await getCompanyModels(companyAcme);
      const count = await Employee.countDocuments({ email: "setup.sia@example.test" });
      assert.equal(count, 0);
      const res = await request(app)
        .get(`/api/hiring/candidates/${ids.setup}`)
        .set("Cookie", hrCookieAcme);
      assert.equal(res.body.candidate.onboarding.status, ONBOARDING_STATUSES.ACCOUNT_SETUP_SENT);
    });

    it("deriveHiringStage mirrors the pipeline rules", () => {
      const d = (o) => deriveHiringStage({ hasOnboardingEmployee: false, offerHasEmployee: false, ...o });
      assert.equal(d({ offerStatus: "DRAFT" }), "OFFERS");
      assert.equal(d({ offerStatus: "WITHDRAWN" }), "WITHDRAWN");
      assert.equal(d({ offerStatus: "ACCEPTED", onboardingStatus: null }), "ONBOARDING");
      assert.equal(d({ offerStatus: "ACCEPTED", onboardingStatus: "SUBMITTED" }), "HR_REVIEW");
      assert.equal(d({ offerStatus: "ACCEPTED", onboardingStatus: "CHANGES_REQUESTED" }), "CORRECTIONS");
      assert.equal(d({ offerStatus: "ACCEPTED", onboardingStatus: "ACCOUNT_SETUP_PENDING" }), "ACCOUNT_SETUP");
      assert.equal(d({ offerStatus: "ACCEPTED", onboardingStatus: "ACTIVATED" }), "COMPLETED");
      assert.equal(d({ offerStatus: "DRAFT", offerHasEmployee: true }), "OFFERS");
    });

    it("an activated candidate (employee exists) moves to COMPLETED", async () => {
      const { User } = await getCompanyModels(companyAcme);
      const empId = new mongoose.Types.ObjectId();
      await User.updateOne(
        { _id: ids.setupUser },
        { $set: { "onboarding.status": "ACTIVATED", "onboarding.employeeId": empId } }
      );
      const res = await listHiring("?stage=COMPLETED");
      assert.equal(res.body.candidates.length, 1);
      assert.equal(res.body.candidates[0].email, "setup.sia@example.test");
      assert.equal(res.body.summary.completed, 1);
      assert.equal(res.body.summary.accountSetup, 0);
    });
  });
});
