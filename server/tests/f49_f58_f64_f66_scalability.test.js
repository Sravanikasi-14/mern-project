process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f49-f58-f64-f66-scalability-secret-32ch!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f49_f58_f64_f66";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.SSE_MAX_DURATION_MS = "5000";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { EventEmitter } from "node:events";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { AUTH_USER_SELECT } from "../middleware/authenticate.js";
import {
  buildExactCiRegex,
  buildPrefixCiRegex,
  escapeRegex,
} from "../utils/searchRegex.js";
import {
  attachSseLifecycle,
  resolveSseMaxDurationMs,
} from "../utils/sseLifecycle.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

describe("F49 / F58 / F64 / F66 scalability helpers", () => {
  let mongo;
  let app;
  let company;
  let models;
  let hrCookie;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    const slug = `f49f58-${Date.now()}`;
    company = await Company.create({
      companyName: "F49 F58 Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    models = await getCompanyModels(company, { provision: true });
    const password = await hashPassword("F49F58Pass123!");

    await models.User.create({
      email: "hr@f49f58.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "HR Admin",
      isActive: true,
    });

    const seed = [
      { code: "RAO-1", name: "Rao Mehta", email: "rao@f49f58.test" },
      { code: "SAR-1", name: "Sara Khan", email: "sara@f49f58.test" },
      { code: "ALI-1", name: "Alice Rao", email: "alice@f49f58.test" },
    ];
    for (const row of seed) {
      const user = await models.User.create({
        email: row.email,
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
        email: row.email,
        status: EMPLOYEE_STATUSES.ACTIVE,
        job: { department: "Engineering", jobTitle: "Engineer" },
      });
    }

    const login = await request(app).post("/api/auth/login").send({
      email: "hr@f49f58.test",
      password: "F49F58Pass123!",
      companyCode: company.slug,
    });
    assert.equal(login.status, 200);
    hrCookie = cookieFrom(login);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("F49: AUTH_USER_SELECT excludes passwordHash and keeps auth fields", () => {
    assert.match(AUTH_USER_SELECT, /email/);
    assert.match(AUTH_USER_SELECT, /role/);
    assert.match(AUTH_USER_SELECT, /onboarding\.status/);
    assert.equal(AUTH_USER_SELECT.includes("passwordHash"), false);
  });

  it("F49: revoked session is rejected; active session works", async () => {
    const ok = await request(app).get("/api/employees/summary").set("Cookie", hrCookie);
    assert.equal(ok.status, 200);

    await models.AuthSession.updateMany(
      {},
      { $set: { isActive: false } }
    );
    const denied = await request(app).get("/api/employees/summary").set("Cookie", hrCookie);
    assert.equal(denied.status, 401);

    // Restore a usable session for later tests via re-login.
    const login = await request(app).post("/api/auth/login").send({
      email: "hr@f49f58.test",
      password: "F49F58Pass123!",
      companyCode: company.slug,
    });
    assert.equal(login.status, 200);
    hrCookie = cookieFrom(login);
  });

  it("F58: prefix regex matches starts-with, not mid-string", () => {
    assert.equal(escapeRegex("a+b"), "a\\+b");
    const prefix = buildPrefixCiRegex("ra");
    assert.equal(prefix.test("Rao Mehta"), true);
    assert.equal(prefix.test("Alice Rao"), false);
    assert.equal(buildExactCiRegex("Engineering").test("engineering"), true);
    assert.equal(buildExactCiRegex("Engineering").test("Engineering Ops"), false);
  });

  it("F58: people search uses prefix semantics", async () => {
    const rao = await request(app)
      .get("/api/employees")
      .query({ search: "Rao", limit: 50 })
      .set("Cookie", hrCookie);
    assert.equal(rao.status, 200);
    const names = (rao.body.employees || []).map((e) => e.fullName);
    assert.ok(names.includes("Rao Mehta"));
    assert.equal(names.includes("Alice Rao"), false);

    const sara = await request(app)
      .get("/api/employees")
      .query({ search: "Sar", limit: 50 })
      .set("Cookie", hrCookie);
    assert.ok((sara.body.employees || []).some((e) => e.fullName === "Sara Khan"));
  });

  it("F64: SSE env max duration is clamped; lifecycle emits RECONNECT", async () => {
    assert.equal(resolveSseMaxDurationMs(), 5000);
    const req = new EventEmitter();
    const chunks = [];
    let ended = false;
    const res = {
      writableEnded: false,
      write(chunk) {
        chunks.push(String(chunk));
        return true;
      },
      end() {
        ended = true;
        this.writableEnded = true;
      },
    };

    let cleaned = false;
    attachSseLifecycle(req, res, {
      heartbeatMs: 1_000,
      maxDurationMs: 50,
      onCleanup: () => {
        cleaned = true;
      },
    });

    await new Promise((r) => setTimeout(r, 120));
    assert.equal(ended, true);
    assert.ok(chunks.some((c) => c.includes("RECONNECT")));
    assert.ok(chunks.some((c) => c.includes("sse_max_duration")));
    assert.equal(cleaned, true, "max-duration end must run onCleanup");
    req.emit("close");
    assert.equal(cleaned, true);
  });

});



