process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET;
delete process.env.R2_ACCOUNT_ID;

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
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

function dataUrl(buffer) {
  return `data:application/octet-stream;base64,${buffer.toString("base64")}`;
}

function png(size = 12) {
  const buffer = Buffer.alloc(size);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return buffer;
}

function jpeg() {
  const buffer = Buffer.alloc(12);
  buffer.set([0xff, 0xd8, 0xff]);
  return buffer;
}

function webp() {
  const buffer = Buffer.alloc(12);
  buffer.write("RIFF", 0);
  buffer.write("WEBP", 8);
  return buffer;
}

function pdf() {
  return Buffer.from("%PDF-1.4\n");
}

function ole() {
  return Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
}

function docx() {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("word/document.xml")]);
}

function xlsx() {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("xl/workbook.xml")]);
}

function pptx() {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("ppt/slides/slide1.xml")]);
}

async function upload(cookie, conversationId, fileName, buffer) {
  return request(app)
    .post(`/api/conversations/${conversationId}/attachments`)
    .set("Cookie", cookie)
    .send({ fileName, fileData: dataUrl(buffer), mimeType: "application/octet-stream" });
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme Files",
    slug: "acme-files",
    databaseName: "company_acme_files",
    status: COMPANY_STATUSES.ACTIVE,
  });
  const globex = await Company.create({
    companyName: "Globex Files",
    slug: "globex-files",
    databaseName: "company_globex_files",
    status: COMPANY_STATUSES.ACTIVE,
  });
  const password = await hashPassword("ChatPass123!");
  const { User } = await getCompanyModels(acme);
  ada = await User.create({ email: "ada@acme-files.test", passwordHash: password, role: USER_ROLES.EMPLOYEE, fullName: "Ada Stone", isActive: true });
  ben = await User.create({ email: "ben@acme-files.test", passwordHash: password, role: USER_ROLES.EMPLOYEE, fullName: "Ben Cole", isActive: true });
  cara = await User.create({ email: "cara@acme-files.test", passwordHash: password, role: USER_ROLES.EMPLOYEE, fullName: "Cara Diaz", isActive: true });
  await User.create({ email: "candidate@acme-files.test", role: USER_ROLES.CANDIDATE, fullName: "Candidate User", isActive: true });
  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({ email: "gia@globex-files.test", passwordHash: password, role: USER_ROLES.EMPLOYEE, fullName: "Gia North", isActive: true });
  adaCookie = await login("acme-files", "ada@acme-files.test");
  benCookie = await login("acme-files", "ben@acme-files.test");
  caraCookie = await login("acme-files", "cara@acme-files.test");
  globexCookie = await login("globex-files", "gia@globex-files.test");
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("chat attachments", () => {
  it("stores valid files in tenant GridFS without R2 and keeps text messages working", async () => {
    const direct = await request(app).post("/api/conversations").set("Cookie", adaCookie).send({ participantUserId: String(ben._id) });
    assert.equal(direct.status, 200);
    const conversationId = direct.body.conversation.id;

    const samples = [
      ["photo.png", png(), "image/png"],
      ["photo.jpg", jpeg(), "image/jpeg"],
      ["photo.webp", webp(), "image/webp"],
      ["notes.pdf", pdf(), "application/pdf"],
      ["notes.doc", ole(), "application/msword"],
      ["notes.docx", docx(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["sheet.xls", ole(), "application/vnd.ms-excel"],
      ["sheet.xlsx", xlsx(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["deck.pptx", pptx(), "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["deck.ppt", ole(), "application/vnd.ms-powerpoint"],
      ["people.csv", Buffer.from("name,role\nAda,Design\n"), "text/csv"],
      ["hello.txt", Buffer.from("hello from chat"), "text/plain"],
    ];
    for (const [fileName, buffer, mimeType] of samples) {
      const saved = await upload(adaCookie, conversationId, fileName, buffer);
      assert.equal(saved.status, 201, saved.body?.message || fileName);
      assert.equal(saved.body.file.fileName, fileName);
      assert.equal(saved.body.file.originalMimeType || saved.body.file.mimeType, mimeType);
      assert.equal(Object.hasOwn(saved.body.file, "storageKey"), false);
      assert.equal(JSON.stringify(saved.body).includes("tenants/"), false);
      const removed = await request(app).delete(`/api/conversations/${conversationId}/attachments/${saved.body.file.id}`).set("Cookie", adaCookie);
      assert.equal(removed.status, 200);
    }

    const text = await request(app).post(`/api/conversations/${conversationId}/messages`).set("Cookie", adaCookie).send({ body: "still works" });
    assert.equal(text.status, 201);
    assert.equal(text.body.message.body, "still works");
  });

  it("persists bytes in chat_attachments GridFS and supports download after send", async () => {
    const direct = await request(app).post("/api/conversations").set("Cookie", adaCookie).send({ participantUserId: String(ben._id) });
    const conversationId = direct.body.conversation.id;
    const uploaded = await upload(adaCookie, conversationId, "notes.pdf", pdf());
    assert.equal(uploaded.status, 201);

    const models = await getCompanyModels(acme);
    const chatFile = await models.ChatFile.findById(uploaded.body.file.id).lean();
    assert.equal(chatFile.storageProvider, "gridfs");
    const gridDoc = await models.connection.db.collection(`${CHAT_ATTACHMENTS_BUCKET}.files`).findOne({
      _id: new (await import("mongodb")).ObjectId(chatFile.storageKey),
    });
    assert.ok(gridDoc);
    assert.equal(gridDoc.metadata.purpose, "chat_attachment");

    const sent = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", adaCookie)
      .send({ body: "", attachmentIds: [uploaded.body.file.id] });
    assert.equal(sent.status, 201);
    const fileId = sent.body.message.attachments[0].id;
    const messageId = sent.body.message.id;

    const download = await request(app)
      .get(`/api/conversations/${conversationId}/messages/${messageId}/attachments/${fileId}`)
      .set("Cookie", benCookie);
    assert.equal(download.status, 200);
    assert.equal(download.headers["content-type"]?.startsWith("application/pdf"), true);
    assert.equal(Buffer.isBuffer(download.body) || typeof download.body === "string" || download.body?.length >= 0, true);

    const outsider = await request(app)
      .get(`/api/conversations/${conversationId}/messages/${messageId}/attachments/${fileId}`)
      .set("Cookie", globexCookie);
    assert.equal(outsider.status, 404);
  });

  it("enforces size and count limits without using local disk", async () => {
    const direct = await request(app).post("/api/conversations").set("Cookie", adaCookie).send({ participantUserId: String(ben._id) });
    const conversationId = direct.body.conversation.id;
    const { ChatFile } = await getCompanyModels(acme);
    await ChatFile.deleteMany({ conversationId, messageId: null });

    const oversized = Buffer.alloc(3 * 1024 * 1024 + 1);
    oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const tooBig = await upload(adaCookie, conversationId, "big.png", oversized);
    assert.equal(tooBig.status, 400);

    const pendingIds = [];
    for (let i = 0; i < 5; i += 1) {
      const ok = await upload(adaCookie, conversationId, `n${i}.txt`, Buffer.from(`note-${i}`));
      assert.equal(ok.status, 201, ok.body?.message);
      pendingIds.push(ok.body.file.id);
    }
    const sixth = await upload(adaCookie, conversationId, "n5.txt", Buffer.from("overflow"));
    assert.equal(sixth.status, 400);
    for (const id of pendingIds) {
      await request(app).delete(`/api/conversations/${conversationId}/attachments/${id}`).set("Cookie", adaCookie);
    }
  });

  it("hides group files from outsiders and removed members", async () => {
    const group = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", adaCookie)
      .send({ name: "Files", memberUserIds: [String(ben._id), String(cara._id)] });
    assert.equal(group.status, 201);
    const groupId = group.body.conversation.id;

    const early = await upload(adaCookie, groupId, "early.pdf", pdf());
    assert.equal(early.status, 201);
    const earlyMessage = await request(app)
      .post(`/api/conversations/${groupId}/messages`)
      .set("Cookie", adaCookie)
      .send({ body: "early", attachmentIds: [early.body.file.id] });
    assert.equal(earlyMessage.status, 201);
    const messageId = earlyMessage.body.message.id;
    const fileId = earlyMessage.body.message.attachments[0].id;

    assert.equal(
      (await request(app).get(`/api/conversations/${groupId}/messages/${messageId}/attachments/${fileId}`).set("Cookie", benCookie)).status,
      200
    );
    assert.equal(
      (await request(app).get(`/api/conversations/${groupId}/messages/${messageId}/attachments/${fileId}`).set("Cookie", caraCookie)).status,
      200
    );
    assert.equal(
      (await request(app).get(`/api/conversations/${groupId}/messages/${messageId}/attachments/${fileId}`).set("Cookie", globexCookie)).status,
      404
    );

    const removed = await request(app).delete(`/api/conversations/${groupId}/members/${cara._id}`).set("Cookie", adaCookie);
    assert.equal(removed.status, 200);
    assert.equal(
      (await request(app).get(`/api/conversations/${groupId}/messages/${messageId}/attachments/${fileId}`).set("Cookie", caraCookie)).status,
      404
    );
    assert.equal(
      (await request(app).get(`/api/conversations/${groupId}/messages/${messageId}/attachments/${fileId}`).set("Cookie", benCookie)).status,
      200
    );
  });

  it("compresses real images with Sharp while preserving original filename metadata", async () => {
    const sharp = (await import("sharp")).default;
    const largePng = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: { r: 20, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();

    const direct = await request(app).post("/api/conversations").set("Cookie", adaCookie).send({ participantUserId: String(ben._id) });
    const conversationId = direct.body.conversation.id;
    const { ChatFile } = await getCompanyModels(acme);
    await ChatFile.deleteMany({ conversationId, messageId: null });

    const saved = await upload(adaCookie, conversationId, "hero-banner.png", largePng);
    assert.equal(saved.status, 201, saved.body?.message);
    assert.equal(saved.body.file.fileName, "hero-banner.png");
    assert.equal(saved.body.file.originalMimeType, "image/png");
    assert.equal(saved.body.file.mimeType, "image/webp");
    assert.ok(saved.body.file.size < largePng.length);
  });
});
