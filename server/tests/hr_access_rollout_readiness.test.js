process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { createCompanyAdmin } from "../services/companyAdminService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import {
  evaluateHrAdminAccessReadiness,
  getHrAccessEnforcementReadiness,
} from "../services/hrAccessRolloutService.js";
import { emitLeaveEvent } from "../services/leaveEventsService.js";

const PASSWORD = "HrReadyPass1!";

let mongo;
let app;
let server;
let baseUrl;
let acme;
let caCookie;
let hrCookie;
let empCookie;
let hrAdminId;
let inactiveHrId;
let engDeptId;
let employeeIdA;
let employeeIdB;
let models;
let aliceEmail;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

async function login(companyCode, email) {
  const res = await request(app).post("/api/auth/login").send({
    companyCode,
    email,
    password: PASSWORD,
  });
  assert.equal(res.status, 200, res.body?.message || "login failed");
  return cookieFrom(res);
}

function parseSseFrames(buffer) {
  return buffer
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) return null;
      try {
        return JSON.parse(dataLine.slice(5).trim());
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Open an SSE subscription, wait for CONNECTED, run onReady, collect events until done().
 */
function withLeaveSseSubscription(cookie, onReady, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${baseUrl}/api/leave-requests/events`,
      {
        headers: {
          Cookie: cookie,
          Accept: "text/event-stream",
        },
      },
      (res) => {
        let buffer = "";
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            req.destroy();
            reject(new Error("SSE subscription timed out"));
          }
        }, timeoutMs);

        const finish = (value, err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          req.destroy();
          if (err) reject(err);
          else resolve(value);
        };

        res.on("data", (chunk) => {
          buffer += chunk.toString();
          const frames = parseSseFrames(buffer);
          const connected = frames.find((f) => f.type === "CONNECTED");
          if (connected && onReady) {
            const ready = onReady;
            onReady = null;
            Promise.resolve()
              .then(() => ready({ frames: () => parseSseFrames(buffer), buffer: () => buffer }))
              .then((result) => finish(result))
              .catch((err) => finish(null, err));
          }
        });

        res.on("error", (err) => finish(null, err));
      }
    );
    req.on("error", reject);
  });
}

before(async () => {
  mongo = await MongoMemoryServer.create({
    instance: {
      dbPath: "D:/tmp/hrms-mongo/ca4c6-readiness-iso",
      storageEngine: "wiredTiger",
    },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  acme = await Company.create({
    companyName: "Acme CA4C6",
    slug: "acme-ca4c6-iso",
    databaseName: "company_acme_ca4c6",
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    config: { hrAccessEnforcement: { mode: "OFF" } },
  });

  models = await getCompanyModels(acme);
  const eng = await models.Department.create({
    name: "Engineering",
    normalizedName: "engineering",
    isActive: true,
  });
  const design = await models.Department.create({
    name: "Design",
    normalizedName: "design",
    isActive: true,
  });
  engDeptId = String(eng._id);

  const empA = await models.Employee.create({
    employeeCode: "C6-001",
    fullName: "Alice Engineer",
    email: "alice@acme-ca4c6-iso.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering", departmentId: eng._id },
  });
  const empB = await models.Employee.create({
    employeeCode: "C6-002",
    fullName: "Bob Designer",
    email: "bob@acme-ca4c6-iso.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Designer", department: "Design", departmentId: design._id },
  });
  employeeIdA = String(empA._id);
  employeeIdB = String(empB._id);
  aliceEmail = empA.email;

  const passwordHash = await hashPassword(PASSWORD);
  await createCompanyAdmin(models.User, {
    email: "ca@acme-ca4c6-iso.test",
    passwordHash,
    fullName: "Acme CA",
  });

  const hr = await models.User.create({
    email: "hr@acme-ca4c6-iso.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Acme HR",
    isActive: true,
    lastLoginAt: new Date(),
    hrAccess: {
      version: 1,
      configuredAt: new Date(),
      updatedAt: new Date(),
      employeeScope: {
        mode: "CUSTOM",
        departmentIds: [eng._id],
        employeeIds: [],
      },
      permissions: ["people.view", "leave.view", "dashboard.view"],
    },
  });
  hrAdminId = String(hr._id);

  const inactive = await models.User.create({
    email: "hr-inactive@acme-ca4c6-iso.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Inactive HR",
    isActive: false,
    hrAccess: undefined,
  });
  inactiveHrId = String(inactive._id);

  const empUser = await models.User.create({
    email: aliceEmail,
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Alice Engineer",
    isActive: true,
    employeeId: empA._id,
  });
  empA.userId = empUser._id;
  await empA.save();

  caCookie = await login("acme-ca4c6-iso", "ca@acme-ca4c6-iso.test");
  hrCookie = await login("acme-ca4c6-iso", "hr@acme-ca4c6-iso.test");
  empCookie = await login("acme-ca4c6-iso", aliceEmail);
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("CA4-C.6 readiness — permissions", () => {
  it("blocks readiness when active HR has empty permissions", async () => {
    await models.User.findByIdAndUpdate(hrAdminId, {
      $set: {
        "hrAccess.permissions": [],
        "hrAccess.configuredAt": new Date(),
        "hrAccess.version": 1,
        "hrAccess.employeeScope": {
          mode: "COMPANY",
          departmentIds: [],
          employeeIds: [],
        },
      },
    });

    const readiness = await getHrAccessEnforcementReadiness({ models, company: acme });
    assert.equal(readiness.enforcement.canEnable, false);
    const row = readiness.hrAdmins.find((r) => r.id === hrAdminId);
    assert.equal(row.readyForEnforcement, false);
    assert.equal(row.readinessCode, "PERMISSIONS_EMPTY");
    assert.ok(row.readinessReason);

    const api = await request(app)
      .get("/api/company-admin/hr-access/enforcement")
      .set("Cookie", caCookie);
    assert.equal(api.status, 200);
    assert.equal(api.body.enforcement.canEnable, false);
  });

  it("blocks readiness for unknown permission keys", async () => {
    await models.User.findByIdAndUpdate(hrAdminId, {
      $set: {
        "hrAccess.permissions": ["people.view", "not.a.real.permission"],
        "hrAccess.employeeScope": {
          mode: "COMPANY",
          departmentIds: [],
          employeeIds: [],
        },
      },
    });
    const readiness = await getHrAccessEnforcementReadiness({ models, company: acme });
    const row = readiness.hrAdmins.find((r) => r.id === hrAdminId);
    assert.equal(readiness.enforcement.canEnable, false);
    assert.equal(row.readinessCode, "PERMISSIONS_INVALID");
  });

  it("inactive HR with empty permissions does not block readiness", async () => {
    await models.User.findByIdAndUpdate(hrAdminId, {
      $set: {
        "hrAccess.permissions": ["people.view", "leave.view", "dashboard.view"],
        "hrAccess.employeeScope": {
          mode: "COMPANY",
          departmentIds: [],
          employeeIds: [],
        },
      },
    });
    await models.User.findByIdAndUpdate(inactiveHrId, {
      $unset: { hrAccess: 1 },
      $set: { isActive: false },
    });

    const readiness = await getHrAccessEnforcementReadiness({ models, company: acme });
    assert.equal(readiness.enforcement.canEnable, true);
    const inactive = readiness.hrAdmins.find((r) => r.id === inactiveHrId);
    assert.equal(inactive.isActive, false);
    assert.equal(inactive.readyForEnforcement, false);
  });

  it("valid permissions allow readiness when other conditions are met", async () => {
    await models.User.findByIdAndUpdate(hrAdminId, {
      $set: {
        "hrAccess.permissions": ["people.view"],
        "hrAccess.version": 1,
        "hrAccess.configuredAt": new Date(),
        "hrAccess.employeeScope": {
          mode: "COMPANY",
          departmentIds: [],
          employeeIds: [],
        },
      },
    });
    const readiness = await getHrAccessEnforcementReadiness({ models, company: acme });
    assert.equal(readiness.enforcement.canEnable, true);
    const row = readiness.hrAdmins.find((r) => r.id === hrAdminId);
    assert.equal(row.readyForEnforcement, true);
    assert.equal(row.readinessCode, null);
  });
});

describe("CA4-C.6 readiness — CUSTOM scope references", () => {
  it("blocks readiness when CUSTOM references a deleted department", async () => {
    const goneDept = new mongoose.Types.ObjectId();
    await models.User.findByIdAndUpdate(hrAdminId, {
      $set: {
        "hrAccess.permissions": ["people.view"],
        "hrAccess.employeeScope": {
          mode: "CUSTOM",
          departmentIds: [goneDept],
          employeeIds: [],
        },
      },
    });
    const readiness = await getHrAccessEnforcementReadiness({ models, company: acme });
    assert.equal(readiness.enforcement.canEnable, false);
    const row = readiness.hrAdmins.find((r) => r.id === hrAdminId);
    assert.equal(row.readinessCode, "DEPARTMENT_NOT_FOUND");
  });

  it("blocks readiness when CUSTOM references a deleted employee", async () => {
    const goneEmp = new mongoose.Types.ObjectId();
    await models.User.findByIdAndUpdate(hrAdminId, {
      $set: {
        "hrAccess.permissions": ["people.view"],
        "hrAccess.employeeScope": {
          mode: "CUSTOM",
          departmentIds: [],
          employeeIds: [goneEmp],
        },
      },
    });
    const readiness = await getHrAccessEnforcementReadiness({ models, company: acme });
    assert.equal(readiness.enforcement.canEnable, false);
    const row = readiness.hrAdmins.find((r) => r.id === hrAdminId);
    assert.equal(row.readinessCode, "EMPLOYEE_NOT_FOUND");
  });

  it("blocks readiness for malformed CUSTOM scope", async () => {
    const evalEmpty = evaluateHrAdminAccessReadiness({
      version: 1,
      configuredAt: new Date(),
      permissions: ["people.view"],
      employeeScope: { mode: "CUSTOM", departmentIds: [], employeeIds: [] },
    });
    assert.equal(evalEmpty.code, "SCOPE_EMPTY");

    const evalBad = evaluateHrAdminAccessReadiness({
      version: 1,
      configuredAt: new Date(),
      permissions: ["people.view"],
      employeeScope: { mode: "CUSTOM", departmentIds: ["not-an-id"], employeeIds: [] },
    });
    assert.equal(evalBad.code, "DEPARTMENT_ID_INVALID");
  });

  it("preserves COMPANY scope readiness when permissions are valid", async () => {
    await models.User.findByIdAndUpdate(hrAdminId, {
      $set: {
        "hrAccess.permissions": ["people.view", "leave.view"],
        "hrAccess.employeeScope": {
          mode: "COMPANY",
          departmentIds: [],
          employeeIds: [],
        },
      },
    });
    const readiness = await getHrAccessEnforcementReadiness({ models, company: acme });
    assert.equal(readiness.enforcement.canEnable, true);
    const row = readiness.hrAdmins.find((r) => r.id === hrAdminId);
    assert.equal(row.readyForEnforcement, true);
    assert.equal(row.accessSummary.scopeLabel, "Entire company");
  });

  it("accepts valid CUSTOM department reference", async () => {
    await models.User.findByIdAndUpdate(hrAdminId, {
      $set: {
        "hrAccess.permissions": ["people.view", "leave.view", "dashboard.view"],
        "hrAccess.employeeScope": {
          mode: "CUSTOM",
          departmentIds: [engDeptId],
          employeeIds: [],
        },
      },
    });
    const readiness = await getHrAccessEnforcementReadiness({ models, company: acme });
    assert.equal(readiness.enforcement.canEnable, true);
  });
});

describe("CA4-C.6 leave SSE event payload scope", () => {
  before(async () => {
    // Enable ENFORCED only inside this isolated memory DB
    await Company.findByIdAndUpdate(acme._id, {
      $set: { "config.hrAccessEnforcement.mode": "ENFORCED" },
    });
    acme = await Company.findById(acme._id);
    await models.User.findByIdAndUpdate(hrAdminId, {
      $set: {
        "hrAccess.permissions": ["people.view", "leave.view", "dashboard.view"],
        "hrAccess.employeeScope": {
          mode: "CUSTOM",
          departmentIds: [engDeptId],
          employeeIds: [],
        },
      },
    });
    // Refresh cookie after config change (token still valid; context loads from DB)
    hrCookie = await login("acme-ca4c6-iso", "hr@acme-ca4c6-iso.test");
  });

  it("delivers in-scope leave events and drops out-of-scope events for CUSTOM HR", async () => {
    const companyId = String(acme._id);
    const collected = await withLeaveSseSubscription(hrCookie, async ({ frames }) => {
      // Wait a tick so the listener is attached after CONNECTED
      await new Promise((r) => setImmediate(r));

      emitLeaveEvent({
        type: "LEAVE_UPDATED",
        companyId,
        employeeId: employeeIdA,
        employeeEmail: aliceEmail,
        reason: "alice-in-scope-leave",
      });
      emitLeaveEvent({
        type: "LEAVE_UPDATED",
        companyId,
        employeeId: employeeIdB,
        employeeEmail: "bob@acme-ca4c6-iso.test",
        reason: "bob-out-of-scope-leave",
      });

      // Poll until alice event arrives (deterministic short wait loop)
      for (let i = 0; i < 40; i += 1) {
        const all = frames();
        if (all.some((f) => f.reason === "alice-in-scope-leave")) {
          return all;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      return frames();
    });

    assert.ok(collected.some((f) => f.reason === "alice-in-scope-leave"));
    assert.equal(
      collected.some((f) => f.reason === "bob-out-of-scope-leave"),
      false
    );
  });

  it("denies SSE subscribe when HR lacks leave.view under ENFORCED", async () => {
    await models.User.findByIdAndUpdate(hrAdminId, {
      $set: { "hrAccess.permissions": ["people.view", "dashboard.view"] },
    });
    const deniedCookie = await login("acme-ca4c6-iso", "hr@acme-ca4c6-iso.test");
    const res = await request(app)
      .get("/api/leave-requests/events?probe=1")
      .set("Cookie", deniedCookie);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "HR_PERMISSION_DENIED");

    // restore leave.view for remaining tests
    await models.User.findByIdAndUpdate(hrAdminId, {
      $set: {
        "hrAccess.permissions": ["people.view", "leave.view", "dashboard.view"],
      },
    });
  });

  it("Employee only receives own leave events", async () => {
    const companyId = String(acme._id);
    const collected = await withLeaveSseSubscription(empCookie, async ({ frames }) => {
      await new Promise((r) => setImmediate(r));
      emitLeaveEvent({
        type: "LEAVE_UPDATED",
        companyId,
        employeeId: employeeIdA,
        employeeEmail: aliceEmail,
        reason: "alice-self-event",
      });
      emitLeaveEvent({
        type: "LEAVE_UPDATED",
        companyId,
        employeeId: employeeIdB,
        employeeEmail: "bob@acme-ca4c6-iso.test",
        reason: "bob-other-event",
      });
      for (let i = 0; i < 40; i += 1) {
        const all = frames();
        if (all.some((f) => f.reason === "alice-self-event")) return all;
        await new Promise((r) => setTimeout(r, 25));
      }
      return frames();
    });
    assert.ok(collected.some((f) => f.reason === "alice-self-event"));
    assert.equal(collected.some((f) => f.reason === "bob-other-event"), false);
  });

  it("Company Admin receives company-wide leave events (no employee scope filter)", async () => {
    const companyId = String(acme._id);
    const collected = await withLeaveSseSubscription(caCookie, async ({ frames }) => {
      await new Promise((r) => setImmediate(r));
      emitLeaveEvent({
        type: "LEAVE_UPDATED",
        companyId,
        employeeId: employeeIdB,
        employeeEmail: "bob@acme-ca4c6-iso.test",
        reason: "ca-sees-bob",
      });
      for (let i = 0; i < 40; i += 1) {
        const all = frames();
        if (all.some((f) => f.reason === "ca-sees-bob")) return all;
        await new Promise((r) => setTimeout(r, 25));
      }
      return frames();
    });
    assert.ok(collected.some((f) => f.reason === "ca-sees-bob"));
  });
});
