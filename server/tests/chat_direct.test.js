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

let mongo;
let app;
let acme;
let globex;
let ada;
let ben;
let cara;
let adminUser;
let adaCookie;
let benCookie;
let caraCookie;
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
    companyName: "Acme Chat",
    slug: "acme-chat",
    databaseName: "company_acme_chat",
    status: COMPANY_STATUSES.ACTIVE,
  });
  globex = await Company.create({
    companyName: "Globex Chat",
    slug: "globex-chat",
    databaseName: "company_globex_chat",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const password = await hashPassword("ChatPass123!");
  const { User, Employee } = await getCompanyModels(acme);
  adminUser = await User.create({
    email: "admin@acme-chat.test",
    passwordHash: password,
    role: USER_ROLES.COMPANY_ADMIN,
    fullName: "Casey Admin",
    isActive: true,
  });
  ada = await User.create({
    email: "ada@acme-chat.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Ada Stone",
    isActive: true,
  });
  ben = await User.create({
    email: "ben@acme-chat.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Ben Cole",
    isActive: true,
  });
  cara = await User.create({
    email: "cara@acme-chat.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Cara Diaz",
    isActive: true,
  });
  const inactive = await User.create({
    email: "inactive@acme-chat.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Inactive User",
    isActive: true,
  });
  await User.create({
    email: "candidate@acme-chat.test",
    role: USER_ROLES.CANDIDATE,
    fullName: "Candidate User",
    isActive: true,
  });

  const adaEmp = await Employee.create({
    employeeCode: "ADA-1",
    fullName: "Ada Stone",
    email: "ada@acme-chat.test",
    userId: ada._id,
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Designer", department: "Engineering", joiningDate: new Date("2024-01-01") },
  });
  const benEmp = await Employee.create({
    employeeCode: "BEN-1",
    fullName: "Ben Cole",
    email: "ben@acme-chat.test",
    userId: ben._id,
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Analyst", department: "Finance", joiningDate: new Date("2024-01-01") },
  });
  ada.employeeId = adaEmp._id;
  ben.employeeId = benEmp._id;
  await ada.save();
  await ben.save();

  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "gia@globex-chat.test",
    passwordHash: password,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Gia North",
    isActive: true,
  });

  adaCookie = await login("acme-chat", "ada@acme-chat.test", "ChatPass123!");
  benCookie = await login("acme-chat", "ben@acme-chat.test", "ChatPass123!");
  caraCookie = await login("acme-chat", "cara@acme-chat.test", "ChatPass123!");
  globexCookie = await login("globex-chat", "gia@globex-chat.test", "ChatPass123!");
  inactiveCookie = await login("acme-chat", "inactive@acme-chat.test", "ChatPass123!");
  await User.updateOne({ _id: inactive._id }, { $set: { isActive: false } });
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("direct messages", () => {
  it("lists only active portal colleagues and searches by job details", async () => {
    const response = await request(app)
      .get("/api/conversations/directory")
      .query({ search: "Engineering" })
      .set("Cookie", benCookie);
    assert.equal(response.status, 200);
    assert.equal(response.body.people.length, 1);
    assert.equal(response.body.people[0].displayName, "Ada Stone");
    const self = await request(app).get("/api/conversations/directory").set("Cookie", adaCookie);
    assert.equal(self.body.people.some((person) => person.userId === String(ada._id)), false);
    assert.equal(self.body.people.some((person) => person.displayName === "Casey Admin"), true);
    assert.equal(self.body.people.some((person) => person.displayName === "Inactive User"), false);
    assert.equal(self.body.people.some((person) => person.displayName === "Candidate User"), false);
    const card = self.body.people.find((person) => person.userId === String(ben._id));
    assert.equal(card.employeeCode, "BEN-1");
    assert.equal(card.jobTitle, "Analyst");
    assert.equal(Object.hasOwn(card, "phoneNumber"), false);
    assert.equal(Object.hasOwn(card, "email"), false);
    assert.equal(Object.hasOwn(card, "documents"), false);
  });

  it("opens one direct conversation for a pair and ignores a client company id", async () => {
    const first = await request(app)
      .post("/api/conversations")
      .set("Cookie", adaCookie)
      .send({ participantUserId: String(ben._id), companyId: String(globex._id) });
    assert.equal(first.status, 200);
    const second = await request(app)
      .post("/api/conversations")
      .set("Cookie", benCookie)
      .send({ participantUserId: String(ada._id), companyId: "other-company" });
    assert.equal(second.status, 200);
    assert.equal(second.body.conversation.id, first.body.conversation.id);

    const { Conversation: AcmeConversation } = await getCompanyModels(acme);
    const { Conversation: GlobexConversation } = await getCompanyModels(globex);
    assert.equal(await AcmeConversation.countDocuments({ directKey: { $exists: true } }), 1);
    assert.equal(await GlobexConversation.countDocuments({}), 0);

    const self = await request(app)
      .post("/api/conversations")
      .set("Cookie", adaCookie)
      .send({ participantUserId: String(ada._id) });
    assert.equal(self.status, 400);
  });

  it("sends, pages, and marks messages read without duplicate notifications", async () => {
    const opened = await request(app)
      .post("/api/conversations")
      .set("Cookie", adaCookie)
      .send({ participantUserId: String(ben._id) });
    const conversationId = opened.body.conversation.id;

    for (let index = 1; index <= 45; index += 1) {
      const sent = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Cookie", adaCookie)
        .send({ body: `Note ${index}` });
      assert.equal(sent.status, 201);
    }

    const latest = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", benCookie);
    assert.equal(latest.status, 200);
    assert.equal(latest.body.messages.length, 40);
    assert.equal(latest.body.hasMore, true);
    assert.equal(latest.body.messages[0].body, "Note 6");
    assert.equal(latest.body.messages[39].body, "Note 45");
    assert.ok(new Date(latest.body.messages[0].createdAt) <= new Date(latest.body.messages[39].createdAt));

    const earlier = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .query({ before: latest.body.messages[0].id })
      .set("Cookie", benCookie);
    assert.equal(earlier.status, 200);
    assert.equal(earlier.body.messages.length, 5);
    assert.equal(earlier.body.messages[0].body, "Note 1");
    assert.equal(earlier.body.hasMore, false);

    const beforeRead = await request(app).get("/api/conversations/unread-count").set("Cookie", benCookie);
    assert.equal(beforeRead.body.unreadCount, 45);
    const senderUnread = await request(app).get("/api/conversations/unread-count").set("Cookie", adaCookie);
    assert.equal(senderUnread.body.unreadCount, 0);

    const read = await request(app).post(`/api/conversations/${conversationId}/read`).set("Cookie", benCookie);
    assert.equal(read.status, 200);
    const afterRead = await request(app).get("/api/conversations/unread-count").set("Cookie", benCookie);
    assert.equal(afterRead.body.unreadCount, 0);

    const { Notification } = await getCompanyModels(acme);
    const notes = await Notification.find({
      userId: ben._id,
      type: NOTIFICATION_TYPES.MESSAGE,
      "metadata.conversationId": conversationId,
    });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].message.includes("Note 45"), true);

    const empty = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", adaCookie)
      .send({ body: "   " });
    assert.equal(empty.status, 400);
  });

  it("blocks non-members, candidates, inactive users, and other companies", async () => {
    const opened = await request(app)
      .post("/api/conversations")
      .set("Cookie", adaCookie)
      .send({ participantUserId: String(adminUser._id) });
    const conversationId = opened.body.conversation.id;

    const outsiderRead = await request(app)
      .get(`/api/conversations/${conversationId}`)
      .set("Cookie", caraCookie);
    assert.equal(outsiderRead.status, 404);
    const outsiderMessages = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", caraCookie);
    assert.equal(outsiderMessages.status, 404);
    const outsiderSend = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", caraCookie)
      .send({ body: "Hello" });
    assert.equal(outsiderSend.status, 404);
    const outsiderCursor = await request(app)
      .post(`/api/conversations/${conversationId}/read`)
      .set("Cookie", caraCookie);
    assert.equal(outsiderCursor.status, 404);

    const { User } = await getCompanyModels(acme);
    const candidate = await User.findOne({ email: "candidate@acme-chat.test" });
    const candidateToken = signAuthToken({ userId: candidate._id, companyId: acme._id });
    const candidateResponse = await request(app)
      .get("/api/conversations")
      .set("Authorization", `Bearer ${candidateToken}`);
    assert.equal(candidateResponse.status, 401);

    const inactiveResponse = await request(app)
      .get("/api/conversations")
      .set("Cookie", inactiveCookie);
    assert.equal(inactiveResponse.status, 401);

    const cross = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", globexCookie);
    assert.equal(cross.status, 404);
    const crossSend = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", globexCookie)
      .send({ body: "From another company", companyId: String(acme._id) });
    assert.equal(crossSend.status, 404);

    const { Message: GlobexMessage } = await getCompanyModels(globex);
    assert.equal(await GlobexMessage.countDocuments({}), 0);
  });
});
