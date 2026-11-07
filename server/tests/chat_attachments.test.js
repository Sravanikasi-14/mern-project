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
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import { USER_ROLES } from "../models/User.js";
import { setStorageAdapter } from "../services/r2StorageService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { signAuthToken } from "../utils/token.js";

const objects = new Map();

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

async function upload(cookie, conversationId, fileName, buffer) {
  return request(app)
    .post(`/api/conversations/${conversationId}/attachments`)
    .set("Cookie", cookie)
    .send({ fileName, fileData: dataUrl(buffer), mimeType: "application/octet-stream" });
}

before(async () => {
  setStorageAdapter({
    async putObject({ key, body }) {
      objects.set(key, Buffer.from(body));
      return { etag: "test" };
    },
    async getObjectBuffer(key) {
      if (!objects.has(key)) {
        const error = new Error("missing");
        error.name = "NoSuchKey";
        throw error;
      }
      return objects.get(key);
    },
    async deleteObject(key) {
      objects.delete(key);
    },
    async getPresignedGetUrl() {
      throw new Error("presigned URLs are not used");
    },
  });
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
  setStorageAdapter(null);
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("chat attachments", () => {
  it("stores valid files privately and keeps text messages working", async () => {
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
      ["people.csv", Buffer.from("name,role\nAda,Design\n"), "text/csv"],
      ["hello.txt", Buffer.from("hello from chat"), "text/plain"],
    ];
    for (const [fileName, buffer, mimeType] of samples) {
      const saved = await upload(adaCookie, conversationId, fileName, buffer);
      assert.equal(saved.status, 201, saved.body?.message || fileName);
      assert.equal(saved.body.file.mimeType, mimeType);
      assert.equal(saved.body.file.fileName, fileName);
      assert.equal(Object.hasOwn(saved.body.file, "storageKey"), false);
      assert.equal(JSON.stringify(saved.body).includes("tenants/"), false);
      const removed = await request(app).delete(`/api/conversations/${conversationId}/attachments/${saved.body.file.id}`).set("Cookie", adaCookie);
      assert.equal(removed.status, 200);
    }

    const image = await upload(adaCookie, conversationId, "..\\..\\secret.png", png());
    assert.equal(image.status, 201);
    assert.equal(image.body.file.fileName, "secret.png");
    const document = await upload(adaCookie, conversationId, "notes.pdf", pdf());
    assert.equal(document.status, 201);
    const sent = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", adaCookie)
      .send({ body: "See the files", attachmentIds: [image.body.file.id, document.body.file.id] });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.body, "See the files");
    assert.equal(sent.body.message.attachments.length, 2);
    assert.equal(sent.body.message.attachments[0].mimeType, "image/png");
    assert.equal(sent.body.message.attachments[1].fileName, "notes.pdf");
    assert.equal(JSON.stringify(sent.body).includes("storageKey"), false);
    assert.equal(JSON.stringify(sent.body).includes("tenants/"), false);
    const messageId = sent.body.message.id;
    const imageId = sent.body.message.attachments[0].id;

    const preview = await request(app)
      .get(`/api/conversations/${conversationId}/messages/${messageId}/attachments/${imageId}`)
      .set("Cookie", benCookie);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers["content-type"], "image/png");
    assert.equal(preview.headers["x-content-type-options"], "nosniff");
    assert.equal(String(preview.headers["content-disposition"]).includes("inline"), true);
    assert.equal(String(preview.headers["content-disposition"]).includes("tenants/"), false);
    assert.ok(Buffer.isBuffer(preview.body));
    assert.equal(preview.body.equals(png()), true);

    const download = await request(app)
      .get(`/api/conversations/${conversationId}/messages/${messageId}/attachments/${document.body.file.id}`)
      .set("Cookie", adaCookie);
    assert.equal(download.status, 200);
    assert.equal(download.headers["content-type"], "application/pdf");
    assert.equal(String(download.headers["content-disposition"]).startsWith("attachment;"), true);

    assert.equal((await request(app).get(`/api/conversations/${conversationId}/messages/${messageId}/attachments/${imageId}`).set("Cookie", caraCookie)).status, 404);
    assert.equal((await request(app).get(`/api/conversations/${conversationId}/messages/${messageId}/attachments/${imageId}`).set("Cookie", globexCookie)).status, 404);
    assert.equal((await request(app).get(`/api/conversations/${conversationId}/messages/${messageId}/attachments/${imageId}`)).status, 401);
    assert.equal((await request(app).post(`/api/conversations/${conversationId}/attachments`).set("Cookie", caraCookie).send({ fileName: "notes.pdf", fileData: dataUrl(pdf()) })).status, 404);

    const history = await request(app).get(`/api/conversations/${conversationId}/messages`).set("Cookie", benCookie);
    assert.equal(JSON.stringify(history.body).includes("storageKey"), false);
    assert.equal(history.body.messages.at(-1).body, "See the files");

    const onlyFile = await upload(adaCookie, conversationId, "hello.txt", Buffer.from("hello from chat"));
    const attachmentOnly = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", adaCookie)
      .send({ body: "", attachmentIds: [onlyFile.body.file.id] });
    assert.equal(attachmentOnly.status, 201);
    assert.equal(attachmentOnly.body.message.body, "");
    assert.equal(attachmentOnly.body.message.attachments[0].fileName, "hello.txt");
    const listed = await request(app).get("/api/conversations").set("Cookie", benCookie);
    assert.equal(listed.body.conversations.find((item) => item.id === conversationId).preview, "hello.txt");

    const text = await request(app).post(`/api/conversations/${conversationId}/messages`).set("Cookie", adaCookie).send({ body: "Still text" });
    assert.equal(text.status, 201);
    assert.equal(text.body.message.body, "Still text");
    assert.deepEqual(text.body.message.attachments, []);
    const { Notification } = await getCompanyModels(acme);
    const notes = await Notification.find({
      userId: ben._id,
      type: NOTIFICATION_TYPES.MESSAGE,
      "metadata.conversationId": conversationId,
      "metadata.event": "message",
    });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].message, "Still text");

    const empty = await request(app).post(`/api/conversations/${conversationId}/messages`).set("Cookie", adaCookie).send({ body: "" });
    assert.equal(empty.status, 400);
    const spoofed = await upload(adaCookie, conversationId, "notes.pdf", png());
    assert.equal(spoofed.status, 400);
    assert.match(spoofed.body.message, /does not match/);
    const blocked = await upload(adaCookie, conversationId, "virus.exe", Buffer.from("not a document"));
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.message, /not supported/);

    const benFile = await upload(benCookie, conversationId, "ben.txt", Buffer.from("ben only"));
    const stolen = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", adaCookie)
      .send({ attachmentIds: [benFile.body.file.id] });
    assert.equal(stolen.status, 400);

    const { User } = await getCompanyModels(acme);
    const candidate = await User.findOne({ email: "candidate@acme-files.test" });
    const candidateToken = signAuthToken({ userId: candidate._id, companyId: acme._id });
    assert.equal((await request(app).post(`/api/conversations/${conversationId}/attachments`).set("Authorization", `Bearer ${candidateToken}`).send({ fileName: "notes.pdf", fileData: dataUrl(pdf()) })).status, 401);
  });

  it("enforces size and count limits without using local disk", async () => {
    const direct = await request(app).post("/api/conversations").set("Cookie", adaCookie).send({ participantUserId: String(ben._id) });
    const conversationId = direct.body.conversation.id;
    const previousBytes = process.env.CHAT_ATTACHMENT_MAX_BYTES;
    const previousCount = process.env.CHAT_ATTACHMENT_MAX_COUNT;
    try {
      process.env.CHAT_ATTACHMENT_MAX_BYTES = "1024";
      const oversized = await upload(adaCookie, conversationId, "big.png", png(1200));
      assert.equal(oversized.status, 400);
      assert.match(oversized.body.message, /smaller/);
      process.env.CHAT_ATTACHMENT_MAX_BYTES = previousBytes;

      process.env.CHAT_ATTACHMENT_MAX_COUNT = "1";
      const group = await request(app).post("/api/conversations/groups").set("Cookie", adaCookie).send({ name: "Limits", memberUserIds: [String(ben._id)] });
      assert.equal(group.status, 201);
      const groupId = group.body.conversation.id;
      const first = await upload(adaCookie, groupId, "one.txt", Buffer.from("one file"));
      assert.equal(first.status, 201);
      const second = await upload(adaCookie, groupId, "two.txt", Buffer.from("two files"));
      assert.equal(second.status, 400);
      assert.match(second.body.message, /up to 1/);
    } finally {
      if (previousBytes == null) delete process.env.CHAT_ATTACHMENT_MAX_BYTES;
      else process.env.CHAT_ATTACHMENT_MAX_BYTES = previousBytes;
      if (previousCount == null) delete process.env.CHAT_ATTACHMENT_MAX_COUNT;
      else process.env.CHAT_ATTACHMENT_MAX_COUNT = previousCount;
    }
  });

  it("hides group files from outsiders, new members, and removed members", async () => {
    const created = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", adaCookie)
      .send({ name: "Files", memberUserIds: [String(ben._id)] });
    assert.equal(created.status, 201);
    const groupId = created.body.conversation.id;
    const uploaded = await upload(adaCookie, groupId, "plan.pdf", pdf());
    const sent = await request(app)
      .post(`/api/conversations/${groupId}/messages`)
      .set("Cookie", adaCookie)
      .send({ attachmentIds: [uploaded.body.file.id] });
    assert.equal(sent.status, 201);
    const messageId = sent.body.message.id;
    const fileId = sent.body.message.attachments[0].id;
    const memberDownload = await request(app)
      .get(`/api/conversations/${groupId}/messages/${messageId}/attachments/${fileId}`)
      .set("Cookie", benCookie);
    assert.equal(memberDownload.status, 200);
    assert.equal(memberDownload.body.equals(pdf()), true);

    const added = await request(app).post(`/api/conversations/${groupId}/members`).set("Cookie", adaCookie).send({ userIds: [String(cara._id)] });
    assert.equal(added.status, 200);
    const hidden = await request(app)
      .get(`/api/conversations/${groupId}/messages/${messageId}/attachments/${fileId}`)
      .set("Cookie", caraCookie);
    assert.equal(hidden.status, 404);
    const hiddenList = await request(app).get(`/api/conversations/${groupId}/messages`).set("Cookie", caraCookie);
    assert.equal(hiddenList.body.messages.length, 0);

    const later = await upload(benCookie, groupId, "later.txt", Buffer.from("after cara joined"));
    const laterMessage = await request(app)
      .post(`/api/conversations/${groupId}/messages`)
      .set("Cookie", benCookie)
      .send({ body: "New file", attachmentIds: [later.body.file.id] });
    assert.equal(laterMessage.status, 201);
    const visible = await request(app)
      .get(`/api/conversations/${groupId}/messages/${laterMessage.body.message.id}/attachments/${later.body.file.id}`)
      .set("Cookie", caraCookie);
    assert.equal(visible.status, 200);

    const removed = await request(app).delete(`/api/conversations/${groupId}/members/${cara._id}`).set("Cookie", adaCookie);
    assert.equal(removed.status, 200);
    assert.equal((await request(app).get(`/api/conversations/${groupId}/messages/${laterMessage.body.message.id}/attachments/${later.body.file.id}`).set("Cookie", caraCookie)).status, 404);
    assert.equal((await request(app).get(`/api/conversations/${groupId}/messages/${messageId}/attachments/${fileId}`).set("Cookie", benCookie)).status, 200);
    assert.equal((await request(app).get(`/api/conversations/${groupId}/messages/${fileId}/attachments/${fileId}`).set("Cookie", globexCookie)).status, 404);
  });

  it("refuses uploads when object storage is not configured", async () => {
    setStorageAdapter(null);
    try {
      const direct = await request(app).post("/api/conversations").set("Cookie", adaCookie).send({ participantUserId: String(ben._id) });
      const beforeCount = objects.size;
      const response = await upload(adaCookie, direct.body.conversation.id, "notes.pdf", pdf());
      assert.equal(response.status, 503);
      assert.equal(response.body.code, "STORAGE_NOT_CONFIGURED");
      assert.equal(objects.size, beforeCount);
      const { ChatFile } = await getCompanyModels(acme);
      assert.equal(await ChatFile.countDocuments({ fileName: "notes.pdf", messageId: null, size: pdf().length }), 0);
    } finally {
      setStorageAdapter({
        async putObject({ key, body }) {
          objects.set(key, Buffer.from(body));
          return { etag: "test" };
        },
        async getObjectBuffer(key) {
          return objects.get(key);
        },
        async deleteObject(key) {
          objects.delete(key);
        },
      });
    }
  });
});
