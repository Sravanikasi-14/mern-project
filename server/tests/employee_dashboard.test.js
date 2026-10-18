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
let company;
let hrCookie;
let employeeCookie;
let employeeRecord;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  company = await Company.create({
    companyName: "Acme Corp",
    slug: "acme",
    databaseName: "company_acme_dash_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User, Employee, EmployeeCompensation } = await getCompanyModels(company);

  // Create HR Admin user
  await User.create({
    email: "hr@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Create Employee user
  const empUser = await User.create({
    email: "employee@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  // Create Employee record
  employeeRecord = await Employee.create({
    userId: empUser._id,
    employeeCode: "EMP-001",
    fullName: "Jane Doe",
    email: "employee@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Senior Frontend Engineer",
      department: "Engineering",
      employmentType: "Full-time",
      workLocation: "Bangalore",
      joiningDate: new Date("2024-01-15"),
    },
    attendance: {
      totalWorkingDays: 22,
      daysPresent: 20,
      leaveBalance: { casual: 8, sick: 6, earned: 12 },
    },
    customFields: {
      assignedAssets: [
        { name: "MacBook Pro M3", serial: "MBP-2024-99", assignedDate: "2024-01-15" },
        { name: "Dell 27-inch 4K Monitor", serial: "DEL-4K-88", assignedDate: "2024-01-16" },
      ],
    },
  });

  // Create Compensation record for payslips
  await EmployeeCompensation.create({
    employeeId: employeeRecord._id,
    revisions: [
      {
        effectiveFromDate: new Date("2024-01-15"),
        monthlyCostToCompany: 120000,
        salaryComponents: {
          basicSalary: 60000,
          houseRentAllowance: 36000,
          specialAllowance: 16800,
          employerProvidentFund: 7200,
        },
      },
    ],
  });

  const hrLogin = await request(app).post("/api/auth/login").send({
    companyCode: "acme",
    email: "hr@acme.test",
    password: "AcmePass123!",
  });
  hrCookie = cookieFrom(hrLogin);

  const empLogin = await request(app).post("/api/auth/login").send({
    companyCode: "acme",
    email: "employee@acme.test",
    password: "AcmePass123!",
  });
  employeeCookie = cookieFrom(empLogin);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("Dedicated Employee Portal Dashboard API", () => {
  it("1. Employee gets their dedicated dashboard bundle with authorized personal data", async () => {
    const res = await request(app)
      .get("/api/employees/me/dashboard")
      .set("Cookie", employeeCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.employee.fullName, "Jane Doe");
    assert.equal(res.body.employee.employeeCode, "EMP-001");
    assert.equal(res.body.employee.jobTitle, "Senior Frontend Engineer");
    assert.equal(res.body.employee.department, "Engineering");

    // Attendance data
    assert.ok(res.body.attendance);
    assert.equal(res.body.attendance.today.status, "NOT_CHECKED_IN");
    assert.equal(res.body.attendance.summary.totalWorkingDays, 22);
    assert.equal(res.body.attendance.summary.daysPresent, 20);

    // Leave balance
    assert.ok(res.body.leave);
    assert.equal(res.body.leave.balance.casual, 8);
    assert.equal(res.body.leave.balance.sick, 6);
    assert.equal(res.body.leave.balance.earned, 12);

    // Holidays
    assert.ok(Array.isArray(res.body.holidays));
    assert.ok(res.body.holidays.length > 0);

    // Payslips
    assert.ok(Array.isArray(res.body.payslips));
    assert.ok(res.body.payslips.length > 0);
    assert.equal(res.body.payslips[0].grossSalary, 120000);
    assert.equal(res.body.payslips[0].netPay, 112800);

    // Assets
    assert.ok(Array.isArray(res.body.assets));
    assert.equal(res.body.assets.length, 2);
    assert.equal(res.body.assets[0].name, "MacBook Pro M3");
  });

  it("2. Employee records check-in for today", async () => {
    const res = await request(app)
      .post("/api/employees/me/attendance/check-in")
      .set("Cookie", employeeCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.today.status, "CHECKED_IN");
    assert.ok(res.body.today.checkInTime);

    // Re-check dashboard shows today's CHECKED_IN status
    const dashRes = await request(app)
      .get("/api/employees/me/dashboard")
      .set("Cookie", employeeCookie);
    assert.equal(dashRes.body.attendance.today.status, "CHECKED_IN");
  });

  it("3. Duplicate check-in is rejected", async () => {
    const res = await request(app)
      .post("/api/employees/me/attendance/check-in")
      .set("Cookie", employeeCookie);

    assert.equal(res.status, 400);
  });

  it("4. Employee records check-out for today", async () => {
    const res = await request(app)
      .post("/api/employees/me/attendance/check-out")
      .set("Cookie", employeeCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.today.status, "CHECKED_OUT");
    assert.ok(res.body.today.checkOutTime);

    // Re-check dashboard shows today's CHECKED_OUT status
    const dashRes = await request(app)
      .get("/api/employees/me/dashboard")
      .set("Cookie", employeeCookie);
    assert.equal(dashRes.body.attendance.today.status, "CHECKED_OUT");
  });

  it("5. Employee applies for leave with valid balance", async () => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() + 5);
    const end = new Date(today);
    end.setDate(end.getDate() + 6);

    const res = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookie)
      .send({
        leaveType: "CASUAL",
        startDate: start.toISOString().split("T")[0],
        endDate: end.toISOString().split("T")[0],
        reason: "Family function",
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.leaveRequest.leaveType, "CASUAL");
    assert.equal(res.body.leaveRequest.days, 2);
    assert.equal(res.body.remainingBalance.casual, 6); // 8 - 2 = 6

    // Dashboard reflects leave summary
    const dashRes = await request(app)
      .get("/api/employees/me/dashboard")
      .set("Cookie", employeeCookie);
    assert.equal(dashRes.body.leave.summary.pending, 1);
    assert.equal(dashRes.body.leave.balance.casual, 6);
  });

  it("6. Rejects leave application when requested days exceed balance", async () => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() + 10);
    const end = new Date(today);
    end.setDate(end.getDate() + 25); // 16 days > remaining 6 casual days

    const res = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookie)
      .send({
        leaveType: "CASUAL",
        startDate: start.toISOString().split("T")[0],
        endDate: end.toISOString().split("T")[0],
        reason: "Vacation",
      });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Insufficient CASUAL leave balance/i);
  });

  it("7. Employee downloads their personal payslip", async () => {
    const dashRes = await request(app)
      .get("/api/employees/me/dashboard")
      .set("Cookie", employeeCookie);

    const payslip = dashRes.body.payslips[0];
    assert.ok(payslip);

    const res = await request(app)
      .get(`/api/employees/me/payslips/${payslip.id}/download`)
      .set("Cookie", employeeCookie);

    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/plain/);
    assert.match(res.text, /SALARY PAYSLIP/);
    assert.match(res.text, /Jane Doe/);
    assert.match(res.text, /EMP-001/);
  });

  it("8. Strict security: Employee is blocked with 403 from HR-only employee management routes", async () => {
    const resSummary = await request(app)
      .get("/api/employees/summary")
      .set("Cookie", employeeCookie);
    assert.equal(resSummary.status, 403);

    const resList = await request(app)
      .get("/api/employees")
      .set("Cookie", employeeCookie);
    assert.equal(resList.status, 403);
  });

  it("9. HR Admin continues to have full access to management endpoints", async () => {
    const resSummary = await request(app)
      .get("/api/employees/summary")
      .set("Cookie", hrCookie);
    assert.equal(resSummary.status, 200);

    const resList = await request(app)
      .get("/api/employees")
      .set("Cookie", hrCookie);
    assert.equal(resList.status, 200);
  });
});
