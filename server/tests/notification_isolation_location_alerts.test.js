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
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { DEFAULT_HR_POLICY } from "../models/CompanyHrPolicy.js";
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import { hashPassword } from "../utils/password.js";
import { notificationVisibilityFilter } from "../utils/notificationVisibility.js";

let mongoServer;
let app;
let server;
let acme;
let globex;
let models;
let globexModels;
let cookies = {};
let empA;
let empB;
let userA;
let userB;
let hrUser;
let globexEmp;
let globexUser;

const OFFICE = { latitude: 17.385, longitude: 78.4867 };
const FAR = { latitude: 17.6, longitude: 78.7 };
const HOME = { latitude: 17.45, longitude: 78.5 };

async function login(email, companyCode) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "Password123!", companyCode: companyCode || acme.slug });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers["set-cookie"];
}

async function ensurePunchedOut(cookie) {
  await request(app)
    .post("/api/employees/me/attendance/punch-out")
    .set("Cookie", cookie)
    .send({ location: { ...OFFICE, accuracy: 10, capturedAt: new Date().toISOString() } });
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();
  await connectCentralDB();
  app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  const slug = `acme-notif-${Date.now()}`;
  acme = await Company.create({
    name: "Acme Notif",
    companyName: "Acme Notif",
    slug,
    databaseName: `company_${slug.replace(/-/g, "_")}`,
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
    hrAccessEnforcement: { mode: "OFF" },
  });
  models = await getCompanyModels(acme, { provision: true });
  const passwordHash = await hashPassword("Password123!");

  hrUser = await models.User.create({
    email: "hr@acme-notif.test",
    passwordHash,
    role: "HR_ADMIN",
    isActive: true,
  });
  userA = await models.User.create({
    email: "emp-a@acme-notif.test",
    passwordHash,
    role: "EMPLOYEE",
    isActive: true,
  });
  userB = await models.User.create({
    email: "emp-b@acme-notif.test",
    passwordHash,
    role: "EMPLOYEE",
    isActive: true,
  });
  empA = await models.Employee.create({
    companyId: acme._id,
    userId: userA._id,
    employeeCode: "N-A",
    fullName: "Employee A",
    email: "emp-a@acme-notif.test",
    status: "ACTIVE",
    job: { jobTitle: "Engineer", workArrangement: { mode: "OFFICE" } },
  });
  empB = await models.Employee.create({
    companyId: acme._id,
    userId: userB._id,
    employeeCode: "N-B",
    fullName: "Employee B",
    email: "emp-b@acme-notif.test",
    status: "ACTIVE",
    job: { jobTitle: "Designer", workArrangement: { mode: "OFFICE" } },
  });
  userA.employeeId = empA._id;
  userB.employeeId = empB._id;
  await userA.save();
  await userB.save();

  await models.CompanyHrPolicy.deleteMany({});
  await models.CompanyHrPolicy.create({
    ...DEFAULT_HR_POLICY,
    effectiveFromDate: new Date("2026-01-01"),
    locationRules: {
      ...DEFAULT_HR_POLICY.locationRules,
      geofenceEnabled: true,
      geofenceRadiusMeters: 200,
      officeLatitude: OFFICE.latitude,
      officeLongitude: OFFICE.longitude,
      officeAddress: "Hyderabad Office",
      outOfRadiusPolicy: "WARN",
      accuracyFailurePolicy: "WARN",
      requireLocationForPunch: true,
      allowWebTracking: true,
    },
    workArrangementRules: {
      ...DEFAULT_HR_POLICY.workArrangementRules,
      monitoringEnabled: true,
      hybridRemoteApprovalRequired: true,
      wfhLocationMode: "WFH_APPROVED_LOCATION",
    },
    updatedBy: hrUser._id,
  });

  const gslug = `globex-notif-${Date.now()}`;
  globex = await Company.create({
    name: "Globex Notif",
    companyName: "Globex Notif",
    slug: gslug,
    databaseName: `company_${gslug.replace(/-/g, "_")}`,
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
  });
  globexModels = await getCompanyModels(globex, { provision: true });
  globexUser = await globexModels.User.create({
    email: "emp@globex-notif.test",
    passwordHash,
    role: "EMPLOYEE",
    isActive: true,
  });
  globexEmp = await globexModels.Employee.create({
    companyId: globex._id,
    userId: globexUser._id,
    employeeCode: "G-1",
    fullName: "Globex Emp",
    email: "emp@globex-notif.test",
    status: "ACTIVE",
    job: { jobTitle: "Ops", workArrangement: { mode: "OFFICE" } },
  });
  globexUser.employeeId = globexEmp._id;
  await globexUser.save();

  cookies.hr = await login("hr@acme-notif.test");
  cookies.a = await login("emp-a@acme-notif.test");
  cookies.b = await login("emp-b@acme-notif.test");
  cookies.globex = await login("emp@globex-notif.test", globex.slug);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectAll();
  if (mongoServer) await mongoServer.stop();
});

