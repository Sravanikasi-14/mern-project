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
let acmeCompany;
let globexCompany;

let acmeHrCookie;
let acmeEmp1Cookie;
let acmeEmp2Cookie;
let globexHrCookie;

let acmeEmp1Id;
let acmeEmp2Id;
let acmeEmp3Id;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  // 1. Create Acme Company
  acmeCompany = await Company.create({
    companyName: "Acme Corp",
    slug: "acme",
    databaseName: "company_acme_payroll_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  // 2. Create Globex Company for tenant isolation testing
  globexCompany = await Company.create({
    companyName: "Globex Corp",
    slug: "globex",
    databaseName: "company_globex_payroll_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const acmeModels = await getCompanyModels(acmeCompany);
  const globexModels = await getCompanyModels(globexCompany);

  // Setup Acme HR Admin
  await acmeModels.User.create({
    email: "hr@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Setup Acme Employee 1 (Full salary, present all month)
  const emp1User = await acmeModels.User.create({
    email: "emp1@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const emp1Doc = await acmeModels.Employee.create({
    userId: emp1User._id,
    employeeCode: "EMP-001",
    fullName: "Alice Smith",
    email: "emp1@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Senior Engineer",
      department: "Engineering",
      joiningDate: new Date("2026-01-01"),
    },
  });
  acmeEmp1Id = emp1Doc._id;

  // Add compensation for Emp 1 (CTC: 1,200,000 / yr = 100,000 / mo)
  await acmeModels.EmployeeCompensation.create({
    employeeId: emp1Doc._id,
    revisions: [
      {
        effectiveFromDate: new Date("2026-01-01"),
        monthlyCostToCompany: 100000,
        salaryComponents: {
          basicSalary: 50000,
          houseRentAllowance: 30000,
          specialAllowance: 20000,
          employerProvidentFund: 1800,
          otherDeductions: 200,
        },
      },
    ],
  });

  // Setup Acme Employee 2 (Bob)
  const emp2User = await acmeModels.User.create({
    email: "emp2@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const emp2Doc = await acmeModels.Employee.create({
    userId: emp2User._id,
    employeeCode: "EMP-002",
    fullName: "Bob Jones",
    email: "emp2@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Marketing Lead",
      department: "Marketing",
      joiningDate: new Date("2026-01-01"),
    },
  });
  acmeEmp2Id = emp2Doc._id;

  // Add compensation for Emp 2 (50,000 / mo)
  await acmeModels.EmployeeCompensation.create({
    employeeId: emp2Doc._id,
    revisions: [
      {
        effectiveFromDate: new Date("2026-01-01"),
        monthlyCostToCompany: 50000,
        salaryComponents: {
          basicSalary: 30000,
          houseRentAllowance: 20000,
          specialAllowance: 0,
          employerProvidentFund: 1800,
          otherDeductions: 0,
        },
      },
    ],
  });

  // Setup Acme Employee 3 (No compensation record -> to verify validation notice handling)
  const emp3User = await acmeModels.User.create({
    email: "emp3@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const emp3Doc = await acmeModels.Employee.create({
    userId: emp3User._id,
    employeeCode: "EMP-003",
    fullName: "Charlie Brown",
    email: "emp3@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Associate",
      department: "Operations",
      joiningDate: new Date("2026-01-01"),
    },
  });
  acmeEmp3Id = emp3Doc._id;

  // Setup Globex HR Admin
  await globexModels.User.create({
    email: "hr@globex.test",
    passwordHash: await hashPassword("GlobexPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Login Acme HR Admin
  const hrLogin = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme", email: "hr@acme.test", password: "AcmePass123!" });
  assert.equal(hrLogin.status, 200);
  acmeHrCookie = cookieFrom(hrLogin);

  // Login Acme Employee 1
  const emp1Login = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme", email: "emp1@acme.test", password: "AcmePass123!" });
  assert.equal(emp1Login.status, 200);
  acmeEmp1Cookie = cookieFrom(emp1Login);

  // Login Acme Employee 2
  const emp2Login = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme", email: "emp2@acme.test", password: "AcmePass123!" });
  assert.equal(emp2Login.status, 200);
  acmeEmp2Cookie = cookieFrom(emp2Login);

  // Login Globex HR Admin
  const globexHrLogin = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "globex", email: "hr@globex.test", password: "GlobexPass123!" });
  assert.equal(globexHrLogin.status, 200);
  globexHrCookie = cookieFrom(globexHrLogin);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("Payroll & Payslips End-to-End Integration Tests", () => {
  let createdCycleId;

  it("1. Missing or invalid payroll inputs are rejected (including 0, 13, and invalid years)", async () => {
    // Missing fields
    const res1 = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", [acmeHrCookie])
      .send({});
    assert.equal(res1.status, 400);

    // Invalid month 0 (both periodMonth and month field names)
    const resZeroMonth1 = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", [acmeHrCookie])
      .send({ periodYear: 2026, periodMonth: 0 });
    assert.equal(resZeroMonth1.status, 400);
    assert.match(resZeroMonth1.body.message, /valid payroll month/i);

    const resZeroMonth2 = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", [acmeHrCookie])
      .send({ year: 2026, month: 0 });
    assert.equal(resZeroMonth2.status, 400);
    assert.match(resZeroMonth2.body.message, /valid payroll month/i);

    // Invalid month 13 (both periodMonth and month field names)
    const res13Month1 = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", [acmeHrCookie])
      .send({ periodYear: 2026, periodMonth: 13 });
    assert.equal(res13Month1.status, 400);
    assert.match(res13Month1.body.message, /valid payroll month/i);

    const res13Month2 = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", [acmeHrCookie])
      .send({ year: 2026, month: 13 });
    assert.equal(res13Month2.status, 400);
    assert.match(res13Month2.body.message, /valid payroll month/i);

    // Invalid year
    const res3 = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", [acmeHrCookie])
      .send({ periodYear: 1990, periodMonth: 5 });
    assert.equal(res3.status, 400);
  });

  it("2. Accepts month 1 (January), month 12 (December), and month 10 (October 2026 from New Cycle form)", async () => {
    // 2a. Verify January (month 1) creation
    const janRes = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", [acmeHrCookie])
      .send({
        month: 1,
        year: 2026,
        notes: "January 2026 payroll",
      });
    assert.equal(janRes.status, 201);
    assert.equal(janRes.body.data.periodMonth, 1);
    assert.equal(janRes.body.data.periodYear, 2026);

    // 2b. Verify December (month 12) creation
    const decRes = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", [acmeHrCookie])
      .send({
        month: 12,
        year: 2026,
        notes: "December 2026 payroll",
      });
    assert.equal(decRes.status, 201);
    assert.equal(decRes.body.data.periodMonth, 12);
    assert.equal(decRes.body.data.periodYear, 2026);

    // 2c. Verify October 2026 (month 10) creation as sent by the frontend New Cycle form
    const res = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", [acmeHrCookie])
      .send({
        periodMonth: 10,
        periodYear: 2026,
        month: 10,
        year: 2026,
        notes: "October 2026 Regular Monthly Payroll",
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data._id);
    createdCycleId = res.body.data._id;

    // Status must be DRAFT or CALCULATED
    assert.equal(res.body.data.status, "CALCULATED");
    assert.equal(res.body.data.periodMonth, 10);
    assert.equal(res.body.data.periodYear, 2026);

    // Check validation issues: emp3 has no compensation, so it should be reported in validationIssues
    assert.ok(res.body.data.validationIssues.length >= 1);
    const emp3Issue = res.body.data.validationIssues.find(
      (issue) => issue.employeeCode === "EMP-003" || String(issue.employeeId) === String(acmeEmp3Id)
    );
    assert.ok(emp3Issue, "Validation issue should clearly identify EMP-003");
    assert.match(emp3Issue.issue || emp3Issue.message, /compensation/i);

    // Employee count processed should be 2 (Alice and Bob)
    assert.equal(res.body.data.employeeCount, 2);
    assert.ok(res.body.data.totalGrossEarnings > 0);
    assert.ok(res.body.data.totalNetPayable > 0);
  });

  it("3. Prevents duplicate payroll cycles for the same company and period", async () => {
    const res = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", [acmeHrCookie])
      .send({
        periodYear: 2026,
        periodMonth: 10,
      });

    assert.equal(res.status, 409);
    assert.match(res.body.message, /already exists/i);
  });

  it("4. Verifies salary calculation rules, rounding, and separation of employer contributions", async () => {
    const res = await request(app)
      .get(`/api/payroll/cycles/${createdCycleId}`)
      .set("Cookie", [acmeHrCookie]);

    assert.equal(res.status, 200);
    const cycle = res.body.data;
    const register = cycle.register;
    assert.equal(register.length, 2);

    // Alice: 100k gross (50k basic + 30k hra + 20k special), 2k deductions (1800 pf + 200 pt) -> 98,000 net
    const alice = register.find((r) => r.employeeNumber === "EMP-001");
    assert.ok(alice);
    assert.equal(alice.grossEarnings, 100000);
    assert.equal(alice.totalDeductions, 2000);
    assert.equal(alice.netPayable, 98000);
    // Employer contribution PF 1800 should be tracked separately and NOT deducted from netPayable
    assert.equal(alice.totalEmployerContributions, 1800);
    assert.equal(alice.netPayable, alice.grossEarnings - alice.totalDeductions);

    // Bob: 50k gross (30k basic + 20k hra), 1.8k deductions (1800 pf) -> 48,200 net
    const bob = register.find((r) => r.employeeNumber === "EMP-002");
    assert.ok(bob);
    assert.equal(bob.grossEarnings, 50000);
    assert.equal(bob.totalDeductions, 1800);
    assert.equal(bob.netPayable, 48200);

    // Check cycle overall totals match register sums
    assert.equal(cycle.totalGrossEarnings, 150000);
    assert.equal(cycle.totalDeductions, 3800);
    assert.equal(cycle.totalEmployerContributions, 3600);
    assert.equal(cycle.totalNetPayable, 146200);
  });

  it("5. Allows draft recalculation while cycle is in DRAFT/CALCULATED status", async () => {
    const res = await request(app)
      .post(`/api/payroll/cycles/${createdCycleId}/recalculate`)
      .set("Cookie", [acmeHrCookie]);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, "CALCULATED");
    assert.equal(res.body.data.employeeCount, 2);
  });

  it("6. Regular employees are forbidden from HR payroll management endpoints", async () => {
    // Normal employee cannot list cycles
    const listRes = await request(app)
      .get("/api/payroll/cycles")
      .set("Cookie", [acmeEmp1Cookie]);
    assert.equal(listRes.status, 403);

    // Normal employee cannot recalculate cycle
    const recalcRes = await request(app)
      .post(`/api/payroll/cycles/${createdCycleId}/recalculate`)
      .set("Cookie", [acmeEmp1Cookie]);
    assert.equal(recalcRes.status, 403);

    // Normal employee cannot finalize cycle
    const finalizeRes = await request(app)
      .post(`/api/payroll/cycles/${createdCycleId}/finalize`)
      .set("Cookie", [acmeEmp1Cookie]);
    assert.equal(finalizeRes.status, 403);
  });

  it("7. Employees cannot access unfinalized/draft payslips", async () => {
    // Attempting to list payslips when cycle is not finalized
    const res = await request(app)
      .get("/api/payroll/employee/payslips")
      .set("Cookie", [acmeEmp1Cookie]);

    assert.equal(res.status, 200);
    // Should return empty list because draft cycles are not visible to employees
    assert.deepEqual(res.body.data, []);
  });

  it("8. Finalizes payroll cycle and enforces historical snapshot immutability", async () => {
    // HR Admin finalizes payroll
    const res = await request(app)
      .post(`/api/payroll/cycles/${createdCycleId}/finalize`)
      .set("Cookie", [acmeHrCookie]);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "FINALIZED");
    assert.ok(res.body.data.finalizedAt);
    assert.ok(res.body.data.finalizedBy);

    // Recalculating a finalized cycle must be BLOCKED
    const recalcRes = await request(app)
      .post(`/api/payroll/cycles/${createdCycleId}/recalculate`)
      .set("Cookie", [acmeHrCookie]);
    assert.equal(recalcRes.status, 400);
    assert.match(recalcRes.body.message, /only draft/i);

    // Now update Employee 1's compensation in EmployeeCompensation model (simulate promotion next month)
    const acmeModels = await getCompanyModels(acmeCompany);
    await acmeModels.EmployeeCompensation.findOneAndUpdate(
      { employeeId: acmeEmp1Id },
      {
        $push: {
          revisions: {
            effectiveFromDate: new Date("2026-11-01"),
            monthlyCostToCompany: 200000,
            salaryComponents: {
              basicSalary: 100000,
              houseRentAllowance: 60000,
              specialAllowance: 40000,
            },
          },
        },
      }
    );

    // Verify Alice's finalized payslip snapshot is STILL 100,000 gross and 98,000 net
    const payslipDoc = await acmeModels.Payslip.findOne({
      payrollCycleId: createdCycleId,
      employeeId: acmeEmp1Id,
    });
    assert.ok(payslipDoc);
    assert.equal(payslipDoc.grossEarnings, 100000);
    assert.equal(payslipDoc.netPayable, 98000);
    assert.equal(payslipDoc.status, "FINALIZED");
  });

  it("9. Authenticated employee can view and download their own finalized payslip", async () => {
    // Alice checks her payslips list
    const listRes = await request(app)
      .get("/api/payroll/employee/payslips")
      .set("Cookie", [acmeEmp1Cookie]);

    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.data.length, 1);
    const aliceSlip = listRes.body.data[0];
    assert.equal(aliceSlip.periodMonth, 10);
    assert.equal(aliceSlip.periodYear, 2026);
    assert.equal(aliceSlip.grossEarnings, 100000);
    assert.equal(aliceSlip.netPayable, 98000);

    // Alice downloads her payslip PDF via new endpoint
    const dlRes = await request(app)
      .get(`/api/payroll/employee/payslips/${aliceSlip._id}/download`)
      .set("Cookie", [acmeEmp1Cookie]);

    assert.equal(dlRes.status, 200);
    assert.equal(dlRes.headers["content-type"], "application/pdf");
    assert.match(dlRes.headers["content-disposition"], /attachment.*payslip.*\.pdf/i);
    // Check PDF magic bytes (%PDF)
    assert.equal(dlRes.body.slice(0, 4).toString(), "%PDF");

    // Alice downloads her payslip via employee dashboard controller route
    const dashDlRes = await request(app)
      .get(`/api/employees/me/payslips/${aliceSlip._id}/download?format=pdf`)
      .set("Cookie", [acmeEmp1Cookie]);

    assert.equal(dashDlRes.status, 200);
    assert.equal(dashDlRes.headers["content-type"], "application/pdf");
    assert.equal(dashDlRes.body.slice(0, 4).toString(), "%PDF");
  });

  it("10. Enforces employee ownership: Employee cannot download another employee's payslip", async () => {
    const acmeModels = await getCompanyModels(acmeCompany);
    const bobSlip = await acmeModels.Payslip.findOne({
      payrollCycleId: createdCycleId,
      employeeId: acmeEmp2Id,
    });
    assert.ok(bobSlip);

    // Alice tries to download Bob's payslip -> must be rejected with 403 or 404
    const res = await request(app)
      .get(`/api/payroll/employee/payslips/${bobSlip._id}/download`)
      .set("Cookie", [acmeEmp1Cookie]);

    assert.ok([403, 404].includes(res.status), `Expected 403 or 404 but got ${res.status}`);
  });

  it("11. Records payments against finalized payroll and prevents duplicate or invalid payments", async () => {
    // 1. Invalid amount (<= 0)
    const errRes1 = await request(app)
      .post(`/api/payroll/cycles/${createdCycleId}/payments`)
      .set("Cookie", [acmeHrCookie])
      .send({ amountPaid: 0, paymentMethod: "BANK_TRANSFER" });
    assert.equal(errRes1.status, 400);

    // 2. Partial payment (50,000 out of 146,200)
    const partialRes = await request(app)
      .post(`/api/payroll/cycles/${createdCycleId}/payments`)
      .set("Cookie", [acmeHrCookie])
      .send({
        amountPaid: 50000,
        paymentMethod: "BANK_TRANSFER",
        referenceNumber: "TXN-OCT-001",
        notes: "First tranche",
      });

    assert.equal(partialRes.status, 200);
    assert.equal(partialRes.body.data.status, "PARTIALLY_PAID");
    assert.equal(partialRes.body.data.paymentSummary.totalPaid, 50000);
    assert.equal(partialRes.body.data.paymentSummary.remainingPayable, 96200);

    // 3. Duplicate payment reference check
    const dupRefRes = await request(app)
      .post(`/api/payroll/cycles/${createdCycleId}/payments`)
      .set("Cookie", [acmeHrCookie])
      .send({
        amountPaid: 10000,
        paymentMethod: "BANK_TRANSFER",
        referenceNumber: "TXN-OCT-001", // duplicate reference
      });
    assert.equal(dupRefRes.status, 409);

    // 4. Overpayment check
    const overPayRes = await request(app)
      .post(`/api/payroll/cycles/${createdCycleId}/payments`)
      .set("Cookie", [acmeHrCookie])
      .send({
        amountPaid: 100000, // exceeds remaining 96,200
        paymentMethod: "BANK_TRANSFER",
        referenceNumber: "TXN-OCT-002",
      });
    assert.equal(overPayRes.status, 400);
    assert.match(overPayRes.body.message, /cannot exceed/i);

    // 5. Pay the remaining 96,200 -> status transitions to PAID
    const fullRes = await request(app)
      .post(`/api/payroll/cycles/${createdCycleId}/payments`)
      .set("Cookie", [acmeHrCookie])
      .send({
        amountPaid: 96200,
        paymentMethod: "BANK_TRANSFER",
        referenceNumber: "TXN-OCT-003",
        notes: "Final tranche",
      });

    assert.equal(fullRes.status, 200);
    assert.equal(fullRes.body.data.status, "PAID");
    assert.equal(fullRes.body.data.paymentSummary.totalPaid, 146200);
    assert.equal(fullRes.body.data.paymentSummary.remainingPayable, 0);
  });

  it("12. Enforces tenant isolation: Globex HR cannot view or modify Acme payroll", async () => {
    // Globex HR attempts to view Acme's payroll cycle
    const getRes = await request(app)
      .get(`/api/payroll/cycles/${createdCycleId}`)
      .set("Cookie", [globexHrCookie]);
    assert.equal(getRes.status, 404);

    // Globex HR attempts to record payment on Acme's cycle
    const payRes = await request(app)
      .post(`/api/payroll/cycles/${createdCycleId}/payments`)
      .set("Cookie", [globexHrCookie])
      .send({
        amountPaid: 1000,
        paymentMethod: "CASH",
      });
    assert.equal(payRes.status, 404);

    // Globex HR cycles list should be empty
    const listRes = await request(app)
      .get("/api/payroll/cycles")
      .set("Cookie", [globexHrCookie]);
    assert.equal(listRes.status, 200);
    assert.deepEqual(listRes.body.data, []);
  });
});
