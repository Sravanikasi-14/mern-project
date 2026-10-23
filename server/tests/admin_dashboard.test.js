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
let companyA;
let companyB;
let hrCookieA;
let hrCookieB;
let employeeCookieA;
let emp1;
let emp2;
let emp3;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  companyA = await Company.create({
    companyName: "Acme Corp",
    slug: "acme",
    databaseName: "company_acme_dash_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  companyB = await Company.create({
    companyName: "Globex Corp",
    slug: "globex",
    databaseName: "company_globex_dash_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  // Provision & seed Company A
  const modelsA = await getCompanyModels(companyA);
  const {
    User: UserA,
    Employee: EmployeeA,
    Attendance: AttendanceA,
    LeaveRequest: LeaveRequestA,
    OfferLetter: OfferLetterA,
    EmployeeCompensation: CompensationA,
    CompanyHrPolicy: PolicyA,
  } = modelsA;

  await PolicyA.deleteMany({});
  await PolicyA.create({
    effectiveFromDate: new Date("2026-01-01"),
    attendanceRules: {
      officeStartTime: "09:30",
      officeEndTime: "18:30",
      gracePeriodMinutes: 15,
    },
    payrollRules: {
      currencySymbol: "₹",
      currencyCode: "INR",
    },
    weekendRules: {
      saturdayOff: true,
      sundayOff: true,
      alternateSaturdaysOff: false,
    },
    holidays: [
      { name: "Gandhi Jayanti", date: new Date("2026-10-02"), isPaid: true },
    ],
  });

  const hrA = await UserA.create({
    email: "hr@acme.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.HR_ADMIN,
    name: "Acme HR Admin",
    status: "ACTIVE",
  });

  const empUserA = await UserA.create({
    email: "alice@acme.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.EMPLOYEE,
    name: "Alice Engineer",
    status: "ACTIVE",
  });

  emp1 = await EmployeeA.create({
    userId: empUserA._id,
    employeeCode: "ACM-001",
    fullName: "Alice Engineer",
    email: "alice@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Software Engineer",
      department: "Engineering",
      project: { projectName: "HRMS Portal", projectType: "MANDATE" },
    },
    customFields: {
      assignedAssets: ["MacBook Pro 16", "Dell Monitor 27"],
    },
  });

  emp2 = await EmployeeA.create({
    employeeCode: "ACM-002",
    fullName: "Bob Designer",
    email: "bob@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "UI/UX Designer",
      department: "Design",
      project: { projectName: "Mobile App", projectType: "RETAIL" },
    },
    customFields: {
      assignedAssets: [],
    },
  });

  emp3 = await EmployeeA.create({
    employeeCode: "ACM-003",
    fullName: "Charlie Sales",
    email: "charlie@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Sales Lead",
      department: "Sales",
      project: { projectName: "Enterprise Expansion", projectType: "MANDATE" },
    },
    customFields: {},
  });

  // Seed Compensation for emp1 and emp2
  await CompensationA.create({
    employeeId: emp1._id,
    revisions: [
      {
        effectiveFromDate: new Date("2026-01-01"),
        monthlyCostToCompany: 100000,
      },
    ],
  });

  await CompensationA.create({
    employeeId: emp2._id,
    revisions: [
      {
        effectiveFromDate: new Date("2026-01-01"),
        monthlyCostToCompany: 80000,
      },
    ],
  });

  // emp3 has customFields salary
  await EmployeeA.updateOne(
    { _id: emp3._id },
    { $set: { "customFields.monthlySalary": 60000 } }
  );

  // Seed Attendance for today: emp1 is Present and On-Time (09:20), emp2 is Late (10:05)
  const todayStr = "2026-10-23";
  await AttendanceA.create({
    employeeId: emp1._id,
    date: todayStr,
    status: "PRESENT",
    checkIn: new Date("2026-10-23T03:50:00.000Z"), // 09:20 IST (03:50 UTC)
  });

  await AttendanceA.create({
    employeeId: emp2._id,
    date: todayStr,
    status: "PRESENT",
    checkIn: new Date("2026-10-23T04:35:00.000Z"), // 10:05 IST (04:35 UTC) -> Late (Threshold is 09:45 IST)
  });

  // emp3 is on APPROVED leave today
  await LeaveRequestA.create({
    employeeId: emp3._id,
    leaveTypeCode: "CASUAL",
    fromDate: new Date("2026-10-22T00:00:00.000Z"),
    toDate: new Date("2026-10-24T23:59:59.999Z"),
    daysCount: 3,
    status: "APPROVED",
    reason: "Personal event",
  });

  // Seed Offer Letters in Company A
  await OfferLetterA.create({
    candidate: { fullName: "David Doe", email: "david@test.com" },
    position: "QA Engineer",
    department: "Engineering",
    monthlySalary: 70000,
    joiningDate: new Date("2026-11-01"),
    content: "Offer letter content",
    status: "ACCEPTED",
  });

  await OfferLetterA.create({
    candidate: { fullName: "Eva Green", email: "eva@test.com" },
    position: "Frontend Dev",
    department: "Engineering",
    monthlySalary: 85000,
    joiningDate: new Date("2026-11-15"),
    content: "Offer letter content",
    status: "SENT",
  });

  await OfferLetterA.create({
    candidate: { fullName: "Frank Castle", email: "frank@test.com" },
    position: "Product Manager",
    department: "Product",
    monthlySalary: 120000,
    joiningDate: new Date("2026-11-20"),
    content: "Offer letter content",
    status: "REJECTED",
  });

  // Provision Company B
  const modelsB = await getCompanyModels(companyB);
  const { User: UserB } = modelsB;
  const hrB = await UserB.create({
    email: "hr@globex.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.HR_ADMIN,
    name: "Globex HR Admin",
    status: "ACTIVE",
  });

  // Log in HR Admin A
  const resLoginHRA = await request(app)
    .post("/api/auth/login")
    .send({ email: "hr@acme.test", password: "Password123!", companyCode: "acme" });
  hrCookieA = cookieFrom(resLoginHRA);

  // Log in Employee A
  const resLoginEmpA = await request(app)
    .post("/api/auth/login")
    .send({ email: "alice@acme.test", password: "Password123!", companyCode: "acme" });
  employeeCookieA = cookieFrom(resLoginEmpA);

  // Log in HR Admin B
  const resLoginHRB = await request(app)
    .post("/api/auth/login")
    .send({ email: "hr@globex.test", password: "Password123!", companyCode: "globex" });
  hrCookieB = cookieFrom(resLoginHRB);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("HR Admin Dashboard API (/api/admin/dashboard)", () => {
  it("1. Authenticated HR Admin retrieves full live dashboard metrics with accurate calculations", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard?date=2026-10-23&month=10&year=2026")
      .set("Cookie", hrCookieA);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    const { meta, summary, recruitmentFunnel, attendanceCalendar, recentLeaves, companyAssets, payrollAllocation, projectTeams } = res.body;

    // Verify Meta
    assert.equal(meta.companyName, "Acme Corp");
    assert.equal(meta.selectedDate, "2026-10-23");
    assert.equal(meta.selectedMonth, 10);
    assert.equal(meta.currencySymbol, "₹");
    assert.ok(meta.departments.includes("Engineering"));
    assert.ok(meta.departments.includes("Design"));

    // Verify Summary Cards
    // 3 active employees: emp1 (present), emp2 (present & late), emp3 (on approved leave)
    assert.equal(summary.activeEmployees, 3);
    assert.equal(summary.todayPresent, 2);
    assert.equal(summary.todayLate, 1); // emp2 checked in after 09:45
    assert.equal(summary.onLeave, 1);   // emp3 on leave
    assert.equal(summary.todayAbsent, 0); // 3 - 2 present - 1 leave = 0 absent
    assert.equal(summary.monthlyPayroll, 240000); // 100k + 80k + 60k = 240k

    // Verify Recruitment Funnel
    assert.equal(recruitmentFunnel.offersGenerated, 3);
    assert.equal(recruitmentFunnel.accepted, 1);
    assert.equal(recruitmentFunnel.pending, 1);
    assert.equal(recruitmentFunnel.declined, 1);
    // Acceptance rate = 1 / (1 + 1) = 50.0%
    assert.equal(recruitmentFunnel.acceptanceRate, "50.0");

    // Verify Attendance Calendar
    assert.equal(attendanceCalendar.month, 10);
    assert.equal(attendanceCalendar.daysInMonth, 31);
    assert.equal(attendanceCalendar.days.length, 31);

    const oct2 = attendanceCalendar.days.find((d) => d.date === "2026-10-02");
    assert.ok(oct2);
    assert.equal(oct2.isHoliday, true);
    assert.equal(oct2.holidayName, "Gandhi Jayanti");

    const oct23 = attendanceCalendar.days.find((d) => d.date === "2026-10-23");
    assert.ok(oct23);
    assert.equal(oct23.isToday, true);
    assert.equal(oct23.presentCount, 2);
    assert.equal(oct23.lateCount, 1);

    // Verify Recent Leaves
    assert.equal(recentLeaves.length, 1);
    assert.equal(recentLeaves[0].employeeName, "Charlie Sales");
    assert.equal(recentLeaves[0].leaveType, "CASUAL");
    assert.equal(recentLeaves[0].status, "APPROVED");

    // Verify Company Assets
    assert.equal(companyAssets.totalEmployees, 3);
    assert.equal(companyAssets.employeesWithAssets, 1); // emp1
    assert.equal(companyAssets.employeesWithoutAssets, 2); // emp2, emp3
    assert.equal(companyAssets.employeesWithAssetsPct, 33);
    assert.equal(companyAssets.employeesWithoutAssetsPct, 67);

    // Verify Payroll Allocation
    assert.equal(payrollAllocation.totalMonthly, 240000);
    assert.equal(payrollAllocation.departments.length, 3);
    const eng = payrollAllocation.departments.find((d) => d.department === "Engineering");
    assert.equal(eng.cost, 100000);
    assert.equal(eng.percentage, 42); // 100k / 240k = 41.6% -> 42%

    // Verify Project Teams
    assert.equal(projectTeams.mandate.count, 2); // emp1, emp3
    assert.equal(projectTeams.retail.count, 1);  // emp2
    assert.equal(projectTeams.topStaffed.length >= 2, true);
  });

  it("2. Filters dashboard data correctly when department query is supplied", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard?date=2026-10-23&department=Engineering")
      .set("Cookie", hrCookieA);

    assert.equal(res.status, 200);
    const { summary, companyAssets } = res.body;

    // Only 1 employee in Engineering (emp1)
    assert.equal(summary.activeEmployees, 1);
    assert.equal(summary.todayPresent, 1);
    assert.equal(summary.todayLate, 0); // emp1 is not late
    assert.equal(summary.onLeave, 0);
    assert.equal(summary.monthlyPayroll, 100000);
    assert.equal(companyAssets.employeesWithAssets, 1);
  });

  it("3. Strictly blocks non-HR_ADMIN (Employee role) with 403 Forbidden", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", employeeCookieA);

    assert.equal(res.status, 403);
  });

  it("4. Rejects unauthenticated request with 401 Unauthorized", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard");

    assert.equal(res.status, 401);
  });

  it("5. Tenant isolation: Company B HR Admin cannot see Company A's dashboard data", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard?date=2026-10-23")
      .set("Cookie", hrCookieB);

    assert.equal(res.status, 200);
    assert.equal(res.body.meta.companyName, "Globex Corp");
    // Globex has 0 employees seeded
    assert.equal(res.body.summary.activeEmployees, 0);
    assert.equal(res.body.summary.todayPresent, 0);
    assert.equal(res.body.recruitmentFunnel.offersGenerated, 0);
    assert.equal(res.body.recentLeaves.length, 0);
  });
});