describe("notification recipient isolation (backend)", () => {
  it("visibility filter never matches another user's personal role:null docs", () => {
    const filter = notificationVisibilityFilter({ _id: userA._id, role: "EMPLOYEE" });
    assert.ok(filter.$or.some((c) => c.userId && String(c.userId) === String(userA._id)));
    assert.equal(
      filter.$or.some((c) => Object.keys(c).length === 1 && c.role === null),
      false,
      "must not match { role: null } alone"
    );
  });

  it("message notification is returned only to the conversation recipient", async () => {
    await models.Notification.deleteMany({});
    const opened = await request(app)
      .post("/api/conversations")
      .set("Cookie", cookies.a)
      .send({ participantUserId: String(hrUser._id) });
    assert.ok([200, 201].includes(opened.status), JSON.stringify(opened.body));
    const conversationId = opened.body.conversation.id;

    const sent = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", cookies.a)
      .send({ body: "Hello HR from A — secret to B" });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));

    const forB = await request(app).get("/api/notifications").set("Cookie", cookies.b);
    assert.equal(forB.status, 200);
    const bBlob = JSON.stringify(forB.body);
    assert.equal(bBlob.includes("secret to B"), false);
    assert.equal(bBlob.includes("Hello HR from A"), false);

    const forHr = await request(app).get("/api/notifications").set("Cookie", cookies.hr);
    assert.equal(forHr.status, 200);
    assert.ok(
      JSON.stringify(forHr.body).includes("Hello HR from A"),
      "HR recipient must see the message notification"
    );

    const forA = await request(app).get("/api/notifications").set("Cookie", cookies.a);
    assert.equal(JSON.stringify(forA.body).includes("Hello HR from A"), false);
  });

  it("attendance punch notification goes to actor employee and HR, not other employees", async () => {
    await ensurePunchedOut(cookies.a);
    await models.Notification.deleteMany({});

    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.a)
      .send({
        location: { ...OFFICE, accuracy: 8, capturedAt: new Date().toISOString() },
        sessionType: "OFFICE",
      });
    assert.equal(punch.status, 200, JSON.stringify(punch.body));

    const forA = await request(app).get("/api/notifications").set("Cookie", cookies.a);
    const forB = await request(app).get("/api/notifications").set("Cookie", cookies.b);
    const forHr = await request(app).get("/api/notifications").set("Cookie", cookies.hr);

    const aHas = JSON.stringify(forA.body).includes("Employee A");
    const bHas = JSON.stringify(forB.body).includes("Employee A");
    const hrHas = JSON.stringify(forHr.body).includes("Employee A");

    assert.equal(aHas, true, "punching employee must see own attendance notification");
    assert.equal(bHas, false, "other employee must not see attendance notification");
    assert.equal(hrHas, true, "HR_ADMIN role broadcast must reach HR");

    await ensurePunchedOut(cookies.a);
  });

  it("employee cannot mark another employee's notification as read", async () => {
    await models.Notification.deleteMany({});
    const note = await models.Notification.create({
      userId: userA._id,
      role: null,
      title: "Private for A",
      message: "Do not mark from B",
      type: NOTIFICATION_TYPES.SYSTEM,
      isRead: false,
    });

    const denied = await request(app)
      .patch(`/api/notifications/${note._id}/read`)
      .set("Cookie", cookies.b);
    assert.equal(denied.status, 403);

    const reloaded = await models.Notification.findById(note._id).lean();
    assert.equal((reloaded.readBy || []).some((id) => String(id) === String(userB._id)), false);

    const ok = await request(app)
      .patch(`/api/notifications/${note._id}/read`)
      .set("Cookie", cookies.a);
    assert.equal(ok.status, 200);
  });

  it("tenant isolation: Globex employee cannot see Acme notifications via API", async () => {
    await models.Notification.create({
      userId: userA._id,
      role: null,
      title: "Acme only",
      message: "tenant-secret-acme",
      type: NOTIFICATION_TYPES.SYSTEM,
    });
    const res = await request(app).get("/api/notifications").set("Cookie", cookies.globex);
    assert.equal(res.status, 200);
    assert.equal(JSON.stringify(res.body).includes("tenant-secret-acme"), false);
  });
});

