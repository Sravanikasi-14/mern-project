/**
 * Local repro for HR signature save + SENT bypass.
 * Uses mongodb-memory-server (does not touch Atlas).
 */
import { createApp } from "../app.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import { getAuthCookieName } from "../utils/authCookie.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const mongo = await MongoMemoryServer.create();
process.env.MONGO_URI = mongo.getUri();
await connectCentralDB();
const app = createApp();
const company = await Company.create({
  companyName: "Sig Co",
  slug: "sigco",
  databaseName: "company_sigco_live",
  status: COMPANY_STATUSES.ACTIVE,
});
const { User, OfferLetter } = await getCompanyModels(company);
await User.create({
  email: "hr@sigco.test",
  passwordHash: await hashPassword("SigPass123!"),
  role: USER_ROLES.HR_ADMIN,
  isActive: true,
});
const login = await request(app)
  .post("/api/auth/login")
  .send({ email: "hr@sigco.test", password: "SigPass123!", companyCode: "sigco" });
console.log("login", login.status, login.body?.message || login.body?.code, JSON.stringify(login.body)?.slice(0, 300));
const cookie = (login.headers["set-cookie"] || []).find((c) =>
  c.startsWith(`${getAuthCookieName()}=`)
);
if (!cookie) {
  console.error("No auth cookie; aborting.");
  await disconnectAll();
  await mongo.stop();
  process.exit(1);
}

for (const body of [
  { method: "DRAW", fileData: png },
  { method: "UPLOAD", fileData: png },
  { method: "TYPE", typedText: "Sri Pavan Tej" },
  { method: "DRAW" },
]) {
  const res = await request(app)
    .post("/api/settings/company/signature")
    .set("Cookie", cookie)
    .send(body);
  console.log(
    "save",
    JSON.stringify(body.method),
    "->",
    res.status,
    res.body?.message || res.body?.code,
    "has=",
    res.body?.hasSignature
  );
}

const get = await request(app).get("/api/settings/company").set("Cookie", cookie);
console.log(
  "settings",
  get.body?.company?.letterhead?.hasSignature,
  get.body?.company?.letterhead?.signatureMethod
);
const stream = await request(app).get("/api/settings/company/signature").set("Cookie", cookie);
console.log("stream", stream.status, stream.headers["content-type"]);

// Simulate letterhead save after signature (common Settings flow)
const put = await request(app)
  .put("/api/settings/company")
  .set("Cookie", cookie)
  .send({
    letterhead: {
      address: "Hyderabad",
      website: "https://example.com",
      signatoryName: "Sri Pavan",
      signatoryTitle: "Co-Founder",
    },
  });
console.log("put letterhead", put.status, put.body?.company?.letterhead?.hasSignature);
const afterPut = await Company.findById(company._id).select("+letterhead.signatureData").lean();
console.log(
  "after letterhead put bytes=",
  afterPut?.letterhead?.signatureData
    ? Buffer.from(afterPut.letterhead.signatureData.buffer || afterPut.letterhead.signatureData).length
    : 0,
  "mime=",
  afterPut?.letterhead?.signatureMimeType
);

const ol = await OfferLetter.create({
  candidate: { fullName: "A", email: "a@b.com" },
  position: "Dev",
  monthlySalary: 1000,
  joiningDate: new Date(),
  content: "<html></html>",
});
const statusRes = await request(app)
  .patch(`/api/offer-letters/${ol._id}/status`)
  .set("Cookie", cookie)
  .send({ status: "SENT" });
console.log("status->SENT", statusRes.status, statusRes.body?.message);

await Company.updateOne(
  { _id: company._id },
  {
    $unset: { "letterhead.signatureData": "" },
    $set: {
      "letterhead.signatureMethod": "",
      "letterhead.signatureMimeType": "",
      "letterhead.signatureTypedText": "",
    },
  }
);
const sendRes = await request(app)
  .post(`/api/offer-letters/${ol._id}/send`)
  .set("Cookie", cookie)
  .send({});
console.log("send without sig", sendRes.status, sendRes.body?.code || sendRes.body?.message);

await disconnectAll();
await mongo.stop();
