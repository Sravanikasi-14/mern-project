process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "tenant-jwt-secret-for-platform-dev-bypass-tests!";
process.env.PLATFORM_JWT_SECRET = "platform-jwt-secret-dev-bypass-tests-32!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_admin_dev_mfa_bypass";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.PLATFORM_AUTH_COOKIE_NAME = "hrms_platform_auth";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll } from "../config/db.js";
import PlatformAdmin from "../models/PlatformAdmin.js";
import { hashPassword } from "../utils/password.js";
import { getPlatformAuthCookieName } from "../utils/platformAuthCookie.js";
import { isPlatformAdminDevMfaBypassEnabled } from "../utils/platformDevMfaBypass.js";

function cookieFrom(response, name) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${name}=`));
}

describe("Platform Admin development MFA bypass", () => {
  let mongo;
  let app;
  const email = "platform-dev@hrms.test";
  const password = "PlatformDevPass123!";
  let previousNodeEnv;

  before(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    await PlatformAdmin.create({
      singletonKey: "default",
      email,
      passwordHash: await hashPassword(password),
      fullName: "Platform Dev Admin",
      isActive: true,
      mfaEnabled: false,
    });
  });

  after(async () => {
    process.env.NODE_ENV = previousNodeEnv;
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("enables the safeguard only for NODE_ENV=development", () => {
    process.env.NODE_ENV = "development";
    assert.equal(isPlatformAdminDevMfaBypassEnabled(), true);

    process.env.NODE_ENV = "production";
    assert.equal(isPlatformAdminDevMfaBypassEnabled(), false);

    process.env.NODE_ENV = "test";
    assert.equal(isPlatformAdminDevMfaBypassEnabled(), false);

    process.env.NODE_ENV = "staging";
    assert.equal(isPlatformAdminDevMfaBypassEnabled(), false);
  });

  it("issues a full session after password login in development (skips MFA)", async () => {
    process.env.NODE_ENV = "development";
    assert.equal(isPlatformAdminDevMfaBypassEnabled(), true);

    const res = await request(app).post("/api/platform/auth/login").send({
      email,
      password,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.mfaBypassed, true);
    assert.equal(res.body.requiresMfa, false);
    assert.equal(res.body.requiresMfaSetup, false);
    assert.ok(res.body.token);
    assert.equal(res.body.admin?.email, email);
    assert.equal(res.body.mfaToken, undefined);

    const platformCookie = cookieFrom(res, getPlatformAuthCookieName());
    assert.ok(platformCookie);

    const me = await request(app)
      .get("/api/platform/auth/me")
      .set("Cookie", platformCookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.admin.email, email);
    // Admin MFA state must remain unchanged (no DB mutation by bypass).
    assert.equal(me.body.admin.mfaEnabled, false);

    const overview = await request(app)
      .get("/api/platform/overview")
      .set("Cookie", platformCookie);
    assert.equal(overview.status, 200);
  });

  it("rejects MFA bypass in production and still requires enrollment", async () => {
    process.env.NODE_ENV = "production";
    assert.equal(isPlatformAdminDevMfaBypassEnabled(), false);

    const res = await request(app).post("/api/platform/auth/login").send({
      email,
      password,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.requiresMfaSetup, true);
    assert.ok(res.body.mfaToken);
    assert.equal(res.body.token, undefined);
    assert.equal(res.body.mfaBypassed, undefined);
    assert.equal(cookieFrom(res, getPlatformAuthCookieName()), undefined);

    const me = await request(app).get("/api/platform/auth/me");
    assert.equal(me.status, 401);
  });

  it("does not bypass MFA when NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";
    assert.equal(isPlatformAdminDevMfaBypassEnabled(), false);

    const res = await request(app).post("/api/platform/auth/login").send({
      email,
      password,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.requiresMfaSetup, true);
    assert.ok(res.body.mfaToken);
    assert.equal(res.body.token, undefined);
  });
});
