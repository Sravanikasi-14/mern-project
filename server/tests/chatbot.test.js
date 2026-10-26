import assert from "node:assert/strict";
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
import {
  validateChatInput,
  getAuthorizedContext,
  buildSystemInstruction,
} from "../services/chatbotService.js";
import { DEFAULT_GEMINI_MODEL } from "../config/gemini.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

let mongo;
let app;
let companyA;
let companyB;
let userCookieA;
let userCookieB;
let employeeA;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  // 1. Company A Setup
  companyA = await Company.create({
    companyName: "Acme Innovations",
    slug: "acme-ai",
    databaseName: "company_acme_ai_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const modelsA = await getCompanyModels(companyA);

  const userA = await modelsA.User.create({
    email: "dev@acme.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  employeeA = await modelsA.Employee.create({
    userId: userA._id,
    companyId: companyA._id,
    employeeCode: "DEV-101",
    fullName: "Alice Developer",
    email: "dev@acme.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { department: "Engineering", jobTitle: "Full Stack Engineer" },
  });

  // 2. Company B Setup (for tenant isolation check)
  companyB = await Company.create({
    companyName: "Beta Systems",
    slug: "beta-ai",
    databaseName: "company_beta_ai_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const modelsB = await getCompanyModels(companyB);

  await modelsB.User.create({
    email: "dev@beta.test",
    passwordHash: await hashPassword("BetaPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  // Log in User A
  const loginA = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "acme-ai", email: "dev@acme.test", password: "AcmePass123!" });
  userCookieA = cookieFrom(loginA);

  // Log in User B
  const loginB = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "beta-ai", email: "dev@beta.test", password: "BetaPass123!" });
  userCookieB = cookieFrom(loginB);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("Gemini AI Chatbot Integration Suite", () => {
  it("1. Unauthenticated requests to /api/chat endpoints are rejected with 401", async () => {
    const resMessage = await request(app)
      .post("/api/chat/message")
      .send({ message: "Hello" });
    assert.equal(resMessage.status, 401);

    const resStatus = await request(app).get("/api/chat/status");
    assert.equal(resStatus.status, 401);
  });

  it("2. Authenticated status endpoint returns configuration status and model name", async () => {
    const res = await request(app)
      .get("/api/chat/status")
      .set("Cookie", userCookieA);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(typeof res.body.isConfigured, "boolean");
    assert.equal(res.body.model, DEFAULT_GEMINI_MODEL);
    // Ensure API key is NEVER returned in response
    assert.equal(res.body.apiKey, undefined);
    assert.equal(JSON.stringify(res.body).includes("AIza"), false);
  });

  it("3. Input validation: empty or invalid message is rejected with 400", async () => {
    const emptyRes = await request(app)
      .post("/api/chat/message")
      .set("Cookie", userCookieA)
      .send({ message: "   " });
    assert.equal(emptyRes.status, 400);

    const nullRes = await request(app)
      .post("/api/chat/message")
      .set("Cookie", userCookieA)
      .send({ message: null });
    assert.equal(nullRes.status, 400);

    const tooLongRes = await request(app)
      .post("/api/chat/message")
      .set("Cookie", userCookieA)
      .send({ message: "a".repeat(2001) });
    assert.equal(tooLongRes.status, 400);
  });

  it("4. Input validation: malformed history structure is rejected with 400", async () => {
    const invalidHistoryRes = await request(app)
      .post("/api/chat/message")
      .set("Cookie", userCookieA)
      .send({ message: "Valid message", history: "not-an-array" });
    assert.equal(invalidHistoryRes.status, 400);
  });

  it("5. Missing API Key handling: returns friendly 503 when GEMINI_API_KEY is not set", async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const res = await request(app)
        .post("/api/chat/message")
        .set("Cookie", userCookieA)
        .send({ message: "What are the office hours?" });

      assert.equal(res.status, 503);
      assert.equal(res.body.code, "SERVICE_UNAVAILABLE");
    } finally {
      if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    }
  });

  it("6. Context Builder & System Instruction gathers only safe, authorized data", async () => {
    const modelsA = await getCompanyModels(companyA);
    const userA = await modelsA.User.findOne({ email: "dev@acme.test" });

    const context = await getAuthorizedContext({
      models: modelsA,
      user: userA,
      company: companyA,
    });

    assert.equal(context.companyName, "Acme Innovations");
    assert.equal(context.userRole, USER_ROLES.EMPLOYEE);
    assert.equal(context.employee.fullName, "Alice Developer");
    assert.equal(context.employee.employeeCode, "DEV-101");
    assert.equal(context.employee.department, "Engineering");

    // Strictly ensure no password hashes or tokens exist in context
    assert.equal(context.userPassword, undefined);
    assert.equal(context.passwordHash, undefined);
    assert.equal(JSON.stringify(context).includes("passwordHash"), false);

    const instruction = buildSystemInstruction(context);
    assert.match(instruction, /HRMS Assistant/);
    assert.match(instruction, /Acme Innovations/);
    assert.match(instruction, /Alice Developer/);
    assert.match(instruction, /Autonomous Actions Prohibition/);
  });

  it("7. Tenant Isolation: Context builder only reads data from user's authenticated tenant", async () => {
    const modelsB = await getCompanyModels(companyB);
    const userB = await modelsB.User.findOne({ email: "dev@beta.test" });

    const contextB = await getAuthorizedContext({
      models: modelsB,
      user: userB,
      company: companyB,
    });

    assert.equal(contextB.companyName, "Beta Systems");
    assert.equal(contextB.userEmail, "dev@beta.test");
    // Ensure user B does not see Alice Developer from Company A
    assert.notEqual(contextB.employee?.fullName, "Alice Developer");
  });

  it("8. validateChatInput utility function validates and sanitizes turn history", () => {
    const valid = validateChatInput("Hello AI", [
      { role: "user", text: "Hi" },
      { role: "model", text: "Hello there!" },
    ]);

    assert.equal(valid.userMessage, "Hello AI");
    assert.equal(valid.sanitizedHistory.length, 2);
    assert.equal(valid.sanitizedHistory[0].role, "user");
    assert.equal(valid.sanitizedHistory[0].parts[0].text, "Hi");
    assert.equal(valid.sanitizedHistory[1].role, "model");
  });

  it("9. Descriptive error handling: returns informative error response instead of generic SERVER_ERROR", async () => {
    // When API key is invalid/missing, ensure the response message is descriptive and code is not SERVER_ERROR
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const res = await request(app)
        .post("/api/chat/message")
        .set("Cookie", userCookieA)
        .send({ message: "What is my leave policy?" });

      assert.notEqual(res.body.code, "SERVER_ERROR");
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /AI assistant service is currently unavailable|GEMINI_API_KEY/i);
    } finally {
      if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    }
  });

  it("10. Null / missing body protection in handleChat returns 400 validation error cleanly", async () => {
    const res = await request(app)
      .post("/api/chat/message")
      .set("Cookie", userCookieA)
      .send();

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, "VALIDATION_ERROR");
    assert.match(res.body.message, /required/i);
  });

  it("11. Streaming endpoint /api/chat/stream rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/api/chat/stream")
      .send({ message: "Hello stream" });

    assert.equal(res.status, 401);
  });

  it("12. Streaming endpoint sets SSE headers and sends immediate connection handshake", async () => {
    const res = await request(app)
      .post("/api/chat/stream")
      .set("Cookie", userCookieA)
      .send({ message: "What is the policy?" });

    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/event-stream/);
    assert.equal(res.headers["cache-control"], "no-cache, no-transform");
    assert.equal(res.headers["connection"], "keep-alive");
    // Verify immediate connection handshake comment was written
    assert.match(res.text, /: connected/);
  });
});

