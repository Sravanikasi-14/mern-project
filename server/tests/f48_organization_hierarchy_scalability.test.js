process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f48-organization-hierarchy-scalability-secret!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f48_org";
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
import {
  NODE_ALLOWED_KEYS,
  buildEmployeeOrganizationView,
} from "../services/employeeOrganizationViewService.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${getAuthCookieName()}=`));
}

async function createEmp(company, data) {
  const { Employee } = await getCompanyModels(company);
  return Employee.create({
    status: data.status || EMPLOYEE_STATUSES.ACTIVE,
    phoneNumber: data.phoneNumber || "9000000001",
    email: data.email,
    employeeCode: data.employeeCode,
    fullName: data.fullName,
    userId: data.userId,
    personalEmail: "p@hidden.test",
    personalPhone: "1111111111",
    dateOfBirth: new Date("1990-01-01"),
    bankDetails: {
      accountHolderName: data.fullName,
      accountNumber: "1234567890",
      bankName: "Test Bank",
      ifscCode: "TEST0001",
    },
    taxDetails: { panNumber: "ABCDE1234F", taxRegime: "NEW" },
    identityDetails: { idType: "PAN", idNumber: "XXXX", isVerified: true },
    job: {
      jobTitle: data.jobTitle || "Engineer",
      department: data.department || "Engineering",
      employmentType: "Full-time",
      workLocation: "Hyderabad",
      joiningDate: new Date("2024-01-15"),
      reportingManagerId: data.reportingManagerId || null,
    },
  });
}