describe("mark-as-read dismisses from visible list without deleting", () => {
  it("marking one notification removes only that item from GET /notifications and keeps the DB row", async () => {
    await models.Notification.deleteMany({});
    const keep = await models.Notification.create({
      userId: userA._id,
      role: null,
      title: "Keep visible",
      message: "still unread",
      type: NOTIFICATION_TYPES.SYSTEM,
      isRead: false,
    });
    const dismiss = await models.Notification.create({
      userId: userA._id,
      role: null,
      title: "Dismiss me",
      message: "will be marked read",
      type: NOTIFICATION_TYPES.SYSTEM,
      isRead: false,
    });

    const before = await request(app).get("/api/notifications").set("Cookie", cookies.a);
    assert.equal(before.status, 200);
    assert.equal(before.body.unreadCount, 2);
    assert.equal(before.body.notifications.length, 2);

    const marked = await request(app)
      .patch(`/api/notifications/${dismiss._id}/read`)
      .set("Cookie", cookies.a);
    assert.equal(marked.status, 200);

    const after = await request(app).get("/api/notifications").set("Cookie", cookies.a);
    assert.equal(after.status, 200);
    assert.equal(after.body.unreadCount, 1);
    assert.equal(after.body.notifications.length, 1);
    assert.equal(after.body.notifications[0].id, String(keep._id));
    assert.equal(
      after.body.notifications.some((n) => n.id === String(dismiss._id)),
      false
    );

    const stillStored = await models.Notification.findById(dismiss._id).lean();
    assert.ok(stillStored, "read notification must remain stored");
    assert.ok((stillStored.readBy || []).some((id) => String(id) === String(userA._id)));

    const forB = await request(app).get("/api/notifications").set("Cookie", cookies.b);
    assert.equal(JSON.stringify(forB.body).includes("Keep visible"), false);
    assert.equal(JSON.stringify(forB.body).includes("Dismiss me"), false);
  });

  it("mark all as read empties the panel list and leaves documents in the database", async () => {
    await models.Notification.deleteMany({});
    await models.Notification.create([
      {
        userId: userA._id,
        role: null,
        title: "One",
        message: "first",
        type: NOTIFICATION_TYPES.SYSTEM,
      },
      {
        userId: userA._id,
        role: null,
        title: "Two",
        message: "second",
        type: NOTIFICATION_TYPES.SYSTEM,
      },
    ]);

    const before = await request(app).get("/api/notifications").set("Cookie", cookies.a);
    assert.ok(before.body.notifications.length >= 2);

    const marked = await request(app)
      .post("/api/notifications/mark-all-read")
      .set("Cookie", cookies.a);
    assert.equal(marked.status, 200);

    const after = await request(app).get("/api/notifications").set("Cookie", cookies.a);
    assert.equal(after.status, 200);
    assert.equal(after.body.unreadCount, 0);
    assert.equal(after.body.notifications.length, 0);

    const storedCount = await models.Notification.countDocuments({ userId: userA._id });
    assert.equal(storedCount, 2);
  });
});

