process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f56-f52-projects-import-test-secret-32!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f56_f52";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;

import assert from "node:assert/strict";
import fs from "node:fs";
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
  EMPLOYEE_IMPORT_MAX_ROWS,
  resolveEmployeeImportCommitChunk,
} from "../controllers/employeeImportController.js";
import { buildEmployeeProjectsOverview } from "../services/employeeProjectsOverviewService.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

describe("F56 projects overview + F52 import chunking", () => {
  let mongo;
  let app;
  let company;
  let models;
  let hrCookie;

  before(async () => {
    const dbPath = `D:/tmp/hrms-mongo/f56-f52/${Date.now()}`;
    fs.mkdirSync(dbPath, { recursive: true });
    mongo = await MongoMemoryServer.create({ instance: { dbPath } });
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    const slug = `f56f52-${Date.now()}`;
    company = await Company.create({
      companyName: "F56 F52 Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    models = await getCompanyModels(company, { provision: true });
    const password = await hashPassword("F56F52Pass123!");

    await models.User.create({
      email: "hr@f56f52.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "HR Admin",
      isActive: true,
    });

    const seed = [
      {
        code: "P-001",
        name: "Alice Lead",
        dept: "Engineering",
        title: "Engineering Lead",
        project: "Platform",
        type: "MANDATE",
      },
      {
        code: "P-002",
        name: "Bob Dev",
        dept: "Engineering",
        title: "Developer",
        project: "Platform",
        type: "MANDATE",
      },
      {
        code: "P-003",
        name: "Cara Sales",
        dept: "Sales",
        title: "Account Manager",
        project: "Retail West",
        type: "RETAIL",
      },
      {
        code: "P-004",
        name: "Dan Bench",
        dept: "Operations",
        title: "Associate",
        project: "",
        type: "",
      },
    ];

    for (const row of seed) {
      const user = await models.User.create({
        email: `${row.code.toLowerCase()}@f56f52.test`,
        passwordHash: password,
        role: USER_ROLES.EMPLOYEE,
        fullName: row.name,
        isActive: true,
      });
      await models.Employee.create({
        userId: user._id,
        companyId: company._id,
        employeeCode: row.code,
        fullName: row.name,
        email: `${row.code.toLowerCase()}@f56f52.test`,
        status: EMPLOYEE_STATUSES.ACTIVE,
        job: {
          department: row.dept,
          jobTitle: row.title,
          workLocation: "Bengaluru",
          ...(row.project
            ? { project: { projectName: row.project, projectType: row.type } }
            : {}),
        },
      });
    }

    const login = await request(app).post("/api/auth/login").send({
      email: "hr@f56f52.test",
      password: "F56F52Pass123!",
      companyCode: company.slug,
    });
    assert.equal(login.status, 200);
    hrCookie = cookieFrom(login);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("resolveEmployeeImportCommitChunk respects Vercel vs local defaults", () => {
    assert.equal(resolveEmployeeImportCommitChunk(undefined), 100);
    assert.equal(resolveEmployeeImportCommitChunk("15"), 15);
    assert.equal(resolveEmployeeImportCommitChunk("999"), 200);
    assert.equal(EMPLOYEE_IMPORT_MAX_ROWS, 500);

    process.env.VERCEL = "1";
    assert.equal(resolveEmployeeImportCommitChunk(undefined), 40);
    assert.equal(resolveEmployeeImportCommitChunk("90"), 75);
    delete process.env.VERCEL;
  });

  it("projects-overview aggregates counts without member arrays", async () => {
    const overview = await buildEmployeeProjectsOverview({
      Employee: models.Employee,
      hrAccess: null,
      status: "ACTIVE",
    });
    assert.ok(overview.projectList.length >= 2);
    const platform = overview.projectList.find((p) => p.name === "Platform");
    assert.ok(platform);
    assert.equal(platform.memberCount, 2);
    assert.equal(Array.isArray(platform.members), false);
    assert.ok(platform.lead?.fullName);

    const res = await request(app)
      .get("/api/employees/projects-overview")
      .query({ status: "ACTIVE" })
      .set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.meta.employeeCount >= 4);
    assert.ok(res.body.deptList.some((d) => d.name === "Engineering" && d.count === 2));
    assert.ok(res.body.leadsList.length >= 1);
    assert.equal(JSON.stringify(res.body).includes("passwordHash"), false);
  });

  it("import commit honors offset/limit chunking across requests", async () => {
    const rows = [];
    for (let i = 1; i <= 5; i += 1) {
      rows.push({
        fullName: `Import Emp ${i}`,
        email: `import${i}@f56f52.test`,
        employeeCode: `IMP-${String(i).padStart(3, "0")}`,
        jobTitle: "Analyst",
        department: "Operations",
        employmentType: "Full-time",
        joiningDate: "2026-05-01",
        monthlySalary: "50000",
        projectName: "Import Wave",
        workLocation: "Bengaluru",
        phoneNumber: `+91 9000000${100 + i}`,
        reportingManagerCode: "",
      });
    }

    const chunk1 = await request(app)
      .post("/api/employees/import")
      .set("Cookie", hrCookie)
      .send({ rows, importValidOnly: true, offset: 0, limit: 2 });
    assert.equal(chunk1.status, 201);
    assert.equal(chunk1.body.created.length, 2);
    assert.equal(chunk1.body.summary.hasMore, true);
    assert.equal(chunk1.body.summary.nextOffset, 2);

    const chunk2 = await request(app)
      .post("/api/employees/import")
      .set("Cookie", hrCookie)
      .send({ rows, importValidOnly: true, offset: 2, limit: 2 });
    assert.equal(chunk2.status, 201);
    assert.equal(chunk2.body.created.length, 2);
    assert.equal(chunk2.body.summary.hasMore, true);

    const chunk3 = await request(app)
      .post("/api/employees/import")
      .set("Cookie", hrCookie)
      .send({ rows, importValidOnly: true, offset: 4, limit: 2 });
    assert.equal(chunk3.status, 201);
    assert.equal(chunk3.body.created.length, 1);
    assert.equal(chunk3.body.summary.hasMore, false);

    const count = await models.Employee.countDocuments({
      employeeCode: { $in: rows.map((r) => r.employeeCode) },
    });
    assert.equal(count, 5);
  });
});
