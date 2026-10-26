import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES, ONBOARDING_STATUSES } from "../models/User.js";
import { LEAVE_STATUSES } from "../models/LeaveRequest.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { PAYROLL_CYCLE_STATUSES, PAYMENT_STATUSES } from "../models/PayrollCycle.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import {
  executeHrAnalystTool,
  formatDeterministicAnalysis,
  HR_ANALYST_FUNCTION_DECLARATIONS,
} from "../services/hrAnalystTools.js";
import {
  sendChatMessage,
  streamChatMessage,
  detectHrQueryIntent,
  buildSystemInstruction,
} from "../services/chatbotService.js";
import { getCompanyBusinessDate } from "../services/attendanceService.js";

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
let hrAdminCookieA;
let employeeCookieA;
let hrAdminCookieB;
let modelsA;
let modelsB;
let empAlice;
let empBob;
let empCharlie;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  // 1. Company A Setup (Acme Corp)
  companyA = await Company.create({
    companyName: "Acme Tech Corp",
    slug: "acme-tech",
    databaseName: "company_acme_tech_analyst_test",
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata" },
  });

  modelsA = await getCompanyModels(companyA);

  // Setup Company A HR Policy (Start: 09:30, Grace: 15 mins)
  await modelsA.CompanyHrPolicy.create({
    attendanceRules: {
      officeStartTime: "09:30",
      officeEndTime: "18:30",
      gracePeriodMinutes: 15,
    },
    workHoursRules: { standardDailyHours: 8 },
    weekendRules: { saturdayOff: true, sundayOff: true },
  });

  // Setup HR Admin for Company A
  const hrUserA = await modelsA.User.create({
    email: "hr.admin@acme.test",
    passwordHash: await hashPassword("AdminPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Setup Employee Users and Employees for Company A
  const devUserA = await modelsA.User.create({
    email: "alice@acme.test",
    passwordHash: await hashPassword("AlicePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  empAlice = await modelsA.Employee.create({
    userId: devUserA._id,
    companyId: companyA._id,
    employeeCode: "ACM-101",
    fullName: "Alice Engineer",
    email: "alice@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { department: "Engineering", jobTitle: "Lead Architect" },
    bankDetails: { accountNumber: "1234567890", ifscCode: "HDFC0001" },
    emergencyContact: { name: "John Doe", phone: "9876543210" },
    taxDetails: { panNumber: "ABCDE1234F" },
  });

  const devUserB = await modelsA.User.create({
    email: "bob@acme.test",
    passwordHash: await hashPassword("BobPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  empBob = await modelsA.Employee.create({
    userId: devUserB._id,
    companyId: companyA._id,
    employeeCode: "ACM-102",
    fullName: "Bob Developer",
    email: "bob@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { department: "Engineering", jobTitle: "Full Stack Developer" },
    // Incomplete profile: missing bank details and emergency contact
  });

  const salesUser = await modelsA.User.create({
    email: "charlie@acme.test",
    passwordHash: await hashPassword("CharliePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  empCharlie = await modelsA.Employee.create({
    userId: salesUser._id,
    companyId: companyA._id,
    employeeCode: "ACM-103",
    fullName: "Charlie Sales",
    email: "charlie@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { department: "Sales", jobTitle: "Account Executive" },
    bankDetails: { accountNumber: "9876543210", ifscCode: "ICIC0002" },
  });

  // 2. Company B Setup (Beta Corp - for tenant isolation)
  companyB = await Company.create({
    companyName: "Beta Systems",
    slug: "beta-sys",
    databaseName: "company_beta_sys_analyst_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  modelsB = await getCompanyModels(companyB);

  const hrUserB = await modelsB.User.create({
    email: "hr@beta.test",
    passwordHash: await hashPassword("BetaHrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  await modelsB.Employee.create({
    userId: hrUserB._id,
    companyId: companyB._id,
    employeeCode: "BET-001",
    fullName: "Beta Admin",
    email: "hr@beta.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { department: "Operations" },
  });

  // Log in users
  const loginHrA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme-tech", email: "hr.admin@acme.test", password: "AdminPass123!" });
  hrAdminCookieA = cookieFrom(loginHrA);

  const loginEmpA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme-tech", email: "alice@acme.test", password: "AlicePass123!" });
  employeeCookieA = cookieFrom(loginEmpA);

  const loginHrB = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "beta-sys", email: "hr@beta.test", password: "BetaHrPass123!" });
  hrAdminCookieB = cookieFrom(loginHrB);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("Real-Time AI HR Analyst: Tool Layer & Intelligence Analysis Suite", () => {
  it("1. Tool Declarations expose valid OpenAPI 3.0 parameters for Gemini function calling", () => {
    assert.equal(Array.isArray(HR_ANALYST_FUNCTION_DECLARATIONS), true);
    assert.equal(HR_ANALYST_FUNCTION_DECLARATIONS.length >= 6, true);

    const toolNames = HR_ANALYST_FUNCTION_DECLARATIONS.map((t) => t.name);
    assert.ok(toolNames.includes("analyzeAttendance"));
    assert.ok(toolNames.includes("analyzeEmployeesAndOnboarding"));
    assert.ok(toolNames.includes("analyzeLeaves"));
    assert.ok(toolNames.includes("analyzePayrollReadiness"));
    assert.ok(toolNames.includes("analyzeRecruitmentAndOffers"));
    assert.ok(toolNames.includes("getCrossModuleOverview"));

    for (const tool of HR_ANALYST_FUNCTION_DECLARATIONS) {
      assert.equal(typeof tool.name, "string");
      assert.equal(typeof tool.description, "string");
      assert.equal(tool.parameters?.type, "OBJECT");
    }
  });

  it("2. Attendance Analysis: accurately computes present, late, absent, and on-leave counts based on policy", async () => {
    const todayStr = getCompanyBusinessDate(new Date(), "Asia/Kolkata");

    // Alice: checked in on time at 09:20 (03:50 UTC)
    await modelsA.Attendance.create({
      employeeId: empAlice._id,
      date: todayStr,
      status: "PRESENT",
      checkIn: new Date(`${todayStr}T03:50:00.000Z`), // 09:20 IST
    });

    // Bob: checked in late at 10:15 (04:45 UTC) (past 09:30 + 15m cutoff)
    await modelsA.Attendance.create({
      employeeId: empBob._id,
      date: todayStr,
      status: "PRESENT",
      checkIn: new Date(`${todayStr}T04:45:00.000Z`), // 10:15 IST
    });

    // Charlie: approved leave for today
    await modelsA.LeaveRequest.create({
      employeeId: empCharlie._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date(`${todayStr}T00:00:00.000Z`),
      toDate: new Date(`${todayStr}T23:59:59.000Z`),
      status: LEAVE_STATUSES.APPROVED,
      daysCount: 1,
    });

    const hrUser = await modelsA.User.findOne({ email: "hr.admin@acme.test" });
    const result = await executeHrAnalystTool(
      "analyzeAttendance",
      { targetDate: "today" },
      { models: modelsA, company: companyA, user: hrUser }
    );

    assert.equal(result.date, todayStr);
    assert.equal(result.summary.totalEmployees, 3);
    assert.equal(result.summary.presentCount, 2);
    assert.equal(result.summary.lateArrivalCount, 1);
    assert.equal(result.summary.onLeaveCount, 1);
    assert.equal(result.summary.absentCount, 0);

    // Verify Bob is identified in late arrivals with calculated minutes late
    assert.equal(result.lateArrivals.length, 1);
    assert.equal(result.lateArrivals[0].fullName, "Bob Developer");
    assert.equal(result.lateArrivals[0].department, "Engineering");
    assert.ok(result.lateArrivals[0].minutesLate >= 40);

    // Verify Charlie is identified in onLeave
    assert.equal(result.onLeaveEmployees.length, 1);
    assert.equal(result.onLeaveEmployees[0].fullName, "Charlie Sales");
    assert.equal(result.onLeaveEmployees[0].leaveType, "CASUAL");

    // Formatted presentation contains links and key metrics
    const formatted = formatDeterministicAnalysis("analyzeAttendance", result);
    assert.match(formatted, /Real-Time Attendance Analysis/);
    assert.match(formatted, /Bob Developer/);
    assert.match(formatted, /\/admin\/attendance/);
  });

  it("3. Attendance Analysis: detects recurring attendance irregularities over past 7 days", async () => {
    const today = new Date();
    // Simulate Bob being late 3 times over the past 5 days
    for (let i = 1; i <= 3; i++) {
      const pastDt = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const pastDateStr = getCompanyBusinessDate(pastDt, "Asia/Kolkata");
      await modelsA.Attendance.create({
        employeeId: empBob._id,
        date: pastDateStr,
        status: "PRESENT",
        checkIn: new Date(`${pastDateStr}T05:00:00.000Z`), // 10:30 IST (late)
      });
    }

    const hrUser = await modelsA.User.findOne({ email: "hr.admin@acme.test" });
    const result = await executeHrAnalystTool(
      "analyzeAttendance",
      { targetDate: "today", checkIrregularities: true },
      { models: modelsA, company: companyA, user: hrUser }
    );

    assert.ok(result.recurringIrregularities?.length > 0);
    const bobIrreg = result.recurringIrregularities.find((r) => r.fullName === "Bob Developer");
    assert.ok(bobIrreg);
    assert.ok(bobIrreg.lateArrivalsThisWeek >= 2);
  });

  it("4. Employee & Onboarding Analysis: identifies incomplete profiles and candidate blockers", async () => {
    // Create candidate user in SUBMITTED state awaiting review
    await modelsA.User.create({
      email: "candidate.dan@example.test",
      role: USER_ROLES.CANDIDATE,
      onboarding: {
        status: ONBOARDING_STATUSES.SUBMITTED,
        position: "Senior DevOps Engineer",
        personalDetails: { fullName: "Dan DevOps" },
        submittedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // submitted 3 days ago
      },
    });

    const hrUser = await modelsA.User.findOne({ email: "hr.admin@acme.test" });
    const result = await executeHrAnalystTool(
      "analyzeEmployeesAndOnboarding",
      { focusArea: "ALL" },
      { models: modelsA, company: companyA, user: hrUser }
    );

    assert.equal(result.employeeDirectory.totalActiveEmployees, 3);
    // Bob is missing bank details
    assert.ok(result.employeeDirectory.profileCompleteness.missingBankCount >= 1);
    const missingBankCodes = result.employeeDirectory.profileCompleteness.missingBankEmployees.map(
      (e) => e.employeeCode
    );
    assert.ok(missingBankCodes.includes("ACM-102"));

    // Candidate onboarding analysis
    assert.equal(result.candidateOnboarding.awaitingHrReviewCount, 1);
    assert.equal(result.candidateOnboarding.pendingReviewList[0].candidateName, "Dan DevOps");
    assert.equal(result.candidateOnboarding.pendingReviewList[0].requiresUrgentReview, true);
  });

  it("5. Leave Analysis: detects overlapping leave dates in the same team posing understaffing risk", async () => {
    const nextWeekStart = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const nextWeekEnd = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

    // Alice requests leave in Engineering
    await modelsA.LeaveRequest.create({
      employeeId: empAlice._id,
      leaveTypeCode: "EARNED",
      fromDate: nextWeekStart,
      toDate: nextWeekEnd,
      status: LEAVE_STATUSES.PENDING,
      daysCount: 4,
    });

    // Bob also requests leave in Engineering for overlapping dates
    await modelsA.LeaveRequest.create({
      employeeId: empBob._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date(nextWeekStart.getTime() + 24 * 60 * 60 * 1000),
      toDate: nextWeekEnd,
      status: LEAVE_STATUSES.PENDING,
      daysCount: 3,
    });

    const hrUser = await modelsA.User.findOne({ email: "hr.admin@acme.test" });
    const result = await executeHrAnalystTool(
      "analyzeLeaves",
      { includeOverlaps: true },
      { models: modelsA, company: companyA, user: hrUser }
    );

    assert.equal(result.totalPendingLeaves, 2);
    assert.equal(result.hasTeamLeaveConflicts, true);
    assert.ok(result.overlappingTeamLeaves.length > 0);
    assert.equal(result.overlappingTeamLeaves[0].department, "Engineering");
    assert.equal(result.overlappingTeamLeaves[0].risk, "STAFFING_CONFLICT");
  });

  it("6. Payroll Readiness: identifies missing compensation structures and register blockers", async () => {
    // Only Alice has compensation; Bob and Charlie do not
    await modelsA.EmployeeCompensation.create({
      employeeId: empAlice._id,
      annualCtc: 1200000,
      monthlyGross: 100000,
      monthlyBasic: 50000,
    });

    // Create a drafted cycle with validation issues
    await modelsA.PayrollCycle.create({
      periodMonth: 10,
      periodYear: 2026,
      periodStartDate: new Date("2026-10-01"),
      periodEndDate: new Date("2026-10-31"),
      status: PAYROLL_CYCLE_STATUSES.DRAFT,
      paymentStatus: PAYMENT_STATUSES.UNPAID,
      employeeCount: 1,
      validationIssues: [
        {
          employeeId: empBob._id,
          employeeCode: "ACM-102",
          fullName: "Bob Developer",
          issue: "Missing tax declaration details",
        },
      ],
    });

    const hrUser = await modelsA.User.findOne({ email: "hr.admin@acme.test" });
    const result = await executeHrAnalystTool(
      "analyzePayrollReadiness",
      {},
      { models: modelsA, company: companyA, user: hrUser }
    );

    assert.equal(result.readinessStatus, "BLOCKED");
    assert.ok(result.blockers.length >= 2);
    assert.ok(result.unconfiguredStaffCount >= 2); // Bob and Charlie lack compensation
  });

  it("7. Recruitment Analysis: calculates offer acceptance rate and identifies response bottlenecks", async () => {
    // 2 Accepted, 1 Rejected, 1 Sent 5 days ago (bottleneck)
    await modelsA.OfferLetter.create({
      candidate: { fullName: "Ella Engineer", email: "ella@example.test" },
      position: "QA Engineer",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      content: "<p>Offer letter content</p>",
      joiningDate: new Date(),
      monthlySalary: 70000,
    });

    await modelsA.OfferLetter.create({
      candidate: { fullName: "Frank Frontend", email: "frank@example.test" },
      position: "Frontend Dev",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      content: "<p>Offer letter content</p>",
      joiningDate: new Date(),
      monthlySalary: 65000,
    });

    await modelsA.OfferLetter.create({
      candidate: { fullName: "George Graphic", email: "george@example.test" },
      position: "UI Designer",
      status: OFFER_LETTER_STATUSES.REJECTED,
      content: "<p>Offer letter content</p>",
      joiningDate: new Date(),
      monthlySalary: 55000,
    });

    await modelsA.OfferLetter.create({
      candidate: { fullName: "Hannah HR", email: "hannah@example.test" },
      position: "HR Specialist",
      status: OFFER_LETTER_STATUSES.SENT,
      content: "<p>Offer letter content</p>",
      joiningDate: new Date(),
      monthlySalary: 50000,
      emailDelivery: {
        sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // sent 5 days ago
        status: "SENT",
      },
    });

    const hrUser = await modelsA.User.findOne({ email: "hr.admin@acme.test" });
    const result = await executeHrAnalystTool(
      "analyzeRecruitmentAndOffers",
      { checkBottlenecks: true },
      { models: modelsA, company: companyA, user: hrUser }
    );

    assert.equal(result.funnel.ACCEPTED, 2);
    assert.equal(result.funnel.REJECTED, 1);
    assert.equal(result.funnel.SENT, 1);
    assert.equal(result.funnel.acceptanceRate, "66.7%");
    assert.ok(result.bottlenecks.length >= 1);
    assert.equal(result.bottlenecks[0].candidateName, "Hannah HR");
  });

  it("8. Cross-Module Operational Overview: aggregates operational health check across all modules", async () => {
    const hrUser = await modelsA.User.findOne({ email: "hr.admin@acme.test" });
    const result = await executeHrAnalystTool(
      "getCrossModuleOverview",
      {},
      { models: modelsA, company: companyA, user: hrUser }
    );

    assert.ok(result.healthOverview);
    assert.equal(result.healthOverview.activeStaffCount, 3);
    assert.ok(result.operationalRisks.length > 0);
    assert.ok(result.recommendedActions.length > 0);
  });

  it("9. Role-Based Security: Regular EMPLOYEE cannot access company-wide analytical tools", async () => {
    const employeeUser = await modelsA.User.findOne({ email: "alice@acme.test" });
    const result = await executeHrAnalystTool(
      "analyzeAttendance",
      {},
      { models: modelsA, company: companyA, user: employeeUser }
    );

    assert.equal(result.error, "ACCESS_DENIED");
    assert.match(result.message, /restricted to HR Administrators/i);
  });

  it("10. Tenant Isolation: Company B HR Admin cannot see Company A records", async () => {
    const hrUserB = await modelsB.User.findOne({ email: "hr@beta.test" });
    const resultB = await executeHrAnalystTool(
      "analyzeEmployeesAndOnboarding",
      {},
      { models: modelsB, company: companyB, user: hrUserB }
    );

    // Company B has only 1 employee (Beta Admin), not Alice, Bob, or Charlie from Company A
    assert.equal(resultB.employeeDirectory.totalActiveEmployees, 1);
    assert.equal(
      resultB.employeeDirectory.departmentHeadcount["Engineering"],
      undefined
    );
  });

  it("11. Real-time data freshness: attendance update is immediately reflected in the assistant's answer", async () => {
    const hrUser = await modelsA.User.findOne({ email: "hr.admin@acme.test" });
    const todayStr = getCompanyBusinessDate(new Date(), "Asia/Kolkata");

    // Remove Charlie's leave record from earlier test so he is not classified as on leave
    await modelsA.LeaveRequest.deleteMany({ employeeId: empCharlie._id });

    // Before: 2 present
    const beforeResult = await executeHrAnalystTool(
      "analyzeAttendance",
      { targetDate: "today" },
      { models: modelsA, company: companyA, user: hrUser }
    );
    assert.equal(beforeResult.summary.presentCount, 2);

    // Now Charlie checks in
    await modelsA.Attendance.create({
      employeeId: empCharlie._id,
      date: todayStr,
      status: "PRESENT",
      checkIn: new Date(),
    });

    // After: immediately reflects 3 present
    const afterResult = await executeHrAnalystTool(
      "analyzeAttendance",
      { targetDate: "today" },
      { models: modelsA, company: companyA, user: hrUser }
    );
    assert.equal(afterResult.summary.presentCount, 3);
  });

  it("12. Intent detector accurately maps natural language HR business queries to tools", () => {
    const q1 = detectHrQueryIntent("How many employees are present right now?");
    assert.equal(q1.name, "analyzeAttendance");

    const q2 = detectHrQueryIntent("Who is absent or late today?");
    assert.equal(q2.name, "analyzeAttendance");

    const q3 = detectHrQueryIntent("How does attendance compare with the previous week?");
    assert.equal(q3.name, "analyzeAttendance");
    assert.equal(q3.args.comparePreviousWeek, true);

    const q4 = detectHrQueryIntent("Which employee profiles are incomplete with missing PAN or bank?");
    assert.equal(q4.name, "analyzeEmployeesAndOnboarding");

    const q5 = detectHrQueryIntent("Are multiple employees in the same team requesting leave for overlapping dates?");
    assert.equal(q5.name, "analyzeLeaves");
    assert.equal(q5.args.includeOverlaps, true);

    const q6 = detectHrQueryIntent("Is payroll ready to process?");
    assert.equal(q6.name, "analyzePayrollReadiness");

    const q7 = detectHrQueryIntent("What is the current recruitment funnel and where are candidates stuck?");
    assert.equal(q7.name, "analyzeRecruitmentAndOffers");

    const q8 = detectHrQueryIntent("Give me an operational health check and company risk overview");
    assert.equal(q8.name, "getCrossModuleOverview");
  });

  it("13. System Instruction for HR Admin explicitly configures AI HR Analyst persona with tool guidelines", async () => {
    const hrUser = await modelsA.User.findOne({ email: "hr.admin@acme.test" });
    const instruction = buildSystemInstruction({
      companyName: "Acme Tech Corp",
      userRole: USER_ROLES.HR_ADMIN,
      userEmail: "hr.admin@acme.test",
      isHrAdmin: true,
      hrPolicy: {
        officeStartTime: "09:30",
        officeEndTime: "18:30",
        gracePeriodMinutes: 15,
        standardDailyHours: 8,
        weekendOff: "Saturday & Sunday",
      },
    });

    assert.match(instruction, /AI HR Analyst/i);
    assert.match(instruction, /analyzeAttendance/);
    assert.match(instruction, /analyzeEmployeesAndOnboarding/);
    assert.match(instruction, /analyzeLeaves/);
    assert.match(instruction, /analyzePayrollReadiness/);
    assert.match(instruction, /analyzeRecruitmentAndOffers/);
    assert.match(instruction, /getCrossModuleOverview/);
    assert.match(instruction, /Key Findings/);
    assert.match(instruction, /\[Attendance Overview\]\(\/admin\/attendance\)/);
  });

  it("14. HTTP POST /api/chat/message for HR Admin answers real-time attendance query without stating lack of data", async () => {
    const res = await request(app)
      .post("/api/chat/message")
      .set("Cookie", hrAdminCookieA)
      .send({ message: "Analyse today's attendance" });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.reply);
    // Must contain real attendance findings from DB and links
    assert.match(res.body.reply, /Attendance/i);
    assert.match(res.body.reply, /present|checked in/i);
    assert.doesNotMatch(res.body.reply, /I do not have access to real-time attendance/i);
  });

  it("15. HTTP POST /api/chat/stream for HR Admin streams real-time leave and team overlap analysis", async () => {
    const res = await request(app)
      .post("/api/chat/stream")
      .set("Cookie", hrAdminCookieA)
      .send({ message: "Check pending leaves and team overlapping conflicts" });

    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/event-stream/);
    assert.match(res.text, /event: chunk/);
    assert.match(res.text, /Leave|Pending|Overlapping/i);
  });
});
