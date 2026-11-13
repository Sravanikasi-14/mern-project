process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f42-attendance-notif-test-secret-32ch!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f42_att_notif";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.FACE_BIOMETRIC_KEY = "test-face-biometric-key-32chars!!";

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { DEFAULT_HR_POLICY } from "../models/CompanyHrPolicy.js";
import { USER_ROLES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import {
  insertAttendanceNotificationDocs,
  notifyAttendanceStakeholders,
  resolveHrPortalNotificationRecipients,
} from "../services/attendanceLocationService.js";
import { punchInEmployee } from "../services/attendanceService.js";

const OFFICE = { latitude: 17.448293, longitude: 78.374628 };
const FAR = { latitude: 17.55, longitude: 78.45 };

function nearOffice(overrides = {}) {
  return {
    latitude: OFFICE.latitude + 0.0002,
    longitude: OFFICE.longitude + 0.0002,
    accuracy: 15,
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

function farFromOffice(overrides = {}) {
  return {
    ...FAR,
    accuracy: 20,
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("F42 attendance punch notification performance", () => {
  let mongoServer;
  let app;
  let server;
  let models;
  let otherModels;
  let company;
  let otherCompany;
  let employee;
  let empUser;
  let emp2;
  let emp2User;
  let hrUser;
  let companyAdminUser;
  let hr2User;
  let otherHrUser;
  let cookies = {};

  before(async () => {
    fs.mkdirSync("D:/tmp/hrms-mongo/f42-attendance-notifications", { recursive: true });
    mongoServer = await MongoMemoryServer.create({
      instance: { dbPath: "D:/tmp/hrms-mongo/f42-attendance-notifications" },
    });
    process.env.MONGO_URI = mongoServer.getUri();
    await connectCentralDB();
    app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));

    const passwordHash = await hashPassword("Password123!");
    const slug = `f42-att-${Date.now()}`;
    company = await Company.create({
      name: "F42 Att Co",
      companyName: "F42 Att Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
      hrAccessEnforcement: { mode: "OFF" },
    });
    models = await getCompanyModels(company, { provision: true });

    hrUser = await models.User.create({
      email: "hr.f42@example.com",
      passwordHash,
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      fullName: "HR Admin",
    });
    companyAdminUser = await models.User.create({
      email: "ca.f42@example.com",
      passwordHash,
      role: USER_ROLES.COMPANY_ADMIN,
      isActive: true,
      fullName: "Company Admin",
    });
    hr2User = await models.User.create({
      email: "hr2.f42@example.com",
      passwordHash,
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      fullName: "HR Admin Two",
    });
    empUser = await models.User.create({
      email: "emp.f42@example.com",
      passwordHash,
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
    });
    employee = await models.Employee.create({
      companyId: company._id,
      userId: empUser._id,
      email: empUser.email,
      fullName: "F42 Punch Emp",
      employeeCode: "F42-1",
      status: "ACTIVE",
      job: { jobTitle: "Engineer", workArrangement: { mode: "OFFICE" } },
    });
    empUser.employeeId = employee._id;
    await empUser.save();

    emp2User = await models.User.create({
      email: "emp2.f42@example.com",
      passwordHash,
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
    });
    emp2 = await models.Employee.create({
      companyId: company._id,
      userId: emp2User._id,
      email: emp2User.email,
      fullName: "F42 Punch Emp Two",
      employeeCode: "F42-2",
      status: "ACTIVE",
      job: { jobTitle: "Analyst", workArrangement: { mode: "OFFICE" } },
    });
    emp2User.employeeId = emp2._id;
    await emp2User.save();

    const otherSlug = `f42-other-${Date.now()}`;
    otherCompany = await Company.create({
      name: "F42 Other Co",
      companyName: "F42 Other Co",
      slug: otherSlug,
      databaseName: `company_${otherSlug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
      hrAccessEnforcement: { mode: "OFF" },
    });
    otherModels = await getCompanyModels(otherCompany, { provision: true });
    otherHrUser = await otherModels.User.create({
      email: "hr.f42other@example.com",
      passwordHash,
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      fullName: "Other HR",
    });

    await models.CompanyHrPolicy.deleteMany({});
    await models.CompanyHrPolicy.create({
      ...DEFAULT_HR_POLICY,
      effectiveFromDate: new Date("2020-01-01"),
      locationRules: {
        ...DEFAULT_HR_POLICY.locationRules,
        requireLocationForPunch: true,
        geofenceEnabled: true,
        geofenceRadiusMeters: 300,
        officeLatitude: OFFICE.latitude,
        officeLongitude: OFFICE.longitude,
        officeName: "HQ",
        outOfRadiusPolicy: "BLOCK",
        maxAccuracyMeters: 80,
        accuracyFailurePolicy: "BLOCK",
        gpsFailurePolicy: "BLOCK",
        maxLocationAgeSeconds: 180,
      },
      attendanceVerification: {
        verificationRequired: false,
        gps: { enabled: false, mandatory: true },
        wifi: { enabled: false, mandatory: true },
        face: { enabled: false, mandatory: true, matchThreshold: 0.55, requireLiveness: true },
        wifiNetworks: [],
      },
      schemaVersion: 2,
    });

    async function login(email, companyCode = company.slug) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email, password: "Password123!", companyCode });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.headers["set-cookie"];
    }

    cookies.hr = await login("hr.f42@example.com");
    cookies.ca = await login("ca.f42@example.com");
    cookies.hr2 = await login("hr2.f42@example.com");
    cookies.emp = await login("emp.f42@example.com");
    cookies.emp2 = await login("emp2.f42@example.com");
    cookies.otherHr = await login("hr.f42other@example.com", otherCompany.slug);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectAll();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    // Close any open sessions first (may emit punch-out notifications).
    for (const cookie of [cookies.emp, cookies.emp2]) {
      await request(app)
        .post("/api/employees/me/attendance/punch-out")
        .set("Cookie", cookie)
        .send({ location: nearOffice() });
    }
    await models.Attendance.deleteMany({});
    // Clear after cleanup so punch-out fan-out cannot leak into the next test.
    await models.Notification.deleteMany({});
    await otherModels.Notification.deleteMany({});
  });

  it("resolves HR Admin and Company Admin recipients (not employees)", async () => {
    const recipients = await resolveHrPortalNotificationRecipients(models);
    const roles = recipients.map((r) => r.role).sort();
    assert.deepEqual(roles, [
      USER_ROLES.COMPANY_ADMIN,
      USER_ROLES.HR_ADMIN,
      USER_ROLES.HR_ADMIN,
    ]);
    assert.equal(
      recipients.some((r) => String(r._id) === String(empUser._id)),
      false
    );
  });

  it("bulk-inserts stakeholder notifications in one insertMany", async () => {
    let insertCalls = 0;
    let lastDocs = [];
    const original = models.Notification.insertMany.bind(models.Notification);
    models.Notification.insertMany = async (docs, opts) => {
      insertCalls += 1;
      lastDocs = docs;
      assert.equal(opts?.ordered, false);
      return original(docs, opts);
    };
    try {
      const result = await notifyAttendanceStakeholders({
        models,
        employee,
        title: "Punch-in successful",
        message: "F42 Punch Emp punched in (office session).",
        link: "/admin/attendance",
        metadata: { sessionId: "sess-bulk-1", sessionType: "OFFICE" },
        dedupeKey: "punch_in:emp:sess-bulk-1",
      });
      assert.equal(insertCalls, 1);
      assert.ok(result.delivered >= 4); // emp + HR + CA + HR2
      assert.equal(lastDocs.length, result.delivered);
      assert.ok(lastDocs.every((d) => d.metadata?.dedupeKey === "punch_in:emp:sess-bulk-1"));
      assert.ok(lastDocs.some((d) => String(d.userId) === String(empUser._id)));
      assert.ok(lastDocs.some((d) => String(d.userId) === String(hrUser._id)));
      assert.ok(lastDocs.some((d) => String(d.userId) === String(companyAdminUser._id)));
      assert.ok(lastDocs.some((d) => String(d.userId) === String(hr2User._id)));
    } finally {
      models.Notification.insertMany = original;
    }
  });

  it("dedupes retry fan-out for the same punch event key", async () => {
    const key = "punch_in:emp:sess-dedupe";
    const first = await notifyAttendanceStakeholders({
      models,
      employee,
      title: "Punch-in successful",
      message: "first",
      dedupeKey: key,
      metadata: { sessionId: "sess-dedupe" },
    });
    assert.ok(first.delivered >= 4);
    const second = await notifyAttendanceStakeholders({
      models,
      employee,
      title: "Punch-in successful",
      message: "retry",
      dedupeKey: key,
      metadata: { sessionId: "sess-dedupe" },
    });
    assert.equal(second.deduped, true);
    assert.equal(second.delivered, 0);
    const count = await models.Notification.countDocuments({ "metadata.dedupeKey": key });
    assert.equal(count, first.delivered);
  });

  it("punch-in notifies HR Admin + Company Admin; punch-out likewise", async () => {
    const inn = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: nearOffice(), sessionType: "OFFICE" });
    assert.equal(inn.status, 200, JSON.stringify(inn.body));

    const hrFeed = await request(app).get("/api/notifications").set("Cookie", cookies.hr);
    assert.equal(hrFeed.status, 200);
    assert.ok(hrFeed.body.unreadCount >= 1);
    assert.ok(
      (hrFeed.body.notifications || []).some((n) => /punched in/i.test(n.message || ""))
    );

    const caFeed = await request(app).get("/api/notifications").set("Cookie", cookies.ca);
    assert.equal(caFeed.status, 200);
    assert.ok(
      (caFeed.body.notifications || []).some((n) => /punched in/i.test(n.message || ""))
    );

    const out = await request(app)
      .post("/api/employees/me/attendance/punch-out")
      .set("Cookie", cookies.emp)
      .send({ location: nearOffice() });
    assert.equal(out.status, 200, JSON.stringify(out.body));

    const hrAfterOut = await request(app).get("/api/notifications").set("Cookie", cookies.hr);
    assert.ok(
      (hrAfterOut.body.notifications || []).some((n) => /punched out/i.test(n.message || ""))
    );
  });

  it("preserves unread counts and mark-read behavior", async () => {
    const inn = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: nearOffice(), sessionType: "OFFICE" });
    assert.equal(inn.status, 200);

    const before = await request(app).get("/api/notifications").set("Cookie", cookies.hr);
    assert.equal(before.status, 200);
    assert.ok(before.body.unreadCount >= 1);
    // API returns `id` (not `_id`) on list items.
    const target = (before.body.notifications || []).find(
      (n) =>
        /punched in/i.test(n.message || "") || /Punch-in successful/i.test(n.title || "")
    );
    assert.ok(target?.id, JSON.stringify(before.body.notifications || []));

    const marked = await request(app)
      .patch(`/api/notifications/${target.id}/read`)
      .set("Cookie", cookies.hr);
    assert.equal(marked.status, 200);

    const after = await request(app).get("/api/notifications").set("Cookie", cookies.hr);
    assert.equal(
      (after.body.notifications || []).some((n) => String(n.id) === String(target.id)),
      false
    );
    assert.ok(after.body.unreadCount <= before.body.unreadCount);
  });

  it("notification insertMany failure does not roll back a successful punch", async () => {
    await models.Notification.deleteMany({});
    const Notif = models.Notification;
    const originalInsertMany = Notif.insertMany;
    let blockedCalls = 0;
    Notif.insertMany = async function blockedInsertMany() {
      blockedCalls += 1;
      throw new Error("simulated bulk notification failure");
    };
    try {
      const result = await punchInEmployee({
        models,
        employee,
        location: nearOffice(),
        sessionType: "OFFICE",
        companyTimezone: "Asia/Kolkata",
      });
      assert.equal(result.success, true);
      assert.equal(await models.Attendance.countDocuments({}), 1);
      assert.ok(blockedCalls >= 1, "expected insertMany to be invoked and blocked");
      const leftover = await models.Notification.find({}).select("title message").lean();
      assert.equal(
        leftover.length,
        0,
        `expected no notifications after blocked insertMany, got ${JSON.stringify(leftover)}`
      );
    } finally {
      Notif.insertMany = originalInsertMany;
    }
  });

  it("tenant isolation: other company never sees this tenant's punch notifications", async () => {
    const inn = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: nearOffice(), sessionType: "OFFICE" });
    assert.equal(inn.status, 200);

    assert.equal(await otherModels.Notification.countDocuments({}), 0);
    const otherFeed = await request(app).get("/api/notifications").set("Cookie", cookies.otherHr);
    assert.equal(otherFeed.status, 200);
    assert.equal(JSON.stringify(otherFeed.body).includes("F42 Punch Emp"), false);
  });

  it("GPS/geofence enforcement remains intact (outside still blocked)", async () => {
    const blocked = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), sessionType: "OFFICE" });
    assert.equal(blocked.status, 400);
    assert.equal(await models.Attendance.countDocuments({}), 0);
  });

  it("concurrent punches by two employees both succeed without duplicate days", async () => {
    const [a, b] = await Promise.all([
      request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({ location: nearOffice(), sessionType: "OFFICE" }),
      request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp2)
        .send({ location: nearOffice(), sessionType: "OFFICE" }),
    ]);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(await models.Attendance.countDocuments({}), 2);

    const punchNotes = await models.Notification.find({
      title: "Punch-in successful",
    }).lean();
    // Each punch: employee + 3 HR portal users = 4; two punches = 8
    assert.equal(punchNotes.length, 8);
  });

  it("insertAttendanceNotificationDocs is a bulk helper (structural)", async () => {
    const n = await insertAttendanceNotificationDocs(models, [
      {
        userId: hrUser._id,
        role: null,
        title: "Bulk helper",
        message: "one",
        type: "ATTENDANCE",
        link: "/admin/attendance",
        metadata: { delivery: "PERSONAL" },
      },
      {
        userId: companyAdminUser._id,
        role: null,
        title: "Bulk helper",
        message: "two",
        type: "ATTENDANCE",
        link: "/admin/attendance",
        metadata: { delivery: "PERSONAL" },
      },
    ]);
    assert.equal(n, 2);
  });
});
