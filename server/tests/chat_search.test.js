process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

import assert from "node:assert/strict";
import mongoose from "mongoose";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

let mongo;
let app;
let acme;
let ada;
let ben;
let cara;
let adaCookie;
let benCookie;
let caraCookie;
let globexCookie;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

async function login(companyCode, email) {
  const response = await request(app).post("/api/auth/login").send({ companyCode, email, password: "ChatPass123!" });
  assert.equal(response.status, 200, response.body?.message || "login failed");
  return cookieFrom(response);
}

function png() {
  const buffer = Buffer.alloc(16);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return buffer;
}

async function upload(cookie, conversationId, fileName) {
  return request(app)
    .post(`/api/conversations/${conversationId}/attachments`)
    .set("Cookie", cookie)
    .send({
      fileName,
      fileData: `data:application/octet-stream;base64,${png().toString("base64")}`,
      mimeType: "application/octet-stream",
    });
}

before(async () => {
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET;
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();
  acme = await Company.create({
    companyName: "Acme Search",
    slug: "acme-search",
    databaseName: "company_acme_search",
    status: COMPANY_STATUSES.ACTIVE,
  });
  const globex = await Company.create({
    companyName: "Globex Search",
    slug: "globex-search",
    databaseName: "company_globex_search",
    status: COMPANY_STATUSES.ACTIVE,
  });
  const password = await hashPassword("ChatPass123!");
  const { User, Message } = await getCompanyModels(acme);
  await Message.createIndexes();
  ada = await User.create({ email: "ada@acme-search.test", passwordHash: password, role: USER_ROLES.EMPLOYEE, fullName: "Ada Stone", isActive: true });
  ben = await User.create({ email: "ben@acme-search.test", passwordHash: password, role: USER_ROLES.EMPLOYEE, fullName: "Ben Cole", isActive: true });
  cara = await User.create({ email: "cara@acme-search.test", passwordHash: password, role: USER_ROLES.EMPLOYEE, fullName: "Cara Diaz", isActive: true });
  await User.create({ email: "candidate@acme-search.test", passwordHash: password, role: USER_ROLES.CANDIDATE, fullName: "Candidate User", isActive: true });
  const { User: GlobexUser, Message: GlobexMessage } = await getCompanyModels(globex);
  await GlobexMessage.createIndexes();
  await GlobexUser.create({ email: "gia@globex-search.test", passwordHash: password, role: USER_ROLES.EMPLOYEE, fullName: "Gia North", isActive: true });
  adaCookie = await login("acme-search", "ada@acme-search.test");
  benCookie = await login("acme-search", "ben@acme-search.test");
  caraCookie = await login("acme-search", "cara@acme-search.test");
  globexCookie = await login("globex-search", "gia@globex-search.test");
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("message search", () => {
  it("searches direct and group text, filenames, older history, and combined filters", async () => {
    const direct = await request(app).post("/api/conversations").set("Cookie", adaCookie).send({ participantUserId: String(ben._id) });
    assert.equal(direct.status, 200);
    const directId = direct.body.conversation.id;
    const directMessage = await request(app).post(`/api/conversations/${directId}/messages`).set("Cookie", adaCookie).send({ body: "Please review the alphaoffer draft" });
    assert.equal(directMessage.status, 201);

    const group = await request(app).post("/api/conversations/groups").set("Cookie", adaCookie).send({ name: "Launch", memberUserIds: [String(ben._id)] });
    assert.equal(group.status, 201);
    const groupId = group.body.conversation.id;
    const uploaded = await upload(adaCookie, groupId, "fileoffer.png");
    assert.equal(uploaded.status, 201);
    const groupMessage = await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", adaCookie).send({
      body: "Shared groupoffer notes",
      attachmentIds: [uploaded.body.file.id],
    });
    assert.equal(groupMessage.status, 201);

    const directHit = await request(app).get("/api/conversations/search").set("Cookie", benCookie).query({ q: "alphaoffer" });
    assert.equal(directHit.status, 200);
    assert.equal(directHit.body.results.length, 1);
    assert.equal(directHit.body.results[0].conversationType, "DIRECT");
    assert.match(directHit.body.results[0].preview, /alphaoffer/);
    assert.match(directHit.body.results[0].senderName, /Ada/);
    assert.equal(JSON.stringify(directHit.body).includes("storageKey"), false);
    assert.equal(JSON.stringify(directHit.body).includes("tenants/"), false);

    const fileHit = await request(app).get("/api/conversations/search").set("Cookie", benCookie).query({ q: "fileoffer" });
    assert.equal(fileHit.status, 200);
    assert.equal(fileHit.body.results.length, 1);
    assert.equal(fileHit.body.results[0].match, "attachment");
    assert.equal(fileHit.body.results[0].attachmentName, "fileoffer.png");

    const ids = [];
    let oldestId = "";
    for (let index = 0; index < 45; index += 1) {
      const sent = await request(app).post(`/api/conversations/${directId}/messages`).set("Cookie", adaCookie).send({
        body: index === 0 ? "historyzero is the oldest note" : `historyword item ${index}`,
      });
      assert.equal(sent.status, 201);
      ids.push(sent.body.message.id);
      if (index === 0) oldestId = sent.body.message.id;
    }
    const older = await request(app).get("/api/conversations/search").set("Cookie", benCookie).query({ q: "historyzero", conversationId: directId });
    assert.equal(older.status, 200);
    assert.equal(older.body.results.some((result) => result.id === oldestId), true);
    const latest = await request(app).get(`/api/conversations/${directId}/messages`).set("Cookie", benCookie);
    assert.equal(latest.body.messages.some((message) => message.id === oldestId), false);
    const around = await request(app).get(`/api/conversations/${directId}/messages/around/${oldestId}`).set("Cookie", benCookie);
    assert.equal(around.status, 200);
    assert.equal(around.body.focusId, oldestId);
    assert.equal(around.body.messages.some((message) => message.id === oldestId), true);
    assert.equal(around.body.messages.length <= 41, true);
    assert.equal(around.body.messages.length < latest.body.messages.length + 45, true);
    assert.equal(around.body.hasMoreAfter, true);
    assert.equal(JSON.stringify(around.body).includes("storageKey"), false);

    const pageIds = [];
    for (let index = 0; index < 21; index += 1) {
      const sent = await request(app).post(`/api/conversations/${directId}/messages`).set("Cookie", benCookie).send({ body: `pageword sequence ${index}` });
      pageIds.push(sent.body.message.id);
    }
    const firstPage = await request(app).get("/api/conversations/search").set("Cookie", adaCookie).query({ q: "pageword", conversationId: directId });
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.body.results.length, 20);
    assert.equal(firstPage.body.hasMore, true);
    assert.equal(firstPage.body.results[0].id, pageIds[20]);
    const secondPage = await request(app).get("/api/conversations/search").set("Cookie", adaCookie).query({
      q: "pageword",
      conversationId: directId,
      cursor: firstPage.body.nextCursor,
    });
    assert.equal(secondPage.body.results.length, 1);
    assert.equal(secondPage.body.results[0].id, pageIds[0]);
    const seen = new Set(firstPage.body.results.map((result) => result.id));
    assert.equal(secondPage.body.results.some((result) => seen.has(result.id)), false);

    const day = new Date(groupMessage.body.message.createdAt).toISOString().slice(0, 10);
    const filtered = await request(app).get("/api/conversations/search").set("Cookie", benCookie).query({
      q: "groupoffer",
      type: "group",
      conversationId: groupId,
      senderId: String(ada._id),
      from: day,
      to: day,
      attachments: "1",
      companyId: "other-company",
    });
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.body.results.map((result) => result.id), [groupMessage.body.message.id]);
    const directOnly = await request(app).get("/api/conversations/search").set("Cookie", benCookie).query({ q: "groupoffer", type: "direct" });
    assert.equal(directOnly.body.results.length, 0);

    const { Message, ConversationMember } = await getCompanyModels(acme);
    const memberUpdate = await ConversationMember.collection.updateOne(
      { conversationId: new mongoose.Types.ObjectId(directId), userId: ben._id },
      { $set: { joinedAt: new Date("2024-01-01T00:00:00.000Z") } }
    );
    assert.equal(memberUpdate.matchedCount, 1);
    const messageUpdate = await Message.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(directMessage.body.message.id) },
      { $set: { createdAt: new Date("2024-06-01T12:00:00.000Z") } }
    );
    assert.equal(messageUpdate.matchedCount, 1);
    const dated = await request(app).get("/api/conversations/search").set("Cookie", benCookie).query({ q: "alphaoffer", from: "2024-06-01", to: "2024-06-01" });
    assert.equal(dated.body.results.length, 1, JSON.stringify(dated.body));
    const outside = await request(app).get("/api/conversations/search").set("Cookie", benCookie).query({ q: "alphaoffer", from: day, to: day });
    assert.equal(outside.body.results.length, 0);
    const tooWide = await request(app).get("/api/conversations/search").set("Cookie", benCookie).query({ q: "alphaoffer", from: "2020-01-01", to: "2021-02-01" });
    assert.equal(tooWide.status, 400);
    const empty = await request(app).get("/api/conversations/search").set("Cookie", benCookie);
    assert.equal(empty.status, 400);
  });

  it("hides deleted text, follows edits, and blocks outsiders", async () => {
    const direct = await request(app).post("/api/conversations").set("Cookie", adaCookie).send({ participantUserId: String(cara._id) });
    const conversationId = direct.body.conversation.id;
    const created = await request(app).post(`/api/conversations/${conversationId}/messages`).set("Cookie", adaCookie).send({ body: "beforeedit phrase" });
    const edited = await request(app).patch(`/api/conversations/${conversationId}/messages/${created.body.message.id}`).set("Cookie", adaCookie).send({ body: "afteredit phrase" });
    assert.equal(edited.status, 200);
    const oldText = await request(app).get("/api/conversations/search").set("Cookie", caraCookie).query({ q: "beforeedit" });
    assert.equal(oldText.body.results.length, 0);
    const newText = await request(app).get("/api/conversations/search").set("Cookie", caraCookie).query({ q: "afteredit" });
    assert.equal(newText.body.results.length, 1);

    const removed = await request(app).post(`/api/conversations/${conversationId}/messages`).set("Cookie", adaCookie).send({ body: "deleteme phrase" });
    await request(app).delete(`/api/conversations/${conversationId}/messages/${removed.body.message.id}`).set("Cookie", adaCookie);
    const gone = await request(app).get("/api/conversations/search").set("Cookie", caraCookie).query({ q: "deleteme" });
    assert.equal(gone.body.results.length, 0);
    const missing = await request(app).get(`/api/conversations/${conversationId}/messages/around/${removed.body.message.id}`).set("Cookie", caraCookie);
    assert.equal(missing.status, 404);

    const foreign = await request(app).get("/api/conversations/search").set("Cookie", globexCookie).query({ q: "afteredit" });
    assert.equal(foreign.status, 200);
    assert.equal(foreign.body.results.length, 0);
    const foreignAround = await request(app).get(`/api/conversations/${conversationId}/messages/around/${created.body.message.id}`).set("Cookie", globexCookie);
    assert.equal(foreignAround.status, 404);
    const outsider = await request(app).get("/api/conversations/search").set("Cookie", benCookie).query({ q: "afteredit", conversationId });
    assert.equal(outsider.status, 404);

    const candidate = await request(app).post("/api/auth/login").send({
      companyCode: "acme-search",
      email: "candidate@acme-search.test",
      password: "ChatPass123!",
    });
    assert.equal(candidate.status, 403);
    const announcements = await request(app).get("/api/announcements");
    assert.equal(announcements.status, 401);
  });

  it("enforces group join history, removed members, and historical navigation", async () => {
    const group = await request(app).post("/api/conversations/groups").set("Cookie", adaCookie).send({
      name: "Archive",
      memberUserIds: [String(ben._id)],
    });
    const groupId = group.body.conversation.id;
    const early = await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", adaCookie).send({ body: "secretjoin phrase stays hidden" });
    assert.equal(early.status, 201);
    const added = await request(app).post(`/api/conversations/${groupId}/members`).set("Cookie", adaCookie).send({ userIds: [String(cara._id)] });
    assert.equal(added.status, 200);
    const hidden = await request(app).get("/api/conversations/search").set("Cookie", caraCookie).query({ q: "secretjoin" });
    assert.equal(hidden.body.results.length, 0);
    const hiddenAround = await request(app).get(`/api/conversations/${groupId}/messages/around/${early.body.message.id}`).set("Cookie", caraCookie);
    assert.equal(hiddenAround.status, 404);

    const later = await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", adaCookie).send({ body: "visiblejoin phrase is available" });
    const visible = await request(app).get("/api/conversations/search").set("Cookie", caraCookie).query({ q: "visiblejoin", type: "group" });
    assert.equal(visible.body.results.length, 1);
    assert.equal(visible.body.results[0].conversationName, "Archive");
    const context = await request(app).get(`/api/conversations/${groupId}/messages/around/${later.body.message.id}`).set("Cookie", caraCookie);
    assert.equal(context.status, 200);
    assert.equal(context.body.messages.some((message) => message.body === "secretjoin phrase stays hidden"), false);
    assert.equal(context.body.messages.some((message) => message.id === later.body.message.id), true);

    const newer = await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", caraCookie).query({ after: later.body.message.id });
    assert.equal(newer.status, 200);

    const removed = await request(app).delete(`/api/conversations/${groupId}/members/${ben._id}`).set("Cookie", adaCookie);
    assert.equal(removed.status, 200);
    const deniedSearch = await request(app).get("/api/conversations/search").set("Cookie", benCookie).query({ q: "visiblejoin", conversationId: groupId });
    assert.equal(deniedSearch.status, 404);
    const deniedAround = await request(app).get(`/api/conversations/${groupId}/messages/around/${later.body.message.id}`).set("Cookie", benCookie);
    assert.equal(deniedAround.status, 404);
    const leaked = await request(app).get("/api/conversations/search").set("Cookie", benCookie).query({ q: "visiblejoin" });
    assert.equal(leaked.body.results.some((result) => result.conversationId === groupId), false);

    const still = await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", adaCookie).send({ body: "Group search still works" });
    assert.equal(still.status, 201);
    const direct = await request(app).post("/api/conversations").set("Cookie", adaCookie).send({ participantUserId: String(ben._id) });
    const directText = await request(app).post(`/api/conversations/${direct.body.conversation.id}/messages`).set("Cookie", adaCookie).send({ body: "Direct search still works" });
    assert.equal(directText.status, 201);
  });
});
