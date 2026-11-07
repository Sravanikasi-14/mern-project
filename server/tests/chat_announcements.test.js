process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.ANNOUNCEMENT_CRON_SECRET = "announcement-cron-test-secret";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import { USER_ROLES } from "../models/User.js";
import { HR_PERMISSION_KEYS } from "../constants/hrAccessCatalog.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { signAuthToken } from "../utils/token.js";

let mongo;
let app;
let acme;
let globex;
let ada;
let ben;
let engineering;
let finance;
let adaCookie;
let benCookie;
let harperCookie;
let indigoCookie;
let noahCookie;
let adminCookie;
let globexCookie;
let inactiveCookie;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

async function login(companyCode, email) {
  const response = await request(app).post("/api/auth/login").send({ companyCode, email, password: "ChatPass123!" });
  assert.equal(response.status, 200, response.body?.message || "login failed");
  return cookieFrom(response);
}

function hrAccess(permissions, scope) {
  return {
    version: 1,
    configuredAt: new Date(),
    updatedAt: new Date(),
    permissions,
    employeeScope: scope,
  };
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme Announcements",
    slug: "acme-announcements",
    databaseName: "company_acme_announcements",
    status: COMPANY_STATUSES.ACTIVE,
    config: { hrAccessEnforcement: { mode: "ENFORCED" } },
  });
  globex = await Company.create({
    companyName: "Globex Announcements",
    slug: "globex-announcements",
    databaseName: "company_globex_announcements",
    status: COMPANY_STATUSES.ACTIVE,
    config: { hrAccessEnforcement: { mode: "ENFORCED" } },
  });

  const password = await hashPassword("ChatPass123!");
  const { User, Employee, Department } = await getCompanyModels(acme);
  engineering = await Department.create({ name: "Engineering" });
  finance = await Department.create({ name: "Finance" });
  await User.create({
    email: "admin@acme-announcements.test",
    passwordHash: password,
    role: USER_ROLES.COMPANY_ADMIN,
    fullName: "Casey Admin",
    isActive: true,
  });
  ada = await User.create({
    email: "ada@acme-announcements.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Ada Stone",
    isActive: true,
  });
  ben = await User.create({
    email: "ben@acme-announcements.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Ben Cole",
    isActive: true,
  });
  const adaEmp = await Employee.create({
    employeeCode: "ADA-1",
    fullName: "Ada Stone",
    email: "ada@acme-announcements.test",
    userId: ada._id,
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Designer", department: "Engineering", departmentId: engineering._id, joiningDate: new Date("2024-01-01") },
  });
  const benEmp = await Employee.create({
    employeeCode: "BEN-1",
    fullName: "Ben Cole",
    email: "ben@acme-announcements.test",
    userId: ben._id,
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Analyst", department: "Finance", departmentId: finance._id, joiningDate: new Date("2024-01-01") },
  });
  ada.employeeId = adaEmp._id;
  ben.employeeId = benEmp._id;
  await ada.save();
  await ben.save();
  await User.create({
    email: "harper@acme-announcements.test",
    passwordHash: password,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Harper Reid",
    isActive: true,
    hrAccess: hrAccess(["announcements.publish"], { mode: "COMPANY", departmentIds: [], employeeIds: [] }),
  });
  await User.create({
    email: "indigo@acme-announcements.test",
    passwordHash: password,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Indigo Scope",
    isActive: true,
    hrAccess: hrAccess(["announcements.publish"], { mode: "CUSTOM", departmentIds: [engineering._id], employeeIds: [] }),
  });
  await User.create({
    email: "noah@acme-announcements.test",
    passwordHash: password,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Noah Limited",
    isActive: true,
    hrAccess: hrAccess(["people.view"], { mode: "COMPANY", departmentIds: [], employeeIds: [] }),
  });
  const inactive = await User.create({
    email: "inactive@acme-announcements.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Inactive User",
    isActive: true,
  });
  const formerUser = await User.create({
    email: "former@acme-announcements.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Former Employee",
    isActive: true,
  });
  const former = await Employee.create({
    employeeCode: "OLD-1",
    fullName: "Former Employee",
    email: "former@acme-announcements.test",
    userId: formerUser._id,
    status: EMPLOYEE_STATUSES.INACTIVE,
    job: { jobTitle: "Analyst", department: "Finance", departmentId: finance._id, joiningDate: new Date("2024-01-01") },
  });
  formerUser.employeeId = former._id;
  await formerUser.save();
  await User.create({
    email: "candidate@acme-announcements.test",
    role: USER_ROLES.CANDIDATE,
    fullName: "Candidate User",
    isActive: true,
  });
  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "gia@globex-announcements.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Gia North",
    isActive: true,
  });

  adminCookie = await login("acme-announcements", "admin@acme-announcements.test");
  adaCookie = await login("acme-announcements", "ada@acme-announcements.test");
  benCookie = await login("acme-announcements", "ben@acme-announcements.test");
  harperCookie = await login("acme-announcements", "harper@acme-announcements.test");
  indigoCookie = await login("acme-announcements", "indigo@acme-announcements.test");
  noahCookie = await login("acme-announcements", "noah@acme-announcements.test");
  globexCookie = await login("globex-announcements", "gia@globex-announcements.test");
  inactiveCookie = await login("acme-announcements", "inactive@acme-announcements.test");
  await User.updateOne({ _id: inactive._id }, { $set: { isActive: false } });
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("announcements", () => {
  it("lets company and scoped HR publish, and blocks everyone else", async () => {
    const companyWide = await request(app)
      .post("/api/announcements")
      .set("Cookie", adminCookie)
      .send({
        title: "Office closed Friday",
        body: "The office is closed this Friday.",
        priority: "IMPORTANT",
        audience: "COMPANY",
        publish: true,
        companyId: String(globex._id),
      });
    assert.equal(companyWide.status, 201);
    assert.equal(companyWide.body.announcement.audience, "COMPANY");
    assert.equal(companyWide.body.announcement.status, "PUBLISHED");
    const companyId = companyWide.body.announcement.id;

    const departmental = await request(app)
      .post("/api/announcements")
      .set("Cookie", harperCookie)
      .send({
        title: "Engineering standup",
        body: "Standup moves to 10.",
        priority: "NORMAL",
        audience: "DEPARTMENTS",
        departmentIds: [String(engineering._id)],
        publish: true,
      });
    assert.equal(departmental.status, 201);
    assert.equal(departmental.body.announcement.departmentNames.includes("Engineering"), true);

    const scoped = await request(app)
      .post("/api/announcements")
      .set("Cookie", indigoCookie)
      .send({
        title: "Design review",
        body: "Bring the latest screens.",
        audience: "DEPARTMENTS",
        departmentIds: [String(engineering._id)],
        publish: true,
      });
    assert.equal(scoped.status, 201);
    const companyDenied = await request(app)
      .post("/api/announcements")
      .set("Cookie", indigoCookie)
      .send({ title: "Everyone", body: "No", audience: "COMPANY", publish: true });
    assert.equal(companyDenied.status, 403);
    const otherDepartment = await request(app)
      .post("/api/announcements")
      .set("Cookie", indigoCookie)
      .send({
        title: "Finance only",
        body: "No",
        audience: "DEPARTMENTS",
        departmentIds: [String(finance._id)],
        publish: true,
      });
    assert.equal(otherDepartment.status, 403);

    const missingPermission = await request(app)
      .post("/api/announcements")
      .set("Cookie", noahCookie)
      .send({ title: "Nope", body: "Nope", audience: "COMPANY", publish: true });
    assert.equal(missingPermission.status, 403);
    const employee = await request(app)
      .post("/api/announcements")
      .set("Cookie", adaCookie)
      .send({ title: "Nope", body: "Nope", audience: "COMPANY", publish: true });
    assert.equal(employee.status, 403);

    const adaList = await request(app).get("/api/announcements").set("Cookie", adaCookie);
    assert.equal(adaList.body.access.canPublish, false);
    assert.equal(adaList.body.announcements.some((item) => item.id === companyId), true);
    assert.equal(adaList.body.announcements.some((item) => item.title === "Engineering standup"), true);
    const benList = await request(app).get("/api/announcements").set("Cookie", benCookie);
    assert.equal(benList.body.announcements.some((item) => item.title === "Engineering standup"), false);
    assert.equal(benList.body.announcements.some((item) => item.id === companyId), true);

    const invalidDepartment = await request(app)
      .post("/api/announcements")
      .set("Cookie", adminCookie)
      .send({
        title: "Missing",
        body: "Missing",
        audience: "DEPARTMENTS",
        departmentIds: [new mongoose.Types.ObjectId().toString()],
        publish: true,
      });
    assert.equal(invalidDepartment.status, 400);

    const editDenied = await request(app)
      .patch(`/api/announcements/${companyId}`)
      .set("Cookie", adaCookie)
      .send({ title: "Changed" });
    assert.equal(editDenied.status, 403);
    const withdrawDenied = await request(app)
      .post(`/api/announcements/${companyId}/withdraw`)
      .set("Cookie", noahCookie);
    assert.equal(withdrawDenied.status, 403);

    const { User } = await getCompanyModels(acme);
    const candidate = await User.findOne({ email: "candidate@acme-announcements.test" });
    const candidateToken = signAuthToken({ userId: candidate._id, companyId: acme._id });
    assert.equal((await request(app).get("/api/announcements").set("Authorization", `Bearer ${candidateToken}`)).status, 401);
    assert.equal((await request(app).get("/api/announcements").set("Cookie", inactiveCookie)).status, 401);
    assert.equal((await request(app).get(`/api/announcements/${companyId}`).set("Cookie", globexCookie)).status, 404);
    const { Announcement: GlobexAnnouncement } = await getCompanyModels(globex);
    assert.equal(await GlobexAnnouncement.countDocuments({}), 0);

    const reads = await request(app).get(`/api/announcements/${companyId}/read-status`).set("Cookie", harperCookie);
    assert.equal(reads.status, 200);
    assert.ok(reads.body.audienceSize >= 3);
    assert.equal(reads.body.people.some((person) => person.displayName === "Candidate User"), false);
    assert.equal(reads.body.people.some((person) => person.displayName === "Inactive User"), false);
    assert.equal(reads.body.people.some((person) => person.displayName === "Former Employee"), false);
    assert.equal((await request(app).get(`/api/announcements/${departmental.body.announcement.id}/read-status`).set("Cookie", adaCookie)).status, 403);
    const engineeringReads = await request(app)
      .get(`/api/announcements/${departmental.body.announcement.id}/read-status`)
      .set("Cookie", adminCookie);
    assert.equal(engineeringReads.body.audienceSize, 1);
    assert.equal(engineeringReads.body.people[0].displayName, "Ada Stone");
    assert.equal(engineeringReads.body.percentage, 0);
  });

  it("hides scheduled announcements until a single idempotent publication", async () => {
    const scheduledFor = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const created = await request(app)
      .post("/api/announcements")
      .set("Cookie", harperCookie)
      .send({
        title: "Monday briefing",
        body: "The briefing is at 9.",
        priority: "URGENT",
        audience: "COMPANY",
        publish: true,
        scheduledAt: scheduledFor,
      });
    assert.equal(created.status, 201);
    assert.equal(created.body.announcement.status, "SCHEDULED");
    const announcementId = created.body.announcement.id;

    const hiddenList = await request(app).get("/api/announcements").set("Cookie", adaCookie);
    assert.equal(hiddenList.body.announcements.some((item) => item.id === announcementId), false);
    assert.equal((await request(app).get(`/api/announcements/${announcementId}`).set("Cookie", adaCookie)).status, 404);
    const { Notification, Announcement } = await getCompanyModels(acme);
    assert.equal(await Notification.countDocuments({ type: NOTIFICATION_TYPES.ANNOUNCEMENT, "metadata.announcementId": announcementId }), 0);

    await Announcement.updateOne({ _id: announcementId }, { $set: { scheduledAt: new Date(Date.now() - 60 * 1000) } });
    const first = await request(app)
      .post("/api/announcements/publish-due")
      .set("Authorization", "Bearer announcement-cron-test-secret");
    assert.equal(first.status, 200);
    assert.ok(first.body.published >= 1);
    const second = await request(app)
      .post("/api/announcements/publish-due")
      .set("Authorization", "Bearer announcement-cron-test-secret");
    assert.equal(second.status, 200);
    assert.equal(second.body.published, 0);
    const viaGet = await request(app)
      .get("/api/announcements/publish-due")
      .set("Authorization", "Bearer announcement-cron-test-secret");
    assert.equal(viaGet.status, 200);
    assert.equal(viaGet.body.published, 0);
    const notes = await Notification.find({ type: NOTIFICATION_TYPES.ANNOUNCEMENT, "metadata.announcementId": announcementId });
    const visible = await request(app).get(`/api/announcements/${announcementId}`).set("Cookie", benCookie);
    assert.equal(visible.status, 200);
    assert.equal(visible.body.announcement.status, "PUBLISHED");
    const status = await request(app).get(`/api/announcements/${announcementId}/read-status`).set("Cookie", harperCookie);
    assert.equal(notes.length, status.body.audienceSize);
    assert.equal(notes.length, await Notification.countDocuments({ type: NOTIFICATION_TYPES.ANNOUNCEMENT, "metadata.announcementId": announcementId }));

    const unconfigured = await request(app).post("/api/announcements/publish-due");
    delete process.env.ANNOUNCEMENT_CRON_SECRET;
    delete process.env.CRON_SECRET;
    const closed = await request(app).post("/api/announcements/publish-due");
    process.env.ANNOUNCEMENT_CRON_SECRET = "announcement-cron-test-secret";
    assert.equal(unconfigured.status, 401);
    assert.equal(closed.status, 503);

    const readOnce = await request(app).post(`/api/announcements/${announcementId}/read`).set("Cookie", benCookie);
    const readTwice = await request(app).post(`/api/announcements/${announcementId}/read`).set("Cookie", benCookie);
    assert.equal(readOnce.status, 200);
    assert.equal(readTwice.status, 200);
    const { AnnouncementRead } = await getCompanyModels(acme);
    assert.equal(await AnnouncementRead.countDocuments({ announcementId, userId: ben._id }), 1);
    const afterRead = await request(app).get(`/api/announcements/${announcementId}/read-status`).set("Cookie", harperCookie);
    assert.equal(afterRead.body.readCount, 1);
    assert.equal(afterRead.body.percentage, Math.round((1 / afterRead.body.audienceSize) * 100));
    const benCard = afterRead.body.people.find((person) => person.userId === String(ben._id));
    assert.ok(benCard.readAt);
    const benNote = await Notification.findOne({
      userId: ben._id,
      type: NOTIFICATION_TYPES.ANNOUNCEMENT,
      "metadata.announcementId": announcementId,
    });
    assert.equal(benNote.isRead, true);
    assert.equal(benNote.readBy.some((id) => String(id) === String(ben._id)), true);
    const adaNote = await Notification.findOne({
      userId: ada._id,
      type: NOTIFICATION_TYPES.ANNOUNCEMENT,
      "metadata.announcementId": announcementId,
    });
    assert.equal(adaNote.isRead, false);

    const withdrawn = await request(app).post(`/api/announcements/${announcementId}/withdraw`).set("Cookie", harperCookie);
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.body.announcement.status, "WITHDRAWN");
    assert.equal((await request(app).get(`/api/announcements/${announcementId}`).set("Cookie", adaCookie)).status, 404);
    const adaFeed = await request(app).get("/api/announcements").set("Cookie", adaCookie);
    assert.equal(adaFeed.body.announcements.some((item) => item.id === announcementId), false);
    const archive = await request(app).get("/api/announcements").query({ status: "WITHDRAWN" }).set("Cookie", harperCookie);
    assert.equal(archive.body.announcements.some((item) => item.id === announcementId), true);
  });

  it("enforces publisher permission on every management route and keeps the employee feed read-only", async () => {
    assert.equal(HR_PERMISSION_KEYS.includes("announcements.publish"), true);
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const companyWide = await request(app)
      .post("/api/announcements")
      .set("Cookie", harperCookie)
      .send({
        title: "Company handbook update",
        body: "Read the updated handbook before Monday.",
        priority: "IMPORTANT",
        audience: "COMPANY",
        publish: true,
        companyId: String(globex._id),
      });
    assert.equal(companyWide.status, 201);
    assert.equal(companyWide.body.announcement.audience, "COMPANY");
    const announcementId = companyWide.body.announcement.id;

    const departmentWide = await request(app)
      .post("/api/announcements")
      .set("Cookie", harperCookie)
      .send({
        title: "Finance close",
        body: "Finance close starts Thursday.",
        audience: "DEPARTMENTS",
        departmentIds: [String(finance._id)],
        publish: true,
      });
    assert.equal(departmentWide.status, 201);

    const mixedDepartments = await request(app)
      .post("/api/announcements")
      .set("Cookie", indigoCookie)
      .send({
        title: "Both teams",
        body: "This should stay inside Engineering.",
        audience: "DEPARTMENTS",
        departmentIds: [String(engineering._id), String(finance._id)],
        publish: true,
      });
    assert.equal(mixedDepartments.status, 403);
    const omittedAudience = await request(app)
      .post("/api/announcements")
      .set("Cookie", indigoCookie)
      .send({ title: "Default company", body: "No", publish: true, departmentIds: [String(engineering._id)] });
    assert.equal(omittedAudience.status, 403);

    const draft = await request(app)
      .post("/api/announcements")
      .set("Cookie", indigoCookie)
      .send({
        title: "Engineering draft",
        body: "Still a draft.",
        audience: "DEPARTMENTS",
        departmentIds: [String(engineering._id)],
        publish: false,
      });
    assert.equal(draft.status, 201);
    const retarget = await request(app)
      .patch(`/api/announcements/${draft.body.announcement.id}`)
      .set("Cookie", indigoCookie)
      .send({ audience: "COMPANY", departmentIds: [] });
    assert.equal(retarget.status, 403);
    const otherDepartment = await request(app)
      .patch(`/api/announcements/${draft.body.announcement.id}`)
      .set("Cookie", indigoCookie)
      .send({ audience: "DEPARTMENTS", departmentIds: [String(finance._id)] });
    assert.equal(otherDepartment.status, 403);

    const { User } = await getCompanyModels(acme);
    const candidate = await User.findOne({ email: "candidate@acme-announcements.test" });
    const candidateToken = signAuthToken({ userId: candidate._id, companyId: acme._id });
    const deniedCookies = [noahCookie, adaCookie];
    for (const cookie of deniedCookies) {
      assert.equal((await request(app).post("/api/announcements").set("Cookie", cookie).send({
        title: "Blocked",
        body: "Blocked",
        audience: "COMPANY",
        publish: true,
      })).status, 403);
      assert.equal((await request(app).post("/api/announcements").set("Cookie", cookie).send({
        title: "Blocked schedule",
        body: "Blocked",
        audience: "COMPANY",
        publish: true,
        scheduledAt: future,
      })).status, 403);
      assert.equal((await request(app).patch(`/api/announcements/${announcementId}`).set("Cookie", cookie).send({ title: "Changed" })).status, 403);
      assert.equal((await request(app).post(`/api/announcements/${announcementId}/publish`).set("Cookie", cookie).send({ scheduledAt: future })).status, 403);
      assert.equal((await request(app).post(`/api/announcements/${announcementId}/withdraw`).set("Cookie", cookie)).status, 403);
      assert.equal((await request(app).get(`/api/announcements/${announcementId}/read-status`).set("Cookie", cookie)).status, 403);
    }
    for (const path of [
      ["/api/announcements", "post", { title: "Blocked", body: "Blocked", publish: true }],
      [`/api/announcements/${announcementId}`, "patch", { title: "Changed" }],
      [`/api/announcements/${announcementId}/publish`, "post", {}],
      [`/api/announcements/${announcementId}/withdraw`, "post", {}],
      [`/api/announcements/${announcementId}/read-status`, "get", null],
      ["/api/announcements", "get", null],
    ]) {
      const call = request(app)[path[1]](path[0]).set("Authorization", `Bearer ${candidateToken}`);
      const response = path[2] ? await call.send(path[2]) : await call;
      assert.equal(response.status, 401);
    }

    const adaList = await request(app).get("/api/announcements").query({ status: "DRAFT" }).set("Cookie", adaCookie);
    assert.equal(adaList.body.access.canPublish, false);
    assert.equal(adaList.body.departments.length, 0);
    const card = adaList.body.announcements.find((item) => item.id === announcementId);
    assert.ok(card);
    assert.equal(card.priority, "IMPORTANT");
    assert.equal(card.preview.includes("updated handbook"), true);
    assert.ok(card.publishedAt);
    assert.equal(card.isRead, false);
    assert.equal(adaList.body.announcements.some((item) => item.id === draft.body.announcement.id), false);
    assert.equal(adaList.body.announcements.some((item) => item.title === "Finance close"), false);
    const scheduledHidden = await request(app).get("/api/announcements").query({ status: "SCHEDULED" }).set("Cookie", adaCookie);
    assert.equal(scheduledHidden.body.announcements.every((item) => item.status === "PUBLISHED"), true);

    const opened = await request(app).get(`/api/announcements/${announcementId}`).set("Cookie", adaCookie);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.announcement.body, "Read the updated handbook before Monday.");
    const marked = await request(app).post(`/api/announcements/${announcementId}/read`).set("Cookie", adaCookie);
    assert.equal(marked.status, 200);
    const reread = await request(app).get("/api/announcements").set("Cookie", adaCookie);
    assert.equal(reread.body.announcements.find((item) => item.id === announcementId).isRead, true);
    const { Notification } = await getCompanyModels(acme);
    const adaNote = await Notification.findOne({
      userId: ada._id,
      type: NOTIFICATION_TYPES.ANNOUNCEMENT,
      "metadata.announcementId": announcementId,
    });
    assert.equal(adaNote.isRead, true);

    const adminStillPublishes = await request(app)
      .post("/api/announcements")
      .set("Cookie", adminCookie)
      .send({ title: "Admin notice", body: "From the company admin.", audience: "COMPANY", publish: true });
    assert.equal(adminStillPublishes.status, 201);
  });

  it("keeps direct messages and groups working", async () => {
    const direct = await request(app).post("/api/conversations").set("Cookie", adaCookie).send({ participantUserId: String(ben._id) });
    assert.equal(direct.status, 200);
    assert.equal(direct.body.conversation.type, "DIRECT");
    const sent = await request(app)
      .post(`/api/conversations/${direct.body.conversation.id}/messages`)
      .set("Cookie", adaCookie)
      .send({ body: "Still direct" });
    assert.equal(sent.status, 201);
    const group = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", adaCookie)
      .send({ name: "Launch notes", memberUserIds: [String(ben._id)] });
    assert.equal(group.status, 201);
    assert.equal(group.body.conversation.type, "GROUP");
    const history = await request(app).get(`/api/conversations/${direct.body.conversation.id}/messages`).set("Cookie", benCookie);
    assert.equal(history.body.messages.at(-1).body, "Still direct");
  });
});
