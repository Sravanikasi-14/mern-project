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

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
// Simulate serverless: no persistent uploads dir
process.env.VERCEL = "1";
delete process.env.UPLOADS_DIR;

/** Minimal valid 1×1 PNG */
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let mongo;
let app;
let companyA;
let companyB;
let hrCookieA;
let empCookieA;
let hrCookieB;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  companyA = await Company.create({
    companyName: "Logo Co A",
    slug: "logocoa",
    databaseName: "company_logo_a",
    status: COMPANY_STATUSES.ACTIVE,
  });
  companyB = await Company.create({
    companyName: "Logo Co B",
    slug: "logocob",
    databaseName: "company_logo_b",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const modelsA = await getCompanyModels(companyA);
  const hrUser = await modelsA.User.create({
    email: "hr@logocoa.test",
    passwordHash: await hashPassword("HrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const empUser = await modelsA.User.create({
    email: "emp@logocoa.test",
    passwordHash: await hashPassword("EmpPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const emp = await modelsA.Employee.create({
    fullName: "Logo Employee",
    employeeCode: "LG-001",
    email: "emp@logocoa.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    userId: empUser._id,
    job: { jobTitle: "Engineer", department: "Engineering" },
  });
  empUser.employeeId = emp._id;
  await empUser.save();

  const modelsB = await getCompanyModels(companyB);
  await modelsB.User.create({
    email: "hr@logocob.test",
    passwordHash: await hashPassword("HrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  hrCookieA = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ email: "hr@logocoa.test", password: "HrPass123!", companyCode: "logocoa" })
  );
  empCookieA = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ email: "emp@logocoa.test", password: "EmpPass123!", companyCode: "logocoa" })
  );
  hrCookieB = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ email: "hr@logocob.test", password: "HrPass123!", companyCode: "logocob" })
  );
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
  delete process.env.VERCEL;
});

describe("Company logo persistence (serverless-safe)", () => {
  let uploadedLogoUrl = "";

  it("1. HR uploads logo; bytes persist in Mongo (not only /tmp)", async () => {
    const upload = await request(app)
      .post("/api/settings/company/logo")
      .set("Cookie", hrCookieA)
      .send({
        fileName: "brand.png",
        fileData: PNG_1X1_BASE64,
        mimeType: "image/png",
      });
    assert.equal(upload.status, 200);
    assert.ok(upload.body.branding?.logoUrl);
    uploadedLogoUrl = upload.body.branding.logoUrl;

    const stored = await Company.findById(companyA._id).select("+branding.logoData");
    assert.ok(stored.branding.logoData?.length > 0, "logoData must be stored in Mongo");
    assert.equal(stored.branding.logoMimeType, "image/png");
    assert.equal(stored.branding.logoUrl, uploadedLogoUrl);
  });

  it("2. Employee and HR can stream the logo after upload", async () => {
    const hrStream = await request(app).get("/api/auth/company-logo").set("Cookie", hrCookieA);
    assert.equal(hrStream.status, 200);
    assert.match(hrStream.headers["content-type"], /image\/png/);
    assert.ok(hrStream.body.length > 0 || Buffer.isBuffer(hrStream.body) || hrStream.text);

    const empStream = await request(app).get("/api/auth/company-logo").set("Cookie", empCookieA);
    assert.equal(empStream.status, 200);
    assert.match(empStream.headers["content-type"], /image\/png/);
  });

  it("3. Auth/session branding exposes logoUrl but never logo binary", async () => {
    const me = await request(app).get("/api/auth/me").set("Cookie", empCookieA);
    assert.equal(me.status, 200);
    assert.equal(me.body.company?.branding?.logoUrl, uploadedLogoUrl);
    assert.equal(me.body.company.branding.logoData, undefined);

    const settings = await request(app).get("/api/settings/company").set("Cookie", hrCookieA);
    assert.equal(settings.status, 200);
    assert.equal(settings.body.company?.branding?.logoUrl, uploadedLogoUrl);
  });

  it("4. Employees cannot upload company logo", async () => {
    const denied = await request(app)
      .post("/api/settings/company/logo")
      .set("Cookie", empCookieA)
      .send({
        fileName: "hack.png",
        fileData: PNG_1X1_BASE64,
        mimeType: "image/png",
      });
    assert.ok([401, 403].includes(denied.status));
  });

  it("5. Tenant isolation: Company B cannot stream Company A logo", async () => {
    const cross = await request(app).get("/api/auth/company-logo").set("Cookie", hrCookieB);
    assert.equal(cross.status, 404);
  });

  it("6. Missing logo returns 404; delete clears Mongo bytes", async () => {
    const del = await request(app).delete("/api/settings/company/logo").set("Cookie", hrCookieA);
    assert.equal(del.status, 200);
    assert.equal(del.body.branding?.logoUrl, "");

    const after = await Company.findById(companyA._id).select("+branding.logoData");
    assert.equal(after.branding.logoUrl || "", "");
    assert.ok(!after.branding.logoData || after.branding.logoData.length === 0);

    const stream = await request(app).get("/api/auth/company-logo").set("Cookie", hrCookieA);
    assert.equal(stream.status, 404);
  });

  it("7. Company profile update must not wipe persisted logo bytes", async () => {
    const upload = await request(app)
      .post("/api/settings/company/logo")
      .set("Cookie", hrCookieA)
      .send({
        fileName: "keep.png",
        fileData: PNG_1X1_BASE64,
        mimeType: "image/png",
      });
    assert.equal(upload.status, 200);
    const logoUrl = upload.body.branding.logoUrl;

    const profile = await request(app)
      .put("/api/settings/company")
      .set("Cookie", hrCookieA)
      .send({ displayName: "Logo Co A Workspace", companyName: "Logo Co A" });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.company?.branding?.logoUrl, logoUrl);

    const stored = await Company.findById(companyA._id).select("+branding.logoData");
    assert.ok(stored.branding.logoData?.length > 0, "logoData must survive profile updates");
    assert.equal(stored.branding.logoUrl, logoUrl);

    const stream = await request(app).get("/api/auth/company-logo").set("Cookie", hrCookieA);
    assert.equal(stream.status, 200);
  });
});
