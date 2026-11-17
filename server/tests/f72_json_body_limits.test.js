process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f72-json-body-limits-secret-32chars!!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f72_json";
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
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import {
  JSON_BODY_LIMIT_DEFAULT,
  JSON_BODY_LIMIT_FACE,
  JSON_BODY_LIMIT_MEDIA,
} from "../middleware/jsonBodyLimits.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let mongo;
let app;
let hrCookie;

before(async () => {
  fs.mkdirSync("D:/tmp/hrms-mongo/f72-json-body", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/f72-json-body" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  const company = await Company.create({
    companyName: "F72 Co",
    slug: `f72-${Date.now()}`,
    databaseName: `company_f72_${Date.now()}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
  });
  const models = await getCompanyModels(company, { provision: true });
  await models.User.create({
    email: "hr@f72.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
    schemaVersion: 1,
  });
  hrCookie = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ companyCode: company.slug, email: "hr@f72.test", password: "Password123!" })
  );
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("F72 JSON body limits", () => {
  it("exports conservative default and elevated face/media limits", () => {
    assert.equal(JSON_BODY_LIMIT_DEFAULT, "256kb");
    assert.equal(JSON_BODY_LIMIT_FACE, "10mb");
    assert.equal(JSON_BODY_LIMIT_MEDIA, "3mb");
  });

  it("rejects oversized JSON on ordinary routes with 413", async () => {
    const oversized = "x".repeat(300_000); // > 256kb
    const res = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: "x", email: "a@b.c", password: oversized });
    assert.equal(res.status, 413);
    assert.equal(res.body.code, "PAYLOAD_TOO_LARGE");
  });

  it("accepts large JSON envelope on face punch route (auth may fail after parse)", async () => {
    const facePayload = "a".repeat(500_000); // > 256kb, well under 10mb
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", hrCookie || "")
      .send({ faceImageBase64: facePayload, method: "FACE" });
    // Must not be 413 — body parsed under face limit. 401/4xx business errors OK.
    assert.notEqual(res.status, 413);
  });

  it("accepts media-sized JSON on avatar route without 413", async () => {
    const dataUrl = `data:image/png;base64,${Buffer.alloc(400_000, 1).toString("base64")}`;
    const res = await request(app)
      .post("/api/auth/profile/avatar")
      .set("Cookie", hrCookie)
      .send({ fileName: "a.png", mimeType: "image/png", fileData: dataUrl });
    assert.notEqual(res.status, 413);
  });
});
