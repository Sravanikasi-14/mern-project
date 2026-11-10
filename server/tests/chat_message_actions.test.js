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
import { ObjectId } from "mongodb";
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import { USER_ROLES } from "../models/User.js";
import { CHAT_ATTACHMENTS_BUCKET } from "../services/chatGridFsStorageService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

let mongo;
let app;
let acme;
let ada;
let ben;
let cara;
let admin;
let hr;
let adaCookie;
let benCookie;
let caraCookie;
let adminCookie;
let hrCookie;
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

async function upload(cookie, conversationId, fileName = "notes.png") {
  return request(app)
    .post(`/api/conversations/${conversationId}/attachments`)
    .set("Cookie", cookie)
    .send({ fileName, fileData: `data:application/octet-stream;base64,${png().toString("base64")}`, mimeType: "application/octet-stream" });
}

async function direct(cookie, userId) {
  const response = await request(app).post("/api/conversations").set("Cookie", cookie).send({ participantUserId: String(userId) });
  assert.equal(response.status, 200, response.body?.message || "direct failed");
  return response.body.conversation.id;
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
    companyName: "Acme Actions",
    slug: "acme-actions",
    databaseName: "company_acme_actions",
    status: COMPANY_STATUSES.ACTIVE,
  });
  const globex = await Company.create({
    companyName: "Globex Actions",
    slug: "globex-actions",
    databaseName: "company_globex_actions",
    status: COMPANY_STATUSES.ACTIVE,
  });
  const password = await hashPassword("ChatPass123!");
  const { User } = await getCompanyModels(acme);
  admin = await User.create({ email: "admin@acme-actions.test", passwordHash: password, role: USER_ROLES.COMPANY_ADMIN, fullName: "Casey Admin", isActive: true });
  hr = await User.create({ email: "hr@acme-actions.test", passwordHash: password, role: USER_ROLES.HR_ADMIN, fullName: "Harper Reid", isActive: true });
  ada = await User.create({ email: "ada@acme-actions.test", passwordHash: password, role: USER_ROLES.EMPLOYEE, fullName: "Ada Stone", isActive: true });
  ben = await User.create({ email: "ben@acme-actions.test", passwordHash: password, role: USER_ROLES.EMPLOYEE, fullName: "Ben Cole", isActive: true });
  cara = await User.create({ email: "cara@acme-actions.test", passwordHash: password, role: USER_ROLES.EMPLOYEE, fullName: "Cara Diaz", isActive: true });
  await User.create({ email: "candidate@acme-actions.test", passwordHash: password, role: USER_ROLES.CANDIDATE, fullName: "Candidate User", isActive: true });
  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({ email: "gia@globex-actions.test", passwordHash: password, role: USER_ROLES.EMPLOYEE, fullName: "Gia North", isActive: true });
  adminCookie = await login("acme-actions", "admin@acme-actions.test");
  hrCookie = await login("acme-actions", "hr@acme-actions.test");
  adaCookie = await login("acme-actions", "ada@acme-actions.test");
  benCookie = await login("acme-actions", "ben@acme-actions.test");
  caraCookie = await login("acme-actions", "cara@acme-actions.test");
  globexCookie = await login("globex-actions", "gia@globex-actions.test");
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

async function gridFileExists(models, storageKey) {
  return Boolean(
    await models.connection.db.collection(`${CHAT_ATTACHMENTS_BUCKET}.files`).findOne({
      _id: new ObjectId(storageKey),
    })
  );
}

