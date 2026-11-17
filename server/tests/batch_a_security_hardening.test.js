process.env.NODE_ENV = "test";
process.env.MONGOMS_MD5_CHECK = "0";

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import {
  COMPANY_AUTH_SELECT,
  connectCentralDB,
  disconnectAll,
  findCompanyById,
  findCompanyBySlug,
  getCentralDbName,
  getCompanyModels,
} from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { getRateLimitHitModel } from "../models/RateLimitHit.js";
import { USER_ROLES } from "../models/User.js";
import { createMongoRateLimitStore } from "../middleware/mongoRateLimitStore.js";
import {
  ensureCentralEphemeralTtlIndexes,
  ensureTenantEphemeralTtlIndexes,
  getCentralEphemeralTtlSpecs,
  getTenantEphemeralTtlSpecs,
  inventoryTtlIndexes,
} from "../services/ephemeralTtlIndexes.js";
import { encryptSecret } from "../utils/secretCrypto.js";
import { hashPassword } from "../utils/password.js";
import {
  corsOriginDelegate,
  getCorsAllowlist,
  isOriginAllowed,
} from "../utils/corsOrigins.js";
import {
  signPlatformAuthToken,
  verifyPlatformAuthToken,
} from "../utils/platformToken.js";

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let mongo;
let app;

