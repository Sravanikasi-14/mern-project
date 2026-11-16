process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f54-live-tracking-write-amp-test-secret-32!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f54_tracking";
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
import {
  createLiveLocationUploadGate,
  haversineMeters,
  LIVE_LOCATION_CLIENT_MIN_DISTANCE_M,
  LIVE_LOCATION_CLIENT_MIN_INTERVAL_MS,
  LIVE_LOCATION_SERVER_MIN_INTERVAL_MS,
} from "../utils/liveLocationUploadGate.js";
import { updateLiveTrackingLocation } from "../services/attendanceService.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

const OFFICE = { latitude: 12.9716, longitude: 77.5946, accuracy: 10 };

describe("F54 live tracking write amplification", () => {
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
      companyName: "F54 Track Co",
      slug: `f54-track-${stamp}`,
      databaseName: `company_f54_track_${stamp}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    models = await getCompanyModels(company, { provision: true });
    const password = await hashPassword("F54Pass123!");

    const user = await models.User.create({
      email: "tracker@f54.test",
      passwordHash: password,
      role: USER_ROLES.EMPLOYEE,
      fullName: "F54 Tracker",
      isActive: true,
    });
    employee = await models.Employee.create({
      userId: user._id,
      employeeCode: "F54-1",
      fullName: "F54 Tracker",
      email: "tracker@f54.test",
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
      .send({ companyCode: company.slug, email: "tracker@f54.test", password: "F54Pass123!" });
    assert.equal(login.status, 200);
    empCookie = cookieFrom(login);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  async function ensurePunchedAndTracking() {
    await models.Attendance.deleteMany({ employeeId: employee._id });
    await models.LiveTrackingSession.deleteMany({ employeeId: employee._id });
    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", empCookie)
      .send({ location: OFFICE });
    assert.equal(punch.status, 200, punch.body?.message);
    const start = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", empCookie)
      .send({ durationMinutes: 30 });
    assert.equal(start.status, 200, start.body?.message);
  }

  describe("client upload gate", () => {
    it("sends first sample immediately and bounds rapid ticks", () => {
      const gate = createLiveLocationUploadGate({
        minIntervalMs: LIVE_LOCATION_CLIENT_MIN_INTERVAL_MS,
        minDistanceMeters: LIVE_LOCATION_CLIENT_MIN_DISTANCE_M,
      });
      const base = { latitude: 12.9716, longitude: 77.5946 };
      const t0 = 1_000_000;
      assert.equal(gate.shouldUpload(base, t0), true);
      gate.markSent(base, t0);

      let uploads = 0;
      // Stay inside the interval window so only jitter (not elapsed time) is tested.
      const ticksInsideWindow = Math.floor(LIVE_LOCATION_CLIENT_MIN_INTERVAL_MS / 1000) - 1;
      for (let i = 1; i <= ticksInsideWindow; i++) {
        // ~1s ticks with tiny jitter (~1–2m) — must not upload
        const jitter = {
          latitude: base.latitude + i * 0.00001,
          longitude: base.longitude + i * 0.00001,
        };
        if (gate.shouldUpload(jitter, t0 + i * 1000)) {
          gate.markSent(jitter, t0 + i * 1000);
          uploads += 1;
        }
      }
      assert.equal(uploads, 0, "jitter within 15s must not upload");

      const afterInterval = {
        latitude: base.latitude + 0.00002,
        longitude: base.longitude,
      };
      assert.equal(gate.shouldUpload(afterInterval, t0 + LIVE_LOCATION_CLIENT_MIN_INTERVAL_MS), true);
    });

    it("allows earlier upload when movement exceeds ~75m", () => {
      const gate = createLiveLocationUploadGate();
      const a = { latitude: 12.9716, longitude: 77.5946 };
      const t0 = 2_000_000;
      assert.equal(gate.shouldUpload(a, t0), true);
      gate.markSent(a, t0);

      // ~0.001 deg latitude ≈ 111m
      const far = { latitude: 12.9727, longitude: 77.5946 };
      const moved = haversineMeters(a.latitude, a.longitude, far.latitude, far.longitude);
      assert.ok(moved >= LIVE_LOCATION_CLIENT_MIN_DISTANCE_M);
      assert.equal(gate.shouldUpload(far, t0 + 2000), true);
    });

    it("does not treat sub-threshold jitter as meaningful movement", () => {
      const gate = createLiveLocationUploadGate();
      const a = { latitude: 12.9716, longitude: 77.5946 };
      gate.markSent(a, 3_000_000);
      const near = { latitude: 12.97165, longitude: 77.59465 };
      const moved = haversineMeters(a.latitude, a.longitude, near.latitude, near.longitude);
      assert.ok(moved < LIVE_LOCATION_CLIENT_MIN_DISTANCE_M);
      assert.equal(gate.shouldUpload(near, 3_000_000 + 2000), false);
    });
  });

  describe("server atomic throttle", () => {
    it("rejects updates within 4 seconds and accepts after window", async () => {
      await ensurePunchedAndTracking();
      const first = await request(app)
        .post("/api/employees/me/tracking/update")
        .set("Cookie", empCookie)
        .send({ location: { ...OFFICE, latitude: 12.9717 } });
      assert.equal(first.status, 200);
      assert.equal(first.body.throttled, false);
      assert.ok(first.body.session.lastLocation);

      const second = await request(app)
        .post("/api/employees/me/tracking/update")
        .set("Cookie", empCookie)
        .send({ location: { ...OFFICE, latitude: 12.9718 } });
      assert.equal(second.status, 200);
      assert.equal(second.body.throttled, true);
      assert.equal(second.body.session.lastLocation, undefined);
      assert.equal(second.body.monitor, undefined);

      const session = await models.LiveTrackingSession.findOne({
        employeeId: employee._id,
        status: "ACTIVE",
      }).lean();
      assert.equal(session.breadcrumbs.length, 1);

      // Force lastLocation older than server throttle for next accept.
      await models.LiveTrackingSession.updateOne(
        { _id: session._id },
        {
          $set: {
            "lastLocation.receivedAt": new Date(
              Date.now() - LIVE_LOCATION_SERVER_MIN_INTERVAL_MS - 100
            ),
          },
        }
      );

      const third = await request(app)
        .post("/api/employees/me/tracking/update")
        .set("Cookie", empCookie)
        .send({ location: { ...OFFICE, latitude: 12.9719 } });
      assert.equal(third.status, 200);
      assert.equal(third.body.throttled, false);
      assert.ok(third.body.session.lastLocation);

      const after = await models.LiveTrackingSession.findById(session._id).lean();
      assert.equal(after.breadcrumbs.length, 2);
    });

    it("concurrent requests cannot bypass the 4s throttle", async () => {
      await ensurePunchedAndTracking();
      const loc = { latitude: 12.972, longitude: 77.595, accuracy: 8 };
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          updateLiveTrackingLocation({
            models,
            employee,
            location: loc,
            companyTimezone: "Asia/Kolkata",
          })
        )
      );
      const accepted = results.filter((r) => r.throttled === false);
      const throttled = results.filter((r) => r.throttled === true);
      assert.equal(accepted.length, 1);
      assert.equal(throttled.length, 7);

      const session = await models.LiveTrackingSession.findOne({
        employeeId: employee._id,
        status: "ACTIVE",
      }).lean();
      assert.equal(session.breadcrumbs.length, 1);
    });

    it("caps breadcrumbs at 50 via $slice", async () => {
      await ensurePunchedAndTracking();
      const session = await models.LiveTrackingSession.findOne({
        employeeId: employee._id,
        status: "ACTIVE",
      });
      const seed = [];
      for (let i = 0; i < 49; i++) {
        seed.push({
          latitude: 12.97,
          longitude: 77.59,
          accuracy: 10,
          receivedAt: new Date(Date.now() - (60 - i) * 10_000),
        });
      }
      session.breadcrumbs = seed;
      session.lastLocation = {
        ...seed[seed.length - 1],
        receivedAt: new Date(Date.now() - LIVE_LOCATION_SERVER_MIN_INTERVAL_MS - 50),
      };
      await session.save();

      const res = await request(app)
        .post("/api/employees/me/tracking/update")
        .set("Cookie", empCookie)
        .send({ location: { latitude: 12.973, longitude: 77.596, accuracy: 9 } });
      assert.equal(res.status, 200);
      assert.equal(res.body.throttled, false);

      const after = await models.LiveTrackingSession.findById(session._id).lean();
      assert.equal(after.breadcrumbs.length, 50);
      assert.equal(after.breadcrumbs[49].latitude, 12.973);
    });

    it("rejects updates after punch-out / stop / expiry", async () => {
      await ensurePunchedAndTracking();
      await request(app).post("/api/employees/me/attendance/punch-out").set("Cookie", empCookie).send({
        location: OFFICE,
      });
      const afterPunchOut = await request(app)
        .post("/api/employees/me/tracking/update")
        .set("Cookie", empCookie)
        .send({ location: OFFICE });
      assert.equal(afterPunchOut.status, 400);
      // Punch-out stops the live session first; clients already key off this message.
      assert.match(afterPunchOut.body.message, /No active tracking session/i);

      await ensurePunchedAndTracking();
      await request(app).post("/api/employees/me/tracking/stop").set("Cookie", empCookie);
      const afterStop = await request(app)
        .post("/api/employees/me/tracking/update")
        .set("Cookie", empCookie)
        .send({ location: OFFICE });
      assert.equal(afterStop.status, 400);
      assert.match(afterStop.body.message, /No active tracking session/);

      await ensurePunchedAndTracking();
      await models.LiveTrackingSession.updateOne(
        { employeeId: employee._id, status: "ACTIVE" },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      );
      const afterExpiry = await request(app)
        .post("/api/employees/me/tracking/update")
        .set("Cookie", empCookie)
        .send({ location: OFFICE });
      assert.equal(afterExpiry.status, 400);
      assert.match(afterExpiry.body.message, /expired/i);
    });

    it("rejects updates when session is ACTIVE but punch-in is closed", async () => {
      await ensurePunchedAndTracking();
      // Simulate a rare orphan: tracking still ACTIVE after attendance closed without stop.
      const closedAt = new Date();
      await models.Attendance.updateOne(
        { employeeId: employee._id },
        {
          $set: {
            openSessionId: null,
            checkOut: closedAt,
            "sessions.$[].checkOut": closedAt,
            "sessions.$[].status": "COMPLETED",
          },
        }
      );

      const res = await request(app)
        .post("/api/employees/me/tracking/update")
        .set("Cookie", empCookie)
        .send({ location: OFFICE });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /no active punch-in/i);
      assert.equal(res.body.code, "TRACKING_REQUIRES_PUNCH_IN");
    });
  });
});
