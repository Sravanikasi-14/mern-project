import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { getCompanyDayBounds } from "../utils/companyTime.js";

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
let hrCookieA;
let hrCookieB;
let managerCookieA;
let managerRecordA;
let employeeCookieA;
let employeeRecordA;
let employeeCookieA2;
let employeeRecordA2;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  // 1. Company A Setup
  companyA = await Company.create({
    companyName: "Acme Work Management",
    slug: "acme-wm",
    databaseName: "company_acme_wm_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const modelsA = await getCompanyModels(companyA);

  // HR Admin
  await modelsA.User.create({
    email: "hr@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Manager User & Employee
  const mgrUser = await modelsA.User.create({
    email: "manager@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  managerRecordA = await modelsA.Employee.create({
    userId: mgrUser._id,
    companyId: companyA._id,
    employeeCode: "MGR-001",
    fullName: "Alice Manager",
    email: "manager@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { department: "Engineering", jobTitle: "Engineering Lead" },
  });

  // Subordinate Employee 1 (reports to managerRecordA)
  const empUser1 = await modelsA.User.create({
    email: "dev@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  employeeRecordA = await modelsA.Employee.create({
    userId: empUser1._id,
    companyId: companyA._id,
    employeeCode: "DEV-001",
    fullName: "Bob Developer",
    email: "dev@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      department: "Engineering",
      jobTitle: "Software Engineer",
      reportingManagerId: managerRecordA._id,
      project: { projectName: "Core Platform" },
    },
  });

  // Employee 2 (Product Department, does NOT report to managerRecordA)
  const empUser2 = await modelsA.User.create({
    email: "product@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  employeeRecordA2 = await modelsA.Employee.create({
    userId: empUser2._id,
    companyId: companyA._id,
    employeeCode: "PRD-001",
    fullName: "Carol Product",
    email: "product@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { department: "Product", jobTitle: "Product Specialist" },
  });

  // 2. Company B Setup (for multi-tenant isolation)
  companyB = await Company.create({
    companyName: "Beta Work Management",
    slug: "beta-wm",
    databaseName: "company_beta_wm_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const modelsB = await getCompanyModels(companyB);
  await modelsB.User.create({
    email: "hr@beta.test",
    passwordHash: await hashPassword("BetaPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Authenticate users
  const loginHrA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme-wm", email: "hr@acme.test", password: "AcmePass123!" });
  hrCookieA = cookieFrom(loginHrA);

  const loginMgrA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme-wm", email: "manager@acme.test", password: "AcmePass123!" });
  managerCookieA = cookieFrom(loginMgrA);

  const loginEmpA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme-wm", email: "dev@acme.test", password: "AcmePass123!" });
  employeeCookieA = cookieFrom(loginEmpA);

  const loginEmpA2 = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme-wm", email: "product@acme.test", password: "AcmePass123!" });
  employeeCookieA2 = cookieFrom(loginEmpA2);

  const loginHrB = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "beta-wm", email: "hr@beta.test", password: "BetaPass123!" });
  hrCookieB = cookieFrom(loginHrB);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("Work Management and Impact Points System Suite", () => {
  let createdTaskId;

  it("1. Metadata endpoint returns role context, direct reports, and assignable employees", async () => {
    // Manager metadata
    const mgrRes = await request(app)
      .get("/api/tasks/meta")
      .set("Cookie", managerCookieA);

    assert.equal(mgrRes.status, 200);
    assert.equal(mgrRes.body.success, true);
    assert.equal(mgrRes.body.isManager, true);
    assert.equal(mgrRes.body.directReportsCount, 1);
    assert.equal(mgrRes.body.assignableEmployees[0].email, "dev@acme.test");

    // Regular employee without subordinates
    const empRes = await request(app)
      .get("/api/tasks/meta")
      .set("Cookie", employeeCookieA2);

    assert.equal(empRes.status, 200);
    assert.equal(empRes.body.isManager, false);
    assert.equal(empRes.body.directReportsCount, 0);
  });

  it("2. Manager can assign task to their direct subordinate; non-subordinate assignment is rejected", async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // 2a. Manager attempts to assign task to employee who does NOT report to them -> must be 403
    const resForbidden = await request(app)
      .post("/api/tasks")
      .set("Cookie", managerCookieA)
      .send({
        title: "Unauthorized Task",
        description: "Task for product team",
        assigneeId: employeeRecordA2._id,
        deadline: futureDate,
      });

    assert.equal(resForbidden.status, 403);
    assert.match(resForbidden.body.message, /not authorized to assign tasks to this employee/i);

    // 2b. Manager assigns task to their direct subordinate Bob Developer -> succeeds 201
    const resSuccess = await request(app)
      .post("/api/tasks")
      .set("Cookie", managerCookieA)
      .send({
        title: "Implement High-Performance Cache",
        description: "Add distributed Redis caching to employee lookup endpoints",
        assigneeId: employeeRecordA._id,
        priority: "HIGH",
        acceptanceCriteria: ["P99 latency under 20ms", "Unit test coverage above 90%"],
        deadline: futureDate,
      });

    assert.equal(resSuccess.status, 201);
    assert.equal(resSuccess.body.success, true);
    assert.equal(resSuccess.body.task.status, "ASSIGNED");
    assert.equal(resSuccess.body.task.priority, "HIGH");
    assert.equal(resSuccess.body.task.assigneeSnapshot.fullName, "Bob Developer");
    createdTaskId = resSuccess.body.task._id;
  });

  it("3. Assigned employee starts task (ASSIGNED -> IN_PROGRESS)", async () => {
    const res = await request(app)
      .post(`/api/tasks/${createdTaskId}/start`)
      .set("Cookie", employeeCookieA);

    assert.equal(res.status, 200);
    assert.equal(res.body.task.status, "IN_PROGRESS");
    assert.ok(res.body.task.startDate);
  });

  it("4. Employee submits deliverables and evidence (IN_PROGRESS -> SUBMITTED)", async () => {
    const res = await request(app)
      .post(`/api/tasks/${createdTaskId}/submit`)
      .set("Cookie", employeeCookieA)
      .send({
        submissionNotes: "Completed caching layer and passed integration tests.",
        deliverables: [
          {
            description: "PR link and benchmark results",
            links: ["https://github.com/example/pr/123"],
          },
        ],
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.task.status, "SUBMITTED");
    assert.ok(res.body.task.submittedAt);
  });

  it("5. Anti-Self-Approval: Employee CANNOT approve their own task", async () => {
    const res = await request(app)
      .post(`/api/tasks/${createdTaskId}/review`)
      .set("Cookie", employeeCookieA)
      .send({
        decision: "APPROVED",
        comments: "Self approval attempt",
      });

    assert.equal(res.status, 403);
    assert.match(res.body.message, /cannot approve their own work|unauthorized/i);
  });

  it("6. Reviewer requests changes with comments (SUBMITTED -> CHANGES_REQUESTED)", async () => {
    const res = await request(app)
      .post(`/api/tasks/${createdTaskId}/review`)
      .set("Cookie", managerCookieA)
      .send({
        decision: "CHANGES_REQUESTED",
        comments: "Please add integration tests verifying failover behavior when cache is unreachable.",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.task.status, "CHANGES_REQUESTED");
    assert.equal(res.body.task.review.decision, "CHANGES_REQUESTED");
  });

  it("7. Employee resubmits updated deliverables with revision history preserved", async () => {
    const res = await request(app)
      .post(`/api/tasks/${createdTaskId}/submit`)
      .set("Cookie", employeeCookieA)
      .send({
        submissionNotes: "Added failover integration tests as requested.",
        deliverables: [
          {
            description: "Updated PR with failover tests",
            links: ["https://github.com/example/pr/123", "https://dashboard.example.com/tests"],
          },
        ],
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.task.status, "SUBMITTED");
    assert.equal(res.body.task.resubmissionHistory.length, 1);
    assert.equal(res.body.task.resubmissionHistory[0].decision, "CHANGES_REQUESTED");
  });

  it("8. Manager approves task; triggers automatic, idempotent Impact Points award", async () => {
    const res = await request(app)
      .post(`/api/tasks/${createdTaskId}/review`)
      .set("Cookie", managerCookieA)
      .send({
        decision: "APPROVED",
        comments: "Excellent work! Tests pass with high performance.",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.task.status, "APPROVED");
    assert.ok(res.body.task.completedAt);
    // On-Time (10) + Early Bonus (5) + High Priority (20) = 35 points awarded
    assert.ok(res.body.task.pointsAwarded >= 30);
    assert.ok(res.body.task.pointsTransactionId);

    // Verify transaction recorded in tenant collection impact_point_transactions
    const { ImpactPointTransaction } = await getCompanyModels(companyA);
    const tx = await ImpactPointTransaction.findById(res.body.task.pointsTransactionId);
    assert.ok(tx);
    assert.equal(String(tx.employeeId), String(employeeRecordA._id));
    assert.equal(tx.transactionType, "EARNED");
    assert.equal(tx.source, "TASK_COMPLETION");
  });

  it("9. Idempotency: Duplicate point awards are blocked", async () => {
    const { ImpactPointTransaction } = await getCompanyModels(companyA);
    const countBefore = await ImpactPointTransaction.countDocuments({ taskId: createdTaskId });

    // Simulate re-running completion processor with the same task
    const { processTaskCompletionPoints } = await import("../services/workManagementService.js");
    const { Task } = await getCompanyModels(companyA);
    const task = await Task.findById(createdTaskId);

    await processTaskCompletionPoints({
      models: await getCompanyModels(companyA),
      task,
      user: { _id: new mongoose.Types.ObjectId(), role: USER_ROLES.HR_ADMIN, email: "hr@acme.test" },
      actorEmployee: managerRecordA,
    });

    const countAfter = await ImpactPointTransaction.countDocuments({ taskId: createdTaskId });
    assert.equal(countBefore, countAfter, "No duplicate transactions may be created for the same task completion");
  });

  it("10. Manager recognition: awards points to direct subordinate; anti-self-award blocked", async () => {
    // 10a. Self-recognition is blocked
    const selfRes = await request(app)
      .post("/api/impact-points/recognize")
      .set("Cookie", managerCookieA)
      .send({
        recipientEmployeeId: managerRecordA._id,
        points: 15,
        reason: "Self award",
      });
    assert.equal(selfRes.status, 400);
    assert.match(selfRes.body.message, /Self-recognition is prohibited/i);

    // 10b. Manager recognizes subordinate Bob
    const recRes = await request(app)
      .post("/api/impact-points/recognize")
      .set("Cookie", managerCookieA)
      .send({
        recipientEmployeeId: employeeRecordA._id,
        points: 15,
        reason: "Outstanding mentorship during sprint",
      });

    assert.equal(recRes.status, 201);
    assert.equal(recRes.body.success, true);
    assert.equal(recRes.body.transaction.points, 15);
    assert.equal(recRes.body.transaction.source, "MANAGER_RECOGNITION");
  });

  it("11. Employee points summary returns computed ledger balance, rank, and transactions", async () => {
    const res = await request(app)
      .get("/api/impact-points/me")
      .set("Cookie", employeeCookieA);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.summary.balance > 0);
    assert.equal(res.body.summary.fullName, "Bob Developer");
    assert.ok(Array.isArray(res.body.summary.recentTransactions));
    assert.ok(res.body.summary.recentTransactions.length >= 2);
  });

  it("12. Leaderboard computes company and department rankings via MongoDB aggregation", async () => {
    // Company leaderboard
    const resAll = await request(app)
      .get("/api/impact-points/leaderboard")
      .query({ department: "ALL" })
      .set("Cookie", employeeCookieA);

    assert.equal(resAll.status, 200);
    assert.ok(Array.isArray(resAll.body.leaderboard));
    assert.ok(resAll.body.leaderboard.length >= 1);
    assert.equal(resAll.body.leaderboard[0].fullName, "Bob Developer");
    assert.equal(resAll.body.leaderboard[0].rank, 1);

    // Department leaderboard for Engineering
    const resEng = await request(app)
      .get("/api/impact-points/leaderboard")
      .query({ department: "Engineering" })
      .set("Cookie", employeeCookieA);

    assert.equal(resEng.status, 200);
    assert.ok(resEng.body.leaderboard.some((e) => e.employeeCode === "DEV-001"));
  });

  it("13. Transaction reversal: HR Admin reverses an erroneous transaction with ledger audit", async () => {
    const { ImpactPointTransaction } = await getCompanyModels(companyA);
    const recognitionTx = await ImpactPointTransaction.findOne({
      employeeId: employeeRecordA._id,
      source: "MANAGER_RECOGNITION",
      isReversed: false,
    });
    assert.ok(recognitionTx);

    // Regular employee cannot reverse
    const empRev = await request(app)
      .post(`/api/impact-points/transactions/${recognitionTx._id}/reverse`)
      .set("Cookie", employeeCookieA)
      .send({ reason: "Unauthorized attempt" });
    assert.equal(empRev.status, 403);

    // HR Admin reverses transaction
    const hrRev = await request(app)
      .post(`/api/impact-points/transactions/${recognitionTx._id}/reverse`)
      .set("Cookie", hrCookieA)
      .send({ reason: "Disputed duplicate recognition" });

    assert.equal(hrRev.status, 200);
    assert.equal(hrRev.body.success, true);
    assert.equal(hrRev.body.reversalTransaction.points, -recognitionTx.points);
    assert.equal(hrRev.body.reversalTransaction.transactionType, "REVERSAL");

    // Balance reflects the deduction
    const summaryRes = await request(app)
      .get("/api/impact-points/me")
      .set("Cookie", employeeCookieA);
    assert.equal(summaryRes.body.summary.recentTransactions[0].transactionType, "REVERSAL");
  });

  it("14. HR Admin can configure Impact Points rules in CompanyHrPolicy", async () => {
    // Read rules
    const rulesRes = await request(app)
      .get("/api/impact-points/rules")
      .set("Cookie", hrCookieA);

    assert.equal(rulesRes.status, 200);
    assert.ok(rulesRes.body.impactPointRules.rules);

    // Update rules (e.g. modify ON_TIME_COMPLETION points to 15)
    const updatedRules = rulesRes.body.impactPointRules.rules.map((r) =>
      r.ruleCode === "ON_TIME_COMPLETION" ? { ...r, points: 15 } : r
    );

    const updateRes = await request(app)
      .patch("/api/impact-points/rules")
      .set("Cookie", hrCookieA)
      .send({
        rules: updatedRules,
        managerMonthlyCap: 150,
      });

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.success, true);
    const savedRule = updateRes.body.impactPointRules.rules.find((r) => r.ruleCode === "ON_TIME_COMPLETION");
    assert.equal(savedRule.points, 15);
  });

  it("15. Multi-tenant isolation: Company B cannot access Company A tasks or points", async () => {
    // Company B HR Admin cannot view Company A task
    const resB = await request(app)
      .get(`/api/tasks/${createdTaskId}`)
      .set("Cookie", hrCookieB);
    assert.equal(resB.status, 404);

    // Company B leaderboard has 0 entries
    const resBLeaderboard = await request(app)
      .get("/api/impact-points/leaderboard")
      .set("Cookie", hrCookieB);
    assert.equal(resBLeaderboard.body.leaderboard.length, 0);

    // Verify Platform Central DB has 0 tasks and 0 impact_point_transactions
    const centralDb = mongoose.connection.useDb("platform");
    const collections = await centralDb.db.listCollections().toArray();
    const names = collections.map((c) => c.name);
    assert.equal(names.includes("tasks"), false, "Platform Central DB must NOT contain tasks");
    assert.equal(names.includes("impact_point_transactions"), false, "Platform Central DB must NOT contain impact_point_transactions");
  });

  it("16. Task list endpoint GET /api/tasks works with pagination, scope, search, and filters", async () => {
    // 16a. HR Admin queries with no filters
    const resNoFilters = await request(app)
      .get("/api/tasks?page=1&limit=20")
      .set("Cookie", hrCookieA);

    assert.equal(resNoFilters.status, 200);
    assert.equal(resNoFilters.body.success, true);
    assert.ok(Array.isArray(resNoFilters.body.tasks));
    assert.ok(resNoFilters.body.pagination);
    assert.equal(resNoFilters.body.pagination.page, 1);
    assert.ok(resNoFilters.body.pagination.total >= 1);

    // 16b. Status filter
    const resStatus = await request(app)
      .get("/api/tasks?status=APPROVED")
      .set("Cookie", hrCookieA);
    assert.equal(resStatus.status, 200);
    assert.ok(resStatus.body.tasks.every((t) => t.status === "APPROVED"));

    // 16c. Priority filter
    const resPriority = await request(app)
      .get("/api/tasks?priority=HIGH")
      .set("Cookie", hrCookieA);
    assert.equal(resPriority.status, 200);
    assert.ok(resPriority.body.tasks.every((t) => t.priority === "HIGH"));

    // 16d. Department filter
    const resDept = await request(app)
      .get("/api/tasks?department=Engineering")
      .set("Cookie", hrCookieA);
    assert.equal(resDept.status, 200);
    assert.ok(resDept.body.tasks.length >= 1);

    // 16e. Search filter
    const resSearch = await request(app)
      .get("/api/tasks?search=Cache")
      .set("Cookie", hrCookieA);
    assert.equal(resSearch.status, 200);
    assert.ok(resSearch.body.tasks.length >= 1);
    assert.match(resSearch.body.tasks[0].title, /Cache/i);

    // 16f. Employee scope (my_tasks)
    const resEmp = await request(app)
      .get("/api/tasks?scope=my_tasks")
      .set("Cookie", employeeCookieA);
    assert.equal(resEmp.status, 200);
    assert.ok(resEmp.body.tasks.every((t) => String(t.assigneeId) === String(employeeRecordA._id)));

    // 16g. Manager scope (team_tasks)
    const resMgr = await request(app)
      .get("/api/tasks?scope=team_tasks")
      .set("Cookie", managerCookieA);
    assert.equal(resMgr.status, 200);
    assert.ok(resMgr.body.tasks.length >= 1);

    const todayBoard = await request(app)
      .get("/api/tasks?completedScope=today&limit=100")
      .set("Cookie", hrCookieA);
    assert.equal(todayBoard.status, 200);
    assert.ok(
      todayBoard.body.tasks.some((t) => t.status === "APPROVED" && String(t._id) === String(createdTaskId)),
      "today's completed task should appear on the today board"
    );

    const modelsA = await getCompanyModels(companyA);
    const { start } = getCompanyDayBounds(new Date(), "Asia/Kolkata");
    await modelsA.Task.updateOne(
      { _id: createdTaskId },
      { $set: { completedAt: new Date(start.getTime() - 60 * 1000) } }
    );

    const todayAfterBackdate = await request(app)
      .get("/api/tasks?completedScope=today&limit=100")
      .set("Cookie", hrCookieA);
    assert.equal(
      todayAfterBackdate.body.tasks.filter(
        (t) => t.status === "APPROVED" && String(t._id) === String(createdTaskId)
      ).length,
      0,
      "older completed tasks must not appear in today's Completed column"
    );

    const history = await request(app)
      .get("/api/tasks?status=APPROVED&limit=100")
      .set("Cookie", hrCookieA);
    assert.ok(
      history.body.tasks.some((t) => String(t._id) === String(createdTaskId)),
      "historical completed tasks remain available without completedScope=today"
    );

    await modelsA.Task.updateOne({ _id: createdTaskId }, { $set: { completedAt: new Date() } });
  });

  it("17. HR Admin awards points: authoritative ledger balance, activity history, and leaderboard rankings update dynamically", async () => {
    // 17a. HR Admin awards 50 points to Carol Product (employeeRecordA2)
    const awardRes = await request(app)
      .post("/api/impact-points/recognize")
      .set("Cookie", hrCookieA)
      .send({
        recipientEmployeeId: employeeRecordA2._id,
        points: 50,
        reason: "Outstanding contribution to cross-functional product launch",
      });

    assert.equal(awardRes.status, 201);
    assert.equal(awardRes.body.success, true);
    assert.equal(awardRes.body.transaction.points, 50);
    assert.equal(String(awardRes.body.transaction.employeeId), String(employeeRecordA2._id));

    // 17b. Carol's points summary reflects the new 50 points
    const carolSummaryRes = await request(app)
      .get(`/api/impact-points/employee/${employeeRecordA2._id}`)
      .set("Cookie", hrCookieA);

    assert.equal(carolSummaryRes.status, 200);
    assert.equal(carolSummaryRes.body.summary.balance, 50);
    assert.equal(carolSummaryRes.body.summary.totalEarned, 50);
    assert.equal(carolSummaryRes.body.summary.recentTransactions.length, 1);
    assert.equal(carolSummaryRes.body.summary.recentTransactions[0].points, 50);
    assert.equal(carolSummaryRes.body.summary.recentTransactions[0].actor.name, "hr@acme.test");

    // 17c. Leaderboard reflects Carol as Rank #1 with 50 points
    const lbRes = await request(app)
      .get("/api/impact-points/leaderboard")
      .set("Cookie", hrCookieA);

    assert.equal(lbRes.status, 200);
    assert.ok(Array.isArray(lbRes.body.leaderboard));
    const carolEntry = lbRes.body.leaderboard.find((e) => String(e.employeeId) === String(employeeRecordA2._id));
    assert.ok(carolEntry, "Carol Product must appear in the leaderboard");
    assert.equal(carolEntry.balance, 50);
    assert.equal(carolEntry.rank, 1);
    assert.equal(carolEntry.fullName, "Carol Product");
    assert.equal(carolEntry.department, "Product");

    // 17d. Verify employee portal /me for Carol returns rank 1
    const carolMeRes = await request(app)
      .get("/api/impact-points/me")
      .set("Cookie", employeeCookieA2);

    assert.equal(carolMeRes.status, 200);
    assert.equal(carolMeRes.body.summary.balance, 50);
    assert.equal(carolMeRes.body.summary.rankInCompany, 1);
    assert.equal(carolMeRes.body.summary.rankInDepartment, 1);

    // 17e. Transaction ledger endpoint returns mapped employee and actor details
    const ledgerRes = await request(app)
      .get("/api/impact-points/transactions")
      .set("Cookie", hrCookieA);

    assert.equal(ledgerRes.status, 200);
    assert.ok(ledgerRes.body.transactions.length >= 1);
    const firstTx = ledgerRes.body.transactions[0];
    assert.ok(firstTx.employee);
    assert.ok(firstTx.employee.name);
    assert.ok(firstTx.actor);
    assert.ok(firstTx.actor.name);
  });
});

