process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f71-impact-leaderboard-secret-32ch!!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f71_impact";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

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
  TRANSACTION_SOURCES,
  TRANSACTION_TYPES,
} from "../models/ImpactPointTransaction.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

describe("F71 impact leaderboard server pagination", () => {
  let mongo;
  let app;
  let hrCookie;
  let company;

  before(async () => {
    const dbPath = `D:/tmp/hrms-mongo/f71-impact/${Date.now()}`;
    fs.mkdirSync(dbPath, { recursive: true });
    mongo = await MongoMemoryServer.create({ instance: { dbPath } });
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    const slug = `f71-impact-${Date.now()}`;
    company = await Company.create({
      companyName: "F71 Impact Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    const models = await getCompanyModels(company, { provision: true });
    const password = await hashPassword("F71ImpactPass123!");

    const hrUser = await models.User.create({
      email: "hr@f71impact.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "HR Admin",
      isActive: true,
    });

    for (let i = 1; i <= 12; i++) {
      const user = await models.User.create({
        email: `e${i}@f71impact.test`,
        passwordHash: password,
        role: USER_ROLES.EMPLOYEE,
        fullName: `Employee ${String(i).padStart(2, "0")}`,
        isActive: true,
      });
      const emp = await models.Employee.create({
        userId: user._id,
        companyId: company._id,
        employeeCode: `F71-${String(i).padStart(3, "0")}`,
        fullName: `Employee ${String(i).padStart(2, "0")}`,
        email: `e${i}@f71impact.test`,
        status: EMPLOYEE_STATUSES.ACTIVE,
        job: {
          department: i <= 6 ? "Engineering" : "Sales",
          jobTitle: "Associate",
        },
      });
      await models.ImpactPointTransaction.create({
        employeeId: emp._id,
        points: 100 - i,
        transactionType: TRANSACTION_TYPES.EARNED,
        source: TRANSACTION_SOURCES.TASK_COMPLETION,
        eventType: "TASK",
        reason: `Seed points ${i}`,
        actorUserId: hrUser._id,
        actorSnapshot: { fullName: "HR Admin", role: USER_ROLES.HR_ADMIN },
        idempotencyKey: `f71-seed-${slug}-${i}`,
        isReversed: false,
        employeeSnapshot: {
          fullName: emp.fullName,
          employeeCode: emp.employeeCode,
          department: emp.job.department,
        },
      });
    }

    const login = await request(app).post("/api/auth/login").send({
      email: "hr@f71impact.test",
      password: "F71ImpactPass123!",
      companyCode: company.slug,
    });
    assert.equal(login.status, 200);
    hrCookie = cookieFrom(login);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("returns pagination + summary and ranks across pages", async () => {
    const page1 = await request(app)
      .get("/api/impact-points/leaderboard")
      .query({ page: 1, limit: 5 })
      .set("Cookie", hrCookie);
    assert.equal(page1.status, 200);
    assert.equal(page1.body.leaderboard.length, 5);
    assert.equal(page1.body.pagination.page, 1);
    assert.equal(page1.body.pagination.limit, 5);
    assert.equal(page1.body.pagination.total, 12);
    assert.equal(page1.body.pagination.totalPages, 3);
    assert.equal(page1.body.summary.participants, 12);
    assert.ok(page1.body.summary.circulation > 0);
    assert.equal(page1.body.leaderboard[0].rank, 1);
    assert.equal(page1.body.leaderboard[4].rank, 5);

    const page2 = await request(app)
      .get("/api/impact-points/leaderboard")
      .query({ page: 2, limit: 5 })
      .set("Cookie", hrCookie);
    assert.equal(page2.body.leaderboard.length, 5);
    assert.equal(page2.body.leaderboard[0].rank, 6);
    const ids1 = page1.body.leaderboard.map((r) => String(r.employeeId));
    const ids2 = page2.body.leaderboard.map((r) => String(r.employeeId));
    assert.equal(ids1.some((id) => ids2.includes(id)), false);

    // Summary must reflect full filtered set, not the page.
    assert.equal(page2.body.summary.participants, 12);
    assert.equal(page2.body.summary.circulation, page1.body.summary.circulation);
  });

  it("applies search and department before skip/limit", async () => {
    const eng = await request(app)
      .get("/api/impact-points/leaderboard")
      .query({ department: "Engineering", page: 1, limit: 3 })
      .set("Cookie", hrCookie);
    assert.equal(eng.status, 200);
    assert.equal(eng.body.pagination.total, 6);
    assert.equal(eng.body.summary.participants, 6);
    assert.equal(eng.body.leaderboard.length, 3);
    assert.ok(eng.body.leaderboard.every((r) => r.department === "Engineering"));

    const search = await request(app)
      .get("/api/impact-points/leaderboard")
      .query({ search: "F71-012", page: 1, limit: 10 })
      .set("Cookie", hrCookie);
    assert.equal(search.status, 200);
    assert.equal(search.body.pagination.total, 1);
    assert.equal(search.body.leaderboard[0].employeeCode, "F71-012");
    assert.equal(search.body.summary.participants, 1);
  });

  it("keeps bare leaderboard array for backward-compatible clients", async () => {
    const res = await request(app)
      .get("/api/impact-points/leaderboard")
      .set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.leaderboard));
    assert.ok(res.body.leaderboard.length >= 1);
    assert.ok(res.body.pagination);
    assert.ok(res.body.summary);
  });
});
