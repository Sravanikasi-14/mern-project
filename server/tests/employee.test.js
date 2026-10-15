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
let globexHrCookie;

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
    databaseName: "company_acme",
    status: COMPANY_STATUSES.ACTIVE,
  });

  globex = await Company.create({
    companyName: "Globex Corp",
    slug: "globex",
    databaseName: "company_globex",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: AcmeUser } = await getCompanyModels(acme);
  await AcmeUser.create({
    email: "hr@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  await AcmeUser.create({
    email: "worker@acme.test",
    passwordHash: await hashPassword("WorkerPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "hr@globex.test",
    passwordHash: await hashPassword("GlobexPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const acmeHrLogin = await request(app).post("/api/auth/login").send({
    companyCode: "acme",
    email: "hr@acme.test",
    password: "AcmePass123!",
  });
  acmeHrCookie = cookieFrom(acmeHrLogin);

  const acmeEmpLogin = await request(app).post("/api/auth/login").send({
    companyCode: "acme",
    email: "worker@acme.test",
    password: "WorkerPass123!",
  });
  acmeEmployeeCookie = cookieFrom(acmeEmpLogin);

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

describe("Employee Management Foundation API", () => {
  it("returns empty list and zeroed counters on empty tenant database", async () => {
    const listRes = await request(app)
      .get("/api/employees")
      .set("Cookie", acmeHrCookie);

    assert.equal(listRes.status, 200);
    assert.deepEqual(listRes.body.employees, []);
    assert.equal(listRes.body.pagination.totalEmployees, 0);

    const summaryRes = await request(app)
      .get("/api/employees/summary")
      .set("Cookie", acmeHrCookie);

    assert.equal(summaryRes.status, 200);
    assert.equal(summaryRes.body.totalEmployees, 0);
    assert.equal(summaryRes.body.activeEmployees, 0);
    assert.equal(summaryRes.body.inactiveEmployees, 0);
    assert.equal(summaryRes.body.assignedEmployees, 0);
    assert.equal(summaryRes.body.totalMonthlySalary, 0);
  });

  it("blocks unauthenticated users from employee routes", async () => {
    const response = await request(app).get("/api/employees");
    assert.equal(response.status, 401);
  });

  it("blocks EMPLOYEE role from employee management routes", async () => {
    const listRes = await request(app)
      .get("/api/employees")
      .set("Cookie", acmeEmployeeCookie);
    assert.equal(listRes.status, 403);

    const summaryRes = await request(app)
      .get("/api/employees/summary")
      .set("Cookie", acmeEmployeeCookie);
    assert.equal(summaryRes.status, 403);
  });

  let emp1;
  let emp2;
  let emp3;

  it("creates test employees and compensations in tenant database", async () => {
    const { Employee, EmployeeCompensation } = await getCompanyModels(acme);

    emp1 = await Employee.create({
      employeeCode: "EMP-001",
      fullName: "Alice Johnson",
      email: "alice@acme.test",
      phoneNumber: "9876543210",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: {
        jobTitle: "Software Engineer",
        joiningDate: new Date("2024-01-15"),
        project: { projectName: "Project Titan", projectType: "MANDATE" },
      },
    });

    emp2 = await Employee.create({
      employeeCode: "EMP-002",
      fullName: "Bob Smith",
      email: "bob@acme.test",
      phoneNumber: "9876543211",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: {
        jobTitle: "QA Lead",
        joiningDate: new Date("2024-02-01"),
        reportingManagerId: emp1._id,
        project: { projectName: "", projectType: "" },
      },
    });

    emp3 = await Employee.create({
      employeeCode: "EMP-003",
      fullName: "Charlie Brown",
      email: "charlie@acme.test",
      phoneNumber: "9876543212",
      status: EMPLOYEE_STATUSES.INACTIVE,
      job: {
        jobTitle: "DevOps Engineer",
        joiningDate: new Date("2023-05-10"),
      },
    });

    // Add compensation for emp1 and emp2
    await EmployeeCompensation.create({
      employeeId: emp1._id,
      revisions: [
        {
          effectiveFromDate: new Date("2024-01-15"),
          monthlyCostToCompany: mongoose.Types.Decimal128.fromString("80000"),
          salaryComponents: {
            basicSalary: mongoose.Types.Decimal128.fromString("40000"),
            houseRentAllowance: mongoose.Types.Decimal128.fromString("20000"),
          },
        },
      ],
    });

    await EmployeeCompensation.create({
      employeeId: emp2._id,
      revisions: [
        {
          effectiveFromDate: new Date("2024-02-01"),
          monthlyCostToCompany: mongoose.Types.Decimal128.fromString("60000"),
        },
      ],
    });

    // Compensation for inactive emp3 (should not be added to active total salary)
    await EmployeeCompensation.create({
      employeeId: emp3._id,
      revisions: [
        {
          effectiveFromDate: new Date("2023-05-10"),
          monthlyCostToCompany: mongoose.Types.Decimal128.fromString("50000"),
        },
      ],
    });

    assert.ok(emp1);
    assert.ok(emp2);
    assert.ok(emp3);
  });

  it("returns summary counters with active, inactive, assigned, and active total salary", async () => {
    const res = await request(app)
      .get("/api/employees/summary")
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.totalEmployees, 3);
    assert.equal(res.body.activeEmployees, 2);
    assert.equal(res.body.inactiveEmployees, 1);
    assert.equal(res.body.assignedEmployees, 1); // Only emp1 has project Titan
    assert.equal(res.body.totalMonthlySalary, 140000); // 80k + 60k
  });

  it("lists employees with pagination and enriched currentMonthlySalary", async () => {
    const res = await request(app)
      .get("/api/employees?page=1&limit=10")
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.employees.length, 3);
    assert.equal(res.body.pagination.totalEmployees, 3);

    const alice = res.body.employees.find((e) => e.employeeCode === "EMP-001");
    assert.ok(alice);
    assert.equal(alice.currentMonthlySalary, 80000);
  });

  it("searches employees by name, email, or employeeCode", async () => {
    const searchByName = await request(app)
      .get("/api/employees?search=alice")
      .set("Cookie", acmeHrCookie);
    assert.equal(searchByName.body.employees.length, 1);
    assert.equal(searchByName.body.employees[0].employeeCode, "EMP-001");

    const searchByCode = await request(app)
      .get("/api/employees?search=EMP-002")
      .set("Cookie", acmeHrCookie);
    assert.equal(searchByCode.body.employees.length, 1);
    assert.equal(searchByCode.body.employees[0].fullName, "Bob Smith");

    const searchByEmail = await request(app)
      .get("/api/employees?search=charlie@acme.test")
      .set("Cookie", acmeHrCookie);
    assert.equal(searchByEmail.body.employees.length, 1);
    assert.equal(searchByEmail.body.employees[0].employeeCode, "EMP-003");
  });

  it("filters employees by status", async () => {
    const activeRes = await request(app)
      .get("/api/employees?status=ACTIVE")
      .set("Cookie", acmeHrCookie);
    assert.equal(activeRes.body.employees.length, 2);

    const inactiveRes = await request(app)
      .get("/api/employees?status=INACTIVE")
      .set("Cookie", acmeHrCookie);
    assert.equal(inactiveRes.body.employees.length, 1);
    assert.equal(inactiveRes.body.employees[0].fullName, "Charlie Brown");
  });

  it("supports limit options 10, 50, 100, 200, 300", async () => {
    const res50 = await request(app)
      .get("/api/employees?limit=50")
      .set("Cookie", acmeHrCookie);
    assert.equal(res50.status, 200);
    assert.equal(res50.body.pagination.limit, 50);

    const res300 = await request(app)
      .get("/api/employees?limit=300")
      .set("Cookie", acmeHrCookie);
    assert.equal(res300.status, 200);
    assert.equal(res300.body.pagination.limit, 300);
  });

  it("gets single employee details with salary components", async () => {
    const res = await request(app)
      .get(`/api/employees/${emp1._id}`)
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.fullName, "Alice Johnson");
    assert.equal(res.body.currentMonthlySalary, 80000);
    assert.equal(res.body.salaryComponents.basicSalary, 40000);
    assert.equal(res.body.salaryComponents.houseRentAllowance, 20000);
  });

  it("enforces tenant isolation: Globex HR cannot see Acme employees", async () => {
    const res = await request(app)
      .get("/api/employees")
      .set("Cookie", globexHrCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.employees.length, 0);

    const summaryRes = await request(app)
      .get("/api/employees/summary")
      .set("Cookie", globexHrCookie);

    assert.equal(summaryRes.body.totalEmployees, 0);
    assert.equal(summaryRes.body.totalMonthlySalary, 0);
  });
});
