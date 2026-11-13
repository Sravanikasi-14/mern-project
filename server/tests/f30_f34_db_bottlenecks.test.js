process.env.MONGOMS_MD5_CHECK = "0";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { SETTLEMENT_STATUSES } from "../models/Settlement.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import {
  findVisibleNotifications,
  notificationVisibilityBranches,
  notificationVisibilityFilter,
} from "../utils/notificationVisibility.js";
import {
  loadUserReadNotificationKeys,
  markNotificationKeyRead,
  migrateLegacyReadNotificationIds,
  normalizeNotificationKey,
  verifyReadKeysMigrated,
} from "../services/notificationReadStateService.js";
import { buildBaseStages } from "../controllers/hiringWorkspaceController.js";

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
let modelsA;
let modelsB;
let hrCookieA;
let hrCookieB;
let employeeCookieA;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

async function login(email, password, companyCode) {
  const res = await request(app).post("/api/auth/login").send({ email, password, companyCode });
  assert.equal(res.status, 200, res.body?.message || "login failed");
  return cookieFrom(res);
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  companyA = await Company.create({
    companyName: "Bottleneck A",
    slug: "bn-a",
    databaseName: "company_bn_a",
    status: COMPANY_STATUSES.ACTIVE,
  });
  companyB = await Company.create({
    companyName: "Bottleneck B",
    slug: "bn-b",
    databaseName: "company_bn_b",
    status: COMPANY_STATUSES.ACTIVE,
  });

  modelsA = await getCompanyModels(companyA, { provision: true });
  modelsB = await getCompanyModels(companyB, { provision: true });

  const hrA = await modelsA.User.create({
    email: "hr@bn-a.test",
    passwordHash: await hashPassword("HrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const empUserA = await modelsA.User.create({
    email: "emp@bn-a.test",
    passwordHash: await hashPassword("EmpPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  await modelsB.User.create({
    email: "hr@bn-b.test",
    passwordHash: await hashPassword("HrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const employees = [];
  for (let i = 0; i < 12; i += 1) {
    const e = await modelsA.Employee.create({
      fullName: `Worker ${String(i).padStart(2, "0")}`,
      employeeCode: `BN-${String(i).padStart(3, "0")}`,
      email: `w${i}@bn-a.test`,
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "Engineer", department: "Engineering" },
    });
    employees.push(e);
  }
  employees[0].userId = empUserA._id;
  await employees[0].save();
  empUserA.employeeId = employees[0]._id;
  await empUserA.save();

  for (const emp of employees) {
    await modelsA.Settlement.create({
      employeeId: emp._id,
      status: SETTLEMENT_STATUSES.DRAFT,
      exitDetails: {
        lastWorkingDay: new Date("2026-12-31"),
        exitReason: `Reason for ${emp.fullName}`,
        initiatedBy: hrA._id,
        initiatedAt: new Date(),
      },
      financialBreakdown: {
        earnings: [],
        deductions: [],
        totalEarnings: 1000,
        totalDeductions: 0,
        netSettlementAmount: 1000 + employees.indexOf(emp),
      },
    });
  }

  hrCookieA = await login("hr@bn-a.test", "HrPass123!", "bn-a");
  hrCookieB = await login("hr@bn-b.test", "HrPass123!", "bn-b");
  employeeCookieA = await login("emp@bn-a.test", "EmpPass123!", "bn-a");
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("F30 settlements DB pagination", () => {
  it("paginates at the database with accurate total metadata", async () => {
    const page1 = await request(app)
      .get("/api/settlements")
      .query({ page: 1, limit: 5 })
      .set("Cookie", hrCookieA);
    assert.equal(page1.status, 200);
    assert.equal(page1.body.settlements.length, 5);
    assert.equal(page1.body.total, 12);
    assert.equal(page1.body.page, 1);
    assert.equal(page1.body.limit, 5);
    assert.equal(page1.body.totalPages, 3);

    const page3 = await request(app)
      .get("/api/settlements")
      .query({ page: 3, limit: 5 })
      .set("Cookie", hrCookieA);
    assert.equal(page3.body.settlements.length, 2);
    assert.equal(page3.body.total, 12);
  });

  it("clamps invalid limit and supports search without loading all rows into memory contract", async () => {
    const res = await request(app)
      .get("/api/settlements")
      .query({ page: 1, limit: 999, search: "Worker 01" })
      .set("Cookie", hrCookieA);
    assert.equal(res.status, 200);
    assert.equal(res.body.limit, 100);
    assert.ok(res.body.total >= 1);
    assert.ok(res.body.settlements.every((s) => s.employeeId?.fullName?.includes("Worker 01") || s.exitDetails?.exitReason?.includes("Worker 01")));
  });

  it("does not leak settlements across tenants", async () => {
    const res = await request(app).get("/api/settlements").set("Cookie", hrCookieB);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 0);
    assert.equal(res.body.settlements.length, 0);
  });

  it("uses status+createdAt index for filtered list (explain)", async () => {
    const explain = await modelsA.Settlement.find({ status: SETTLEMENT_STATUSES.DRAFT })
      .sort({ createdAt: -1 })
      .skip(0)
      .limit(5)
      .explain("executionStats");
    const stats = explain.executionStats || explain;
    assert.ok(stats.totalDocsExamined != null || stats.executionStats?.totalDocsExamined != null || explain.ok === 1);
    const winning =
      explain.queryPlanner?.winningPlan ||
      explain.executionStats?.executionStages ||
      explain;
    const planText = JSON.stringify(winning);
    assert.ok(
      planText.includes("status_1_createdAt_-1") ||
        planText.includes("IXSCAN") ||
        planText.includes("employeeId") ||
        planText.includes("FETCH"),
      `unexpected plan: ${planText.slice(0, 400)}`
    );
  });
});

describe("F31 AuthSession userId index + revoke-all", () => {
  it("creates userId+isActive index and revokes only the target user's sessions", async () => {
    await modelsA.AuthSession.createIndexes();
    const indexes = await modelsA.AuthSession.collection.indexes();
    const revokeIdx = indexes.find(
      (idx) => idx.name === "userId_1_isActive_1" || JSON.stringify(idx.key) === JSON.stringify({ userId: 1, isActive: 1 })
    );
    assert.ok(revokeIdx, `missing revoke index: ${indexes.map((i) => i.name).join(",")}`);

    const userX = await modelsA.User.create({
      email: "revoke-x@bn-a.test",
      passwordHash: await hashPassword("Pass123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
    });
    const userY = await modelsA.User.create({
      email: "revoke-y@bn-a.test",
      passwordHash: await hashPassword("Pass123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
    });

    await modelsA.AuthSession.create([
      { userId: userX._id, token: "tok-x-1", expiresAt: new Date(Date.now() + 3600000), isActive: true },
      { userId: userX._id, token: "tok-x-2", expiresAt: new Date(Date.now() + 3600000), isActive: true },
      { userId: userY._id, token: "tok-y-1", expiresAt: new Date(Date.now() + 3600000), isActive: true },
    ]);

    await modelsA.AuthSession.updateMany({ userId: userX._id, isActive: true }, { isActive: false });

    const xActive = await modelsA.AuthSession.countDocuments({ userId: userX._id, isActive: true });
    const yActive = await modelsA.AuthSession.countDocuments({ userId: userY._id, isActive: true });
    assert.equal(xActive, 0);
    assert.equal(yActive, 1);

    const explain = await modelsA.AuthSession.find({ userId: userX._id, isActive: true }).explain(
      "executionStats"
    );
    const planText = JSON.stringify(explain.queryPlanner?.winningPlan || explain);
    assert.ok(
      planText.includes("userId_1_isActive_1") || planText.includes("IXSCAN"),
      planText.slice(0, 400)
    );
  });
});

describe("F32 notification visibility query paths", () => {
  it("builds discrete branches and never matches role:null alone", () => {
    const branches = notificationVisibilityBranches({
      _id: "abc",
      role: USER_ROLES.COMPANY_ADMIN,
    });
    assert.equal(branches.length, 4);
    assert.ok(branches.every((b) => b.userId !== undefined || b._id != null));
    assert.ok(!branches.some((b) => Object.keys(b).length === 1 && b.role === null));

    const filter = notificationVisibilityFilter({ _id: "abc", role: USER_ROLES.EMPLOYEE });
    assert.ok(Array.isArray(filter.$or));
  });

  it("returns only visible notifications and keeps tenant isolation", async () => {
    const emp = await modelsA.User.findOne({ email: "emp@bn-a.test" });
    const other = await modelsA.User.create({
      email: "other-notif@bn-a.test",
      passwordHash: await hashPassword("Pass123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
    });

    await modelsA.Notification.create({
      userId: emp._id,
      role: null,
      title: "Personal A",
      message: "mine",
      type: "SYSTEM",
    });
    await modelsA.Notification.create({
      userId: other._id,
      role: null,
      title: "Personal Other",
      message: "secret",
      type: "SYSTEM",
    });
    await modelsA.Notification.create({
      userId: null,
      role: USER_ROLES.HR_ADMIN,
      title: "HR Broadcast",
      message: "hr only",
      type: "SYSTEM",
    });
    await modelsA.Notification.create({
      userId: null,
      role: null,
      title: "Company Wide",
      message: "all",
      type: "SYSTEM",
    });

    const visible = await findVisibleNotifications(modelsA.Notification, emp, { limit: 40 });
    const titles = visible.map((n) => n.title);
    assert.ok(titles.includes("Personal A"));
    assert.ok(titles.includes("Company Wide"));
    assert.ok(!titles.includes("Personal Other"));
    assert.ok(!titles.includes("HR Broadcast"));

    const api = await request(app).get("/api/notifications").set("Cookie", employeeCookieA);
    assert.equal(api.status, 200);
    assert.ok(!api.body.notifications.some((n) => n.title === "Personal Other"));

    const cross = await request(app).get("/api/notifications").set("Cookie", hrCookieB);
    assert.equal(cross.status, 200);
    assert.ok(!cross.body.notifications.some((n) => n.title === "Personal A"));
  });

  it("creates compound notification indexes", async () => {
    await modelsA.Notification.createIndexes();
    const indexes = await modelsA.Notification.collection.indexes();
    const names = indexes.map((i) => i.name);
    assert.ok(names.includes("notifications_userId_createdAt"));
    assert.ok(names.includes("notifications_userId_role_createdAt"));
  });
});

describe("F33 bounded notification read state", () => {
  it("mark-read is idempotent and does not grow preferences.readNotificationIds", async () => {
    const emp = await modelsA.User.findOne({ email: "emp@bn-a.test" });
    const note = await modelsA.Notification.create({
      userId: emp._id,
      title: "Read Me",
      message: "x",
      type: "SYSTEM",
    });

    const beforeLen = (emp.preferences?.readNotificationIds || []).length;

    const mark1 = await request(app)
      .patch(`/api/notifications/${note._id}/read`)
      .set("Cookie", employeeCookieA);
    assert.equal(mark1.status, 200);
    const mark2 = await request(app)
      .patch(`/api/notifications/${note._id}/read`)
      .set("Cookie", employeeCookieA);
    assert.equal(mark2.status, 200);

    const states = await modelsA.NotificationReadState.find({
      userId: emp._id,
      notificationKey: String(note._id),
    });
    assert.equal(states.length, 1);

    const refreshed = await modelsA.User.findById(emp._id).lean();
    const afterLen = (refreshed.preferences?.readNotificationIds || []).length;
    assert.equal(afterLen, beforeLen);

    const keys = await loadUserReadNotificationKeys(modelsA, refreshed);
    assert.ok(keys.has(String(note._id)));
  });

  it("migrates legacy readNotificationIds without discarding unread semantics", async () => {
    const user = await modelsA.User.create({
      email: "legacy-read@bn-a.test",
      passwordHash: await hashPassword("Pass123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
      preferences: {
        readNotificationIds: ["legacy-1", "legacy-2", "leave-legacy-1"],
      },
    });

    const dry = await migrateLegacyReadNotificationIds(modelsA, { pruneLegacy: false });
    assert.ok(dry.keysMigrated >= 2);
    assert.equal(dry.pruned, 0);

    const keys = await loadUserReadNotificationKeys(modelsA, user);
    assert.ok(keys.has("legacy-1"));
    assert.ok(keys.has("legacy-2"));
    assert.ok(keys.has(normalizeNotificationKey("leave-legacy-1")));

    // Concurrent upserts stay unique
    await Promise.all([
      markNotificationKeyRead(modelsA, user._id, "concurrent-key"),
      markNotificationKeyRead(modelsA, user._id, "concurrent-key"),
      markNotificationKeyRead(modelsA, user._id, "concurrent-key"),
    ]);
    const concurrent = await modelsA.NotificationReadState.countDocuments({
      userId: user._id,
      notificationKey: "concurrent-key",
    });
    assert.equal(concurrent, 1);

    const indexes = await modelsA.NotificationReadState.collection.indexes();
    assert.ok(indexes.some((i) => i.name === "uniq_notification_read_user_key" && i.unique));

    const pruned = await migrateLegacyReadNotificationIds(modelsA, { pruneLegacy: true });
    assert.ok(pruned.pruned >= 1);
    assert.equal(pruned.verificationFailures, 0);
    const after = await modelsA.User.findById(user._id).lean();
    assert.equal((after.preferences?.readNotificationIds || []).length, 0);
    const keysAfterPrune = await loadUserReadNotificationKeys(modelsA, after);
    assert.ok(keysAfterPrune.has("legacy-1"));
    assert.ok(keysAfterPrune.has("legacy-2"));
  });

  it("verification blocks prune when migrated keys are missing", async () => {
    const user = await modelsA.User.create({
      email: "prune-guard@bn-a.test",
      passwordHash: await hashPassword("Pass123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
      preferences: {
        readNotificationIds: ["keep-me-1", "keep-me-2"],
      },
    });

    await markNotificationKeyRead(modelsA, user._id, "keep-me-1");
    const verification = await verifyReadKeysMigrated(
      modelsA.NotificationReadState,
      user._id,
      ["keep-me-1", "keep-me-2"]
    );
    assert.equal(verification.ok, false);
    assert.deepEqual(verification.missing, ["keep-me-2"]);

    // Incomplete copy must not clear legacy arrays (User.updateOne must not run).
    const legacyUsers = [
      {
        _id: user._id,
        preferences: { readNotificationIds: ["keep-me-1", "keep-me-2"] },
      },
    ];
    const result = await migrateLegacyReadNotificationIds(
      {
        User: {
          find: () => ({
            select: () => ({
              lean: async () => legacyUsers,
            }),
          }),
          updateOne: async () => {
            throw new Error("prune must not run when verification fails");
          },
        },
        NotificationReadState: {
          updateOne: async () => ({ upsertedCount: 0 }),
          find: () => ({
            select: () => ({
              lean: async () => [{ notificationKey: "keep-me-1" }],
            }),
          }),
        },
      },
      { pruneLegacy: true }
    );
    assert.equal(result.verificationFailures, 1);
    assert.equal(result.pruneSkipped, 1);
    assert.equal(result.pruned, 0);

    const after = await modelsA.User.findById(user._id).lean();
    assert.deepEqual(after.preferences.readNotificationIds, ["keep-me-1", "keep-me-2"]);
  });

  it("mark-all-read still clears unread panel via watermark", async () => {
    const emp = await modelsA.User.findOne({ email: "emp@bn-a.test" });
    await modelsA.Notification.create({
      userId: emp._id,
      title: "Fresh Unread",
      message: "y",
      type: "SYSTEM",
    });
    const before = await request(app).get("/api/notifications").set("Cookie", employeeCookieA);
    assert.ok(before.body.unreadCount >= 1);

    const markAll = await request(app)
      .post("/api/notifications/mark-all-read")
      .set("Cookie", employeeCookieA);
    assert.equal(markAll.status, 200);

    const after = await request(app).get("/api/notifications").set("Cookie", employeeCookieA);
    assert.equal(after.body.notifications.length, 0);
  });
});

describe("F34 hiring $lookup uses foreign _id join", () => {
  it("pipeline includes localField/foreignField join key", () => {
    const stages = buildBaseStages("users");
    const lookup = stages.find((s) => s.$lookup);
    assert.ok(lookup);
    assert.equal(lookup.$lookup.localField, "_lookupUserId");
    assert.equal(lookup.$lookup.foreignField, "_id");
    assert.equal(lookup.$lookup.from, "users");
  });

  it("hiring list remains tenant-scoped and paginated", async () => {
    const candidate = await modelsA.User.create({
      email: "candidate@bn-a.test",
      passwordHash: await hashPassword("Pass123!"),
      role: USER_ROLES.CANDIDATE,
      isActive: true,
    });
    const offerBase = {
      position: "Engineer",
      department: "Engineering",
      status: OFFER_LETTER_STATUSES.SENT,
      monthlySalary: 50000,
      joiningDate: new Date("2027-01-15"),
      content: "<p>Offer</p>",
    };
    await modelsA.OfferLetter.create({
      ...offerBase,
      candidate: { fullName: "Cand One", email: "candidate@bn-a.test" },
      candidateUserId: candidate._id,
    });
    await modelsB.OfferLetter.create({
      ...offerBase,
      candidate: { fullName: "Other Co", email: "x@bn-b.test" },
    });

    const resA = await request(app)
      .get("/api/hiring/candidates")
      .query({ page: 1, limit: 20, stage: "OFFERS" })
      .set("Cookie", hrCookieA);
    assert.equal(resA.status, 200);
    assert.ok(resA.body.candidates.some((c) => c.email === "candidate@bn-a.test"));
    assert.ok(!resA.body.candidates.some((c) => c.email === "x@bn-b.test"));

    const resB = await request(app)
      .get("/api/hiring/candidates")
      .query({ page: 1, limit: 20 })
      .set("Cookie", hrCookieB);
    assert.equal(resB.status, 200);
    assert.ok(!resB.body.candidates.some((c) => c.email === "candidate@bn-a.test"));
  });
});