describe("F48 organization hierarchy scalability", () => {
  let mongo;
  let app;
  let company;
  let otherCompany;
  let models;
  let hrCookie;
  let workerCookie;
  let workerUser;
  let ids = {};

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    company = await Company.create({
      companyName: "F48 Acme",
      slug: "f48-acme",
      databaseName: "company_f48_acme",
      status: COMPANY_STATUSES.ACTIVE,
    });
    otherCompany = await Company.create({
      companyName: "F48 Globex",
      slug: "f48-globex",
      databaseName: "company_f48_globex",
      status: COMPANY_STATUSES.ACTIVE,
    });

    models = await getCompanyModels(company);
    const { User } = models;

    await User.create({
      email: "hr@f48-acme.test",
      passwordHash: await hashPassword("HrPass123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });

    hrCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "f48-acme",
        email: "hr@f48-acme.test",
        password: "HrPass123!",
      })
    );

    const ceo = await createEmp(company, {
      employeeCode: "CEO-1",
      fullName: "Ada Chief",
      email: "ceo@f48-acme.test",
      jobTitle: "CEO",
      department: "Executive",
    });
    const manager = await createEmp(company, {
      employeeCode: "MGR-1",
      fullName: "Blake Manager",
      email: "manager@f48-acme.test",
      reportingManagerId: ceo._id,
    });
    workerUser = await User.create({
      email: "worker@f48-acme.test",
      passwordHash: await hashPassword("WorkerPass123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
    });
    const worker = await createEmp(company, {
      employeeCode: "WRK-1",
      fullName: "Casey Worker",
      email: "worker@f48-acme.test",
      userId: workerUser._id,
      reportingManagerId: manager._id,
    });
    workerUser.employeeId = worker._id;
    await workerUser.save();

    const peer = await createEmp(company, {
      employeeCode: "PEER-1",
      fullName: "Drew Peer",
      email: "peer@f48-acme.test",
      reportingManagerId: manager._id,
    });
    const other = await createEmp(company, {
      employeeCode: "OTH-1",
      fullName: "Evan Other",
      email: "other@f48-acme.test",
      jobTitle: "Accountant",
      department: "Finance",
    });

    const inactiveMid = await createEmp(company, {
      employeeCode: "INACT-MID",
      fullName: "Inactive Mid",
      email: "inact-mid@f48-acme.test",
      status: EMPLOYEE_STATUSES.INACTIVE,
      reportingManagerId: worker._id,
    });
    const leaf = await createEmp(company, {
      employeeCode: "LEAF-1",
      fullName: "Leaf Report",
      email: "leaf@f48-acme.test",
      reportingManagerId: inactiveMid._id,
    });

    const cycleA = await createEmp(company, {
      employeeCode: "CYC-A",
      fullName: "Cycle A",
      email: "cyc-a@f48-acme.test",
      department: "Ops",
    });
    const cycleB = await createEmp(company, {
      employeeCode: "CYC-B",
      fullName: "Cycle B",
      email: "cyc-b@f48-acme.test",
      department: "Ops",
      reportingManagerId: cycleA._id,
    });
    cycleA.job.reportingManagerId = cycleB._id;
    await cycleA.save();

    for (let i = 0; i < 30; i += 1) {
      await createEmp(company, {
        employeeCode: `NOISE-${i}`,
        fullName: `Noise Emp ${i}`,
        email: `noise${i}@f48-acme.test`,
        department: "Noise",
      });
    }

    await createEmp(otherCompany, {
      employeeCode: "GX-1",
      fullName: "Globex Only",
      email: "gx@f48-globex.test",
    });

    ids = {
      ceo: String(ceo._id),
      manager: String(manager._id),
      worker: String(worker._id),
      peer: String(peer._id),
      other: String(other._id),
      leaf: String(leaf._id),
      inactiveMid: String(inactiveMid._id),
      cycleA: String(cycleA._id),
      cycleB: String(cycleB._id),
    };

    workerCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "f48-acme",
        email: "worker@f48-acme.test",
        password: "WorkerPass123!",
      })
    );
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("employee organization-view fetches only visible IDs (no full ACTIVE scan)", async () => {
    const { Employee } = models;
    const findFilters = [];
    const originalFind = Employee.find.bind(Employee);
    Employee.find = function patched(filter, ...rest) {
      findFilters.push(filter);
      return originalFind(filter, ...rest);
    };
    try {
      const payload = await buildEmployeeOrganizationView(Employee, workerUser, {});
      assert.ok(payload.employees.some((e) => e.id === ids.worker));
      assert.ok(payload.employees.some((e) => e.id === ids.leaf), "ACTIVE leaf under inactive mid");
      assert.equal(payload.employees.some((e) => e.id === ids.other), false);
      assert.equal(payload.meta.viewerEmployeeId, ids.worker);
      const constrained = findFilters.some(
        (f) => f && f._id && Array.isArray(f._id.$in) && f.status === EMPLOYEE_STATUSES.ACTIVE
      );
      assert.equal(constrained, true);
      assert.equal(
        findFilters.some((f) => f && f.status === EMPLOYEE_STATUSES.ACTIVE && !f._id),
        false,
        "must not full-scan ACTIVE without $in"
      );
    } finally {
      Employee.find = originalFind;
    }
  });

  it("employee privacy allowlist and unrelated ACTIVE excluded", async () => {
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", workerCookie);
    assert.equal(res.status, 200);
    const json = JSON.stringify(res.body);
    assert.equal(json.includes("Evan Other"), false);
    assert.equal(json.includes("Noise Emp"), false);
    assert.equal(json.includes("Globex Only"), false);
    assert.equal(json.includes("bankDetails"), false);
    assert.equal(json.includes("personalEmail"), false);
    for (const row of res.body.employees) {
      for (const key of Object.keys(row)) {
        assert.equal(NODE_ALLOWED_KEYS.includes(key), true, `unexpected field ${key}`);
      }
    }
  });

  it("cycles remain render-safe on employee view", async () => {
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", workerCookie);
    assert.equal(res.body.employees.some((e) => e.id === ids.cycleA), false);
  });

  it("HR bootstrap payload is bounded (roots only, not full workforce)", async () => {
    const res = await request(app)
      .get("/api/employees/organization")
      .query({ status: "ALL" })
      .set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, "bootstrap");
    assert.equal(res.body.lazy, true);
    assert.ok(res.body.meta.total > 30);
    assert.ok(res.body.employees.length < res.body.meta.total);
    assert.ok(res.body.hierarchyRootIds.includes(ids.ceo));
    assert.equal(
      res.body.employees.some((e) => e.fullName?.startsWith("Noise Emp")),
      false
    );
    assert.ok(Array.isArray(res.body.filterOptions?.departments));
  });

  it("children endpoint returns only direct reports", async () => {
    const res = await request(app)
      .get("/api/employees/organization/children")
      .query({ managerId: ids.ceo, status: "ACTIVE" })
      .set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.employees.length, 1);
    assert.equal(res.body.employees[0].id, ids.manager);
    assert.equal(res.body.employees[0].treeManagerId, ids.ceo);
    assert.deepEqual(res.body.employees[0].childIds, []);
    assert.ok(res.body.employees[0].directReportCount >= 1);
  });

  it("children?managerId=none returns unassigned leaves only", async () => {
    const res = await request(app)
      .get("/api/employees/organization/children")
      .query({ managerId: "none", status: "ACTIVE" })
      .set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.employees.some((e) => e.id === ids.other));
    assert.equal(res.body.employees.some((e) => e.id === ids.ceo), false);
    assert.ok(res.body.employees.some((e) => e.fullName?.startsWith("Noise Emp")));
  });

  it("search returns matches and ancestor ids", async () => {
    const res = await request(app)
      .get("/api/employees/organization/search")
      .query({ q: "Casey", status: "ACTIVE" })
      .set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.matchIds.includes(ids.worker));
    assert.ok(res.body.ancestorIds.includes(ids.manager));
    assert.ok(res.body.ancestorIds.includes(ids.ceo));
    assert.ok(res.body.employees.some((e) => e.id === ids.worker));
  });

  it("ACTIVE vs ALL status behavior on bootstrap", async () => {
    const active = await request(app)
      .get("/api/employees/organization")
      .query({ status: "ACTIVE" })
      .set("Cookie", hrCookie);
    const all = await request(app)
      .get("/api/employees/organization")
      .query({ status: "ALL" })
      .set("Cookie", hrCookie);
    assert.equal(active.status, 200);
    assert.equal(all.status, 200);
    assert.ok(all.body.meta.total >= active.body.meta.total);
  });

  it("tenant isolation on children and search", async () => {
    const children = await request(app)
      .get("/api/employees/organization/children")
      .query({ managerId: ids.ceo })
      .set("Cookie", hrCookie);
    assert.equal(JSON.stringify(children.body).includes("Globex Only"), false);

    const search = await request(app)
      .get("/api/employees/organization/search")
      .query({ q: "Globex" })
      .set("Cookie", hrCookie);
    assert.equal(search.body.employees.length, 0);
  });

  it("legacy mode=full still available for migration consumers", async () => {
    const res = await request(app)
      .get("/api/employees/organization")
      .query({ mode: "full", status: "ACTIVE" })
      .set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, "full");
    assert.ok(res.body.employees.length > 30);
    assert.ok(res.body.employees.some((e) => e.id === ids.worker));
  });

  it("employees cannot call HR organization children/search", async () => {
    const children = await request(app)
      .get("/api/employees/organization/children")
      .query({ managerId: ids.ceo })
      .set("Cookie", workerCookie);
    assert.equal(children.status, 403);

    const search = await request(app)
      .get("/api/employees/organization/search")
      .query({ q: "Casey" })
      .set("Cookie", workerCookie);
    assert.equal(search.status, 403);
  });

  it("manager-edit then children reflects new reporting line", async () => {
    const move = await request(app)
      .patch(`/api/employees/${ids.peer}`)
      .set("Cookie", hrCookie)
      .send({ reportingManagerId: ids.ceo });
    assert.equal(move.status, 200);

    const children = await request(app)
      .get("/api/employees/organization/children")
      .query({ managerId: ids.ceo, status: "ACTIVE" })
      .set("Cookie", hrCookie);
    assert.ok(children.body.employees.some((e) => e.id === ids.peer));
  });
});
