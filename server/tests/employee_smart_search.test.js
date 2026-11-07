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
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

let mongo;
let app;
let acme;
let globex;
let acmeHrCookie;
let acmeEmployeeCookie;
let globexHrCookie;
let ceo;
let mgr;
let engA;
let engB;
let solo;
let contractor;
let globexMgr;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme Search",
    slug: "acme-search",
    databaseName: "company_acme_search",
    status: COMPANY_STATUSES.ACTIVE,
  });
  globex = await Company.create({
    companyName: "Globex Search",
    slug: "globex-search",
    databaseName: "company_globex_search",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: AcmeUser, Employee: AcmeEmployee } = await getCompanyModels(acme);
  await AcmeUser.create({
    email: "hr@acme-search.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const workerUser = await AcmeUser.create({
    email: "worker@acme-search.test",
    passwordHash: await hashPassword("WorkerPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  ceo = await AcmeEmployee.create({
    employeeCode: "CEO-1",
    fullName: "Casey CEO",
    preferredName: "Case",
    email: "ceo@acme-search.test",
    phoneNumber: "+91 9000000001",
    city: "Mumbai",
    status: EMPLOYEE_STATUSES.ACTIVE,
    invitation: { status: "ACCEPTED", token: "secret-ceo-token", sentAt: new Date() },
    job: {
      jobTitle: "Chief Executive",
      department: "Executive",
      employmentType: "Full-time",
      workLocation: "Mumbai HQ",
      joiningDate: new Date("2020-01-15T00:00:00.000Z"),
      project: { projectName: "Leadership", projectType: "INTERNAL" },
    },
    bankDetails: { accountNumber: "SENSITIVE-CEO-ACC", bankName: "Hidden Bank" },
    taxDetails: { panNumber: "ABCDE1234F" },
    identityDetails: { idNumber: "AADHAAR-CEO" },
  });
  mgr = await AcmeEmployee.create({
    employeeCode: "MGR-1",
    fullName: "Morgan Manager",
    email: "mgr@acme-search.test",
    phoneNumber: "+91 9000000002",
    city: "Pune",
    status: EMPLOYEE_STATUSES.ACTIVE,
    invitation: { status: "ACCEPTED", token: "secret-mgr-token" },
    job: {
      jobTitle: "Engineering Manager",
      department: "Engineering",
      employmentType: "Full-time",
      workLocation: "Pune Campus",
      reportingManagerId: ceo._id,
      joiningDate: new Date("2021-06-01T00:00:00.000Z"),
      project: { projectName: "Platform Core", projectType: "MANDATE" },
    },
  });
  engA = await AcmeEmployee.create({
    employeeCode: "ENG-A",
    fullName: "Asha Engineer",
    preferredName: "Ash",
    email: "asha@acme-search.test",
    phoneNumber: "+91 9888777666",
    city: "Bengaluru",
    status: EMPLOYEE_STATUSES.ACTIVE,
    invitation: { status: "PENDING", token: "secret-asha-token" },
    job: {
      jobTitle: "Frontend Engineer",
      department: "Engineering",
      employmentType: "Full-time",
      workLocation: "Bengaluru Hub",
      project: { projectName: "Portal", projectType: "MANDATE" },
      reportingManagerId: mgr._id,
      joiningDate: new Date("2023-03-10T00:00:00.000Z"),
    },
  });
  engB = await AcmeEmployee.create({
    employeeCode: "ENG-B",
    fullName: "Bala Backend",
    email: "bala@acme-search.test",
    phoneNumber: "+91 9777666555",
    city: "Hyderabad",
    status: EMPLOYEE_STATUSES.INACTIVE,
    invitation: { status: "EXPIRED", token: "secret-bala-token" },
    job: {
      jobTitle: "Backend Engineer",
      department: "Engineering",
      employmentType: "Full-time",
      workLocation: "Hyderabad Hub",
      reportingManagerId: mgr._id,
      joiningDate: new Date("2022-11-20T00:00:00.000Z"),
      project: { projectName: "Payments", projectType: "RETAIL" },
    },
  });
  solo = await AcmeEmployee.create({
    employeeCode: "FIN-1",
    fullName: "Sam Solo",
    email: "solo@acme-search.test",
    phoneNumber: "+91 9666555444",
    city: "Chennai",
    status: EMPLOYEE_STATUSES.ACTIVE,
    invitation: { status: "DELIVERY_FAILED", token: "secret-solo-token" },
    job: {
      jobTitle: "Finance Analyst",
      department: "Finance",
      employmentType: "Full-time",
      workLocation: "Chennai Office",
      joiningDate: new Date("2024-01-05T00:00:00.000Z"),
      project: { projectName: "Finance Ops", projectType: "INTERNAL" },
    },
  });
  contractor = await AcmeEmployee.create({
    employeeCode: "CTR-1",
    fullName: "Dev Contractor",
    preferredName: "Devvy",
    email: "devvy@acme-search.test",
    phoneNumber: "+91 9555444333",
    city: "Remote",
    status: EMPLOYEE_STATUSES.ACTIVE,
    invitation: { status: "PENDING", token: "secret-ctr-token" },
    job: {
      jobTitle: "Contract Developer",
      department: "Engineering",
      employmentType: "Contract",
      workLocation: "Remote India",
      joiningDate: new Date("2024-07-01T00:00:00.000Z"),
      project: { projectName: "Portal", projectType: "BENCH" },
      reportingManagerId: mgr._id,
    },
  });

  const workerEmp = await AcmeEmployee.create({
    employeeCode: "WRK-1",
    fullName: "Worker Bee",
    email: "worker@acme-search.test",
    userId: workerUser._id,
    phoneNumber: "+91 9444333222",
    city: "Delhi",
    status: EMPLOYEE_STATUSES.ACTIVE,
    invitation: { status: "ACCEPTED", token: "secret-worker-token" },
    job: {
      jobTitle: "Ops Associate",
      department: "Ops",
      employmentType: "Full-time",
      workLocation: "Delhi Office",
      joiningDate: new Date("2023-09-01T00:00:00.000Z"),
      project: { projectName: "Ops Desk", projectType: "INTERNAL" },
    },
  });
  workerUser.employeeId = workerEmp._id;
  await workerUser.save();

  const { User: GlobexUser, Employee: GlobexEmployee } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "hr@globex-search.test",
    passwordHash: await hashPassword("GlobexPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  globexMgr = await GlobexEmployee.create({
    employeeCode: "GX-MGR",
    fullName: "Globex Boss",
    preferredName: "Ash",
    email: "boss@globex-search.test",
    phoneNumber: "+91 9888777666",
    city: "Bengaluru",
    status: EMPLOYEE_STATUSES.ACTIVE,
    invitation: { status: "PENDING", token: "secret-globex-token" },
    job: {
      jobTitle: "Director",
      department: "Ops",
      employmentType: "Contract",
      workLocation: "Bengaluru Hub",
      joiningDate: new Date("2023-03-10T00:00:00.000Z"),
      project: { projectName: "Portal", projectType: "MANDATE" },
    },
  });

  acmeHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-search",
      email: "hr@acme-search.test",
      password: "AcmePass123!",
    })
  );
  acmeEmployeeCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-search",
      email: "worker@acme-search.test",
      password: "WorkerPass123!",
    })
  );
  globexHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "globex-search",
      email: "hr@globex-search.test",
      password: "GlobexPass123!",
    })
  );
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Smart employee search (Phase 3B + 4A)", () => {
  it("searches by name, email, employee code and designation", async () => {
    const byName = await request(app)
      .get("/api/employees?search=Asha&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(byName.status, 200);
    assert.equal(byName.body.employees.length, 1);
    assert.equal(byName.body.employees[0].employeeCode, "ENG-A");

    const byEmail = await request(app)
      .get("/api/employees?search=bala@acme-search.test&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(byEmail.body.employees[0].employeeCode, "ENG-B");

    const byCode = await request(app)
      .get("/api/employees?search=FIN-1&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(byCode.body.employees[0].fullName, "Sam Solo");

    const byTitle = await request(app)
      .get("/api/employees?search=Frontend&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(byTitle.status, 200);
    assert.equal(byTitle.body.employees.length, 1);
    assert.equal(byTitle.body.employees[0].employeeCode, "ENG-A");
  });

  it("searches by preferredName", async () => {
    const res = await request(app)
      .get("/api/employees?search=Devvy&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.employees.length, 1);
    assert.equal(res.body.employees[0].employeeCode, "CTR-1");
  });

  it("searches by phoneNumber", async () => {
    const res = await request(app)
      .get("/api/employees?search=9888777666&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.employees.length, 1);
    assert.equal(res.body.employees[0].employeeCode, "ENG-A");
  });

  it("searches by department via free-text", async () => {
    const res = await request(app)
      .get("/api/employees?search=Finance&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.employees.some((e) => e.employeeCode === "FIN-1"));
  });

  it("searches by project name via free-text", async () => {
    const res = await request(app)
      .get("/api/employees?search=Portal&includeCompensation=false&sortBy=fullName&sortOrder=asc")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    const codes = res.body.employees.map((e) => e.employeeCode).sort();
    assert.deepEqual(codes, ["CTR-1", "ENG-A"]);
  });

  it("searches by work location via free-text", async () => {
    const res = await request(app)
      .get("/api/employees?search=Pune%20Campus&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.employees.length, 1);
    assert.equal(res.body.employees[0].employeeCode, "MGR-1");
  });

  it("searches by city via free-text", async () => {
    const res = await request(app)
      .get("/api/employees?search=Chennai&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.employees.some((e) => e.employeeCode === "FIN-1"));
  });

  it("filters by employmentType", async () => {
    const res = await request(app)
      .get("/api/employees?employmentType=Contract&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.employees.length, 1);
    assert.equal(res.body.employees[0].employeeCode, "CTR-1");
  });

  it("filters by workLocation", async () => {
    const res = await request(app)
      .get("/api/employees?workLocation=Bengaluru&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.employees.length, 1);
    assert.equal(res.body.employees[0].employeeCode, "ENG-A");
  });

  it("filters by invitationStatus", async () => {
    const pending = await request(app)
      .get("/api/employees?invitationStatus=PENDING&includeCompensation=false&sortBy=fullName&sortOrder=asc")
      .set("Cookie", acmeHrCookie);
    assert.equal(pending.status, 200);
    const pendingCodes = pending.body.employees.map((e) => e.employeeCode).sort();
    assert.deepEqual(pendingCodes, ["CTR-1", "ENG-A"]);

    const failed = await request(app)
      .get("/api/employees?invitationStatus=DELIVERY_FAILED&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(failed.status, 200);
    assert.equal(failed.body.employees.length, 1);
    assert.equal(failed.body.employees[0].employeeCode, "FIN-1");

    const bad = await request(app)
      .get("/api/employees?invitationStatus=BOGUS")
      .set("Cookie", acmeHrCookie);
    assert.equal(bad.status, 400);
  });

  it("filters by joining date range including boundaries", async () => {
    const range = await request(app)
      .get(
        "/api/employees?joiningFrom=2023-03-10&joiningTo=2023-03-10&includeCompensation=false&sortBy=fullName&sortOrder=asc"
      )
      .set("Cookie", acmeHrCookie);
    assert.equal(range.status, 200);
    assert.equal(range.body.employees.length, 1);
    assert.equal(range.body.employees[0].employeeCode, "ENG-A");

    const wider = await request(app)
      .get(
        "/api/employees?joiningFrom=2023-01-01&joiningTo=2023-12-31&includeCompensation=false&sortBy=fullName&sortOrder=asc"
      )
      .set("Cookie", acmeHrCookie);
    assert.equal(wider.status, 200);
    const codes = wider.body.employees.map((e) => e.employeeCode).sort();
    assert.deepEqual(codes, ["ENG-A", "WRK-1"]);
  });

  it("rejects invalid and reversed joining date ranges", async () => {
    const invalid = await request(app)
      .get("/api/employees?joiningFrom=not-a-date")
      .set("Cookie", acmeHrCookie);
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.message || "", /invalid joiningFrom/i);

    const reversed = await request(app)
      .get("/api/employees?joiningFrom=2024-12-01&joiningTo=2024-01-01")
      .set("Cookie", acmeHrCookie);
    assert.equal(reversed.status, 400);
    assert.match(reversed.body.message || "", /joiningFrom cannot be later/i);
  });

  it("filters by projectType", async () => {
    const res = await request(app)
      .get("/api/employees?projectType=BENCH&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.employees.length, 1);
    assert.equal(res.body.employees[0].employeeCode, "CTR-1");

    const bad = await request(app)
      .get("/api/employees?projectType=UNKNOWN")
      .set("Cookie", acmeHrCookie);
    assert.equal(bad.status, 400);
  });

  it("combines free-text search with dedicated filters", async () => {
    const res = await request(app)
      .get(
        `/api/employees?search=Portal&department=Engineering&status=ACTIVE&employmentType=Contract&projectType=BENCH&includeCompensation=false`
      )
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.employees.length, 1);
    assert.equal(res.body.employees[0].employeeCode, "CTR-1");
  });

  it("paginates with new filters and accepts desktop page size 12", async () => {
    const page1 = await request(app)
      .get(
        "/api/employees?department=Engineering&limit=12&page=1&sortBy=fullName&sortOrder=asc&includeCompensation=false"
      )
      .set("Cookie", acmeHrCookie);
    assert.equal(page1.status, 200);
    assert.equal(page1.body.pagination.limit, 12);
    assert.ok(page1.body.pagination.totalEmployees >= 3);
    assert.ok(page1.body.employees.length <= 12);

    const pageTiny = await request(app)
      .get(
        "/api/employees?department=Engineering&status=ACTIVE&limit=1&page=1&sortBy=fullName&sortOrder=asc&includeCompensation=false"
      )
      .set("Cookie", acmeHrCookie);
    // limit=1 is not allowed → falls back to 10
    assert.equal(pageTiny.status, 200);
    assert.equal(pageTiny.body.pagination.limit, 10);

    const page2 = await request(app)
      .get(
        `/api/employees?reportingManagerId=${mgr._id}&limit=1&page=2&sortBy=fullName&sortOrder=asc&includeCompensation=false`
      )
      .set("Cookie", acmeHrCookie);
    // still falls back to 10, so page 2 may be empty if total <= 10
    assert.equal(page2.status, 200);
    assert.equal(page2.body.pagination.limit, 10);
  });

  it("paginates filtered results with an allowed small page size", async () => {
    const page1 = await request(app)
      .get(
        `/api/employees?reportingManagerId=${mgr._id}&limit=8&page=1&sortBy=fullName&sortOrder=asc&includeCompensation=false`
      )
      .set("Cookie", acmeHrCookie);
    assert.equal(page1.status, 200);
    assert.equal(page1.body.pagination.limit, 8);
    assert.equal(page1.body.pagination.totalEmployees, 3);
    assert.equal(page1.body.employees.length, 3);
  });

  it("returns direct reports for reportingManagerId", async () => {
    const res = await request(app)
      .get(
        `/api/employees?reportingManagerId=${mgr._id}&includeCompensation=false&sortBy=fullName&sortOrder=asc`
      )
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    const codes = res.body.employees.map((e) => e.employeeCode).sort();
    assert.deepEqual(codes, ["CTR-1", "ENG-A", "ENG-B"]);
    assert.equal(res.body.pagination.totalEmployees, 3);
  });

  it("returns employees without a manager for reportingManagerId=none", async () => {
    const res = await request(app)
      .get("/api/employees?reportingManagerId=none&includeCompensation=false&sortBy=fullName&sortOrder=asc")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    const codes = res.body.employees.map((e) => e.employeeCode).sort();
    assert.ok(codes.includes("CEO-1"));
    assert.ok(codes.includes("FIN-1"));
    assert.ok(codes.includes("WRK-1"));
    assert.equal(codes.includes("ENG-A"), false);
    assert.equal(codes.includes("MGR-1"), false);
  });

  it("combines search + department + status + manager filters in one query", async () => {
    // Prefer a designation token ("Frontend") — free-text also matches department "Engineering".
    const res = await request(app)
      .get(
        `/api/employees?reportingManagerId=${mgr._id}&department=Engineering&status=ACTIVE&search=Frontend&includeCompensation=false`
      )
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.employees.length, 1);
    assert.equal(res.body.employees[0].employeeCode, "ENG-A");
    assert.equal(res.body.pagination.totalEmployees, 1);
  });

  it("rejects an invalid manager ObjectId", async () => {
    const res = await request(app)
      .get("/api/employees?reportingManagerId=not-a-valid-id")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /invalid reporting manager/i);
  });

  it("rejects a manager id from another tenant without exposing records", async () => {
    const res = await request(app)
      .get(`/api/employees?reportingManagerId=${globexMgr._id}`)
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /not found/i);
    assert.equal(res.body.employees, undefined);
  });

  it("keeps free-text search tenant-isolated", async () => {
    const acme = await request(app)
      .get("/api/employees?search=Ash&includeCompensation=false")
      .set("Cookie", acmeHrCookie);
    assert.equal(acme.status, 200);
    assert.ok(acme.body.employees.every((e) => String(e.email || "").endsWith("@acme-search.test") || e.employeeCode));
    assert.equal(
      acme.body.employees.some((e) => e.employeeCode === "GX-MGR"),
      false
    );

    const globex = await request(app)
      .get("/api/employees?search=Ash&includeCompensation=false")
      .set("Cookie", globexHrCookie);
    assert.equal(globex.status, 200);
    assert.equal(globex.body.employees.length, 1);
    assert.equal(globex.body.employees[0].employeeCode, "GX-MGR");
  });

  it("blocks EMPLOYEE role from the HR employee list", async () => {
    const res = await request(app).get("/api/employees").set("Cookie", acmeEmployeeCookie);
    assert.equal(res.status, 403);
  });

  it("preserves create, edit and manager reassignment", async () => {
    const created = await request(app)
      .post("/api/employees")
      .set("Cookie", acmeHrCookie)
      .send({
        fullName: "New Hire",
        email: "newhire@acme-search.test",
        employeeCode: "NEW-1",
        jobTitle: "QA Engineer",
        department: "Engineering",
        reportingManagerId: mgr._id.toString(),
      });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(String(created.body.employee.job.reportingManagerId), String(mgr._id));

    const patched = await request(app)
      .patch(`/api/employees/${created.body.employee._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: ceo._id.toString(), department: "Quality" });
    assert.equal(patched.status, 200);
    assert.equal(String(patched.body.employee.job.reportingManagerId), String(ceo._id));

    const cleared = await request(app)
      .patch(`/api/employees/${created.body.employee._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.employee.job.reportingManagerId, null);

    const cycle = await request(app)
      .patch(`/api/employees/${ceo._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: mgr._id.toString() });
    assert.equal(cycle.status, 400);
  });

  it("does not leak sensitive fields in list payloads", async () => {
    const res = await request(app)
      .get("/api/employees?limit=12&includeCompensation=false&search=Casey")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.pagination.limit, 12);
    const raw = JSON.stringify(res.body);
    assert.equal(raw.includes("accountNumber"), false);
    assert.equal(raw.includes("passwordHash"), false);
    assert.equal(raw.includes("secret-ceo-token"), false);
    assert.equal(raw.includes("SENSITIVE-CEO-ACC"), false);
    assert.equal(raw.includes("ABCDE1234F"), false);
    assert.equal(raw.includes("AADHAAR-CEO"), false);
    for (const emp of res.body.employees) {
      assert.equal(Object.hasOwn(emp, "bankDetails"), false);
      assert.equal(Object.hasOwn(emp, "documents"), false);
      assert.equal(Object.hasOwn(emp, "taxDetails"), false);
      assert.equal(Object.hasOwn(emp, "identityDetails"), false);
      assert.equal(Object.hasOwn(emp, "personalEmail"), false);
      assert.equal(Object.hasOwn(emp, "personalPhone"), false);
      assert.equal(Object.hasOwn(emp, "dateOfBirth"), false);
      if (emp.invitation) {
        assert.equal(Object.hasOwn(emp.invitation, "token"), false);
      }
    }
  });
});
