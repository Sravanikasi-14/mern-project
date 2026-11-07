process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
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
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { signAuthToken } from "../utils/token.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let mongo;
let app;
let acme;
let globex;
let ada;
let ben;
let cara;
let drew;
let inactiveEmployeeUser;
let adaCookie;
let benCookie;
let caraCookie;
let drewCookie;
let hrCookie;
let globexCookie;
let inactiveCookie;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

async function login(companyCode, email, password) {
  const response = await request(app).post("/api/auth/login").send({ companyCode, email, password });
  assert.equal(response.status, 200, response.body?.message || "login failed");
  return cookieFrom(response);
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme Groups",
    slug: "acme-groups",
    databaseName: "company_acme_groups",
    status: COMPANY_STATUSES.ACTIVE,
  });
  globex = await Company.create({
    companyName: "Globex Groups",
    slug: "globex-groups",
    databaseName: "company_globex_groups",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const password = await hashPassword("ChatPass123!");
  const { User, Employee } = await getCompanyModels(acme);
  await User.create({
    email: "admin@acme-groups.test",
    passwordHash: password,
    role: USER_ROLES.COMPANY_ADMIN,
    fullName: "Casey Admin",
    isActive: true,
  });
  ada = await User.create({
    email: "ada@acme-groups.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Ada Stone",
    isActive: true,
  });
  ben = await User.create({
    email: "ben@acme-groups.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Ben Cole",
    isActive: true,
  });
  cara = await User.create({
    email: "cara@acme-groups.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Cara Diaz",
    isActive: true,
  });
  drew = await User.create({
    email: "drew@acme-groups.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Drew Ellis",
    isActive: true,
  });
  await User.create({
    email: "hr@acme-groups.test",
    passwordHash: password,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Harper Reid",
    isActive: true,
  });
  const inactive = await User.create({
    email: "inactive@acme-groups.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Inactive User",
    isActive: true,
  });
  inactiveEmployeeUser = await User.create({
    email: "former@acme-groups.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Former Employee",
    isActive: true,
  });
  await User.create({
    email: "candidate@acme-groups.test",
    role: USER_ROLES.CANDIDATE,
    fullName: "Candidate User",
    isActive: true,
  });
  const former = await Employee.create({
    employeeCode: "OLD-1",
    fullName: "Former Employee",
    email: "former@acme-groups.test",
    userId: inactiveEmployeeUser._id,
    status: EMPLOYEE_STATUSES.INACTIVE,
    job: { jobTitle: "Analyst", department: "Finance", joiningDate: new Date("2024-01-01") },
  });
  inactiveEmployeeUser.employeeId = former._id;
  await inactiveEmployeeUser.save();

  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "gia@globex-groups.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Gia North",
    isActive: true,
  });

  adaCookie = await login("acme-groups", "ada@acme-groups.test", "ChatPass123!");
  benCookie = await login("acme-groups", "ben@acme-groups.test", "ChatPass123!");
  caraCookie = await login("acme-groups", "cara@acme-groups.test", "ChatPass123!");
  drewCookie = await login("acme-groups", "drew@acme-groups.test", "ChatPass123!");
  hrCookie = await login("acme-groups", "hr@acme-groups.test", "ChatPass123!");
  globexCookie = await login("globex-groups", "gia@globex-groups.test", "ChatPass123!");
  inactiveCookie = await login("acme-groups", "inactive@acme-groups.test", "ChatPass123!");
  await User.updateOne({ _id: inactive._id }, { $set: { isActive: false } });
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("group conversations", () => {
  it("creates one group, stores an image, and blocks non-admins and outsiders", async () => {
    const missingName = await request(app).post("/api/conversations/groups").set("Cookie", adaCookie).send({ memberUserIds: [String(ben._id)] });
    assert.equal(missingName.status, 400);
    const onlySelf = await request(app).post("/api/conversations/groups").set("Cookie", adaCookie).send({ name: "Solo", memberUserIds: [String(ada._id)] });
    assert.equal(onlySelf.status, 400);

    const created = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", adaCookie)
      .send({
        name: "Platform",
        description: "Ship the release",
        memberUserIds: [String(ben._id), String(ben._id)],
        companyId: String(globex._id),
        image: { fileName: "dot.png", mimeType: "image/png", fileData: PNG },
      });
    assert.equal(created.status, 201);
    const groupId = created.body.conversation.id;
    assert.equal(created.body.conversation.type, "GROUP");
    assert.equal(created.body.conversation.name, "Platform");
    assert.equal(created.body.conversation.memberCount, 2);
    assert.equal(created.body.conversation.isAdmin, true);
    assert.equal(created.body.conversation.hasImage, true);

    const { Conversation: GlobexConversation } = await getCompanyModels(globex);
    assert.equal(await GlobexConversation.countDocuments({}), 0);

    const image = await request(app).get(`/api/conversations/${groupId}/image`).set("Cookie", benCookie);
    assert.equal(image.status, 200);
    assert.match(String(image.headers["content-type"]), /image\/png/);
    const hiddenImage = await request(app).get(`/api/conversations/${groupId}/image`).set("Cookie", drewCookie);
    assert.equal(hiddenImage.status, 404);

    const again = await request(app)
      .post(`/api/conversations/${groupId}/members`)
      .set("Cookie", adaCookie)
      .send({ userIds: [String(ben._id)] });
    assert.equal(again.status, 409);

    const outsider = await request(app).get(`/api/conversations/${groupId}`).set("Cookie", drewCookie);
    assert.equal(outsider.status, 404);
    assert.equal((await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", drewCookie)).status, 404);
    assert.equal((await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", drewCookie).send({ body: "Nope" })).status, 404);
    assert.equal((await request(app).patch(`/api/conversations/${groupId}`).set("Cookie", drewCookie).send({ name: "Hijack" })).status, 404);
    assert.equal((await request(app).post(`/api/conversations/${groupId}/members`).set("Cookie", drewCookie).send({ userIds: [String(cara._id)] })).status, 404);

    const memberEdit = await request(app).patch(`/api/conversations/${groupId}`).set("Cookie", benCookie).send({ name: "Renamed" });
    assert.equal(memberEdit.status, 403);
    const memberAdd = await request(app).post(`/api/conversations/${groupId}/members`).set("Cookie", benCookie).send({ userIds: [String(cara._id)] });
    assert.equal(memberAdd.status, 403);
    const memberRemove = await request(app).delete(`/api/conversations/${groupId}/members/${ada._id}`).set("Cookie", benCookie);
    assert.equal(memberRemove.status, 403);

    const renamed = await request(app).patch(`/api/conversations/${groupId}`).set("Cookie", adaCookie).send({ name: "Platform team", description: "Weekly" });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.conversation.name, "Platform team");

    const hrGroup = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", hrCookie)
      .send({ name: "HR desk", memberUserIds: [String(ada._id)] });
    assert.equal(hrGroup.status, 201);
    assert.equal(hrGroup.body.conversation.isAdmin, true);
  });

  it("promotes, demotes, transfers, and keeps the group when another admin remains", async () => {
    const created = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", adaCookie)
      .send({ name: "Design", memberUserIds: [String(ben._id), String(cara._id)] });
    const groupId = created.body.conversation.id;

    const promoted = await request(app).post(`/api/conversations/${groupId}/admins`).set("Cookie", adaCookie).send({ userId: String(ben._id) });
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.conversation.isAdmin, true);
    const benView = await request(app).get(`/api/conversations/${groupId}`).set("Cookie", benCookie);
    assert.equal(benView.body.conversation.isAdmin, true);
    const benEdit = await request(app).patch(`/api/conversations/${groupId}`).set("Cookie", benCookie).send({ description: "Shared" });
    assert.equal(benEdit.status, 200);

    const demoted = await request(app).delete(`/api/conversations/${groupId}/admins/${ben._id}`).set("Cookie", adaCookie);
    assert.equal(demoted.status, 200);
    assert.equal((await request(app).get(`/api/conversations/${groupId}`).set("Cookie", benCookie)).body.conversation.isAdmin, false);

    const lastAdmin = await request(app).delete(`/api/conversations/${groupId}/admins/${ada._id}`).set("Cookie", adaCookie);
    assert.equal(lastAdmin.status, 400);

    const blocked = await request(app).post(`/api/conversations/${groupId}/admins`).set("Cookie", benCookie).send({ userId: String(cara._id) });
    assert.equal(blocked.status, 403);

    const transferred = await request(app)
      .post(`/api/conversations/${groupId}/admins/transfer`)
      .set("Cookie", adaCookie)
      .send({ userId: String(cara._id) });
    assert.equal(transferred.status, 200);
    assert.equal(transferred.body.conversation.isAdmin, false);
    assert.equal((await request(app).get(`/api/conversations/${groupId}`).set("Cookie", caraCookie)).body.conversation.isAdmin, true);

    const adaLeaves = await request(app).post(`/api/conversations/${groupId}/leave`).set("Cookie", adaCookie);
    assert.equal(adaLeaves.status, 200);
    assert.equal(adaLeaves.body.transferredTo, null);
    assert.equal((await request(app).get(`/api/conversations/${groupId}`).set("Cookie", adaCookie)).status, 404);
    assert.equal((await request(app).get(`/api/conversations/${groupId}`).set("Cookie", caraCookie)).body.conversation.isAdmin, true);
    const members = await request(app).get(`/api/conversations/${groupId}/members`).set("Cookie", caraCookie);
    assert.equal(members.status, 200);
    assert.equal(members.body.members.some((member) => member.userId === String(ada._id)), false);
    assert.equal(members.body.members.find((member) => member.userId === String(cara._id)).isAdmin, true);
  });

  it("hides messages from before a member joins and after they leave", async () => {
    const created = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", benCookie)
      .send({ name: "Launch", memberUserIds: [String(cara._id)] });
    const groupId = created.body.conversation.id;
    const earlier = await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", benCookie).send({ body: "Earlier plan" });
    assert.equal(earlier.status, 201);

    const added = await request(app).post(`/api/conversations/${groupId}/members`).set("Cookie", benCookie).send({ userIds: [String(drew._id)] });
    assert.equal(added.status, 200);
    const hidden = await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", drewCookie);
    assert.equal(hidden.status, 200);
    assert.deepEqual(hidden.body.messages.map((message) => message.body), []);
    assert.equal((await request(app).get("/api/conversations/unread-count").set("Cookie", drewCookie)).body.unreadCount, 0);

    const after = await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", benCookie).send({ body: "After join" });
    assert.equal(after.status, 201);
    const drewMessages = await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", drewCookie);
    assert.deepEqual(drewMessages.body.messages.map((message) => message.body), ["After join"]);
    const caraMessages = await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", caraCookie);
    assert.deepEqual(caraMessages.body.messages.map((message) => message.body), ["Earlier plan", "After join"]);
    assert.equal((await request(app).get("/api/conversations/unread-count").set("Cookie", drewCookie)).body.unreadCount, 1);
    assert.equal((await request(app).get("/api/conversations/unread-count").set("Cookie", caraCookie)).body.unreadCount, 2);
    assert.equal((await request(app).get("/api/conversations/unread-count").set("Cookie", benCookie)).body.unreadCount, 0);

    const caraRead = await request(app).post(`/api/conversations/${groupId}/read`).set("Cookie", caraCookie);
    assert.equal(caraRead.status, 200);
    assert.equal((await request(app).get("/api/conversations/unread-count").set("Cookie", caraCookie)).body.unreadCount, 0);
    assert.equal((await request(app).get("/api/conversations/unread-count").set("Cookie", drewCookie)).body.unreadCount, 1);

    const removed = await request(app).delete(`/api/conversations/${groupId}/members/${drew._id}`).set("Cookie", benCookie);
    assert.equal(removed.status, 200);
    assert.equal((await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", drewCookie)).status, 404);
    assert.equal((await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", drewCookie).send({ body: "Still here" })).status, 404);
    assert.equal((await request(app).get("/api/conversations/unread-count").set("Cookie", drewCookie)).body.unreadCount, 0);
    const stillThere = await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", caraCookie);
    assert.equal(stillThere.body.messages.length, 2);

    await request(app).post(`/api/conversations/${groupId}/members`).set("Cookie", benCookie).send({ userIds: [String(drew._id)] });
    const rejoined = await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", drewCookie);
    assert.deepEqual(rejoined.body.messages.map((message) => message.body), []);
    await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", benCookie).send({ body: "Second visit" });
    const second = await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", drewCookie);
    assert.deepEqual(second.body.messages.map((message) => message.body), ["Second visit"]);

    const { Notification } = await getCompanyModels(acme);
    const addedNotes = await Notification.find({
      userId: cara._id,
      type: NOTIFICATION_TYPES.MESSAGE,
      "metadata.conversationId": groupId,
      "metadata.event": "added",
    });
    const messageNotes = await Notification.find({
      userId: cara._id,
      type: NOTIFICATION_TYPES.MESSAGE,
      "metadata.conversationId": groupId,
      "metadata.event": "message",
    });
    assert.equal(addedNotes.length, 1);
    assert.equal(messageNotes.length, 2);
    assert.equal(messageNotes.some((note) => note.message.includes("Second visit")), true);
    assert.equal(messageNotes.some((note) => note.message.includes("After join")), true);

    const listed = await request(app).get("/api/conversations").set("Cookie", caraCookie);
    const row = listed.body.conversations.find((item) => item.id === groupId);
    assert.equal(row.type, "GROUP");
    assert.equal(row.name, "Launch");
    assert.equal(row.preview, "Second visit");
    assert.ok(row.memberCount >= 3);
  });

  it("transfers the last admin, rejects candidates and inactive users, and keeps direct messages", async () => {
    const created = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", caraCookie)
      .send({ name: "Handoff", memberUserIds: [String(drew._id), String(ben._id)], companyId: "client-supplied" });
    const groupId = created.body.conversation.id;
    const left = await request(app).post(`/api/conversations/${groupId}/leave`).set("Cookie", caraCookie);
    assert.equal(left.status, 200);
    assert.equal(left.body.transferredTo, String(drew._id));
    const drewView = await request(app).get(`/api/conversations/${groupId}`).set("Cookie", drewCookie);
    assert.equal(drewView.body.conversation.isAdmin, true);
    assert.equal((await request(app).get(`/api/conversations/${groupId}`).set("Cookie", caraCookie)).status, 404);
    assert.equal((await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", globexCookie)).status, 404);

    const { User } = await getCompanyModels(acme);
    const candidate = await User.findOne({ email: "candidate@acme-groups.test" });
    const candidateToken = signAuthToken({ userId: candidate._id, companyId: acme._id });
    const candidateResponse = await request(app)
      .post("/api/conversations/groups")
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({ name: "Nope", memberUserIds: [String(ada._id)] });
    assert.equal(candidateResponse.status, 401);
    assert.equal((await request(app).get("/api/conversations").set("Cookie", inactiveCookie)).status, 401);

    const addInactive = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", adaCookie)
      .send({ name: "Closed", memberUserIds: [String(inactiveEmployeeUser._id)] });
    assert.equal(addInactive.status, 400);
    const addCandidate = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", adaCookie)
      .send({ name: "Closed", memberUserIds: [String(candidate._id)] });
    assert.equal(addCandidate.status, 404);
    const crossCreate = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", globexCookie)
      .send({ name: "Cross", memberUserIds: [String(ada._id)], companyId: String(acme._id) });
    assert.equal(crossCreate.status, 404);
    const { Conversation: GlobexConversation } = await getCompanyModels(globex);
    assert.equal(await GlobexConversation.countDocuments({}), 0);

    const direct = await request(app).post("/api/conversations").set("Cookie", adaCookie).send({ participantUserId: String(ben._id) });
    assert.equal(direct.status, 200);
    assert.equal(direct.body.conversation.type, "DIRECT");
    const reopened = await request(app).post("/api/conversations").set("Cookie", benCookie).send({ participantUserId: String(ada._id) });
    assert.equal(reopened.body.conversation.id, direct.body.conversation.id);
    const sent = await request(app).post(`/api/conversations/${direct.body.conversation.id}/messages`).set("Cookie", adaCookie).send({ body: "Still direct" });
    assert.equal(sent.status, 201);
    const history = await request(app).get(`/api/conversations/${direct.body.conversation.id}/messages`).set("Cookie", benCookie);
    assert.equal(history.body.messages.at(-1).body, "Still direct");
    const groupOnDirect = await request(app).post(`/api/conversations/${direct.body.conversation.id}/members`).set("Cookie", adaCookie).send({ userIds: [String(cara._id)] });
    assert.equal(groupOnDirect.status, 400);
  });
});
