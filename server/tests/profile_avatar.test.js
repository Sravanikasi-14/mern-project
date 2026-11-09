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
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { parseProfileImageUpload } from "../services/documentStorage.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

/** Minimal valid 1×1 PNG */
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_1X1_BASE64, "base64");

const PASSWORD = "ProfilePass123!";

let mongo;
let app;
let companyA;
let companyB;
let modelsA;
let empA; // employee record for emp1
let empUserA;
let emp2UserA;
let emp2A;
const cookies = {};

function cookieFrom(response) {
  const list = response.headers["set-cookie"] || [];
  return list.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

async function login(email, companyCode) {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD, companyCode });
  assert.equal(res.status, 200, res.body?.message);
  return cookieFrom(res);
}

function binaryParser(res, callback) {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

function getImage(path, cookie) {
  return request(app).get(path).set("Cookie", cookie).buffer(true).parse(binaryParser);
}

function uploadAvatar(cookie, overrides = {}) {
  return request(app)
    .post("/api/auth/profile/avatar")
    .set("Cookie", cookie)
    .send({ fileName: "me.png", mimeType: "image/png", fileData: PNG_1X1_BASE64, ...overrides });
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  companyA = await Company.create({
    companyName: "Avatar Co A",
    slug: "avatarcoa",
    databaseName: "company_avatar_a",
    status: COMPANY_STATUSES.ACTIVE,
    config: { hrAccessEnforcement: { mode: "OFF" } },
  });
  companyB = await Company.create({
    companyName: "Avatar Co B",
    slug: "avatarcob",
    databaseName: "company_avatar_b",
    status: COMPANY_STATUSES.ACTIVE,
    config: { hrAccessEnforcement: { mode: "OFF" } },
  });

  const passwordHash = await hashPassword(PASSWORD);
  modelsA = await getCompanyModels(companyA);

  await modelsA.User.create({
    email: "ca@avatarcoa.test",
    passwordHash,
    role: USER_ROLES.COMPANY_ADMIN,
    fullName: "Avatar CA",
    isActive: true,
  });
  // HR admin without a linked Employee record (account-level photo only).
  await modelsA.User.create({
    email: "hr@avatarcoa.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: "Avatar HR",
    isActive: true,
  });

  empUserA = await modelsA.User.create({
    email: "emp1@avatarcoa.test",
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Emp One",
    isActive: true,
  });
  empA = await modelsA.Employee.create({
    fullName: "Emp One",
    employeeCode: "AV-001",
    email: "emp1@avatarcoa.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    userId: empUserA._id,
    job: { jobTitle: "Engineer", department: "Engineering" },
  });
  empUserA.employeeId = empA._id;
  await empUserA.save();

  emp2UserA = await modelsA.User.create({
    email: "emp2@avatarcoa.test",
    passwordHash,
    role: USER_ROLES.EMPLOYEE,
    fullName: "Emp Two",
    isActive: true,
  });
  emp2A = await modelsA.Employee.create({
    fullName: "Emp Two",
    employeeCode: "AV-002",
    email: "emp2@avatarcoa.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    userId: emp2UserA._id,
    job: { jobTitle: "Analyst", department: "Finance" },
  });
  emp2UserA.employeeId = emp2A._id;
  await emp2UserA.save();

  const modelsB = await getCompanyModels(companyB);
  await modelsB.User.create({
    email: "hr@avatarcob.test",
    passwordHash,
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  cookies.ca = await login("ca@avatarcoa.test", "avatarcoa");
  cookies.hr = await login("hr@avatarcoa.test", "avatarcoa");
  cookies.emp1 = await login("emp1@avatarcoa.test", "avatarcoa");
  cookies.emp2 = await login("emp2@avatarcoa.test", "avatarcoa");
  cookies.hrB = await login("hr@avatarcob.test", "avatarcob");
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("parseProfileImageUpload", () => {
  it("returns buffer, detected mime type and a sanitized file name without touching disk", () => {
    const parsed = parseProfileImageUpload({
      fileName: "my photo!.png",
      fileData: `data:image/png;base64,${PNG_1X1_BASE64}`,
      mimeType: "image/png",
    });
    assert.ok(Buffer.isBuffer(parsed.buffer));
    assert.deepEqual(parsed.buffer, PNG_BYTES);
    assert.equal(parsed.mimeType, "image/png");
    assert.equal(parsed.fileName, "my_photo_.png");
  });

  it("rejects non-images, wrong extensions and oversize payloads", () => {
    assert.throws(
      () =>
        parseProfileImageUpload({
          fileName: "x.png",
          fileData: Buffer.from("this is definitely not an image").toString("base64"),
        }),
      /not a valid PNG, JPEG, or WebP/
    );
    assert.throws(
      () => parseProfileImageUpload({ fileName: "x.gif", fileData: PNG_1X1_BASE64 }),
      /PNG, JPEG, or WebP/
    );
    assert.throws(
      () =>
        parseProfileImageUpload({
          fileName: "big.png",
          fileData: Buffer.concat([PNG_BYTES, Buffer.alloc(2 * 1024 * 1024)]),
        }),
      /2 MB or smaller/
    );
  });
});

describe("profile avatar", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/auth/profile/avatar")
      .send({ fileName: "me.png", fileData: PNG_1X1_BASE64 });
    assert.equal(res.status, 401);
    assert.equal((await request(app).get("/api/auth/avatar")).status, 401);
  });

  it("rejects invalid uploads with 400", async () => {
    const bad = await uploadAvatar(cookies.emp1, {
      fileData: Buffer.from("not an image at all").toString("base64"),
    });
    assert.equal(bad.status, 400);
    const badExt = await uploadAvatar(cookies.emp1, { fileName: "me.exe", mimeType: undefined });
    assert.equal(badExt.status, 400);
  });

  it("lets an employee upload a photo and stream it back from /auth/avatar", async () => {
    const res = await uploadAvatar(cookies.emp1);
    assert.equal(res.status, 200, res.body?.message);
    assert.match(res.body.user.avatar, /^\/api\/auth\/avatar\?v=\d+$/);
    assert.equal(res.body.user.avatarData, undefined);
    assert.equal(res.body.user.passwordHash, undefined);

    const img = await getImage("/api/auth/avatar", cookies.emp1);
    assert.equal(img.status, 200);
    assert.match(img.headers["content-type"], /image\/png/);
    assert.match(img.headers["cache-control"], /private/);
    assert.deepEqual(img.body, PNG_BYTES);

    const me = await request(app).get("/api/auth/me").set("Cookie", cookies.emp1);
    assert.equal(me.status, 200);
    assert.match(me.body.user.avatar, /^\/api\/auth\/avatar/);
    assert.equal(me.body.user.avatarData, undefined);
  });

  it("syncs the photo to the linked Employee record without creating duplicates", async () => {
    const usersBefore = await modelsA.User.countDocuments();
    const employeesBefore = await modelsA.Employee.countDocuments();

    const res = await uploadAvatar(cookies.emp1);
    assert.equal(res.status, 200);
    assert.equal(String(res.body.employee._id), String(empA._id));
    assert.match(res.body.employee.avatar, new RegExp(`^/api/employees/${empA._id}/avatar\\?v=\\d+$`));

    const employee = await modelsA.Employee.findById(empA._id).select("+avatarData");
    const user = await modelsA.User.findById(empUserA._id).select("+avatarData");
    assert.equal(employee.avatar, res.body.employee.avatar);
    assert.equal(employee.avatarMimeType, "image/png");
    assert.deepEqual(Buffer.from(employee.avatarData), PNG_BYTES);
    assert.deepEqual(Buffer.from(user.avatarData), Buffer.from(employee.avatarData));
    assert.equal(String(user.employeeId), String(employee._id));
    assert.equal(String(employee.userId), String(user._id));

    assert.equal(await modelsA.User.countDocuments(), usersBefore);
    assert.equal(await modelsA.Employee.countDocuments(), employeesBefore);

    const self = await getImage("/api/employees/me/avatar", cookies.emp1);
    assert.equal(self.status, 200);
    assert.deepEqual(self.body, PNG_BYTES);
    const byId = await getImage(`/api/employees/${empA._id}/avatar`, cookies.emp1);
    assert.equal(byId.status, 200);
    assert.match(byId.headers["content-type"], /image\/png/);
    assert.deepEqual(byId.body, PNG_BYTES);

    // Employee avatar path never leaks bytes through HR detail.
    const detail = await request(app).get(`/api/employees/${empA._id}`).set("Cookie", cookies.ca);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.avatar, employee.avatar);
    assert.equal(detail.body.avatarData, undefined);
  });

  it("enforces who may read an employee photo", async () => {
    // Another employee: forbidden.
    const other = await getImage(`/api/employees/${empA._id}/avatar`, cookies.emp2);
    assert.equal(other.status, 403);
    // Company Admin and HR Admin (people.view): allowed.
    for (const key of ["ca", "hr"]) {
      const res = await getImage(`/api/employees/${empA._id}/avatar`, cookies[key]);
      assert.equal(res.status, 200, key);
      assert.deepEqual(res.body, PNG_BYTES);
    }
    // Employee with no photo: 404; invalid id: 404.
    assert.equal((await getImage(`/api/employees/${emp2A._id}/avatar`, cookies.ca)).status, 404);
    assert.equal((await getImage("/api/employees/not-an-id/avatar", cookies.ca)).status, 404);
  });

  it("stores an account-level photo for users without an employee link (HR/CA)", async () => {
    const employeesBefore = await modelsA.Employee.countDocuments();
    const res = await uploadAvatar(cookies.hr);
    assert.equal(res.status, 200);
    assert.equal(res.body.employee, null);
    assert.match(res.body.user.avatar, /^\/api\/auth\/avatar/);
    assert.equal(await modelsA.Employee.countDocuments(), employeesBefore);

    const img = await getImage("/api/auth/avatar", cookies.hr);
    assert.equal(img.status, 200);
    assert.deepEqual(img.body, PNG_BYTES);

    const ca = await uploadAvatar(cookies.ca);
    assert.equal(ca.status, 200);
    assert.equal((await getImage("/api/auth/avatar", cookies.ca)).status, 200);
  });

  it("does not let another tenant read an avatar", async () => {
    const cross = await getImage(`/api/employees/${empA._id}/avatar`, cookies.hrB);
    assert.equal(cross.status, 404);
    const own = await getImage("/api/auth/avatar", cookies.hrB);
    assert.equal(own.status, 404);
  });

  it("keeps name/phone in sync via PUT /auth/profile and rejects a blank name", async () => {
    const res = await request(app)
      .put("/api/auth/profile")
      .set("Cookie", cookies.emp1)
      .send({ fullName: "Emp One Updated", phoneNumber: "9999900000" });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.fullName, "Emp One Updated");
    assert.match(res.body.user.avatar, /^\/api\/auth\/avatar/);
    const employee = await modelsA.Employee.findById(empA._id);
    assert.equal(employee.fullName, "Emp One Updated");
    assert.equal(employee.phoneNumber, "9999900000");

    const blank = await request(app)
      .put("/api/auth/profile")
      .set("Cookie", cookies.emp1)
      .send({ fullName: "   " });
    assert.equal(blank.status, 400);
  });

  it("removes the photo from both the account and the linked employee", async () => {
    const res = await request(app).delete("/api/auth/profile/avatar").set("Cookie", cookies.emp1);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.avatar, "");

    const employee = await modelsA.Employee.findById(empA._id).select("+avatarData");
    const user = await modelsA.User.findById(empUserA._id).select("+avatarData");
    assert.equal(employee.avatar, "");
    assert.ok(!employee.avatarData || employee.avatarData.length === 0);
    assert.equal(user.avatar, "");
    assert.ok(!user.avatarData || user.avatarData.length === 0);

    assert.equal((await getImage("/api/auth/avatar", cookies.emp1)).status, 404);
    assert.equal((await getImage("/api/employees/me/avatar", cookies.emp1)).status, 404);
  });
});

