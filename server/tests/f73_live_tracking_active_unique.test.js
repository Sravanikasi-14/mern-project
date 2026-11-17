process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f73-live-tracking-active-unique-secret-32!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f73_tracking";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import {
  connectCentralDB,
  disconnectAll,
  getCompanyModels,
} from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { TRACKING_STATUSES } from "../models/LiveTrackingSession.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { startLiveTrackingSession } from "../services/attendanceService.js";
import {
  ACTIVE_EMPLOYEE_UNIQUE_INDEX,
  cleanupDuplicateActiveSessions,
  inventoryDuplicateActiveSessions,
} from "../services/liveTrackingActiveSession.js";
import { TENANT_INDEX_SCHEMA_VERSION } from "../services/tenantIndexInventory.js";
import { expectedIndexesFromSchema } from "../services/tenantIndexInventory.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

const OFFICE = { latitude: 12.9716, longitude: 77.5946, accuracy: 10 };

describe("F73 LiveTrackingSession single-ACTIVE invariant", () => {
  let mongo;
  let app;
  let company;
  let models;
  let empCookie;
  let employee;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    const stamp = Date.now();
    company = await Company.create({
      companyName: "F73 Track Co",
      slug: `f73-track-${stamp}`,
      databaseName: `company_f73_track_${stamp}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    models = await getCompanyModels(company, { provision: true });
    const password = await hashPassword("F73Pass123!");

    const user = await models.User.create({
      email: "tracker@f73.test",
      passwordHash: password,
      role: USER_ROLES.EMPLOYEE,
      fullName: "F73 Tracker",
      isActive: true,
    });
    employee = await models.Employee.create({
      userId: user._id,
      employeeCode: "F73-1",
      fullName: "F73 Tracker",
      email: "tracker@f73.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: {
        jobTitle: "Field",
        department: "Ops",
        joiningDate: new Date("2026-01-01"),
      },
    });
    user.employeeId = employee._id;
    await user.save();

    const login = await request(app)
      .post("/api/auth/login")
      .send({
        companyCode: company.slug,
        email: "tracker@f73.test",
        password: "F73Pass123!",
      });
    assert.equal(login.status, 200);
    empCookie = cookieFrom(login);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  beforeEach(async () => {
    await models.Attendance.deleteMany({ employeeId: employee._id });
    await models.LiveTrackingSession.deleteMany({ employeeId: employee._id });
  });

  async function punchIn() {
    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", empCookie)
      .send({ location: OFFICE });
    assert.equal(punch.status, 200);
  }

  it("declares unique partial ACTIVE index in schema (no TTL)", () => {
    assert.equal(TENANT_INDEX_SCHEMA_VERSION, 5);
    const expected = expectedIndexesFromSchema(models.LiveTrackingSession.schema);
    const uniq = expected.find(
      (e) => e.name === ACTIVE_EMPLOYEE_UNIQUE_INDEX.name
    );
    assert.ok(uniq);
    assert.equal(uniq.unique, true);
    assert.deepEqual(uniq.key, { employeeId: 1 });
    assert.deepEqual(uniq.partialFilterExpression, {
      status: TRACKING_STATUSES.ACTIVE,
    });
    assert.equal(
      expected.some((e) => typeof e.expireAfterSeconds === "number"),
      false
    );
  });

  it("provision creates uniq_live_tracking_active_employeeId", async () => {
    const indexes = await models.LiveTrackingSession.collection.indexes();
    const uniq = indexes.find(
      (ix) => ix.name === "uniq_live_tracking_active_employeeId"
    );
    assert.ok(uniq, JSON.stringify(indexes.map((i) => i.name)));
    assert.equal(uniq.unique, true);
    assert.deepEqual(uniq.partialFilterExpression, { status: "ACTIVE" });
    assert.equal(uniq.expireAfterSeconds, undefined);
  });

  async function withUniqueIndexDropped(fn) {
    const col = models.LiveTrackingSession.collection;
    const name = ACTIVE_EMPLOYEE_UNIQUE_INDEX.name;
    try {
      await col.dropIndex(name);
    } catch {
      /* may already be absent */
    }
    try {
      return await fn();
    } finally {
      // Must collapse to ≤1 ACTIVE before recreating the unique partial index.
      await cleanupDuplicateActiveSessions(models.LiveTrackingSession, {
        apply: true,
      });
      await col.createIndex(ACTIVE_EMPLOYEE_UNIQUE_INDEX.key, {
        name: ACTIVE_EMPLOYEE_UNIQUE_INDEX.name,
        unique: true,
        partialFilterExpression:
          ACTIVE_EMPLOYEE_UNIQUE_INDEX.partialFilterExpression,
      });
    }
  }

  it("cleanup dry-run reports duplicates without stopping", async () => {
    const now = Date.now();
    await withUniqueIndexDropped(async () => {
      await models.LiveTrackingSession.collection.deleteMany({
        employeeId: employee._id,
      });
      await models.LiveTrackingSession.collection.insertMany([
        {
          employeeId: employee._id,
          status: "ACTIVE",
          startedAt: new Date(now - 60_000),
          expiresAt: new Date(now + 3_600_000),
        },
        {
          employeeId: employee._id,
          status: "ACTIVE",
          startedAt: new Date(now - 10_000),
          expiresAt: new Date(now + 3_600_000),
        },
        {
          employeeId: employee._id,
          status: "STOPPED",
          startedAt: new Date(now - 120_000),
          expiresAt: new Date(now - 60_000),
          stoppedAt: new Date(now - 90_000),
        },
      ]);

      const dups = await inventoryDuplicateActiveSessions(
        models.LiveTrackingSession
      );
      assert.equal(dups.length, 1);
      assert.equal(dups[0].count, 2);

      const dry = await cleanupDuplicateActiveSessions(
        models.LiveTrackingSession,
        { apply: false }
      );
      assert.equal(dry.apply, false);
      assert.equal(dry.duplicateGroups, 1);
      assert.equal(dry.wouldStop, 1);
      assert.equal(dry.stopped, 0);

      const stillActive = await models.LiveTrackingSession.countDocuments({
        employeeId: employee._id,
        status: "ACTIVE",
      });
      assert.equal(stillActive, 2);
    });
  });

  it("cleanup apply keeps newest ACTIVE and stops older duplicates; preserves STOPPED history", async () => {
    const now = Date.now();
    let inserted;
    await withUniqueIndexDropped(async () => {
      await models.LiveTrackingSession.collection.deleteMany({
        employeeId: employee._id,
      });
      inserted = await models.LiveTrackingSession.collection.insertMany([
        {
          employeeId: employee._id,
          status: "ACTIVE",
          startedAt: new Date(now - 60_000),
          expiresAt: new Date(now + 3_600_000),
        },
        {
          employeeId: employee._id,
          status: "ACTIVE",
          startedAt: new Date(now - 5_000),
          expiresAt: new Date(now + 3_600_000),
        },
        {
          employeeId: employee._id,
          status: "STOPPED",
          startedAt: new Date(now - 200_000),
          expiresAt: new Date(now - 100_000),
          stoppedAt: new Date(now - 150_000),
        },
      ]);

      const applied = await cleanupDuplicateActiveSessions(
        models.LiveTrackingSession,
        { apply: true }
      );
      assert.equal(applied.stopped, 1);
      assert.equal(applied.wouldStop, 1);

      const active = await models.LiveTrackingSession.find({
        employeeId: employee._id,
        status: "ACTIVE",
      }).lean();
      assert.equal(active.length, 1);
      assert.equal(
        new Date(active[0].startedAt).getTime(),
        new Date(now - 5_000).getTime()
      );

      const stoppedHistory = await models.LiveTrackingSession.countDocuments({
        employeeId: employee._id,
        status: "STOPPED",
      });
      assert.equal(stoppedHistory, 2);

      const remaining = await models.LiveTrackingSession.countDocuments({
        _id: { $in: Object.values(inserted.insertedIds) },
      });
      assert.equal(remaining, 3);
    });
  });

  it("concurrent startLiveTrackingSession calls yield a single ACTIVE session", async () => {
    await punchIn();

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        startLiveTrackingSession({
          models,
          employee,
          durationMinutes: 30,
          userAgent: "f73-test",
          clientPlatform: "android",
        })
      )
    );

    assert.equal(results.every((r) => r.success), true);
    const active = await models.LiveTrackingSession.find({
      employeeId: employee._id,
      status: "ACTIVE",
    }).lean();
    assert.equal(active.length, 1);

    const activeIds = new Set(results.map((r) => String(r.session.id)));
    // All successful returns should refer to an ACTIVE id that exists (may be same).
    for (const id of activeIds) {
      const doc = await models.LiveTrackingSession.findById(id).lean();
      assert.ok(doc);
    }
  });

  it("HTTP concurrent tracking starts leave one ACTIVE", async () => {
    await punchIn();

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app)
          .post("/api/employees/me/tracking/start")
          .set("Cookie", empCookie)
          .send({ durationMinutes: 30 })
      )
    );

    const statuses = responses.map((r) => r.status);
    const okCount = statuses.filter((s) => s === 200).length;
    assert.ok(
      okCount >= 1,
      `expected at least one 200, got statuses=${JSON.stringify(statuses)} bodies=${JSON.stringify(responses.map((r) => r.body?.code || r.body?.message))}`
    );
    const active = await models.LiveTrackingSession.countDocuments({
      employeeId: employee._id,
      status: "ACTIVE",
    });
    assert.equal(active, 1);
  });

  it("duplicate-key race is handled without throwing to the client", async () => {
    await punchIn();
    // Pre-create ACTIVE via raw insert
    await models.LiveTrackingSession.create({
      employeeId: employee._id,
      status: "ACTIVE",
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const result = await startLiveTrackingSession({
      models,
      employee,
      durationMinutes: 45,
      clientPlatform: "ios",
    });
    assert.equal(result.success, true);
    const active = await models.LiveTrackingSession.find({
      employeeId: employee._id,
      status: "ACTIVE",
    }).lean();
    assert.equal(active.length, 1);
  });

  it("preserves punch-out stop behavior", async () => {
    await punchIn();
    const start = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookie)
      .send({ durationMinutes: 30 });
    assert.equal(start.status, 200);

    const punchOut = await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", empCookie)
      .send({ location: OFFICE });
    assert.equal(punchOut.status, 200);
    assert.equal(punchOut.body.trackingStopped, true);

    const active = await models.LiveTrackingSession.countDocuments({
      employeeId: employee._id,
      status: "ACTIVE",
    });
    assert.equal(active, 0);
  });
});