describe("Batch A — security & production hardening", () => {
  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    process.env.CENTRAL_DB_NAME = "platform_batch_a";
    process.env.JWT_SECRET = "batch-a-company-jwt-secret-32chars!!";
    process.env.PLATFORM_JWT_SECRET = "batch-a-platform-jwt-secret-32chars!";
    process.env.CLIENT_URL = "https://mern-project-nu-nine.vercel.app";
    process.env.COOKIE_SECRET = "batch-a-cookie-secret-at-least-32-chars!";
    await connectCentralDB();
    app = createApp();
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  beforeEach(async () => {
    await Company.deleteMany({});
    const RateLimitHit = getRateLimitHitModel();
    await RateLimitHit.deleteMany({});
    process.env.NODE_ENV = "test";
    process.env.PLATFORM_JWT_SECRET = "batch-a-platform-jwt-secret-32chars!";
    delete process.env.RATE_LIMIT_FAIL_CLOSED;
  });

  describe("F80 CORS allowlist", () => {
    it("allows configured production origin and rejects unauthorized origins", () => {
      assert.equal(
        isOriginAllowed("https://mern-project-nu-nine.vercel.app"),
        true
      );
      assert.equal(isOriginAllowed("https://evil-preview.vercel.app"), false);
      assert.equal(isOriginAllowed("https://evil.onrender.com"), false);
      assert.equal(isOriginAllowed(undefined), true);
      assert.equal(isOriginAllowed(null), true);
    });

    it("allows localhost only outside production", () => {
      process.env.NODE_ENV = "development";
      assert.equal(isOriginAllowed("http://localhost:5173"), true);
      assert.equal(isOriginAllowed("http://127.0.0.1:3000"), true);

      process.env.NODE_ENV = "production";
      assert.equal(isOriginAllowed("http://localhost:5173"), false);
      assert.equal(
        isOriginAllowed("https://mern-project-nu-nine.vercel.app"),
        true
      );
      process.env.NODE_ENV = "test";
    });

    it("honors CORS_ALLOWED_ORIGINS extras", () => {
      process.env.CORS_ALLOWED_ORIGINS =
        "https://custom-app.example.com, https://admin.example.com/";
      assert.equal(isOriginAllowed("https://custom-app.example.com"), true);
      assert.equal(isOriginAllowed("https://admin.example.com"), true);
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it("cors delegate rejects unauthorized without throwing", async () => {
      const allowed = await new Promise((resolve, reject) => {
        corsOriginDelegate("https://ok.example", (err, value) => {
          if (err) reject(err);
          else resolve(value);
        });
      }).catch(() => "threw");
      // ok.example not allowlisted
      assert.equal(allowed, false);

      const denied = await new Promise((resolve, reject) => {
        corsOriginDelegate("https://attacker.vercel.app", (err, value) => {
          if (err) reject(err);
          else resolve(value);
        });
      });
      assert.equal(denied, false);
    });

    it("preflight and credentialed request from allowlisted origin succeed", async () => {
      const origin = "https://mern-project-nu-nine.vercel.app";
      const preflight = await request(app)
        .options("/api/auth/login")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "content-type");

      assert.ok([200, 204].includes(preflight.status));
      assert.equal(preflight.headers["access-control-allow-origin"], origin);
      assert.equal(preflight.headers["access-control-allow-credentials"], "true");

      const blocked = await request(app)
        .options("/api/auth/login")
        .set("Origin", "https://evil-preview.vercel.app")
        .set("Access-Control-Request-Method", "POST");
      assert.equal(
        blocked.headers["access-control-allow-origin"],
        undefined
      );
    });

    it("allowlist includes CLIENT_URL", () => {
      const list = getCorsAllowlist();
      assert.ok(list.has("https://mern-project-nu-nine.vercel.app"));
    });
  });

  describe("F65 shared Mongo rate-limit store", () => {
    it("shares atomic counters across store instances (simulated isolates)", async () => {
      process.env.RATE_LIMIT_FAIL_CLOSED = "true";
      const storeA = createMongoRateLimitStore({ prefix: "rl:test-login:" });
      const storeB = createMongoRateLimitStore({ prefix: "rl:test-login:" });
      storeA.init({ windowMs: 60_000 });
      storeB.init({ windowMs: 60_000 });

      const key = "1.2.3.4";
      const a1 = await storeA.increment(key);
      const b1 = await storeB.increment(key);
      const a2 = await storeA.increment(key);

      assert.equal(a1.totalHits, 1);
      assert.equal(b1.totalHits, 2);
      assert.equal(a2.totalHits, 3);
    });

    it("fail-closed on store failure in production mode", async () => {
      const store = createMongoRateLimitStore({ prefix: "rl:fail:" });
      store.init({ windowMs: 60_000 });
      store._docId = async () => {
        throw new Error("simulated mongo outage");
      };

      process.env.NODE_ENV = "production";
      process.env.RATE_LIMIT_FAIL_CLOSED = "true";
      const result = await store.increment("user-1");
      assert.ok(result.totalHits >= 10);
      process.env.NODE_ENV = "test";
    });

    it("Mongo store reports localKeys=false (shared across instances)", () => {
      const store = createMongoRateLimitStore({ prefix: "rl:assert:" });
      assert.equal(store.localKeys, false);
      assert.equal(typeof store.increment, "function");
    });
  });

  describe("F84 SMTP exclusion from auth", () => {
    it("auth projection and cache omit emailSettings", async () => {
      assert.match(COMPANY_AUTH_SELECT, /emailSettings/);

      const company = await Company.create({
        companyName: "SMTP Co",
        slug: "smtp-co",
        databaseName: "tenant_smtp_co",
        status: COMPANY_STATUSES.ACTIVE,
        emailSettings: {
          fromName: "HR",
          fromEmail: "hr@smtp.test",
          smtpHost: "smtp.smtp.test",
          smtpPort: 587,
          smtpSecure: false,
          appPasswordEncrypted: encryptSecret("super-secret-smtp-pass"),
          isConfigured: true,
        },
      });

      const byId = await findCompanyById(company._id);
      assert.ok(byId);
      assert.equal(byId.emailSettings, undefined);

      const bySlug = await findCompanyBySlug("smtp-co");
      assert.ok(bySlug);
      assert.equal(bySlug.emailSettings, undefined);

      const leanDefault = await Company.findById(company._id).lean();
      assert.equal(leanDefault.emailSettings?.appPasswordEncrypted, undefined);

      const withSecret = await Company.findById(company._id)
        .select("+emailSettings.appPasswordEncrypted")
        .lean();
      assert.ok(withSecret.emailSettings.appPasswordEncrypted);
    });

    it("login still works without loading SMTP ciphertext", async () => {
      const company = await Company.create({
        companyName: "Login Co",
        slug: "login-co",
        databaseName: "tenant_login_co",
        status: COMPANY_STATUSES.ACTIVE,
        emailSettings: {
          fromEmail: "hr@login.test",
          appPasswordEncrypted: encryptSecret("login-smtp-pass"),
          isConfigured: true,
        },
      });
      const { User } = await getCompanyModels(company);
      await User.create({
        email: "hr@login.test",
        passwordHash: await hashPassword("LoginPass123!"),
        role: USER_ROLES.HR_ADMIN,
        isActive: true,
        schemaVersion: 1,
      });

      const res = await request(app).post("/api/auth/login").send({
        companyCode: "login-co",
        email: "hr@login.test",
        password: "LoginPass123!",
      });
      assert.equal(res.status, 200);
      assert.ok(res.headers["set-cookie"]);
    });
  });

  describe("F85 PLATFORM_JWT_SECRET fail-closed", () => {
    it("signs and verifies with issuer/audience using PLATFORM_JWT_SECRET", () => {
      const token = signPlatformAuthToken({ adminId: "507f1f77bcf86cd799439011" });
      const decoded = verifyPlatformAuthToken(token);
      assert.equal(decoded.typ, "platform_admin");
      assert.equal(decoded.iss, "hrms-platform-admin");
      assert.equal(decoded.aud, "hrms-platform-admins");
    });

    it("production rejects missing PLATFORM_JWT_SECRET even if JWT_SECRET is set", () => {
      const prevNode = process.env.NODE_ENV;
      const prevPlatform = process.env.PLATFORM_JWT_SECRET;
      process.env.NODE_ENV = "production";
      delete process.env.PLATFORM_JWT_SECRET;
      process.env.JWT_SECRET = "batch-a-company-jwt-secret-32chars!!";

      assert.throws(
        () => signPlatformAuthToken({ adminId: "507f1f77bcf86cd799439011" }),
        /PLATFORM_JWT_SECRET must be set/
      );

      process.env.NODE_ENV = prevNode;
      process.env.PLATFORM_JWT_SECRET = prevPlatform;
    });

    it("non-production can fall back to JWT_SECRET", () => {
      const prevPlatform = process.env.PLATFORM_JWT_SECRET;
      delete process.env.PLATFORM_JWT_SECRET;
      process.env.NODE_ENV = "development";
      process.env.JWT_SECRET = "batch-a-company-jwt-secret-32chars!!";

      const token = signPlatformAuthToken({ adminId: "507f1f77bcf86cd799439011" });
      assert.ok(token);

      process.env.PLATFORM_JWT_SECRET = prevPlatform;
      process.env.NODE_ENV = "test";
    });
  });

  describe("F43-OPS / F45 TTL indexes", () => {
    it("inventories planned ephemeral TTL specs without business collections", () => {
      const tenant = getTenantEphemeralTtlSpecs();
      const central = getCentralEphemeralTtlSpecs();
      const names = [...tenant, ...central].map((s) => s.collectionName);
      assert.ok(names.includes("authTokens"));
      assert.ok(names.includes("authSessions"));
      assert.ok(names.includes("attendance_verification_challenges"));
      assert.ok(names.includes("platform_admin_sessions"));
      assert.ok(names.includes("rate_limit_hits"));
      assert.ok(!names.includes("employees"));
      assert.ok(!names.includes("payslips"));
      assert.ok(!names.includes("live_tracking_sessions"));
    });

    it("creates TTL indexes on central ephemeral collections", async () => {
      await ensureCentralEphemeralTtlIndexes(mongoose.connection);
      const inventory = await inventoryTtlIndexes(mongoose.connection.db);
      const platform = inventory.find(
        (i) =>
          i.collection === "platform_admin_sessions" &&
          i.name === "expiresAt_ttl"
      );
      const rate = inventory.find(
        (i) => i.collection === "rate_limit_hits" && i.name === "expiresAt_ttl"
      );
      assert.ok(platform);
      assert.equal(platform.expireAfterSeconds, 0);
      assert.ok(rate);
      assert.equal(rate.expireAfterSeconds, 0);
    });

    it("creates AuthSession purgeAt TTL and token/challenge TTLs on tenant db", async () => {
      const company = await Company.create({
        companyName: "TTL Co",
        slug: "ttl-co",
        databaseName: "tenant_ttl_co",
        status: COMPANY_STATUSES.ACTIVE,
      });
      const { AuthSession } = await getCompanyModels(company, { provision: true });
      assert.ok(AuthSession);

      const conn = AuthSession.db;
      await ensureTenantEphemeralTtlIndexes(conn);
      const inventory = await inventoryTtlIndexes(conn.db);
      const sessionTtl = inventory.find((i) => i.name === "purgeAt_ttl");
      const tokens = inventory.find(
        (i) => i.collection === "authTokens" && i.name === "expiresAt_ttl"
      );
      const challenges = inventory.find(
        (i) =>
          i.collection === "attendance_verification_challenges" &&
          i.name === "expiresAt_ttl"
      );
      assert.ok(sessionTtl);
      assert.equal(sessionTtl.expireAfterSeconds, 0);
      assert.deepEqual(sessionTtl.key, { purgeAt: 1 });
      assert.ok(tokens);
      assert.ok(challenges);
      // Must never TTL LiveTrackingSession / employees via this helper.
      assert.equal(
        inventory.some((i) => i.collection === "live_tracking_sessions"),
        false
      );
    });
  });
});