describe("employee detail identity data", () => {
  it("does not invent bank, tax, or identity defaults when none are on file", async () => {
    const res = await request(app).get(`/api/employees/${emp2A._id}`).set("Cookie", cookies.ca);
    assert.equal(res.status, 200);
    const raw = JSON.stringify(res.body);
    assert.equal(raw.includes("HDFC"), false);
    assert.equal(raw.includes("ABCDE1234F"), false);
    assert.equal(raw.includes("9812"), false);
    assert.equal(res.body.bankDetails.accountNumber, "");
    assert.equal(res.body.bankDetails.bankName, "");
    assert.equal(res.body.taxDetails.panNumber, "");
    assert.equal(res.body.identityDetails.idNumber, "");
    assert.equal(res.body.identityDetails.isVerified, false);
  });

  it("still returns real bank details when they are stored", async () => {
    await modelsA.Employee.updateOne(
      { _id: emp2A._id },
      { $set: { "bankDetails.bankName": "Real Bank", "bankDetails.accountNumber": "000111222" } }
    );
    const res = await request(app).get(`/api/employees/${emp2A._id}`).set("Cookie", cookies.ca);
    assert.equal(res.body.bankDetails.bankName, "Real Bank");
    assert.equal(res.body.bankDetails.accountNumber, "000111222");
  });
});
