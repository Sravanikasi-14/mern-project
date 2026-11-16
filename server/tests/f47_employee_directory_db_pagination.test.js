process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f47-employee-directory-db-pagination-secret-32!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f47_directory";
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
import { buildEmployeeDirectory } from "../services/employeeDirectoryService.js";
import {
  EMPLOYEE_RELATIONSHIPS,
  MAX_RELATIONSHIP_WALK,
  collectHierarchyVisibleEmployeeIds,
} from "../services/employeeRelationshipService.js";

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

describe("F47 employee directory DB pagination", () => {
  let mongo;
  let app;
  let company;
  let otherCompany;
  let models;
  let workerCookie;
  let hrCookie;
  let companyAdminCookie;
  let workerUser;
  let ids = {};

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    company = await Company.create({
      companyName: "F47 Acme",
      slug: "f47-acme",
      databaseName: "company_f47_acme",
      status: COMPANY_STATUSES.ACTIVE,
    });
    otherCompany = await Company.create({
      companyName: "F47 Globex",
      slug: "f47-globex",
      databaseName: "company_f47_globex",
      status: COMPANY_STATUSES.ACTIVE,
    });

    models = await getCompanyModels(company);
    const { User } = models;

    await User.create({
      email: "hr@f47-acme.test",
      passwordHash: await hashPassword("HrPass123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });
    await User.create({
      email: "admin@f47-acme.test",
      passwordHash: await hashPassword("AdminPass123!"),
      role: USER_ROLES.COMPANY_ADMIN,
      isActive: true,
    });

    hrCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "f47-acme",
        email: "hr@f47-acme.test",
        password: "HrPass123!",
      })
    );
    companyAdminCookie = cookieFrom(
      await request(app).post("/api/auth/login").send({
        companyCode: "f47-acme",
        email: "admin@f47-acme.test",
        password: "AdminPass123!",
      })
    );

    // CEO → Manager → Worker / Peer; Finance OTHER; inactive mid + active leaf
    const ceo = await createEmp(company, {
      employeeCode: "CEO-1",
      fullName: "Ada Chief",
      email: "ceo@f47-acme.test",
      jobTitle: "Chief Executive",
      department: "Executive",
    });
    const manager = await createEmp(company, {
      employeeCode: "MGR-1",
      fullName: "Blake Manager",
      email: "manager@f47-acme.test",
      jobTitle: "Engineering Manager",
      department: "Engineering",
      reportingManagerId: ceo._id,
    });
    workerUser = await User.create({
      email: "worker@f47-acme.test",
      passwordHash: await hashPassword("WorkerPass123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
    });
    const worker = await createEmp(company, {
      employeeCode: "WRK-1",
      fullName: "Casey Worker",
      email: "worker@f47-acme.test",
      userId: workerUser._id,
      jobTitle: "Software Engineer",
      department: "Engineering",
      reportingManagerId: manager._id,
      invitation: { status: "ACCEPTED", token: "secret-f47-token", sentAt: new Date() },
    });
    workerUser.employeeId = worker._id;
    await workerUser.save();

    const peer = await createEmp(company, {
      employeeCode: "PEER-1",
      fullName: "Drew Peer",
      email: "peer@f47-acme.test",
      jobTitle: "Software Engineer",
      department: "Engineering",
      reportingManagerId: manager._id,
    });
    const other = await createEmp(company, {
      employeeCode: "OTH-1",
      fullName: "Evan Other",
      email: "other@f47-acme.test",
      jobTitle: "Accountant",
      department: "Finance",
      reportingManagerId: null,
    });

    // Inactive middle manager under worker; active leaf under inactive mid
    const inactiveMid = await createEmp(company, {
      employeeCode: "INACT-MID",
      fullName: "Inactive Mid",
      email: "inact-mid@f47-acme.test",
      status: EMPLOYEE_STATUSES.INACTIVE,
      jobTitle: "Former Lead",
      department: "Engineering",
      reportingManagerId: worker._id,
    });
    const leaf = await createEmp(company, {
      employeeCode: "LEAF-1",
      fullName: "Leaf Report",
      email: "leaf@f47-acme.test",
      jobTitle: "Junior Engineer",
      department: "Engineering",
      reportingManagerId: inactiveMid._id,
    });

    // Cycle A ↔ B (orphaned from viewer hierarchy)
    const cycleA = await createEmp(company, {
      employeeCode: "CYC-A",
      fullName: "Cycle A",
      email: "cyc-a@f47-acme.test",
      jobTitle: "Ops",
      department: "Ops",
    });
    const cycleB = await createEmp(company, {
      employeeCode: "CYC-B",
      fullName: "Cycle B",
      email: "cyc-b@f47-acme.test",
      jobTitle: "Ops",
      department: "Ops",
      reportingManagerId: cycleA._id,
    });
    cycleA.job.reportingManagerId = cycleB._id;
    await cycleA.save();

    // Orphan (no manager) and employee pointing at a non-existent manager.
    const { default: mongoose } = await import("mongoose");
    await createEmp(company, {
      employeeCode: "ORPH-1",
      fullName: "Orphan Emp",
      email: "orphan@f47-acme.test",
      jobTitle: "Contractor",
      department: "Ops",
      reportingManagerId: null,
    });
    await createEmp(company, {
      employeeCode: "MISS-MGR",
      fullName: "Missing Manager Emp",
      email: "miss-mgr@f47-acme.test",
      jobTitle: "Lone Wolf",
      department: "Ops",
      reportingManagerId: new mongoose.Types.ObjectId(),
    });

    await createEmp(otherCompany, {
      employeeCode: "GX-1",
      fullName: "Globex Only",
      email: "gx@f47-globex.test",
      jobTitle: "Director",
      department: "Ops",
    });

    // Noise ACTIVE workforce for full-fetch detection
    for (let i = 0; i < 40; i += 1) {
      await createEmp(company, {
        employeeCode: `NOISE-${i}`,
        fullName: `Noise Emp ${String(i).padStart(2, "0")}`,
        email: `noise${i}@f47-acme.test`,
        jobTitle: "Noise",
        department: "NoiseDept",
        reportingManagerId: null,
      });
    }

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
        companyCode: "f47-acme",
        email: "worker@f47-acme.test",
        password: "WorkerPass123!",
      })
    );
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("collectHierarchyVisibleEmployeeIds includes SELF, ancestors, peers, reports", async () => {
    const visible = await collectHierarchyVisibleEmployeeIds({
      Employee: models.Employee,
      viewerEmployeeId: ids.worker,
    });
    assert.equal(visible.has(ids.worker), true);
    assert.equal(visible.has(ids.manager), true);
    assert.equal(visible.has(ids.ceo), true);
    assert.equal(visible.has(ids.peer), true);
    assert.equal(visible.has(ids.leaf), true, "ACTIVE leaf under inactive mid must remain visible");
    assert.equal(visible.has(ids.inactiveMid), false, "inactive mid is not directory-visible");
    assert.equal(visible.has(ids.other), false);
    assert.equal(visible.has(ids.cycleA), false);
    assert.equal(visible.has(ids.cycleB), false);
  });

  it("employee directory returns hierarchy-visible set only", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ page: 1, limit: 50 })
      .set("Cookie", workerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const names = new Set(res.body.data.map((row) => row.fullName));
    assert.equal(names.has("Casey Worker"), true);
    assert.equal(names.has("Blake Manager"), true);
    assert.equal(names.has("Ada Chief"), true);
    assert.equal(names.has("Drew Peer"), true);
    assert.equal(names.has("Leaf Report"), true);
    assert.equal(names.has("Evan Other"), false);
    assert.equal(names.has("Noise Emp 00"), false);
    assert.equal(names.has("Globex Only"), false);
    assert.equal(names.has("Cycle A"), false);
    assert.ok(res.body.pagination.totalEmployees >= 5);
    assert.ok(res.body.pagination.totalEmployees < 20);
  });

  it("large peer cohort paginates without duplicates across pages", async () => {
    for (let i = 0; i < 12; i += 1) {
      await createEmp(company, {
        employeeCode: `PG-${i}`,
        fullName: `Page Peer ${String(i).padStart(2, "0")}`,
        email: `pg${i}@f47-acme.test`,
        jobTitle: "Analyst",
        department: "Engineering",
        reportingManagerId: ids.manager,
      });
    }

    const page1 = await request(app)
      .get("/api/employees/directory")
      .query({ page: 1, limit: 10 })
      .set("Cookie", workerCookie);
    const page2 = await request(app)
      .get("/api/employees/directory")
      .query({ page: 2, limit: 10 })
      .set("Cookie", workerCookie);

    assert.equal(page1.status, 200);
    assert.equal(page2.status, 200);
    assert.equal(page1.body.data.length, 10);
    assert.equal(page1.body.pagination.page, 1);
    assert.equal(page2.body.pagination.page, 2);
    assert.equal(page1.body.pagination.totalEmployees, page2.body.pagination.totalEmployees);
    assert.ok(page1.body.pagination.totalEmployees > 10);

    const ids1 = new Set(page1.body.data.map((r) => String(r._id)));
    for (const row of page2.body.data) {
      assert.equal(ids1.has(String(row._id)), false);
    }
    const combined = [...page1.body.data, ...page2.body.data];
    assert.equal(combined.some((r) => r.fullName === "Evan Other"), false);
    assert.equal(combined.some((r) => r.fullName?.startsWith("Noise Emp")), false);
  });

  it("search is restricted to visible employees", async () => {
    const emp = await request(app)
      .get("/api/employees/directory")
      .query({ search: "Accountant" })
      .set("Cookie", workerCookie);
    assert.equal(emp.status, 200);
    assert.equal(emp.body.data.length, 0);

    const noise = await request(app)
      .get("/api/employees/directory")
      .query({ search: "Noise Emp" })
      .set("Cookie", workerCookie);
    assert.equal(noise.status, 200);
    assert.equal(noise.body.data.length, 0);

    const peer = await request(app)
      .get("/api/employees/directory")
      .query({ search: "Drew" })
      .set("Cookie", workerCookie);
    assert.equal(peer.status, 200);
    assert.equal(peer.body.data.length, 1);
    assert.equal(peer.body.data[0].relationship, EMPLOYEE_RELATIONSHIPS.PEER);
  });

  it("tenant isolation and sensitive fields remain excluded", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ limit: 50 })
      .set("Cookie", workerCookie);
    assert.equal(res.status, 200);
    const json = JSON.stringify(res.body);
    assert.equal(json.includes("Globex Only"), false);
    assert.equal(json.includes("secret-f47-token"), false);
    assert.equal(json.includes("personalEmail"), false);
    assert.equal(json.includes("bankDetails"), false);
    assert.equal(json.includes("taxDetails"), false);
    for (const row of res.body.data) {
      assert.equal(row.status, undefined);
      assert.equal(row.phoneNumber, undefined);
      assert.equal(row.invitation, undefined);
    }
  });

  it("HR_ADMIN still DB-paginates and can see Finance search hits", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: "Accountant", page: 1, limit: 10 })
      .set("Cookie", hrCookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((e) => e.jobTitle === "Accountant"));
    assert.equal(res.body.data[0].relationship, EMPLOYEE_RELATIONSHIPS.OTHER);
  });

  it("COMPANY_ADMIN DB-paginates without loading all employee documents", async () => {
    const { Employee } = models;
    const findFilters = [];
    const originalFind = Employee.find.bind(Employee);
    Employee.find = function patchedFind(filter, ...rest) {
      findFilters.push(filter);
      const query = originalFind(filter, ...rest);
      return query;
    };

    try {
      const result = await buildEmployeeDirectory({
        Employee,
        user: { _id: "ca", role: USER_ROLES.COMPANY_ADMIN, email: "admin@f47-acme.test" },
        page: 1,
        limit: 10,
      });
      assert.equal(result.success, true);
      assert.equal(result.data.length, 10);
      assert.ok(result.pagination.totalEmployees > 40);
      // Portal path must not constrain by a precomputed visible $in set of hierarchy IDs
      // and must not have fetched without skip/limit (assert page size).
      assert.equal(
        findFilters.some((f) => f && f._id && f._id.$in && Array.isArray(f._id.$in)),
        false,
        "COMPANY_ADMIN should use company-wide filter, not hierarchy $in"
      );
    } finally {
      Employee.find = originalFind;
    }

    const http = await request(app)
      .get("/api/employees/directory")
      .query({ page: 1, limit: 10 })
      .set("Cookie", companyAdminCookie);
    assert.equal(http.status, 200);
    assert.equal(http.body.data.length, 10);
    assert.ok(http.body.pagination.totalEmployees > 40);
  });

  it("employee path find uses visible $in with skip/limit", async () => {
    const { Employee } = models;
    const skips = [];
    const limits = [];
    const filters = [];
    const originalFind = Employee.find.bind(Employee);
    Employee.find = function patchedFind(filter, ...rest) {
      filters.push(filter);
      const query = originalFind(filter, ...rest);
      const origSkip = query.skip.bind(query);
      const origLimit = query.limit.bind(query);
      query.skip = function patchedSkip(n) {
        skips.push(n);
        return origSkip(n);
      };
      query.limit = function patchedLimit(n) {
        limits.push(n);
        return origLimit(n);
      };
      return query;
    };

    try {
      const result = await buildEmployeeDirectory({
        Employee,
        user: workerUser.toObject ? workerUser.toObject() : workerUser,
        page: 2,
        limit: 10,
      });
      assert.equal(result.success, true);
      assert.equal(skips.includes(10), true, "expected skip(10) for page 2");
      assert.equal(limits.includes(10), true, "expected limit(10)");
      const pageFilter = filters.find(
        (f) => f && f.status === EMPLOYEE_STATUSES.ACTIVE && f._id && Array.isArray(f._id.$in)
      );
      assert.ok(pageFilter, "expected ACTIVE + _id.$in page filter");
      assert.ok(pageFilter._id.$in.length > 0);
      assert.ok(pageFilter._id.$in.length < 80, "visible $in must not be full company");
    } finally {
      Employee.find = originalFind;
    }
  });

  it("GlobalSearch limit=8 stays compatible (falls back to default 20)", async () => {
    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: "", page: 1, limit: 8 })
      .set("Cookie", workerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.pagination.limit, 20);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length <= 20);
  });

  it("deep hierarchy within walk bound remains visible; cycles do not hang", async () => {
    // Attach a short chain under leaf (already under worker via inactive mid)
    let parentId = ids.leaf;
    const deepIds = [];
    for (let i = 0; i < 5; i += 1) {
      const node = await createEmp(company, {
        employeeCode: `DEEP-${i}`,
        fullName: `Deep Node ${i}`,
        email: `deep${i}@f47-acme.test`,
        jobTitle: "Deep",
        department: "Engineering",
        reportingManagerId: parentId,
      });
      deepIds.push(String(node._id));
      parentId = node._id;
    }

    const visible = await collectHierarchyVisibleEmployeeIds({
      Employee: models.Employee,
      viewerEmployeeId: ids.worker,
    });
    for (const id of deepIds) {
      assert.equal(visible.has(id), true);
    }
    assert.ok(MAX_RELATIONSHIP_WALK >= 5);

    // Cycle pair still excluded for worker
    assert.equal(visible.has(ids.cycleA), false);
    assert.equal(visible.has(ids.cycleB), false);

    const res = await request(app)
      .get("/api/employees/directory")
      .query({ search: "Deep Node 4", limit: 10 })
      .set("Cookie", workerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].relationship, EMPLOYEE_RELATIONSHIPS.INDIRECT_REPORT);
  });
});
