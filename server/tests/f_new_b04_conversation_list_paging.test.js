process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "new-b04-conversation-list-secret-32!!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_new_b04_chat";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

import assert from "node:assert/strict";
import fs from "node:fs";
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

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let mongo;
let app;
let adaCookie;
let peers = [];

before(async () => {
  fs.mkdirSync("D:/tmp/hrms-mongo/new-b04-chat-paging", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/new-b04-chat-paging" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  const company = await Company.create({
    companyName: "NEW-B04 Co",
    slug: `new-b04-${Date.now()}`,
    databaseName: `company_new_b04_${Date.now()}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
  });
  const models = await getCompanyModels(company, { provision: true });
  const passwordHash = await hashPassword("Password123!");

  const adaUser = await models.User.create({
    email: "ada@b04.test",
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Ada B04",
    isActive: true,
    schemaVersion: 1,
  });
  const adaEmp = await models.Employee.create({
    employeeCode: "B04-ADA",
    fullName: "Ada B04",
    email: "ada@b04.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    userId: adaUser._id,
    job: { jobTitle: "Eng", department: "Eng", employmentType: "Full-time" },
    schemaVersion: 1,
  });
  adaUser.employeeId = adaEmp._id;
  await adaUser.save();

  for (let i = 0; i < 5; i += 1) {
    const user = await models.User.create({
      email: `peer${i}@b04.test`,
      passwordHash,
      role: USER_ROLES.EMPLOYEE,
      fullName: `Peer ${i}`,
      isActive: true,
      schemaVersion: 1,
    });
    const emp = await models.Employee.create({
      employeeCode: `B04-P${i}`,
      fullName: `Peer ${i}`,
      email: `peer${i}@b04.test`,
      status: EMPLOYEE_STATUSES.ACTIVE,
      userId: user._id,
      job: { jobTitle: "Eng", department: "Eng", employmentType: "Full-time" },
      schemaVersion: 1,
    });
    user.employeeId = emp._id;
    await user.save();
    peers.push(user);
  }

  adaCookie = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ companyCode: company.slug, email: "ada@b04.test", password: "Password123!" })
  );

  for (const peer of peers) {
    const opened = await request(app)
      .post("/api/conversations")
      .set("Cookie", adaCookie)
      .send({ participantUserId: String(peer._id) });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    const id = opened.body.conversation?.id;
    const sent = await request(app)
      .post(`/api/conversations/${id}/messages`)
      .set("Cookie", adaCookie)
      .send({ body: `hi ${peer.email}` });
    assert.ok([200, 201].includes(sent.status), JSON.stringify(sent.body));
  }
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("NEW-B04 conversation list paging", () => {
  it("supports limit/offset and reports hasMore/total", async () => {
    const page1 = await request(app)
      .get("/api/conversations")
      .query({ limit: 2, offset: 0 })
      .set("Cookie", adaCookie);
    assert.equal(page1.status, 200);
    assert.equal(page1.body.conversations.length, 2);
    assert.equal(page1.body.limit, 2);
    assert.equal(page1.body.offset, 0);
    assert.equal(page1.body.total, 5);
    assert.equal(page1.body.hasMore, true);

    const page2 = await request(app)
      .get("/api/conversations")
      .query({ limit: 2, offset: 2 })
      .set("Cookie", adaCookie);
    assert.equal(page2.body.conversations.length, 2);
    assert.equal(page2.body.hasMore, true);

    const page3 = await request(app)
      .get("/api/conversations")
      .query({ limit: 2, offset: 4 })
      .set("Cookie", adaCookie);
    assert.equal(page3.body.conversations.length, 1);
    assert.equal(page3.body.hasMore, false);

    const ids = [
      ...page1.body.conversations,
      ...page2.body.conversations,
      ...page3.body.conversations,
    ].map((c) => c.id);
    assert.equal(new Set(ids).size, 5);
  });

  it("legacy unpaged response still returns conversations array", async () => {
    const res = await request(app).get("/api/conversations").set("Cookie", adaCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.conversations.length, 5);
    assert.equal(res.body.hasMore, false);
  });
});
