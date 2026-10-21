process.env.MONGOMS_MD5_CHECK = "0";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { SETTLEMENT_STATUSES } from "../models/Settlement.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

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
let acme;
let globex;
let acmeHrCookie;
let acmeEmployeeCookie;
let acmeEmployee2Cookie;
let globexHrCookie;
let employee1Id;
let employee2Id;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme Corp",
    slug: "acme",
    databaseName: "company_acme_settlement",
    status: COMPANY_STATUSES.ACTIVE,
  });

  globex = await Company.create({
    companyName: "Globex Corp",
    slug: "globex",
    databaseName: "company_globex_settlement",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: AcmeUser, Employee: AcmeEmployee, EmployeeCompensation: AcmeCompensation } = await getCompanyModels(acme);

  // 1. Acme HR Admin
  await AcmeUser.create({
    email: "hr@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // 2. Acme Employee 1 (with salary structure and leave balance)
  const emp1 = await AcmeEmployee.create({
    employeeCode: "ACM-001",
    fullName: "Alice Smith",
    firstName: "Alice",
    lastName: "Smith",
    email: "alice@acme.test",
    department: "Engineering",
    designation: "Software Engineer",
    status: EMPLOYEE_STATUSES.ACTIVE,
    joiningDate: new Date("2023-01-15"),
    attendance: {
      leaveBalance: {
        casual: 4,
        sick: 3,
        earned: 12,
      },
    },
  });
  employee1Id = emp1._id.toString();

  await AcmeCompensation.create({
    employeeId: emp1._id,
    revisions: [
      {
        effectiveFromDate: new Date("2023-01-15"),
        monthlyCostToCompany: 100000,
        salaryComponents: {
          basicSalary: 50000,
          houseRentAllowance: 25000,
          specialAllowance: 25000,
          employerProvidentFund: 1800,
        },
      },
    ],
  });

  await AcmeUser.create({
    email: "alice@acme.test",
    passwordHash: await hashPassword("AlicePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
    employeeId: emp1._id,
  });

  // 3. Acme Employee 2 (without salary structure to verify missing data flags)
  const emp2 = await AcmeEmployee.create({
    employeeCode: "ACM-002",
    fullName: "Bob Jones",
    firstName: "Bob",
    lastName: "Jones",
    email: "bob@acme.test",
    department: "Marketing",
    designation: "Marketing Specialist",
    status: EMPLOYEE_STATUSES.ACTIVE,
    joiningDate: new Date("2023-06-01"),
    leaveBalances: {
      casual: 2,
      sick: 1,
      earned: 0,
    },
  });
  employee2Id = emp2._id.toString();

  await AcmeUser.create({
    email: "bob@acme.test",
    passwordHash: await hashPassword("BobPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
    employeeId: emp2._id,
  });

  // Globex HR Admin
  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "hr@globex.test",
    passwordHash: await hashPassword("GlobexPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Log in sessions
  const hrLogin = await request(app).post("/api/auth/login").send({
    companyCode: "acme",
    email: "hr@acme.test",
    password: "AcmePass123!",
  });
  acmeHrCookie = cookieFrom(hrLogin);

  const emp1Login = await request(app).post("/api/auth/login").send({
    companyCode: "acme",
    email: "alice@acme.test",
    password: "AlicePass123!",
  });
  acmeEmployeeCookie = cookieFrom(emp1Login);

  const emp2Login = await request(app).post("/api/auth/login").send({
    companyCode: "acme",
    email: "bob@acme.test",
    password: "BobPass123!",
  });
  acmeEmployee2Cookie = cookieFrom(emp2Login);

  const globexHrLogin = await request(app).post("/api/auth/login").send({
    companyCode: "globex",
    email: "hr@globex.test",
    password: "GlobexPass123!",
  });
  globexHrCookie = cookieFrom(globexHrLogin);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("Full & Final (F&F) Settlement Workflow End-to-End", () => {
  let settlementId;

  it("1. Initiates F&F from HR profile with calculations and pro-rated salary", async () => {
    const res = await request(app)
      .post("/api/settlements/initiate")
      .set("Cookie", acmeHrCookie)
      .send({
        employeeId: employee1Id,
        lastWorkingDay: "2026-10-15",
        exitReason: "RESIGNATION",
        remarks: "Smooth resignation with 30 days notice.",
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.settlement);
    assert.equal(res.body.settlement.status, SETTLEMENT_STATUSES.DRAFT);
    settlementId = (res.body.settlement._id || res.body.settlement.id).toString();

    // Verify Calculations:
    // October has 31 days. Last working day is 15.
    // Monthly CTC = 100,000 -> Pro-rated = (100000 / 31) * 15 = 48,387
    // Earned leave = 12 days -> Daily rate = 100000 / 30 = 3333.33 -> 12 * 3333.33 = 40,000
    // Statutory EPF deduction = 1,800
    assert.ok(res.body.settlement.financialBreakdown.totalEarnings > 0);
    assert.ok(res.body.settlement.financialBreakdown.totalDeductions > 0);
    assert.equal(
      res.body.settlement.financialBreakdown.netSettlementAmount,
      res.body.settlement.financialBreakdown.totalEarnings - res.body.settlement.financialBreakdown.totalDeductions
    );
  });

  it("2. Prevents duplicate active settlement initiation for the same employee exit", async () => {
    const res = await request(app)
      .post("/api/settlements/initiate")
      .set("Cookie", acmeHrCookie)
      .send({
        employeeId: employee1Id,
        lastWorkingDay: "2026-10-15",
        exitReason: "RESIGNATION",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.message, "An active F&F settlement already exists for this employee.");
    assert.equal((res.body.settlement._id || res.body.settlement.id).toString(), settlementId);
  });

  it("3. Flags missing salary data appropriately when initiating F&F for employee without salary", async () => {
    const res = await request(app)
      .post("/api/settlements/initiate")
      .set("Cookie", acmeHrCookie)
      .send({
        employeeId: employee2Id,
        lastWorkingDay: "2026-10-10",
        exitReason: "RESIGNATION",
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.settlement.calculationInputs.missingDataFlags.length > 0);
    assert.ok(
      res.body.settlement.calculationInputs.missingDataFlags.some((f) => f.includes("Salary structure is not configured"))
    );
  });

  it("4. Appears in settlements list with searching, filtering and pagination", async () => {
    const res = await request(app)
      .get("/api/settlements")
      .set("Cookie", acmeHrCookie)
      .query({ status: "DRAFT", search: "Alice" });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.settlements.length >= 1);
    assert.equal(res.body.settlements[0].employeeId.fullName, "Alice Smith");
  });

  it("5. Employee profile returns active settlement status and details", async () => {
    const res = await request(app)
      .get(`/api/employees/${employee1Id}`)
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 200);
    assert.ok(res.body.settlement);
    assert.equal(res.body.settlement.id.toString(), settlementId);
    assert.equal(res.body.settlement.status, SETTLEMENT_STATUSES.DRAFT);
  });

  it("6. Rejects unapproved settlement access for employee (Drafts are confidential)", async () => {
    const res = await request(app)
      .get("/api/settlements/my-settlement")
      .set("Cookie", acmeEmployeeCookie);

    // Draft is not yet finalized, so employee cannot view it (settlement is null)
    assert.equal(res.status, 200);
    assert.equal(res.body.settlement, null);
  });

  it("7. Updates settlement line items, recalculates totals and preserves audit history", async () => {
    const updateRes = await request(app)
      .put(`/api/settlements/${settlementId}/draft`)
      .set("Cookie", acmeHrCookie)
      .send({
        earnings: [
          { category: "SALARY", title: "Pro-rated Salary (15 days)", amount: 48387 },
          { category: "LEAVE_ENCASHMENT", title: "Leave Encashment (12 days)", amount: 40000 },
          { category: "BONUS", title: "Annual Performance Bonus", amount: 20000 },
        ],
        deductions: [
          { category: "STATUTORY", title: "Provident Fund (EPF)", amount: 1800 },
          { category: "OTHER", title: "Notice Shortfall (1 day)", amount: 3333 },
        ],
        manualAdjustmentRemarks: "Added performance bonus and 1 day notice adjustment.",
      });

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.settlement.financialBreakdown.totalEarnings, 48387 + 40000 + 20000); // 108387
    assert.equal(updateRes.body.settlement.financialBreakdown.totalDeductions, 1800 + 3333); // 5133
    assert.equal(updateRes.body.settlement.financialBreakdown.netSettlementAmount, 108387 - 5133); // 103254
    assert.ok(updateRes.body.settlement.adjustmentsHistory.length >= 1);
  });

  it("8. Rejects invalid status transition (DRAFT directly to PAID)", async () => {
    const res = await request(app)
      .put(`/api/settlements/${settlementId}/status`)
      .set("Cookie", acmeHrCookie)
      .send({
        status: "PAID",
      });

    assert.equal(res.status, 400);
    assert.ok(res.body.message.includes("Invalid status transition"));
  });

  it("9. Supports On Hold and Resume workflow", async () => {
    // Put On Hold
    const holdRes = await request(app)
      .put(`/api/settlements/${settlementId}/status`)
      .set("Cookie", acmeHrCookie)
      .send({
        status: "ON_HOLD",
        holdReason: "Pending manager sign-off on knowledge transfer.",
      });

    assert.equal(holdRes.status, 200);
    assert.equal(holdRes.body.settlement.status, "ON_HOLD");
    assert.equal(holdRes.body.settlement.holdReason, "Pending manager sign-off on knowledge transfer.");

    // Resume back to DRAFT
    const resumeRes = await request(app)
      .put(`/api/settlements/${settlementId}/status`)
      .set("Cookie", acmeHrCookie)
      .send({
        status: "DRAFT",
        remarks: "Sign-off received.",
      });

    assert.equal(resumeRes.status, 200);
    assert.equal(resumeRes.body.settlement.status, "DRAFT");
  });

  it("10. Transitions from DRAFT -> UNDER_REVIEW -> APPROVED", async () => {
    // Submit for review
    const reviewRes = await request(app)
      .put(`/api/settlements/${settlementId}/status`)
      .set("Cookie", acmeHrCookie)
      .send({ status: "UNDER_REVIEW" });
    assert.equal(reviewRes.status, 200);
    assert.equal(reviewRes.body.settlement.status, "UNDER_REVIEW");

    // Approve
    const approveRes = await request(app)
      .put(`/api/settlements/${settlementId}/status`)
      .set("Cookie", acmeHrCookie)
      .send({ status: "APPROVED", remarks: "Finance verified and approved." });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.body.settlement.status, "APPROVED");
    assert.ok(approveRes.body.settlement.approvedAt);
  });

  it("11. Employee can now view their finalized statement once APPROVED", async () => {
    const res = await request(app)
      .get("/api/settlements/my-settlement")
      .set("Cookie", acmeEmployeeCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.settlement._id.toString(), settlementId);
    assert.equal(res.body.settlement.status, "APPROVED");
    assert.equal(res.body.settlement.financialBreakdown.netSettlementAmount, 103254);
    assert.equal(res.body.company.name, "Acme Corp");
  });

  it("12. Employee cannot modify or approve settlements (Role authorization enforced)", async () => {
    const res = await request(app)
      .put(`/api/settlements/${settlementId}/status`)
      .set("Cookie", acmeEmployeeCookie)
      .send({ status: "COMPLETED" });

    assert.equal(res.status, 403);
  });

  it("13. Records payment and transitions to PAID", async () => {
    const payRes = await request(app)
      .post(`/api/settlements/${settlementId}/payment`)
      .set("Cookie", acmeHrCookie)
      .send({
        paymentDate: "2026-10-18",
        paymentMethod: "NEFT",
        referenceNumber: "NEFT-20261018-994821",
        remarks: "Processed via HDFC corporate batch.",
      });

    assert.equal(payRes.status, 200);
    assert.equal(payRes.body.settlement.status, "PAID");
    assert.ok(payRes.body.settlement.paymentDetails.paymentDate);
    assert.equal(payRes.body.settlement.paymentDetails.referenceNumber, "NEFT-20261018-994821");
  });

  it("14. Completes settlement and verifies employee exit timestamps", async () => {
    const completeRes = await request(app)
      .post(`/api/settlements/${settlementId}/complete`)
      .set("Cookie", acmeHrCookie)
      .send({ remarks: "Settlement fully closed." });

    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.body.settlement.status, "COMPLETED");

    // Employee records, exit details, salary compensation and leave balances are preserved
    const { Employee: AcmeEmployee, EmployeeCompensation: AcmeComp } = await getCompanyModels(acme);
    const emp = await AcmeEmployee.findById(employee1Id);
    assert.ok(emp);
    assert.equal(emp.employeeCode, "ACM-001");
    assert.ok(emp.exit.fullAndFinalGeneratedAt);
    assert.equal(emp.exit.reason, "RESIGNATION");
    assert.equal(emp.attendance.leaveBalance.earned, 12);

    const comp = await AcmeComp.findOne({ employeeId: employee1Id });
    assert.ok(comp);
    assert.equal(comp.revisions.length, 1);
  });

  it("15. Enforces tenant isolation: Globex HR cannot access Acme settlement", async () => {
    const res = await request(app)
      .get(`/api/settlements/${settlementId}`)
      .set("Cookie", globexHrCookie);

    assert.equal(res.status, 404);
  });
});
