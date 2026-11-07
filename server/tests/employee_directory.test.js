process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { EMPLOYEE_RELATIONSHIPS } from "../services/employeeRelationshipService.js";

let mongo;
let app;
let acme;
let globex;
let acmeHrCookie;
let acmeWorkerCookie;
let ids = {};

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

async function createEmp(company, data) {
  const { Employee } = await getCompanyModels(company);
  return Employee.create({
    status: data.status || EMPLOYEE_STATUSES.ACTIVE,
    phoneNumber: data.phoneNumber || "9000000001",
    email: data.email,
    employeeCode: data.employeeCode,
    fullName: data.fullName,
    preferredName: data.preferredName || "",
    userId: data.userId,
    invitation: data.invitation,
    personalEmail: data.personalEmail || "personal@hidden.test",
    personalPhone: data.personalPhone || "1111111111",
    dateOfBirth: data.dateOfBirth || new Date("1990-01-01"),
    bankDetails: data.bankDetails || {
      accountHolderName: data.fullName,
      accountNumber: "1234567890",
      bankName: "Test Bank",
      ifscCode: "TEST0001",
    },
    taxDetails: data.taxDetails || { panNumber: "ABCDE1234F", taxRegime: "NEW" },
    identityDetails: data.identityDetails || { idType: "PAN", idNumber: "XXXX", isVerified: true },
    job: {
      jobTitle: data.jobTitle || "Engineer",
      department: data.department || "Engineering",
      employmentType: data.employmentType || "Full-time",
      workLocation: data.workLocation || "Hyderabad",
      joiningDate: data.joiningDate || new Date("2024-01-15"),
      reportingManagerId: data.reportingManagerId || null,
    },
  });
}

function assertNoDirectoryLeak(body) {
  const json = JSON.stringify(body);
  assert.equal(json.includes("secret-invite"), false);
  assert.equal(json.includes("passwordHash"), false);
  assert.equal(json.includes("personalEmail"), false);
  assert.equal(json.includes("personalPhone"), false);
  assert.equal(json.includes("bankDetails"), false);
  assert.equal(json.includes("taxDetails"), false);
  assert.equal(json.includes("identityDetails"), false);
  for (const row of body.data || []) {
    assert.equal(row.status, undefined);
    assert.equal(row.invitation, undefined);
  }
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme Directory",
    slug: "acme-dir",
    databaseName: "company_acme_dir",
    status: COMPANY_STATUSES.ACTIVE,
  });
  globex = await Company.create({
    companyName: "Globex Directory",
    slug: "globex-dir",
    databaseName: "company_globex_dir",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: AcmeUser } = await getCompanyModels(acme);
  await AcmeUser.create({
    email: "hr@acme-dir.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  acmeHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-dir",
      email: "hr@acme-dir.test",
      password: "AcmePass123!",
    })
  );
});

