process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f57-f63-f48-f53-scalability-secret-32ch!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f57_f63_f48_f53";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.DOCUMENT_STORAGE = "gridfs";

import assert from "node:assert/strict";
import fs from "node:fs";
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
import {
  documentFileIdFromStorageKey,
  HR_DOCUMENTS_BUCKET,
} from "../services/documentGridFsStorageService.js";
import { loadDocumentBuffer, saveDocumentFile } from "../services/documentStorage.js";
import {
  publishDueForAllCompanies,
  rotateCompaniesAfterId,
} from "../services/announcementService.js";
import { perCompanyBudgetMs } from "../services/workforceScheduler/config.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

describe("F57 / F63 / F48 / F53 combined scalability", () => {
  let mongo;
  let app;
  let company;
  let models;
  let hrCookie;
  let employeeA;
  let employeeB;

  before(async () => {
    const dbPath = `D:/tmp/hrms-mongo/f57-f63-f48-f53/${Date.now()}`;
    fs.mkdirSync(dbPath, { recursive: true });
    mongo = await MongoMemoryServer.create({ instance: { dbPath } });
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    const slug = `f57batch-${Date.now()}`;
    company = await Company.create({
      companyName: "F57 Batch Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    models = await getCompanyModels(company, { provision: true });
    const password = await hashPassword("F57BatchPass123!");

    await models.User.create({
      email: "hr@f57batch.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "HR Admin",
      isActive: true,
    });

    const userA = await models.User.create({
      email: "a@f57batch.test",
      passwordHash: password,
      role: USER_ROLES.EMPLOYEE,
      fullName: "Alice Active",
      isActive: true,
    });
    employeeA = await models.Employee.create({
      userId: userA._id,
      companyId: company._id,
      employeeCode: "F57-A",
      fullName: "Alice Active",
      email: "a@f57batch.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { department: "Engineering", jobTitle: "Engineer", project: { projectName: "Platform" } },
    });

    const userB = await models.User.create({
      email: "b@f57batch.test",
      passwordHash: password,
      role: USER_ROLES.EMPLOYEE,
      fullName: "Bob Active",
      isActive: true,
    });
    employeeB = await models.Employee.create({
      userId: userB._id,
      companyId: company._id,
      employeeCode: "F57-B",
      fullName: "Bob Active",
      email: "b@f57batch.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { department: "Sales", jobTitle: "AE" },
    });

    const past = new Date("2020-01-01");
    await models.EmployeeCompensation.create({
      employeeId: employeeA._id,
      revisions: [
        { effectiveFromDate: past, monthlyCostToCompany: 80000 },
        { effectiveFromDate: new Date("2019-01-01"), monthlyCostToCompany: 50000 },
      ],
    });
    await models.EmployeeCompensation.create({
      employeeId: employeeB._id,
      revisions: [{ effectiveFromDate: past, monthlyCostToCompany: 60000 }],
    });

    const login = await request(app).post("/api/auth/login").send({
      email: "hr@f57batch.test",
      password: "F57BatchPass123!",
      companyCode: company.slug,
    });
    assert.equal(login.status, 200);
    hrCookie = cookieFrom(login);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("F63: employee summary CTC uses aggregation without ID materialization", async () => {
    const findCalls = [];
    const originalFind = models.Employee.find.bind(models.Employee);
    models.Employee.find = function patched(filter, ...rest) {
      findCalls.push(filter);
      return originalFind(filter, ...rest);
    };
    try {
      const res = await request(app)
        .get("/api/employees/summary")
        .set("Cookie", hrCookie);
      assert.equal(res.status, 200);
      assert.equal(res.body.activeEmployees, 2);
      assert.equal(res.body.totalMonthlySalary, 140000);
      assert.equal(
        findCalls.some((f) => f && f.status === EMPLOYEE_STATUSES.ACTIVE && !f._id),
        false,
        "must not Employee.find(active) for CTC"
      );
    } finally {
      models.Employee.find = originalFind;
    }
  });

  it("F57: new uploads persist to GridFS and download via loadDocumentBuffer", async () => {
    const payload = Buffer.from("%PDF-1.4 f57-test-bytes");
    const saved = await saveDocumentFile({
      databaseName: company.databaseName,
      employeeId: employeeA._id,
      fileName: "offer-letter.pdf",
      fileData: payload.toString("base64"),
      mimeType: "application/pdf",
      connection: models.Employee.db,
      ownerType: "employee",
    });
    assert.equal(saved.backend, "gridfs");
    assert.ok(documentFileIdFromStorageKey(saved.storageKey));

    const files = await models.Employee.db.db
      .collection(`${HR_DOCUMENTS_BUCKET}.files`)
      .find({ _id: new mongoose.Types.ObjectId(saved.storageKey) })
      .toArray();
    assert.equal(files.length, 1);

    const loaded = await loadDocumentBuffer({
      databaseName: company.databaseName,
      employeeId: employeeA._id,
      storageKey: saved.storageKey,
      connection: models.Employee.db,
    });
    assert.equal(loaded.backend, "gridfs");
    assert.equal(loaded.buffer.equals(payload), true);
  });

  it("F53: rotateCompaniesAfterId and per-company budget helpers", async () => {
    const companies = [{ _id: "a" }, { _id: "b" }, { _id: "c" }];
    assert.deepEqual(
      rotateCompaniesAfterId(companies, "a").map((c) => c._id),
      ["b", "c", "a"]
    );
    assert.ok(perCompanyBudgetMs() > 0);

    // Fleet budget already exhausted → every tenant pending, none marked complete.
    const result = await publishDueForAllCompanies(new Date(), {
      budgetMs: 0,
      publishForCompany: async () => 1,
    });
    assert.equal(result.published, 0);
    assert.equal(result.truncated, true);
    assert.ok(result.results.every((r) => r.reason === "budget_exhausted"));
  });
});
