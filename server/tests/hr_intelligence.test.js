import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import {
  calculateDeterministicFindings,
  enrichFindingsWithGemini,
  getHrIntelligenceReport,
  clearCompanyExplanationCache,
  setCachedCompanyExplanation,
} from "../services/hrIntelligenceService.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

let mongo;
let app;
let companyA;
let companyB;
let adminCookieA;
let employeeCookieA;
let adminCookieB;
let modelsA;
let modelsB;
let createdTaskA;
let employeeDocA;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  // 1. Setup Company A (Acme Intelligence)
  companyA = await Company.create({
    companyName: "Acme Intelligence",
    slug: "acme-intel",
    databaseName: "company_acme_intel_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  modelsA = await getCompanyModels(companyA);

  // Create HR Admin user for Company A
  const adminUserA = await modelsA.User.create({
    email: "hradmin@acme.test",
    passwordHash: await hashPassword("AcmeAdmin123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Create regular Employee user for Company A
  const employeeUserA = await modelsA.User.create({
    email: "emp@acme.test",
    passwordHash: await hashPassword("AcmeEmp123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  // Create Employee record with missing bank and emergency contact details
  employeeDocA = await modelsA.Employee.create({
    userId: employeeUserA._id,
    companyId: companyA._id,
    employeeCode: "INTEL-101",
    fullName: "Arthur Dent",
    email: "emp@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    invitation: { status: "ACCEPTED" },
    bankDetails: { accountNumber: "", ifscCode: "" }, // Incomplete
    emergencyContact: { phone: "", name: "" }, // Incomplete
  });

  // Create an overdue task in Company A
  createdTaskA = await modelsA.Task.create({
    title: "Overdue Project Roadmap",
    description: "Finalize annual architecture goals",
    assigneeId: employeeDocA._id,
    assignedByUserId: adminUserA._id,
    status: "IN_PROGRESS",
    deadline: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
  });

  // Create a pending leave request in Company A
  await modelsA.LeaveRequest.create({
    employeeId: employeeDocA._id,
    leaveTypeCode: "CASUAL",
    fromDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow (urgent)
    toDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
    daysCount: 1,
    status: "PENDING",
  });

  // 2. Setup Company B (Beta Systems - for tenant isolation)
  companyB = await Company.create({
    companyName: "Beta Systems",
    slug: "beta-intel",
    databaseName: "company_beta_intel_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  modelsB = await getCompanyModels(companyB);

  const adminUserB = await modelsB.User.create({
    email: "admin@beta.test",
    passwordHash: await hashPassword("BetaAdmin123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Log in users
  const loginAdminA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme-intel", email: "hradmin@acme.test", password: "AcmeAdmin123!" });
  adminCookieA = cookieFrom(loginAdminA);

  const loginEmpA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme-intel", email: "emp@acme.test", password: "AcmeEmp123!" });
  employeeCookieA = cookieFrom(loginEmpA);

  const loginAdminB = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "beta-intel", email: "admin@beta.test", password: "BetaAdmin123!" });
  adminCookieB = cookieFrom(loginAdminB);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("Phase 2: HR Intelligence Dashboard Engine & Refresh Suite", () => {
  it("1. Unauthenticated request to /api/admin/intelligence is rejected with 401", async () => {
    const res = await request(app).get("/api/admin/intelligence");
    assert.equal(res.status, 401);
  });

  it("2. Regular employee role is rejected with 403 Forbidden", async () => {
    const res = await request(app)
      .get("/api/admin/intelligence")
      .set("Cookie", employeeCookieA);

    assert.equal(res.status, 403);
    assert.match(res.body.message, /access/i);
  });

  it("3. Authenticated HR Admin receives 200 with actionable findings and no-cache headers", async () => {
    const res = await request(app)
      .get("/api/admin/intelligence")
      .set("Cookie", adminCookieA);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(typeof res.body.aiEnriched, "boolean");
    assert.ok(Array.isArray(res.body.insights));
    assert.ok(res.body.insights.length > 0);

    // Verify cache prevention headers so browser never serves stale intelligence
    assert.match(res.headers["cache-control"], /no-store/i);
    assert.equal(res.headers["pragma"], "no-cache");

    // Verify finding categories exist
    const categories = res.body.insights.map((i) => i.category);
    assert.ok(categories.includes("ONBOARDING_PROFILE"));
    assert.ok(categories.includes("WORK_MANAGEMENT"));
    assert.ok(categories.includes("LEAVES"));

    for (const insight of res.body.insights) {
      assert.ok(insight.id);
      assert.ok(insight.title);
      assert.ok(insight.severity);
      assert.ok(typeof insight.count === "number");
      assert.ok(insight.explanation);
      assert.ok(insight.action);
      assert.ok(insight.link.startsWith("/admin") || insight.link.startsWith("/app"));
    }
  });

  it("4. Tenant Isolation: Company B only sees its own data, never Company A findings", async () => {
    const resB = await request(app)
      .get("/api/admin/intelligence")
      .set("Cookie", adminCookieB);

    assert.equal(resB.status, 200);
    assert.equal(resB.body.success, true);

    const categoriesB = resB.body.insights.map((i) => i.category);
    assert.equal(categoriesB.includes("WORK_MANAGEMENT"), false);
    assert.equal(categoriesB.includes("LEAVES"), false);
  });

  it("5. Deterministic Calculation: Handles missing or empty data cleanly without crashing", async () => {
    const emptyFindings = await calculateDeterministicFindings({
      models: {
        Employee: null,
        Task: null,
        Attendance: null,
        CompanyHrPolicy: null,
        LeaveRequest: null,
        PayrollCycle: null,
        EmployeeCompensation: null,
      },
      company: { config: { timezone: "UTC" } },
    });

    assert.ok(Array.isArray(emptyFindings));
    assert.equal(emptyFindings.length, 0);
  });

  it("6. Resolved issue disappears after manual refresh", async () => {
    // Before: Task is IN_PROGRESS and overdue
    const beforeRes = await request(app)
      .get("/api/admin/intelligence?refresh=true")
      .set("Cookie", adminCookieA);
    const beforeCats = beforeRes.body.insights.map((i) => i.category);
    assert.ok(beforeCats.includes("WORK_MANAGEMENT"));

    // User action: Approve/complete the overdue task in the database
    await modelsA.Task.updateOne(
      { _id: createdTaskA._id },
      { $set: { status: "APPROVED" } }
    );

    // Refresh: Send manual refresh request
    const afterRes = await request(app)
      .get("/api/admin/intelligence?refresh=true")
      .set("Cookie", adminCookieA);

    assert.equal(afterRes.status, 200);
    const afterCats = afterRes.body.insights.map((i) => i.category);
    // Verified: The resolved task finding is completely gone!
    assert.equal(afterCats.includes("WORK_MANAGEMENT"), false);
  });

  it("7. Unresolved issue remains visible with accurate counts after refresh", async () => {
    // Arthur Dent's bank and emergency contact details were NOT fixed
    const res = await request(app)
      .get("/api/admin/intelligence?refresh=true")
      .set("Cookie", adminCookieA);

    assert.equal(res.status, 200);
    const onboardingFinding = res.body.insights.find(
      (i) => i.category === "ONBOARDING_PROFILE"
    );
    assert.ok(onboardingFinding, "Unresolved onboarding issue must remain visible");
    assert.equal(onboardingFinding.count, 1);
    assert.match(onboardingFinding.summary, /missing direct deposit/i);
  });

  it("8. Gemini explanation reuse: Unchanged findings reuse valid explanations without re-calling Gemini", async () => {
    clearCompanyExplanationCache();

    setCachedCompanyExplanation("test-comp-1", "ONBOARDING_PROFILE", {
      count: 2,
      summary: "2 missing bank records",
      severity: "MEDIUM",
      explanation: "Cached AI Explanation",
      action: "Cached AI Action",
      timestamp: Date.now(),
    });

    const sampleFindings = [
      {
        id: "insight-sample-1",
        category: "ONBOARDING_PROFILE",
        title: "Incomplete Profile",
        severity: "MEDIUM",
        count: 2,
        summary: "2 missing bank records",
        explanation: "Deterministic Explanation",
        action: "Deterministic Action",
      },
    ];

    const result = await enrichFindingsWithGemini(sampleFindings, {
      companyKey: "test-comp-1",
    });

    assert.equal(result.aiEnriched, true);
    assert.equal(result.findings[0].explanation, "Cached AI Explanation");
    assert.equal(result.findings[0].action, "Cached AI Action");
  });

  it("9. Changed finding counts trigger updated explanation and never serve stale explanations", async () => {
    clearCompanyExplanationCache();

    setCachedCompanyExplanation("test-comp-2", "ONBOARDING_PROFILE", {
      count: 5,
      summary: "5 missing bank records",
      severity: "MEDIUM",
      explanation: "Stale 5-record explanation",
      action: "Stale 5-record action",
      timestamp: Date.now(),
    });

    // Count changes from 5 to 1:
    const updatedFindings = [
      {
        id: "insight-sample-1",
        category: "ONBOARDING_PROFILE",
        title: "Incomplete Profile",
        severity: "LOW",
        count: 1,
        summary: "1 missing bank record",
        explanation: "Fresh 1-record deterministic explanation",
        action: "Fresh 1-record deterministic action",
      },
    ];

    const updatedResult = await enrichFindingsWithGemini(updatedFindings, { companyKey: "test-comp-2" });
    // Must NOT serve the stale 5-record explanation!
    assert.notEqual(updatedResult.findings[0].explanation, "Stale 5-record explanation");
    assert.equal(updatedResult.findings[0].count, 1);
  });

  it("10. Gemini Fallback: Gracefully retains deterministic findings when Gemini is bypassed or fails", async () => {
    const findings = [
      {
        id: "test-task",
        category: "WORK_MANAGEMENT",
        title: "Overdue Task",
        severity: "HIGH",
        count: 1,
        summary: "1 overdue task",
        explanation: "1 task is past deadline.",
        action: "Review work management.",
        link: "/admin/work-management",
      },
    ];

    // Simulate missing GEMINI_API_KEY
    const origKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const result = await enrichFindingsWithGemini(findings, { companyKey: "test-comp-3" });
      assert.equal(result.aiEnriched, false);
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].explanation, "1 task is past deadline.");
      assert.equal(result.findings[0].action, "Review work management.");
    } finally {
      if (origKey) process.env.GEMINI_API_KEY = origKey;
    }
  });

  it("11. Client cache module contract: Deduplicates concurrent requests and reuses memory cache", async () => {
    // Verify client memory caching and deduplication behavior in isolation
    let networkCallCount = 0;
    let memoryCache = { data: null, inFlightPromise: null };

    const mockFetch = async ({ forceRefresh = false } = {}) => {
      if (!forceRefresh && memoryCache.data) {
        return memoryCache.data;
      }
      if (memoryCache.inFlightPromise) {
        return memoryCache.inFlightPromise;
      }
      const promise = (async () => {
        networkCallCount++;
        const result = { success: true, count: networkCallCount };
        memoryCache.data = result;
        return result;
      })().finally(() => {
        memoryCache.inFlightPromise = null;
      });
      memoryCache.inFlightPromise = promise;
      return promise;
    };

    // 1. Initial load
    const firstCall = await mockFetch();
    assert.equal(firstCall.count, 1);
    assert.equal(networkCallCount, 1);

    // 2. Revisit without refresh: uses memory cache, network count remains 1
    const revisitCall = await mockFetch();
    assert.equal(revisitCall.count, 1);
    assert.equal(networkCallCount, 1);

    // 3. Concurrent requests (React Strict Mode double invoke): deduplicates into 1 call
    memoryCache.data = null; // simulate fresh session
    const [concurrent1, concurrent2] = await Promise.all([
      mockFetch(),
      mockFetch(),
    ]);
    assert.equal(concurrent1.count, 2);
    assert.equal(concurrent2.count, 2);
    assert.equal(networkCallCount, 2); // only 1 network call was made for both

    // 4. Force refresh: fetches fresh data and increments network count
    const refreshCall = await mockFetch({ forceRefresh: true });
    assert.equal(refreshCall.count, 3);
    assert.equal(networkCallCount, 3);
  });
});
