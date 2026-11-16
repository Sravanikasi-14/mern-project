process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f46-chat-list-n-plus-one-test-secret-32!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f46_chat_list";
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
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

describe("F46 chat listConversations / unreadTotal batching", () => {
  let mongoServer;
  let app;
  let server;
  let acme;
  let globex;
  let models;
  let globexModels;
  let ada;
  let ben;
  let cara;
  let drew;
  let adaCookie;
  let benCookie;
  let caraCookie;
  let drewCookie;
  let globexCookie;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    await connectCentralDB();
    app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));

    const password = await hashPassword("ChatPass123!");
    const slug = `f46-chat-${Date.now()}`;
    acme = await Company.create({
      companyName: "F46 Acme Chat",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    const otherSlug = `f46-globex-${Date.now()}`;
    globex = await Company.create({
      companyName: "F46 Globex Chat",
      slug: otherSlug,
      databaseName: `company_${otherSlug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
    });

    models = await getCompanyModels(acme, { provision: true });
    globexModels = await getCompanyModels(globex, { provision: true });

    ada = await models.User.create({
      email: "ada.f46@example.com",
      passwordHash: password,
      role: USER_ROLES.EMPLOYEE,
      fullName: "Ada F46",
      isActive: true,
    });
    ben = await models.User.create({
      email: "ben.f46@example.com",
      passwordHash: password,
      role: USER_ROLES.EMPLOYEE,
      fullName: "Ben F46",
      isActive: true,
    });
    cara = await models.User.create({
      email: "cara.f46@example.com",
      passwordHash: password,
      role: USER_ROLES.EMPLOYEE,
      fullName: "Cara F46",
      isActive: true,
    });
    drew = await models.User.create({
      email: "drew.f46@example.com",
      passwordHash: password,
      role: USER_ROLES.EMPLOYEE,
      fullName: "Drew F46",
      isActive: true,
    });

    const adaEmp = await models.Employee.create({
      employeeCode: "F46-ADA",
      fullName: "Ada F46",
      email: ada.email,
      userId: ada._id,
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "Designer", department: "Eng" },
    });
    const benEmp = await models.Employee.create({
      employeeCode: "F46-BEN",
      fullName: "Ben F46",
      email: ben.email,
      userId: ben._id,
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "Analyst", department: "Finance" },
    });
    ada.employeeId = adaEmp._id;
    ben.employeeId = benEmp._id;
    await ada.save();
    await ben.save();

    await globexModels.User.create({
      email: "gia.f46@example.com",
      passwordHash: password,
      role: USER_ROLES.EMPLOYEE,
      fullName: "Gia F46",
      isActive: true,
    });

    async function login(companyCode, email) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ companyCode, email, password: "ChatPass123!" });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return cookieFrom(res);
    }

    adaCookie = await login(acme.slug, ada.email);
    benCookie = await login(acme.slug, ben.email);
    caraCookie = await login(acme.slug, cara.email);
    drewCookie = await login(acme.slug, drew.email);
    globexCookie = await login(globex.slug, "gia.f46@example.com");
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectAll();
    if (mongoServer) await mongoServer.stop();
  });

  async function openDirect(cookie, participantUserId) {
    const res = await request(app)
      .post("/api/conversations")
      .set("Cookie", cookie)
      .send({ participantUserId: String(participantUserId) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.conversation;
  }

  async function sendMessage(cookie, conversationId, body) {
    const res = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", cookie)
      .send({ body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.message;
  }

  it("lists multiple DMs + group with previews, peers, memberCount, and sort", async () => {
    const dmAdaBen = await openDirect(adaCookie, ben._id);
    const dmAdaCara = await openDirect(adaCookie, cara._id);
    await sendMessage(benCookie, dmAdaBen.id, "hello from ben");
    await sendMessage(caraCookie, dmAdaCara.id, "hello from cara — newer");

    const group = await request(app)
      .post("/api/conversations/groups")
      .set("Cookie", adaCookie)
      .send({
        name: "F46 Squad",
        memberUserIds: [String(ben._id), String(cara._id), String(drew._id)],
      });
    assert.equal(group.status, 201, JSON.stringify(group.body));
    const groupId = group.body.conversation.id;
    await sendMessage(adaCookie, groupId, "welcome group");

    const listed = await request(app).get("/api/conversations").set("Cookie", adaCookie);
    assert.equal(listed.status, 200);
    assert.ok(Array.isArray(listed.body.conversations));
    assert.ok(listed.body.conversations.length >= 3);

    const dmBen = listed.body.conversations.find((c) => c.id === dmAdaBen.id);
    const dmCara = listed.body.conversations.find((c) => c.id === dmAdaCara.id);
    const grp = listed.body.conversations.find((c) => c.id === groupId);
    assert.ok(dmBen);
    assert.ok(dmCara);
    assert.ok(grp);

    assert.equal(dmBen.preview, "hello from ben");
    assert.equal(dmCara.preview, "hello from cara — newer");
    assert.equal(grp.preview, "welcome group");
    assert.equal(dmBen.peer?.displayName, "Ben F46");
    assert.equal(dmBen.peer?.employeeCode, "F46-BEN");
    assert.equal(grp.memberCount, 4);
    assert.equal(grp.isAdmin, true);

    // Newest activity first
    const idxCara = listed.body.conversations.findIndex((c) => c.id === dmAdaCara.id);
    const idxBen = listed.body.conversations.findIndex((c) => c.id === dmAdaBen.id);
    assert.ok(idxCara < idxBen);
  });

  it("unread counts update after send/read; empty conversations stay at 0", async () => {
    const dm = await openDirect(adaCookie, drew._id);
    assert.ok(dm?.id, JSON.stringify(dm));

    // Clear any prior unread noise for Drew on this DM only by marking read first.
    await request(app).post(`/api/conversations/${dm.id}/read`).set("Cookie", drewCookie);

    const emptyList = await request(app).get("/api/conversations").set("Cookie", drewCookie);
    assert.equal(emptyList.status, 200, JSON.stringify(emptyList.body));
    const emptyRow = emptyList.body.conversations.find((c) => c.id === dm.id);
    assert.ok(emptyRow, `missing dm ${dm.id} in ${JSON.stringify(emptyList.body.conversations)}`);
    assert.equal(emptyRow.unreadCount, 0);
    assert.equal(emptyRow.preview || "", "");

    await sendMessage(adaCookie, dm.id, "ping 1");
    await sendMessage(adaCookie, dm.id, "ping 2");

    const unreadList = await request(app).get("/api/conversations").set("Cookie", drewCookie);
    assert.equal(unreadList.status, 200, JSON.stringify(unreadList.body));
    const unreadRow = unreadList.body.conversations.find((c) => c.id === dm.id);
    assert.ok(unreadRow);
    assert.equal(unreadRow.unreadCount, 2, JSON.stringify(unreadRow));
    assert.equal(unreadRow.preview, "ping 2");

    const dmUnreadBefore = unreadRow.unreadCount;
    const mark = await request(app)
      .post(`/api/conversations/${dm.id}/read`)
      .set("Cookie", drewCookie);
    assert.equal(mark.status, 200, JSON.stringify(mark.body));

    const afterList = await request(app).get("/api/conversations").set("Cookie", drewCookie);
    const afterRow = afterList.body.conversations.find((c) => c.id === dm.id);
    assert.equal(afterRow.unreadCount, 0, JSON.stringify(afterRow));
    assert.ok(dmUnreadBefore > afterRow.unreadCount);
  });

  it("hides messages older than joinedAt and soft-deleted still preview as deleted", async () => {
    const dm = await openDirect(benCookie, cara._id);
    const early = await sendMessage(benCookie, dm.id, "before cara joined history");
    assert.ok(early?.id && early?.createdAt, JSON.stringify(early));

    // Force Cara's membership joinedAt just after the early message (not in the future).
    const afterEarly = new Date(new Date(early.createdAt).getTime() + 1);
    const updated = await models.ConversationMember.updateOne(
      { conversationId: dm.id, userId: cara._id },
      { $set: { joinedAt: afterEarly } }
    );
    assert.ok(updated.modifiedCount === 1 || updated.matchedCount === 1, JSON.stringify(updated));

    await new Promise((resolve) => setTimeout(resolve, 15));
    await sendMessage(benCookie, dm.id, "after join");

    const listed = await request(app).get("/api/conversations").set("Cookie", caraCookie);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    const row = listed.body.conversations.find((c) => c.id === dm.id);
    assert.ok(row, JSON.stringify(listed.body.conversations));
    assert.equal(row.preview, "after join", JSON.stringify(row));
    // Early message is invisible for unread (before joinedAt)
    assert.equal(row.unreadCount, 1, JSON.stringify(row));

    const latest = await sendMessage(benCookie, dm.id, "will delete");
    const del = await request(app)
      .delete(`/api/conversations/${dm.id}/messages/${latest.id}`)
      .set("Cookie", benCookie);
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.equal(del.body.message?.deleted, true, JSON.stringify(del.body));

    const afterDel = await request(app).get("/api/conversations").set("Cookie", caraCookie);
    const delRow = afterDel.body.conversations.find((c) => c.id === dm.id);
    assert.equal(delRow.preview, "This message was deleted", JSON.stringify(delRow));
    // Soft-deleted messages are excluded from unread counts
    assert.equal(delRow.unreadCount, 1, JSON.stringify(delRow));
  });

  it("isolates tenants: globex cannot see acme conversation ids or previews", async () => {
    const dm = await openDirect(adaCookie, ben._id);
    await sendMessage(adaCookie, dm.id, "secret acme");

    const globexList = await request(app).get("/api/conversations").set("Cookie", globexCookie);
    assert.equal(globexList.status, 200);
    assert.equal(
      globexList.body.conversations.some((c) => c.id === dm.id),
      false
    );
    assert.equal(
      globexList.body.conversations.some((c) => String(c.preview || "").includes("secret acme")),
      false
    );

    const foreign = await request(app)
      .get(`/api/conversations/${dm.id}/messages`)
      .set("Cookie", globexCookie);
    assert.ok([404, 403].includes(foreign.status));
  });

  it("Message query count stays O(1) as membership count grows", async () => {
    // Seed several DMs for Ada so listConversations has many memberships.
    const peers = [ben, cara, drew];
    for (const peer of peers) {
      const dm = await openDirect(adaCookie, peer._id);
      await sendMessage(peer === ben ? benCookie : peer === cara ? caraCookie : adaCookie, dm.id, `msg-${peer.email}`);
    }

    // Create additional empty DMs by opening more conversations if needed — use existing three + group.
    const memberships = await models.ConversationMember.countDocuments({
      userId: ada._id,
      leftAt: null,
    });
    assert.ok(memberships >= 3, `expected several memberships, got ${memberships}`);

    let aggregateCalls = 0;
    let findOneCalls = 0;
    let countCalls = 0;
    const Message = models.Message;
    const originalAggregate = Message.aggregate.bind(Message);
    const originalFindOne = Message.findOne.bind(Message);
    const originalCount = Message.countDocuments.bind(Message);

    Message.aggregate = (...args) => {
      aggregateCalls += 1;
      return originalAggregate(...args);
    };
    Message.findOne = (...args) => {
      findOneCalls += 1;
      return originalFindOne(...args);
    };
    Message.countDocuments = (...args) => {
      countCalls += 1;
      return originalCount(...args);
    };

    try {
      const listed = await request(app).get("/api/conversations").set("Cookie", adaCookie);
      assert.equal(listed.status, 200);
      assert.ok(listed.body.conversations.length >= 3);

      const messageRoundTrips = aggregateCalls + findOneCalls + countCalls;
      // Batched path: two Message aggregations (preview + unread). Must not scale with memberships.
      assert.ok(
        messageRoundTrips <= 4,
        `expected O(1) Message queries, got ${messageRoundTrips} (agg=${aggregateCalls}, findOne=${findOneCalls}, count=${countCalls}) for ${memberships} memberships`
      );
      assert.ok(
        messageRoundTrips < memberships,
        `Message queries (${messageRoundTrips}) must be strictly less than membership count (${memberships})`
      );
      assert.equal(findOneCalls, 0, "listConversations must not per-conversation findOne on Message");
      assert.equal(countCalls, 0, "listConversations must not per-conversation countDocuments on Message");
    } finally {
      Message.aggregate = originalAggregate;
      Message.findOne = originalFindOne;
      Message.countDocuments = originalCount;
    }
  });
});
