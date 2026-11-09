import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

const PASSWORD = "CorrectHorseBattery1";

let mongo;
let app;
let company;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  company = await Company.create({
    companyName: "Refresh Co",
    slug: "refresh-co",
    databaseName: "company_refresh_co",
    migrationVersion: 0,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });

  const { User } = await getCompanyModels(company);
  await User.create({
    email: "employee@refresh.test",
    passwordHash: await hashPassword(PASSWORD),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
    schemaVersion: 1,
  });
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("mobile refresh session", () => {
  it("does not issue a refresh token to web login", async () => {
    const response = await request(app).post("/api/auth/login").send({
      companyCode: "refresh-co",
      email: "employee@refresh.test",
      password: PASSWORD,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.refreshToken, undefined);
    assert.ok(response.body.token);
  });

  it("issues a refresh token to the Android client and renews an expired access token", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .set("X-HRMS-Client-Platform", "android")
      .send({
        companyCode: "refresh-co",
        email: "employee@refresh.test",
        password: PASSWORD,
      });

    assert.equal(login.status, 200);
    assert.equal(typeof login.body.refreshToken, "string");
    assert.ok(login.body.refreshToken.length >= 20);
    const companyId = String(login.body.company._id);

    const expired = jwt.sign(
      { sub: login.body.user._id || login.body.user.id, companyId },
      process.env.JWT_SECRET,
      {
        expiresIn: "0s",
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      }
    );
    const rejected = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${expired}`);
    assert.equal(rejected.status, 401);

    const models = await getCompanyModels(company);
    await models.AuthSession.updateOne(
      { token: login.body.token },
      { expiresAt: new Date(Date.now() - 60_000) }
    );

    const refreshed = await request(app).post("/api/auth/refresh").send({
      refreshToken: login.body.refreshToken,
      companyId,
    });

    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.token);
    assert.notEqual(refreshed.body.token, login.body.token);
    assert.equal(refreshed.body.user.email, "employee@refresh.test");

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${refreshed.body.token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, "employee@refresh.test");
  });

  it("rejects refresh after the refresh session is revoked", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .set("X-HRMS-Client-Platform", "android")
      .send({
        companyCode: "refresh-co",
        email: "employee@refresh.test",
        password: PASSWORD,
      });
    const companyId = String(login.body.company._id);

    const logout = await request(app).post("/api/auth/logout").send({
      refreshToken: login.body.refreshToken,
      companyId,
    });
    assert.equal(logout.status, 200);

    const refreshed = await request(app).post("/api/auth/refresh").send({
      refreshToken: login.body.refreshToken,
      companyId,
    });
    assert.equal(refreshed.status, 401);
  });

  it("rejects a refresh token after its refresh session has expired", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .set("X-HRMS-Client-Platform", "android")
      .send({
        companyCode: "refresh-co",
        email: "employee@refresh.test",
        password: PASSWORD,
      });

    const models = await getCompanyModels(company);
    await models.AuthSession.updateOne(
      { token: login.body.token },
      { refreshExpiresAt: new Date(Date.now() - 1000) }
    );

    const refreshed = await request(app).post("/api/auth/refresh").send({
      refreshToken: login.body.refreshToken,
      companyId: String(login.body.company._id),
    });
    assert.equal(refreshed.status, 401);
  });
});