describe("message replies, edits, and deletion", () => {
  it("replies to text and attachment-only messages and rejects other conversations", async () => {
    const conversationId = await direct(adaCookie, ben._id);
    const otherId = await direct(adaCookie, cara._id);
    const original = await request(app).post(`/api/conversations/${conversationId}/messages`).set("Cookie", adaCookie).send({ body: "Start the offer" });
    assert.equal(original.status, 201);
    assert.equal(original.body.message.replyTo, null);

    const reply = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", benCookie)
      .send({ body: "I will start it", replyToMessageId: original.body.message.id });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.message.replyTo.id, original.body.message.id);
    assert.equal(reply.body.message.replyTo.available, true);
    assert.equal(reply.body.message.replyTo.deleted, false);
    assert.match(reply.body.message.replyTo.senderName, /Ada/);
    assert.equal(reply.body.message.replyTo.preview, "Start the offer");

    const uploaded = await upload(adaCookie, conversationId, "offer.png");
    assert.equal(uploaded.status, 201);
    const fileOnly = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", adaCookie)
      .send({ body: "", attachmentIds: [uploaded.body.file.id] });
    assert.equal(fileOnly.status, 201);
    assert.equal(fileOnly.body.message.attachments.length, 1);
    const fileReply = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", benCookie)
      .send({ body: "Got the file", replyToMessageId: fileOnly.body.message.id });
    assert.equal(fileReply.status, 201);
    assert.equal(fileReply.body.message.replyTo.preview, "offer.png");

    const replyFile = await upload(benCookie, conversationId, "reply.png");
    const withFile = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", benCookie)
      .send({ body: "And a file", attachmentIds: [replyFile.body.file.id], replyToMessageId: original.body.message.id });
    assert.equal(withFile.status, 201);
    assert.equal(withFile.body.message.attachments.length, 1);
    assert.equal(withFile.body.message.replyTo.id, original.body.message.id);

    const foreign = await request(app)
      .post(`/api/conversations/${otherId}/messages`)
      .set("Cookie", adaCookie)
      .send({ body: "Wrong room", replyToMessageId: original.body.message.id });
    assert.equal(foreign.status, 400);

    const listed = await request(app).get(`/api/conversations/${conversationId}/messages`).set("Cookie", benCookie);
    assert.equal(listed.status, 200);
    const quoted = listed.body.messages.find((message) => message.id === reply.body.message.id);
    assert.equal(quoted.replyTo.preview, "Start the offer");
    assert.equal(quoted.body, "I will start it");
  });

  it("lets the sender edit and blocks everyone else, including admins", async () => {
    const conversationId = await direct(adaCookie, admin._id);
    const hrThread = await direct(hrCookie, ada._id);
    const uploaded = await upload(adaCookie, conversationId, "keep.png");
    const created = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", adaCookie)
      .send({ body: "Original wording", attachmentIds: [uploaded.body.file.id] });
    assert.equal(created.status, 201);
    const messageId = created.body.message.id;
    const createdAt = created.body.message.createdAt;
    const fileId = created.body.message.attachments[0].id;

    const edited = await request(app)
      .patch(`/api/conversations/${conversationId}/messages/${messageId}`)
      .set("Cookie", adaCookie)
      .send({ body: "Corrected wording" });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.message.id, messageId);
    assert.equal(edited.body.message.createdAt, createdAt);
    assert.ok(edited.body.message.editedAt);
    assert.equal(edited.body.message.body, "Corrected wording");
    assert.equal(edited.body.message.attachments.length, 1);
    assert.equal(edited.body.message.attachments[0].id, fileId);

    const again = await request(app).get(`/api/conversations/${conversationId}/messages`).set("Cookie", adaCookie);
    const rows = again.body.messages.filter((message) => message.id === messageId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].body, "Corrected wording");

    const byAdmin = await request(app)
      .patch(`/api/conversations/${conversationId}/messages/${messageId}`)
      .set("Cookie", adminCookie)
      .send({ body: "Admin rewrite" });
    assert.equal(byAdmin.status, 403);

    const hrMessage = await request(app).post(`/api/conversations/${hrThread}/messages`).set("Cookie", hrCookie).send({ body: "HR note" });
    const employeeEdit = await request(app)
      .patch(`/api/conversations/${hrThread}/messages/${hrMessage.body.message.id}`)
      .set("Cookie", adaCookie)
      .send({ body: "Taken over" });
    assert.equal(employeeEdit.status, 403);
    const hrEdit = await request(app)
      .patch(`/api/conversations/${hrThread}/messages/${hrMessage.body.message.id}`)
      .set("Cookie", hrCookie)
      .send({ body: "HR note revised" });
    assert.equal(hrEdit.status, 200);
    assert.equal(hrEdit.body.message.body, "HR note revised");
  });

  it("soft-deletes the sender's message, hides text and files, and keeps shared objects", async () => {
    const conversationId = await direct(adaCookie, ben._id);
    const firstUpload = await upload(adaCookie, conversationId, "shared.png");
    const created = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", adaCookie)
      .send({ body: "Please delete this", attachmentIds: [firstUpload.body.file.id] });
    assert.equal(created.status, 201);
    const messageId = created.body.message.id;
    const fileId = created.body.message.attachments[0].id;

    const models = await getCompanyModels(acme);
    const { Message } = models;
    const stored = await Message.findById(messageId).lean();
    const storageKey = stored.attachments[0].storageKey;
    assert.equal(await gridFileExists(models, storageKey), true);
    await Message.create({
      conversationId,
      senderUserId: ada._id,
      body: "Second copy",
      attachments: stored.attachments,
    });

    const byBen = await request(app).delete(`/api/conversations/${conversationId}/messages/${messageId}`).set("Cookie", benCookie);
    assert.equal(byBen.status, 403);

    const removed = await request(app).delete(`/api/conversations/${conversationId}/messages/${messageId}`).set("Cookie", adaCookie);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.message.deleted, true);
    assert.equal(removed.body.message.body, "");
    assert.deepEqual(removed.body.message.attachments, []);
    // Shared storageKey still referenced by the second message copy — bytes retained.
    assert.equal(await gridFileExists(models, storageKey), true);

    const raw = await Message.findById(messageId).lean();
    assert.equal(raw.body, "");
    assert.ok(raw.deletedAt);
    assert.equal(raw.attachments.length, 1);

    const download = await request(app).get(`/api/conversations/${conversationId}/messages/${messageId}/attachments/${fileId}`).set("Cookie", benCookie);
    assert.equal(download.status, 404);
    const listed = await request(app).get(`/api/conversations/${conversationId}/messages`).set("Cookie", benCookie);
    const placeholder = listed.body.messages.find((message) => message.id === messageId);
    assert.equal(placeholder.deleted, true);
    assert.equal(placeholder.body, "");
    assert.equal(JSON.stringify(listed.body).includes("Please delete this"), false);

    const reply = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", benCookie)
      .send({ body: "I still have this reply", replyToMessageId: messageId });
    assert.equal(reply.status, 400);

    const older = await request(app).post(`/api/conversations/${conversationId}/messages`).set("Cookie", adaCookie).send({ body: "Still here", replyToMessageId: stored._id });
    assert.equal(older.status, 400);

    const liveReplyTarget = await request(app).post(`/api/conversations/${conversationId}/messages`).set("Cookie", adaCookie).send({ body: "Keep me" });
    const linked = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", benCookie)
      .send({ body: "Replying first", replyToMessageId: liveReplyTarget.body.message.id });
    assert.equal(linked.status, 201);
    await request(app).delete(`/api/conversations/${conversationId}/messages/${liveReplyTarget.body.message.id}`).set("Cookie", adaCookie);
    const after = await request(app).get(`/api/conversations/${conversationId}/messages`).set("Cookie", benCookie);
    const surviving = after.body.messages.find((message) => message.id === linked.body.message.id);
    assert.equal(surviving.body, "Replying first");
    assert.equal(surviving.replyTo.deleted, true);
    assert.equal(surviving.replyTo.preview, "");
    assert.equal(JSON.stringify(surviving).includes("Keep me"), false);

    const copies = await Message.find({ "attachments.storageKey": storageKey, deletedAt: null });
    assert.equal(copies.length, 1);
    await request(app).delete(`/api/conversations/${conversationId}/messages/${copies[0]._id}`).set("Cookie", adaCookie);
    assert.equal(await gridFileExists(models, storageKey), false);
  });

  it("updates an existing unread preview in place and counts replies as new messages", async () => {
    const conversationId = await direct(benCookie, cara._id);
    const sent = await request(app).post(`/api/conversations/${conversationId}/messages`).set("Cookie", benCookie).send({ body: "First alert" });
    assert.equal(sent.status, 201);
    const { Notification } = await getCompanyModels(acme);
    const notes = () => Notification.find({
      userId: cara._id,
      type: NOTIFICATION_TYPES.MESSAGE,
      "metadata.conversationId": conversationId,
    }).lean();
    const before = await notes();
    assert.equal(before.length, 1);
    const stamp = new Date(before[0].createdAt).getTime();

    const edited = await request(app)
      .patch(`/api/conversations/${conversationId}/messages/${sent.body.message.id}`)
      .set("Cookie", benCookie)
      .send({ body: "Revised alert" });
    assert.equal(edited.status, 200);
    const afterEdit = await notes();
    assert.equal(afterEdit.length, 1);
    assert.equal(new Date(afterEdit[0].createdAt).getTime(), stamp);
    assert.equal(afterEdit[0].message, "Revised alert");

    const removed = await request(app).delete(`/api/conversations/${conversationId}/messages/${sent.body.message.id}`).set("Cookie", benCookie);
    assert.equal(removed.status, 200);
    const afterDelete = await notes();
    assert.equal(afterDelete.length, 1);
    assert.equal(new Date(afterDelete[0].createdAt).getTime(), stamp);
    assert.equal(afterDelete[0].message, "This message was deleted");

    await request(app).post(`/api/conversations/${conversationId}/messages`).set("Cookie", benCookie).send({ body: "One" });
    await request(app).post(`/api/conversations/${conversationId}/messages`).set("Cookie", benCookie).send({
      body: "Two",
      replyToMessageId: (await request(app).get(`/api/conversations/${conversationId}/messages`).set("Cookie", benCookie)).body.messages.at(-1).id,
    });
    const unread = await request(app).get("/api/conversations").set("Cookie", caraCookie);
    const row = unread.body.conversations.find((conversation) => conversation.id === conversationId);
    assert.equal(row.unreadCount, 2);
    assert.equal((await notes()).length, 1);
  });

  it("enforces group history, removed members, and tenant isolation", async () => {
    const created = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", adaCookie)
      .send({ name: "Delivery", memberUserIds: [String(ben._id)] });
    assert.equal(created.status, 201);
    const groupId = created.body.conversation.id;
    const early = await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", adaCookie).send({ body: "Before Cara joined" });
    assert.equal(early.status, 201);
    const added = await request(app).post(`/api/conversations/${groupId}/members`).set("Cookie", adaCookie).send({ userIds: [String(cara._id)] });
    assert.equal(added.status, 200);

    const reply = await request(app)
      .post(`/api/conversations/${groupId}/messages`)
      .set("Cookie", caraCookie)
      .send({ body: "I should not see that", replyToMessageId: early.body.message.id });
    assert.equal(reply.status, 404);
    const edit = await request(app).patch(`/api/conversations/${groupId}/messages/${early.body.message.id}`).set("Cookie", caraCookie).send({ body: "Nope" });
    assert.equal(edit.status, 404);
    const listed = await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", caraCookie);
    assert.equal(JSON.stringify(listed.body).includes("Before Cara joined"), false);

    const later = await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", adaCookie).send({
      body: "Welcome",
      replyToMessageId: early.body.message.id,
    });
    assert.equal(later.status, 201);
    const caraView = await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", caraCookie);
    const welcome = caraView.body.messages.find((message) => message.body === "Welcome");
    assert.equal(welcome.replyTo.available, false);
    assert.equal(welcome.replyTo.preview, "");
    assert.equal(JSON.stringify(caraView.body).includes("Before Cara joined"), false);

    const removed = await request(app).delete(`/api/conversations/${groupId}/members/${ben._id}`).set("Cookie", adaCookie);
    assert.equal(removed.status, 200);
    assert.equal((await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", benCookie).send({ body: "Still here?", replyToMessageId: early.body.message.id })).status, 404);
    assert.equal((await request(app).patch(`/api/conversations/${groupId}/messages/${early.body.message.id}`).set("Cookie", benCookie).send({ body: "Edit" })).status, 404);
    assert.equal((await request(app).delete(`/api/conversations/${groupId}/messages/${early.body.message.id}`).set("Cookie", benCookie)).status, 404);
    assert.equal((await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", globexCookie)).status, 404);
    assert.equal((await request(app).patch(`/api/conversations/${groupId}/messages/${early.body.message.id}`).set("Cookie", globexCookie).send({ body: "Other company" })).status, 404);

    const candidate = await request(app).post("/api/auth/login").send({
      companyCode: "acme-actions",
      email: "candidate@acme-actions.test",
      password: "ChatPass123!",
    });
    assert.equal(candidate.status, 403);
    assert.equal(candidate.body.code, "CANDIDATE_ACCESS_DENIED");

    const announcements = await request(app).get("/api/announcements");
    assert.equal(announcements.status, 401);

    const text = await request(app).post(`/api/conversations/${groupId}/messages`).set("Cookie", adaCookie).send({ body: "Group still works" });
    assert.equal(text.status, 201);
    const directId = await direct(adaCookie, ben._id);
    const directText = await request(app).post(`/api/conversations/${directId}/messages`).set("Cookie", adaCookie).send({ body: "Direct still works" });
    assert.equal(directText.status, 201);
    assert.equal(directText.body.message.replyTo, null);
  });
});
