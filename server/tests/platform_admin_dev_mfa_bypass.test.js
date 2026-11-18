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
// Enforce MFA for baseline tests unless a case explicitly pauses it.
process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT = "on";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll } from "../config/db.js";
import PlatformAdmin from "../models/PlatformAdmin.js";
import { hashPassword } from "../utils/password.js";
import { getPlatformAuthCookieName } from "../utils/platformAuthCookie.js";
import {
  isPlatformAdminDevMfaBypassEnabled,
  isPlatformAdminMfaBypassEnabled,
  isPlatformAdminMfaEnforcementPaused,
} from "../utils/platformDevMfaBypass.js";

function cookieFrom(response, name) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${name}=`));
}

describe("Platform Admin MFA bypass / temporary enforcement pause", () => {
  let mongo;
  let app;
  const email = "platform-dev@hrms.test";
  const password = "PlatformDevPass123!";
  let previousNodeEnv;
  let previousEnforcement;

  before(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    previousEnforcement = process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT;
    process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT = "on";
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
    process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT = previousEnforcement;
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("enables the development safeguard only for NODE_ENV=development", () => {
    process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT = "on";
    process.env.NODE_ENV = "development";
    assert.equal(isPlatformAdminDevMfaBypassEnabled(), true);
    assert.equal(isPlatformAdminMfaBypassEnabled(), true);

    process.env.NODE_ENV = "production";
    assert.equal(isPlatformAdminDevMfaBypassEnabled(), false);
    assert.equal(isPlatformAdminMfaBypassEnabled(), false);

    process.env.NODE_ENV = "test";
    assert.equal(isPlatformAdminDevMfaBypassEnabled(), false);

    process.env.NODE_ENV = "staging";
    assert.equal(isPlatformAdminDevMfaBypassEnabled(), false);
  });

  it("pauses MFA enforcement when PLATFORM_ADMIN_MFA_ENFORCEMENT is off (incl. production)", () => {
    process.env.NODE_ENV = "production";
    process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT = "off";
    assert.equal(isPlatformAdminMfaEnforcementPaused(), true);
    assert.equal(isPlatformAdminMfaBypassEnabled(), true);

    process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT = "on";
    assert.equal(isPlatformAdminMfaEnforcementPaused(), false);
    assert.equal(isPlatformAdminMfaBypassEnabled(), false);

    delete process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT;
    assert.equal(isPlatformAdminMfaEnforcementPaused(), true);
  });

  it("issues a full session after password login in development (skips MFA)", async () => {
    process.env.NODE_ENV = "development";
    process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT = "on";
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

  it("with enforcement on, production still requires MFA enrollment", async () => {
    process.env.NODE_ENV = "production";
    process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT = "on";
    assert.equal(isPlatformAdminMfaBypassEnabled(), false);

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

  it("with temporary pause, production password login reaches the dashboard session", async () => {
    process.env.NODE_ENV = "production";
    process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT = "off";
    assert.equal(isPlatformAdminMfaBypassEnabled(), true);

    const res = await request(app).post("/api/platform/auth/login").send({
      email,
      password,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.mfaBypassed, true);
    assert.equal(res.body.requiresMfa, false);
    assert.equal(res.body.requiresMfaSetup, false);
    assert.ok(res.body.token);

    const platformCookie = cookieFrom(res, getPlatformAuthCookieName());
    assert.ok(platformCookie);

    const me = await request(app)
      .get("/api/platform/auth/me")
      .set("Cookie", platformCookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.admin.mfaEnabled, false);

    const bad = await request(app).post("/api/platform/auth/login").send({
      email,
      password: "WrongPassword!!!",
    });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.code, "PLATFORM_INVALID_CREDENTIALS");
  });

  it("does not apply development bypass when NODE_ENV=test and enforcement is on", async () => {
    process.env.NODE_ENV = "test";
    process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT = "on";
    assert.equal(isPlatformAdminDevMfaBypassEnabled(), false);
    assert.equal(isPlatformAdminMfaBypassEnabled(), false);

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