beforeEach(async () => {
  const { Employee: AcmeEmployee, User: AcmeUser } = await getCompanyModels(acme);
  const { Employee: GlobexEmployee, User: GlobexUser } = await getCompanyModels(globex);

  await AcmeEmployee.deleteMany({});
  await GlobexEmployee.deleteMany({});
  await AcmeUser.deleteMany({ role: USER_ROLES.EMPLOYEE });
  await GlobexUser.deleteMany({});

  // CEO → Manager → Worker / Peer; Other unassigned; Inactive hidden from directory
  const ceo = await createEmp(acme, {
    employeeCode: "CEO-1",
    fullName: "Ada Chief",
    preferredName: "Ada",
    email: "ceo@acme-dir.test",
    jobTitle: "Chief Executive",
    department: "Executive",
    phoneNumber: "9000000001",
  });
  const manager = await createEmp(acme, {
    employeeCode: "MGR-1",
    fullName: "Blake Manager",
    email: "manager@acme-dir.test",
    jobTitle: "Engineering Manager",
    department: "Engineering",
    reportingManagerId: ceo._id,
    phoneNumber: "9000000099",
    employmentType: "Full-time",
    joiningDate: new Date("2022-03-01"),
  });
  const workerUser = await AcmeUser.create({
    email: "worker@acme-dir.test",
    passwordHash: await hashPassword("WorkerPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const worker = await createEmp(acme, {
    employeeCode: "WRK-1",
    fullName: "Casey Worker",
    preferredName: "Case",
    email: "worker@acme-dir.test",
    userId: workerUser._id,
    jobTitle: "Software Engineer",
    department: "Engineering",
    reportingManagerId: manager._id,
    invitation: { status: "ACCEPTED", token: "secret-invite-token-do-not-leak", sentAt: new Date() },
  });
  workerUser.employeeId = worker._id;
  await workerUser.save();

  const peer = await createEmp(acme, {
    employeeCode: "PEER-1",
    fullName: "Drew Peer",
    email: "peer@acme-dir.test",
    jobTitle: "Software Engineer",
    department: "Engineering",
    reportingManagerId: manager._id,
    phoneNumber: "9000000088",
    employmentType: "Contract",
    joiningDate: new Date("2023-06-01"),
  });
  const other = await createEmp(acme, {
    employeeCode: "OTH-1",
    fullName: "Evan Other",
    email: "other@acme-dir.test",
    jobTitle: "Accountant",
    department: "Finance",
    reportingManagerId: null,
    phoneNumber: "9000000077",
  });
  await createEmp(acme, {
    employeeCode: "INACT-1",
    fullName: "Inactive Person",
    email: "inactive@acme-dir.test",
    status: EMPLOYEE_STATUSES.INACTIVE,
    jobTitle: "Former Engineer",
    department: "Engineering",
  });

  const globexEmp = await createEmp(globex, {
    employeeCode: "GX-1",
    fullName: "Globex Only",
    email: "gx@globex-dir.test",
    jobTitle: "Director",
    department: "Ops",
  });

  ids = {
    ceo: String(ceo._id),
    manager: String(manager._id),
    worker: String(worker._id),
    peer: String(peer._id),
    other: String(other._id),
    globexEmp: String(globexEmp._id),
  };

  acmeWorkerCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-dir",
      email: "worker@acme-dir.test",
      password: "WorkerPass123!",
    })
  );
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("GET /api/employees/directory", () => {
  it("rejects anonymous requests with 401", async () => {
    const res = await request(app).get("/api/employees/directory");
    assert.equal(res.status, 401);
  });

  it("allows EMPLOYEE to access their company directory", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    // Hierarchy-visible only: SELF + managers + peer (not Finance OTHER / inactive / cross-tenant)
    assert.equal(res.body.data.length, 4);
    assert.equal(res.body.data.some((e) => e.fullName === "Evan Other"), false);
    assert.equal(res.body.data.some((e) => e.fullName === "Inactive Person"), false);
    assert.equal(res.body.data.some((e) => e.fullName === "Globex Only"), false);
    assert.equal(res.body.pagination.totalEmployees, 4);
    assertNoDirectoryLeak(res.body);
  });

  it("allows HR_ADMIN to access the directory endpoint", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.length >= 4);
    assertNoDirectoryLeak(res.body);
  });

  it("does not return employees from another tenant", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(
      res.body.data.some((e) => String(e._id) === ids.globexEmp || e.fullName === "Globex Only"),
      false
    );
    assert.equal(
      res.body.data.some((e) => e.employeeCode === "GX-1"),
      false
    );
  });

  it("searches by name", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: "Drew" })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].fullName, "Drew Peer");
  });

  it("searches by employee code", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: "MGR-1" })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].employeeCode, "MGR-1");
  });

  it("searches by designation (job title) only within visible set", async () => {
    const empRes = await request(app)
      .get("/api/employees/directory")
      .query({ search: "Accountant" })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(empRes.status, 200);
    assert.equal(empRes.body.data.length, 0);

    const hrRes = await request(app)
      .get("/api/employees/directory")
      .query({ search: "Accountant" })
      .set("Cookie", acmeHrCookie);
    assert.equal(hrRes.status, 200);
    assert.ok(hrRes.body.data.some((e) => e.jobTitle === "Accountant"));
  });

  it("searches by department only within visible set", async () => {
    const empRes = await request(app)
      .get("/api/employees/directory")
      .query({ search: "Finance" })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(empRes.status, 200);
    assert.equal(empRes.body.data.length, 0);

    const hrRes = await request(app)
      .get("/api/employees/directory")
      .query({ search: "Finance" })
      .set("Cookie", acmeHrCookie);
    assert.equal(hrRes.status, 200);
    assert.ok(hrRes.body.data.length >= 1);
    assert.ok(hrRes.body.data.every((e) => e.department === "Finance"));
  });

  it("performs case-insensitive search", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: "drew peer" })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].fullName, "Drew Peer");
  });

  it("escapes regex-special-character input", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: ".*(Engineering)?" })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    // Escaped as a literal — must not match all Engineering rows like a regex would.
    assert.equal(res.body.data.length, 0);
  });

  it("paginates correctly over hierarchy-visible employees only", async () => {
    // Peers under the same manager are visible to the worker; unrelated Ops are not.
    for (let i = 0; i < 8; i += 1) {
      await createEmp(acme, {
        employeeCode: `PG-${i}`,
        fullName: `Page Emp ${i}`,
        email: `pg${i}@acme-dir.test`,
        jobTitle: "Analyst",
        department: "Engineering",
        reportingManagerId: ids.manager,
      });
    }

    const page1 = await request(app)
      .get("/api/employees/directory")
      .query({ page: 1, limit: 10 })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(page1.status, 200);
    assert.equal(page1.body.data.length, 10);
    assert.equal(page1.body.pagination.page, 1);
    assert.equal(page1.body.pagination.limit, 10);
    // Base visible 4 + 8 peers = 12
    assert.equal(page1.body.pagination.totalEmployees, 12);
    assert.equal(page1.body.pagination.totalPages, 2);
    assert.equal(page1.body.data.some((e) => e.fullName === "Evan Other"), false);

    const page2 = await request(app)
      .get("/api/employees/directory")
      .query({ page: 2, limit: 10 })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(page2.status, 200);
    assert.equal(page2.body.data.length, 2);
    const idsPage1 = new Set(page1.body.data.map((e) => String(e._id)));
    for (const row of page2.body.data) {
      assert.equal(idsPage1.has(String(row._id)), false);
    }
  });

  it("returns only permitted directory fields for peers", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: "PEER-1" })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    const peer = res.body.data[0];
    assert.equal(peer.relationship, EMPLOYEE_RELATIONSHIPS.PEER);
    assert.equal(peer.fullName, "Drew Peer");
    assert.equal(peer.employeeCode, "PEER-1");
    assert.equal(peer.email, "peer@acme-dir.test");
    assert.equal(peer.jobTitle, "Software Engineer");
    assert.equal(peer.department, "Engineering");
    assert.ok(peer.workLocation);
    assert.equal(peer.phoneNumber, undefined);
    assert.equal(peer.employmentType, undefined);
    assert.equal(peer.joiningDate, undefined);
    assert.equal(peer.status, undefined);
    assert.equal(peer.invitation, undefined);
    assertNoDirectoryLeak(res.body);
  });

  it("peer cannot see official phone", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: "Drew" })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.body.data[0].phoneNumber, undefined);
    assert.equal(JSON.stringify(res.body).includes("9000000088"), false);
  });

  it("peer cannot see employment type or joining date", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: "PEER-1" })
      .set("Cookie", acmeWorkerCookie);
    const peer = res.body.data[0];
    assert.equal(peer.employmentType, undefined);
    assert.equal(peer.joiningDate, undefined);
    assert.equal(JSON.stringify(peer).includes("Contract"), false);
  });

  it("never returns employee status to employees", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .set("Cookie", acmeWorkerCookie);
    for (const row of res.body.data) {
      assert.equal(Object.prototype.hasOwnProperty.call(row, "status"), false);
    }
  });

  it("never leaks invitation tokens or authentication data", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .set("Cookie", acmeWorkerCookie);
    assertNoDirectoryLeak(res.body);
    assert.equal(JSON.stringify(res.body).includes("secret-invite-token"), false);
  });

  it("applies upward fields for direct manager results (no phone)", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: "MGR-1" })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    const mgr = res.body.data[0];
    assert.equal(mgr.relationship, EMPLOYEE_RELATIONSHIPS.DIRECT_MANAGER);
    assert.equal(mgr.email, "manager@acme-dir.test");
    assert.equal(mgr.phoneNumber, undefined);
    assert.equal(mgr.employmentType, undefined);
    assert.equal(mgr.joiningDate, undefined);
    assert.equal(mgr.status, undefined);
    assert.equal(mgr.bankDetails, undefined);
  });

  it("applies upward fields for indirect manager (CEO)", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: "CEO-1" })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    const ceo = res.body.data[0];
    assert.equal(ceo.relationship, EMPLOYEE_RELATIONSHIPS.INDIRECT_MANAGER);
    assert.ok(ceo.email);
    assert.equal(ceo.phoneNumber, undefined);
    assert.equal(ceo.status, undefined);
  });

  it("keeps existing HR People Management list unchanged", async () => {
    const dir = await request(app)
      .get("/api/employees/directory")
      .set("Cookie", acmeHrCookie);
    assert.equal(dir.status, 200);

    const hrList = await request(app)
      .get("/api/employees")
      .set("Cookie", acmeHrCookie);
    assert.equal(hrList.status, 200);
    assert.ok(Array.isArray(hrList.body.employees));
    assert.ok(hrList.body.pagination);
    // HR list still exposes status (management behavior).
    assert.ok(hrList.body.employees.some((e) => e.status === EMPLOYEE_STATUSES.ACTIVE));
    // EMPLOYEE still blocked from HR list.
    const blocked = await request(app)
      .get("/api/employees")
      .set("Cookie", acmeWorkerCookie);
    assert.equal(blocked.status, 403);
  });

  it("rejects overly long search queries", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: "x".repeat(101) })
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 400);
  });
});
