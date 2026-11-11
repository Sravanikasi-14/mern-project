process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

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
import { EMPLOYEE_IMPORT_TEMPLATE_HEADERS } from "../controllers/employeeImportController.js";
import {
  collectUnrecognizedImportHeaders,
  mapImportRowDetailed,
  normalizeMappedCell,
} from "../utils/employeeImportMapping.js";

let mongo;
let app;
let company;
let hrCookie;
let models;
let managerEmp;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

/** Workforce-export shaped rows matching the audit sample headers (no email). */
function sampleWorkforceRows(count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    employee_id: `WF-${String(i + 1).padStart(3, "0")}`,
    name: `Worker ${i + 1}`,
    department: "Engineering",
    title: "Software Engineer",
    hire_date: "2024-03-01",
    salary: "85,000",
    location: "Hyderabad",
    manager_id: "MGR-001",
    notes: i === 0 ? "unsupported sample column" : "",
  }));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  company = await Company.create({
    companyName: "Import Co",
    slug: "importco",
    databaseName: "company_importco_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  models = await getCompanyModels(company);
  const { User, Employee, Department, Designation } = models;

  await User.create({
    email: "hr@importco.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.HR_ADMIN,
    name: "Import HR",
    status: "ACTIVE",
  });

  managerEmp = await Employee.create({
    employeeCode: "MGR-001",
    fullName: "Manager One",
    email: "manager@importco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineering Manager", department: "Engineering" },
  });

  await Department.create({
    name: "Engineering",
    normalizedName: "engineering",
    isActive: true,
  });
  await Department.create({
    name: "People Ops",
    normalizedName: "people ops",
    isActive: true,
  });

  await Designation.create({
    title: "Software Engineer",
    normalizedTitle: "software engineer",
    isActive: true,
  });
  await Designation.create({
    title: "Coordinator",
    normalizedTitle: "coordinator",
    isActive: true,
  });

  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: "hr@importco.test", password: "Password123!", companyCode: "importco" });
  hrCookie = cookieFrom(login);
  assert.ok(hrCookie);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Employee import pipeline", () => {
  it("maps sample CSV aliases and does not invent email; surfaces unsupported columns", () => {
    const row = sampleWorkforceRows(1)[0];
    const { mapped, unrecognizedHeaders } = mapImportRowDetailed(row);
    assert.equal(mapped.employeeCode, "WF-001");
    assert.equal(mapped.fullName, "Worker 1");
    assert.equal(mapped.department, "Engineering");
    assert.equal(mapped.jobTitle, "Software Engineer");
    assert.equal(mapped.joiningDate, "2024-03-01");
    assert.equal(mapped.monthlySalary, "85000");
    assert.equal(mapped.workLocation, "Hyderabad");
    assert.equal(mapped.reportingManagerCode, "MGR-001");
    assert.equal(mapped.email, undefined);
    assert.ok(unrecognizedHeaders.includes("notes"));
    assert.deepEqual(collectUnrecognizedImportHeaders([row]), ["notes"]);
  });

  it("normalizes Excel serial hire dates and currency salary cells", () => {
    // 2024-03-01 ≈ Excel serial 45352 (1900 system)
    assert.equal(normalizeMappedCell("joiningDate", 45352), "2024-03-01");
    assert.equal(normalizeMappedCell("monthlySalary", "₹1,25,000"), "125000");
  });

  it("official template download headers match importer canonical fields", async () => {
    const res = await request(app)
      .get("/api/employees/import/template")
      .set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    const headerLine = String(res.text).split(/\r?\n/)[0].trim();
    assert.equal(headerLine, EMPLOYEE_IMPORT_TEMPLATE_HEADERS.join(","));
    assert.match(headerLine, /fullName,email,employeeCode,jobTitle,department/);
  });

  it("preview of workforce CSV without email: mapped values visible, all rows invalid", async () => {
    const rows = sampleWorkforceRows(5);
    const res = await request(app)
      .post("/api/employees/import/preview")
      .set("Cookie", hrCookie)
      .send({ rows });

    assert.equal(res.status, 200);
    assert.equal(res.body.summary.totalRows, 5);
    assert.equal(res.body.summary.validRows, 0);
    assert.equal(res.body.summary.invalidRows, 5);
    assert.ok(res.body.unrecognizedColumns.includes("notes"));

    for (const r of res.body.rows) {
      assert.equal(r.valid, false);
      assert.ok(r.errors.email, "email must remain required");
      assert.ok(r.data.fullName.startsWith("Worker"));
      assert.ok(r.data.employeeCode.startsWith("WF-"));
      assert.equal(r.data.department, "Engineering");
      assert.equal(r.data.jobTitle, "Software Engineer");
      assert.equal(r.data.joiningDate, "2024-03-01");
      assert.equal(String(r.data.monthlySalary), "85000");
      assert.equal(r.data.workLocation, "Hyderabad");
      assert.equal(r.data.reportingManagerCode, "MGR-001");
    }
  });

  it("rejects unknown department/title and bad date/salary/manager while keeping mapped preview", async () => {
    const res = await request(app)
      .post("/api/employees/import/preview")
      .set("Cookie", hrCookie)
      .send({
        rows: [
          {
            employee_id: "BAD-1",
            name: "Bad Dept",
            email: "bad.dept@importco.test",
            department: "Not A Real Dept",
            title: "Software Engineer",
            hire_date: "2024-01-15",
            salary: "50000",
          },
          {
            employee_id: "BAD-2",
            name: "Bad Title",
            email: "bad.title@importco.test",
            department: "Engineering",
            title: "Space Admiral",
            hire_date: "not-a-date",
            salary: "-12",
            manager_id: "NO-SUCH-MGR",
          },
        ],
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.summary.validRows, 0);
    assert.equal(res.body.summary.invalidRows, 2);

    const [r0, r1] = res.body.rows;
    assert.equal(r0.data.fullName, "Bad Dept");
    assert.equal(r0.data.employeeCode, "BAD-1");
    assert.match(r0.errors.department, /not found/i);

    assert.equal(r1.data.fullName, "Bad Title");
    assert.match(r1.errors.jobTitle, /not found/i);
    assert.ok(r1.errors.joiningDate);
    assert.ok(r1.errors.monthlySalary);
    assert.match(r1.errors.reportingManagerCode, /not found/i);
  });

  it("official template rows preview as valid and commit persists complete employees", async () => {
    const rows = [
      {
        fullName: "Maya Rao",
        email: "maya.rao@importco.test",
        employeeCode: "EMP-101",
        jobTitle: "Software Engineer",
        department: "Engineering",
        employmentType: "Full-time",
        joiningDate: "2026-04-01",
        monthlySalary: "75000",
        projectName: "Platform",
        workLocation: "Bengaluru",
        phoneNumber: "+91 9000000001",
        reportingManagerCode: "MGR-001",
      },
      {
        fullName: "Import Dup",
        email: "maya.rao@importco.test",
        employeeCode: "EMP-102",
        jobTitle: "Coordinator",
        department: "People Ops",
      },
    ];

    const preview = await request(app)
      .post("/api/employees/import/preview")
      .set("Cookie", hrCookie)
      .send({ rows });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.summary.validRows, 1);
    assert.equal(preview.body.summary.invalidRows, 1);
    assert.equal(preview.body.rows[0].valid, true);
    assert.equal(preview.body.rows[0].data.fullName, "Maya Rao");
    assert.equal(preview.body.rows[1].valid, false);
    assert.match(preview.body.rows[1].errors.email, /Duplicate email/i);

    const commit = await request(app)
      .post("/api/employees/import")
      .set("Cookie", hrCookie)
      .send({ rows, importValidOnly: true });
    assert.equal(commit.status, 201);
    assert.equal(commit.body.summary.createdCount, 1);
    assert.equal(commit.body.summary.failedCount, 1);
    assert.ok(commit.body.created[0].activationLink.includes("/activate?token="));

    const saved = await models.Employee.findOne({ employeeCode: "EMP-101" }).lean();
    assert.ok(saved);
    assert.equal(saved.fullName, "Maya Rao");
    assert.equal(saved.email, "maya.rao@importco.test");
    assert.equal(saved.job.jobTitle, "Software Engineer");
    assert.equal(saved.job.department, "Engineering");
    assert.ok(saved.job.departmentId);
    assert.equal(String(saved.job.reportingManagerId), String(managerEmp._id));
    assert.equal(saved.job.workLocation, "Bengaluru");
    assert.equal(saved.phoneNumber, "+91 9000000001");

    const user = await models.User.findOne({ email: "maya.rao@importco.test" }).lean();
    assert.ok(user);
    assert.equal(user.role, USER_ROLES.EMPLOYEE);
    assert.equal(String(user.employeeId), String(saved._id));
  });

  it("workforce rows with email + known org refs import successfully", async () => {
    const rows = [
      {
        employee_id: "WF-900",
        name: "Asha Nair",
        email: "asha.nair@importco.test",
        department: "Engineering",
        title: "Software Engineer",
        hire_date: "2024-06-15",
        salary: "₹90,000",
        location: "Hyderabad",
        manager_id: "MGR-001",
        bonus_flag: "Y",
      },
    ];

    const preview = await request(app)
      .post("/api/employees/import/preview")
      .set("Cookie", hrCookie)
      .send({ rows });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.summary.validRows, 1);
    assert.equal(preview.body.rows[0].data.employeeCode, "WF-900");
    assert.equal(preview.body.rows[0].data.monthlySalary, "90000");
    assert.ok(preview.body.unrecognizedColumns.includes("bonus_flag"));

    const commit = await request(app)
      .post("/api/employees/import")
      .set("Cookie", hrCookie)
      .send({ rows, importValidOnly: true });
    assert.equal(commit.status, 201);
    assert.equal(commit.body.summary.createdCount, 1);

    const saved = await models.Employee.findOne({ employeeCode: "WF-900" }).lean();
    assert.ok(saved);
    assert.equal(saved.fullName, "Asha Nair");
    assert.equal(saved.job.department, "Engineering");
    assert.equal(String(saved.job.reportingManagerId), String(managerEmp._id));
  });

  it("duplicate employee code against database is rejected", async () => {
    const res = await request(app)
      .post("/api/employees/import/preview")
      .set("Cookie", hrCookie)
      .send({
        rows: [
          {
            fullName: "Clash",
            email: "clash@importco.test",
            employeeCode: "EMP-101",
            jobTitle: "Coordinator",
            department: "People Ops",
          },
        ],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.summary.validRows, 0);
    assert.match(res.body.rows[0].errors.employeeCode, /already exists/i);
  });
});