describe("out-of-radius location notifications", () => {
  it("WARN punch-in outside radius notifies employee and HR and creates exception", async () => {
    await ensurePunchedOut(cookies.a);
    await models.Notification.deleteMany({});
    await models.LocationException.deleteMany({});
    await models.Attendance.deleteMany({ employeeId: empA._id });

    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.a)
      .send({
        location: { ...FAR, accuracy: 8, capturedAt: new Date().toISOString() },
        sessionType: "OFFICE",
      });
    assert.equal(punch.status, 200, JSON.stringify(punch.body));
    assert.equal(punch.body.session?.geofence?.outside, true);
    assert.ok(punch.body.session?.exceptionId, "WARN outside punch must create a LocationException");

    const day = await models.Attendance.findOne({ employeeId: empA._id }).lean();
    const open = (day?.sessions || []).find((s) => String(s._id) === String(day.openSessionId));
    assert.equal(open?.outsideRadius, true, "session monitoring state must seed from outside punch");

    const exceptions = await models.LocationException.find({ employeeId: empA._id }).lean();
    assert.ok(exceptions.length >= 1);
    assert.ok(exceptions.some((e) => e.type === "OUTSIDE_GEOFENCE" || e.type === "PUNCH_OUTSIDE"));

    const outsideNotes = await models.Notification.find({
      type: NOTIFICATION_TYPES.ATTENDANCE,
      title: /outside permitted/i,
    }).lean();
    assert.ok(outsideNotes.length >= 2, "employee + HR portal recipients expected");
    assert.ok(outsideNotes.some((n) => String(n.userId) === String(userA._id)));
    assert.ok(
      outsideNotes.some(
        (n) =>
          String(n.userId) === String(hrUser._id) ||
          (n.userId == null && (n.role === "HR_ADMIN" || n.role === "COMPANY_ADMIN"))
      ),
      "HR portal operator must receive the outside-radius alert"
    );

    const forA = await request(app).get("/api/notifications").set("Cookie", cookies.a);
    const forB = await request(app).get("/api/notifications").set("Cookie", cookies.b);
    const forHr = await request(app).get("/api/notifications").set("Cookie", cookies.hr);
    assert.ok(JSON.stringify(forA.body).match(/outside permitted|punched in/i));
    assert.equal(JSON.stringify(forB.body).includes("Employee A"), false);
    assert.ok(JSON.stringify(forHr.body).match(/outside permitted|punched in/i));

    await ensurePunchedOut(cookies.a);
  });

  it("live tracking LEFT then RETURN creates one leave and one return notification without duplicates", async () => {
    await ensurePunchedOut(cookies.a);
    await models.Notification.deleteMany({});
    await models.LocationException.deleteMany({});
    await models.Attendance.deleteMany({ employeeId: empA._id });
    await models.LiveTrackingSession.deleteMany({ employeeId: empA._id });

    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.a)
      .send({
        location: { ...OFFICE, accuracy: 8, capturedAt: new Date().toISOString() },
        sessionType: "OFFICE",
      });
    assert.equal(punch.status, 200, JSON.stringify(punch.body));

    const start = await request(app)
      .post("/api/employees/me/tracking/start")
      .set("Cookie", cookies.a)
      .send({ durationMinutes: 30 });
    assert.equal(start.status, 200, JSON.stringify(start.body));

    await models.Notification.deleteMany({});

    const leave1 = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", cookies.a)
      .send({ location: { ...FAR, accuracy: 8, capturedAt: new Date().toISOString() } });
    assert.equal(leave1.status, 200, JSON.stringify(leave1.body));
    assert.equal(leave1.body.monitor?.event, "LEFT");

    // Force throttle window to elapse for a second update.
    await models.LiveTrackingSession.updateOne(
      { employeeId: empA._id, status: "ACTIVE" },
      { $set: { "lastLocation.receivedAt": new Date(Date.now() - 10_000) } }
    );

    const leave2 = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", cookies.a)
      .send({ location: { ...FAR, accuracy: 8, capturedAt: new Date().toISOString() } });
    assert.equal(leave2.status, 200);
    assert.equal(leave2.body.monitor?.changed, false);

    const afterLeave = await models.Notification.find({
      type: NOTIFICATION_TYPES.ATTENDANCE,
      "metadata.type": "OUTSIDE_GEOFENCE",
    }).lean();
    // employee personal + at least one HR portal recipient
    assert.ok(afterLeave.length >= 2);
    assert.ok(afterLeave.some((n) => String(n.userId) === String(userA._id)));
    assert.ok(
      afterLeave.some(
        (n) =>
          String(n.userId) === String(hrUser._id) ||
          (n.userId == null && (n.role === "HR_ADMIN" || n.role === "COMPANY_ADMIN"))
      )
    );

    await models.LiveTrackingSession.updateOne(
      { employeeId: empA._id, status: "ACTIVE" },
      { $set: { "lastLocation.receivedAt": new Date(Date.now() - 10_000) } }
    );

    const ret = await request(app)
      .post("/api/employees/me/tracking/update")
      .set("Cookie", cookies.a)
      .send({ location: { ...OFFICE, accuracy: 8, capturedAt: new Date().toISOString() } });
    assert.equal(ret.status, 200, JSON.stringify(ret.body));
    assert.equal(ret.body.monitor?.event, "RETURNED");

    const returns = await models.Notification.find({
      type: NOTIFICATION_TYPES.ATTENDANCE,
      "metadata.type": "RETURNED_INSIDE",
    }).lean();
    assert.ok(returns.length >= 2);

    const forB = await request(app).get("/api/notifications").set("Cookie", cookies.b);
    assert.equal(JSON.stringify(forB.body).includes("Employee A"), false);

    await ensurePunchedOut(cookies.a);
  });

  it("WFH unrestricted does not fire office-geofence outside alerts on far punch", async () => {
    await ensurePunchedOut(cookies.a);
    empA.job.workArrangement.mode = "WFH";
    empA.markModified("job");
    await empA.save();
    await models.CompanyHrPolicy.updateMany(
      {},
      { $set: { "workArrangementRules.wfhLocationMode": "WFH_UNRESTRICTED" } }
    );
    await models.Notification.deleteMany({});
    await models.LocationException.deleteMany({});

    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.a)
      .send({
        location: { ...FAR, accuracy: 8, capturedAt: new Date().toISOString() },
        sessionType: "REMOTE",
      });
    assert.equal(punch.status, 200, JSON.stringify(punch.body));

    const outsideNotes = await models.Notification.find({
      type: NOTIFICATION_TYPES.ATTENDANCE,
      title: /outside permitted/i,
    }).lean();
    assert.equal(outsideNotes.length, 0);

    empA.job.workArrangement.mode = "OFFICE";
    empA.markModified("job");
    await empA.save();
    await ensurePunchedOut(cookies.a);
  });
});
