process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f49-auth-tenant-resolution-test-secret-32ch!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f49_auth";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.COMPANY_METADATA_CACHE_TTL_MS = "2000";
process.env.COMPANY_METADATA_CACHE_MAX = "32";

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import {
  clearCompanyMetadataCache,
  connectCentralDB,
  disconnectAll,
  findCompanyById,
  getCompanyMetadataCacheStats,
  getCompanyModels,
  invalidateCompanyMetadataCache,
} from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { resolveClientPlatformFromAuthSession } from "../utils/clientPlatform.js";
import { CLIENT_PLATFORMS } from "../utils/clientPlatform.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

describe("F49 auth tenant resolution", () => {
  let mongo;
  let app;
  let company;
  let otherCompany;
  let models;
  let hrCookie;
  let hrUser;
  let empCookie;
  let empUser;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    company = await Company.create({
      companyName: "F49 Acme",
      slug: "f49-acme",
      databaseName: "company_f49_acme",
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata" },
    });
    otherCompany = await Company.create({
      companyName: "F49 Globex",
      slug: "f49-globex",
      databaseName: "company_f49_globex",
      status: COMPANY_STATUSES.ACTIVE,
    });

    models = await getCompanyModels(company);
    const { User } = models;
    const otherModels = await getCompanyModels(otherCompany);

    hrUser = await User.create({
      email: "hr@f49-acme.test",
      passwordHash: await hashPassword("HrPass123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });
    empUser = await User.create({
      email: "emp@f49-acme.test",
      passwordHash: await hashPassword("EmpPass123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
    });
    await otherModels.User.create({
      email: "hr@f49-globex.test",
      passwordHash: await hashPassword("GxPass123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });

    hrCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "f49-acme",
        email: "hr@f49-acme.test",
        password: "HrPass123!",
      })
    );
    empCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "f49-acme",
        email: "emp@f49-acme.test",
        password: "EmpPass123!",
      })
    );
  });

  beforeEach(() => {
    clearCompanyMetadataCache();
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("happy-path authentication restores /auth/me with company fields", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.user?.email, "hr@f49-acme.test");
    assert.ok(res.body.company);
    assert.equal(res.body.company.slug || res.body.company.companyName, res.body.company.slug || "F49 Acme");
    assert.ok(res.body.company.config || res.body.company.companyName);
  });

  it("company cache hits within TTL without a second Mongo findById", async () => {
    let findCount = 0;
    const original = Company.findById.bind(Company);
    Company.findById = function patched(...args) {
      findCount += 1;
      return original(...args);
    };
    try {
      clearCompanyMetadataCache();
      await findCompanyById(company._id);
      assert.equal(findCount, 1);
      await findCompanyById(company._id);
      assert.equal(findCount, 1, "second lookup must be a cache hit");
      assert.equal(getCompanyMetadataCacheStats().size, 1);
    } finally {
      Company.findById = original;
    }
  });

  it("cache expiry refreshes from MongoDB", async () => {
    process.env.COMPANY_METADATA_CACHE_TTL_MS = "50";
    clearCompanyMetadataCache();
    let findCount = 0;
    const original = Company.findById.bind(Company);
    Company.findById = function patched(...args) {
      findCount += 1;
      return original(...args);
    };
    try {
      await findCompanyById(company._id);
      assert.equal(findCount, 1);
      await new Promise((r) => setTimeout(r, 80));
      await findCompanyById(company._id);
      assert.equal(findCount, 2, "expired entry must refresh");
    } finally {
      Company.findById = original;
      process.env.COMPANY_METADATA_CACHE_TTL_MS = "2000";
    }
  });

  it("invalidateCompanyMetadataCache forces refresh", async () => {
    let findCount = 0;
    const original = Company.findById.bind(Company);
    Company.findById = function patched(...args) {
      findCount += 1;
      return original(...args);
    };
    try {
      await findCompanyById(company._id);
      invalidateCompanyMetadataCache(company._id);
      await findCompanyById(company._id);
      assert.equal(findCount, 2);
    } finally {
      Company.findById = original;
    }
  });

  it("company status update invalidates cache and suspended company is rejected", async () => {
    // Warm cache while ACTIVE
    await findCompanyById(company._id);
    await Company.updateOne({ _id: company._id }, { $set: { status: COMPANY_STATUSES.SUSPENDED } });
    // Hook should invalidate; next auth must see SUSPENDED
    const res = await request(app).get("/api/auth/me").set("Cookie", hrCookie);
    assert.equal(res.status, 403);
    assert.match(String(res.body.message || ""), /not available/i);

    await Company.updateOne({ _id: company._id }, { $set: { status: COMPANY_STATUSES.ACTIVE } });
    // Re-login after suspend (session may still be fine once company active again)
    hrCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "f49-acme",
        email: "hr@f49-acme.test",
        password: "HrPass123!",
      })
    );
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", hrCookie)).status, 200);
  });

  it("User and AuthSession lookups run concurrently (Promise.all)", async () => {
    const { User, AuthSession } = models;
    const starts = [];
    const originalUserFind = User.findById.bind(User);
    const originalSessionFind = AuthSession.findOne.bind(AuthSession);

    User.findById = function patched(...args) {
      starts.push({ who: "user", t: Date.now() });
      return originalUserFind(...args);
    };
    AuthSession.findOne = function patched(...args) {
      starts.push({ who: "session", t: Date.now() });
      return originalSessionFind(...args);
    };

    try {
      const res = await request(app).get("/api/auth/me").set("Cookie", empCookie);
      assert.equal(res.status, 200);
      const userStart = starts.find((s) => s.who === "user");
      const sessionStart = starts.find((s) => s.who === "session");
      assert.ok(userStart && sessionStart);
      // Concurrent: session started before user finished (starts within a small window)
      assert.ok(Math.abs(userStart.t - sessionStart.t) < 50);
    } finally {
      User.findById = originalUserFind;
      AuthSession.findOne = originalSessionFind;
    }
  });

  it("inactive session produces logout error; missing session still allows auth", async () => {
    const login = await request(app).post("/api/auth/login").send({
      companyCode: "f49-acme",
      email: "emp@f49-acme.test",
      password: "EmpPass123!",
    });
    const cookie = cookieFrom(login);
    assert.equal(login.status, 200);

    const token = String(cookie).split("=")[1].split(";")[0];
    await models.AuthSession.updateMany({ token }, { $set: { isActive: false } });

    const loggedOut = await request(app).get("/api/auth/me").set("Cookie", cookie);
    assert.equal(loggedOut.status, 401);
    assert.match(String(loggedOut.body.message || ""), /logged out/i);

    // Missing session row: delete all sessions for a fresh login token then delete rows
    const login2 = await request(app).post("/api/auth/login").send({
      companyCode: "f49-acme",
      email: "emp@f49-acme.test",
      password: "EmpPass123!",
    });
    const cookie2 = cookieFrom(login2);
    const token2 = String(cookie2).split("=")[1].split(";")[0];
    await models.AuthSession.deleteMany({ token: token2 });
    const missing = await request(app).get("/api/auth/me").set("Cookie", cookie2);
    assert.equal(missing.status, 200, "missing AuthSession row remains allowed");
  });

  it("inactive user is rejected", async () => {
    empUser.isActive = false;
    await empUser.save();
    const res = await request(app).get("/api/auth/me").set("Cookie", empCookie);
    assert.equal(res.status, 401);
    empUser.isActive = true;
    await empUser.save();
    empCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "f49-acme",
        email: "emp@f49-acme.test",
        password: "EmpPass123!",
      })
    );
  });

  it("cross-tenant isolation: acme cookie cannot see globex company user context", async () => {
    const gxLogin = await request(app).post("/api/auth/login").send({
      companyCode: "f49-globex",
      email: "hr@f49-globex.test",
      password: "GxPass123!",
    });
    assert.equal(gxLogin.status, 200);
    const gxMe = await request(app).get("/api/auth/me").set("Cookie", cookieFrom(gxLogin));
    assert.equal(gxMe.status, 200);
    assert.equal(gxMe.body.user?.email, "hr@f49-globex.test");

    const acmeMe = await request(app).get("/api/auth/me").set("Cookie", hrCookie);
    assert.equal(acmeMe.body.user?.email, "hr@f49-acme.test");
    assert.notEqual(acmeMe.body.user?.email, gxMe.body.user?.email);
  });

  it("logout then reuse of the same token is rejected", async () => {
    const login = await request(app).post("/api/auth/login").send({
      companyCode: "f49-acme",
      email: "hr@f49-acme.test",
      password: "HrPass123!",
    });
    const cookie = cookieFrom(login);
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookie)).status, 200);

    const logout = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    assert.ok(logout.status === 200 || logout.status === 204 || logout.status === 200);

    const reused = await request(app).get("/api/auth/me").set("Cookie", cookie);
    assert.equal(reused.status, 401);
  });

  it("resolveClientPlatformFromAuthSession reuses attached session without Mongo find", async () => {
    let findCount = 0;
    const original = models.AuthSession.findOne.bind(models.AuthSession);
    models.AuthSession.findOne = function patched(...args) {
      findCount += 1;
      return original(...args);
    };
    try {
      const platform = await resolveClientPlatformFromAuthSession(models, "unused-token", {
        session: { isActive: true, clientPlatform: CLIENT_PLATFORMS.ANDROID },
      });
      assert.equal(platform, CLIENT_PLATFORMS.ANDROID);
      assert.equal(findCount, 0);
    } finally {
      models.AuthSession.findOne = original;
    }
  });

  it("warm-path AuthSession uses a single findOne by token", async () => {
    const filters = [];
    const original = models.AuthSession.findOne.bind(models.AuthSession);
    models.AuthSession.findOne = function patched(filter, ...rest) {
      filters.push(filter);
      return original(filter, ...rest);
    };
    try {
      const res = await request(app).get("/api/auth/me").set("Cookie", empCookie);
      assert.equal(res.status, 200);
      const authSessionFinds = filters.filter((f) => f && Object.prototype.hasOwnProperty.call(f, "token"));
      assert.equal(authSessionFinds.length, 1);
      assert.equal(Object.prototype.hasOwnProperty.call(authSessionFinds[0], "isActive"), false);
    } finally {
      models.AuthSession.findOne = original;
    }
  });

  it("candidate role cannot authenticate through password login as employee portal", async () => {
    const { User } = models;
    await User.create({
      email: "cand@f49-acme.test",
      passwordHash: await hashPassword("CandPass123!"),
      role: USER_ROLES.CANDIDATE,
      isActive: true,
    });
    const login = await request(app).post("/api/auth/login").send({
      companyCode: "f49-acme",
      email: "cand@f49-acme.test",
      password: "CandPass123!",
    });
    // Login may reject candidates at login, or issue a token that authenticate rejects.
    if (login.status === 200) {
      const me = await request(app).get("/api/auth/me").set("Cookie", cookieFrom(login));
      assert.equal(me.status, 401);
    } else {
      assert.ok(login.status >= 400);
    }
  });
});
