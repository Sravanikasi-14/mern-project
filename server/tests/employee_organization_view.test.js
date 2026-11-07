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
import {
  NODE_ALLOWED_KEYS,
  filterOrganizationViewPayload,
} from "../services/employeeOrganizationViewService.js";
import { EMPLOYEE_RELATIONSHIPS } from "../services/employeeRelationshipService.js";

let mongo;
let app;
let acme;
let globex;
let acmeHrCookie;
let acmeWorkerCookie;
let acmeManagerCookie;
let acmeRootMgrCookie;
let globexHrCookie;
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
    personalEmail: "personal@hidden.test",
    personalPhone: "1111111111",
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
      employmentType: data.employmentType || "Full-time",
      workLocation: data.workLocation || "Hyderabad",
      joiningDate: data.joiningDate || new Date("2024-01-15"),
      reportingManagerId: data.reportingManagerId || null,
    },
  });
}

function assertNoSensitiveOrgLeak(body) {
  const json = JSON.stringify(body);
  assert.equal(json.includes("secret-invite"), false);
  assert.equal(json.includes("passwordHash"), false);
  assert.equal(json.includes("personalEmail"), false);
  assert.equal(json.includes("bankDetails"), false);
  assert.equal(json.includes("taxDetails"), false);
  assert.equal(json.includes("identityDetails"), false);
  assert.equal(json.includes("compensation"), false);
  for (const node of body.employees || []) {
    assert.equal(node.status, undefined);
    assert.equal(node.email, undefined);
    assert.equal(node.phoneNumber, undefined);
    assert.equal(node.employmentType, undefined);
    assert.equal(node.invitation, undefined);
    for (const key of Object.keys(node)) {
      assert.ok(NODE_ALLOWED_KEYS.includes(key), `unexpected org node field: ${key}`);
    }
  }
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme OrgView",
    slug: "acme-ov",
    databaseName: "company_acme_ov",
    status: COMPANY_STATUSES.ACTIVE,
  });
  globex = await Company.create({
    companyName: "Globex OrgView",
    slug: "globex-ov",
    databaseName: "company_globex_ov",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: AcmeUser, Employee: AcmeEmployee } = await getCompanyModels(acme);
  await AcmeUser.create({
    email: "hr@acme-ov.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const ceo = await createEmp(acme, {
    employeeCode: "CEO-1",
    fullName: "Ada Chief",
    email: "ceo@acme-ov.test",
    jobTitle: "CEO",
    department: "Executive",
  });
  const managerUser = await AcmeUser.create({
    email: "manager@acme-ov.test",
    passwordHash: await hashPassword("ManagerPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const manager = await createEmp(acme, {
    employeeCode: "MGR-1",
    fullName: "Blake Manager",
    email: "manager@acme-ov.test",
    userId: managerUser._id,
    jobTitle: "Engineering Manager",
    department: "Engineering",
    reportingManagerId: ceo._id,
    phoneNumber: "9000000099",
  });
  managerUser.employeeId = manager._id;
  await managerUser.save();

  const workerUser = await AcmeUser.create({
    email: "worker@acme-ov.test",
    passwordHash: await hashPassword("WorkerPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const worker = await createEmp(acme, {
    employeeCode: "WRK-1",
    fullName: "Casey Worker",
    email: "worker@acme-ov.test",
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
    email: "peer@acme-ov.test",
    jobTitle: "Software Engineer",
    department: "Engineering",
    reportingManagerId: manager._id,
    phoneNumber: "9000000088",
  });
  const other = await createEmp(acme, {
    employeeCode: "FIN-1",
    fullName: "Evan Finance",
    email: "finance@acme-ov.test",
    jobTitle: "Accountant",
    department: "Finance",
    reportingManagerId: null,
  });
  const skip = await createEmp(acme, {
    employeeCode: "SKIP-1",
    fullName: "Skip Level",
    email: "skip@acme-ov.test",
    reportingManagerId: peer._id,
  });
  await createEmp(acme, {
    employeeCode: "INACT-1",
    fullName: "Inactive Person",
    email: "inactive@acme-ov.test",
    status: EMPLOYEE_STATUSES.INACTIVE,
  });

  // Cycle pair for safe rendering
  const cycA = await createEmp(acme, {
    employeeCode: "CYC-A",
    fullName: "Cycle A",
    email: "cyca@acme-ov.test",
  });
  const cycB = await createEmp(acme, {
    employeeCode: "CYC-B",
    fullName: "Cycle B",
    email: "cycb@acme-ov.test",
    reportingManagerId: cycA._id,
  });
  await AcmeEmployee.updateOne({ _id: cycA._id }, { $set: { "job.reportingManagerId": cycB._id } });

  // Root manager (no own manager) with two direct reports — chart-root regression fixture
  const rootMgrUser = await AcmeUser.create({
    email: "rootmgr@acme-ov.test",
    passwordHash: await hashPassword("RootMgrPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const rootMgr = await createEmp(acme, {
    employeeCode: "ROOT-MGR",
    fullName: "Root Manager",
    email: "rootmgr@acme-ov.test",
    userId: rootMgrUser._id,
    jobTitle: "Head of Ops",
    department: "Operations",
    reportingManagerId: null,
  });
  rootMgrUser.employeeId = rootMgr._id;
  await rootMgrUser.save();
  const rootReportA = await createEmp(acme, {
    employeeCode: "ROOT-R1",
    fullName: "Root Report A",
    email: "rootr1@acme-ov.test",
    jobTitle: "Ops Specialist",
    department: "Operations",
    reportingManagerId: rootMgr._id,
  });
  const rootReportB = await createEmp(acme, {
    employeeCode: "ROOT-R2",
    fullName: "Root Report B",
    email: "rootr2@acme-ov.test",
    jobTitle: "Ops Analyst",
    department: "Operations",
    reportingManagerId: rootMgr._id,
  });

  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "hr@globex-ov.test",
    passwordHash: await hashPassword("GlobexPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const globexEmp = await createEmp(globex, {
    employeeCode: "GX-1",
    fullName: "Globex Only",
    email: "gx@globex-ov.test",
    jobTitle: "Director",
    department: "Ops",
  });

  ids = {
    ceo: String(ceo._id),
    manager: String(manager._id),
    worker: String(worker._id),
    peer: String(peer._id),
    other: String(other._id),
    skip: String(skip._id),
    cycA: String(cycA._id),
    cycB: String(cycB._id),
    globexEmp: String(globexEmp._id),
    rootMgr: String(rootMgr._id),
    rootReportA: String(rootReportA._id),
    rootReportB: String(rootReportB._id),
  };

  acmeHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-ov",
      email: "hr@acme-ov.test",
      password: "AcmePass123!",
    })
  );
  acmeWorkerCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-ov",
      email: "worker@acme-ov.test",
      password: "WorkerPass123!",
    })
  );
  acmeManagerCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-ov",
      email: "manager@acme-ov.test",
      password: "ManagerPass123!",
    })
  );
  acmeRootMgrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-ov",
      email: "rootmgr@acme-ov.test",
      password: "RootMgrPass123!",
    })
  );
  globexHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "globex-ov",
      email: "hr@globex-ov.test",
      password: "GlobexPass123!",
    })
  );
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("GET /api/employees/organization-view", () => {
  it("rejects anonymous requests with 401", async () => {
    const res = await request(app).get("/api/employees/organization-view");
    assert.equal(res.status, 401);
  });

  it("allows EMPLOYEE to retrieve hierarchy-visible colleagues only", async () => {
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.employees));
    // Worker sees SELF + managers + peer (not Finance OTHER, skip-level OTHER, cycles, inactive)
    const visibleIds = new Set(res.body.employees.map((e) => e.id));
    assert.equal(visibleIds.has(ids.ceo), true);
    assert.equal(visibleIds.has(ids.manager), true);
    assert.equal(visibleIds.has(ids.worker), true);
    assert.equal(visibleIds.has(ids.peer), true);
    assert.equal(visibleIds.has(ids.other), false);
    assert.equal(visibleIds.has(ids.skip), false);
    assert.equal(res.body.employees.some((e) => e.fullName === "Inactive Person"), false);
    assert.equal(res.body.employees.some((e) => e.id === ids.globexEmp), false);
    assert.equal(res.body.meta.viewerEmployeeId, ids.worker);
    assertNoSensitiveOrgLeak(res.body);
  });

  it("employee sees self, immediate manager, and all ancestors in a linked chart path", async () => {
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    const byId = new Map(res.body.employees.map((e) => [e.id, e]));
    assert.ok(byId.has(ids.worker));
    assert.ok(byId.has(ids.manager));
    assert.ok(byId.has(ids.ceo));
    assert.equal(byId.get(ids.worker).reportingManagerId, ids.manager);
    assert.equal(byId.get(ids.worker).treeManagerId, ids.manager);
    assert.equal(byId.get(ids.manager).reportingManagerId, ids.ceo);
    assert.equal(byId.get(ids.manager).treeManagerId, ids.ceo);
    assert.equal(byId.get(ids.ceo).treeManagerId, null);
    assert.ok(byId.get(ids.manager).childIds.includes(ids.worker));
    assert.ok(byId.get(ids.ceo).childIds.includes(ids.manager));
    assert.ok(res.body.hierarchyRootIds.includes(ids.ceo));
    assert.equal(res.body.hierarchyRootIds.includes(ids.worker), false);
  });

  it("employee sees peers sharing the same immediate manager", async () => {
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeWorkerCookie);
    const mgr = res.body.employees.find((e) => e.id === ids.manager);
    assert.ok(mgr.childIds.includes(ids.peer));
    assert.ok(res.body.employees.some((e) => e.id === ids.peer));
  });

  it("reporting manager sees ancestors and descendants", async () => {
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeManagerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.viewerEmployeeId, ids.manager);
    const byId = new Map(res.body.employees.map((e) => [e.id, e]));
    assert.ok(byId.has(ids.ceo));
    assert.ok(byId.has(ids.manager));
    assert.ok(byId.has(ids.worker));
    assert.ok(byId.has(ids.peer));
    assert.ok(byId.has(ids.skip)); // indirect report via peer
    assert.ok(byId.get(ids.ceo).childIds.includes(ids.manager));
    assert.ok(byId.get(ids.manager).childIds.includes(ids.worker));
    assert.ok(byId.get(ids.manager).childIds.includes(ids.peer));
    assert.ok(res.body.hierarchyRootIds.includes(ids.ceo));
    assert.equal(byId.has(ids.other), false);
    assert.equal(byId.has(ids.rootMgr), false);
  });

  it("denies direct profile access to unrelated employees", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.other}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 404);
  });

  it("does not return another company's hierarchy", async () => {
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.body.employees.some((e) => e.employeeCode === "GX-1"), false);

    const gx = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", globexHrCookie);
    assert.equal(gx.status, 200);
    assert.equal(gx.body.employees.length, 1);
    assert.equal(gx.body.employees[0].employeeCode, "GX-1");
    assert.equal(gx.body.employees.some((e) => e.id === ids.worker), false);
  });

  it("allows HR_ADMIN without losing existing HR organization API", async () => {
    const view = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeHrCookie);
    assert.equal(view.status, 200);
    assertNoSensitiveOrgLeak(view.body);

    const hrOrg = await request(app)
      .get("/api/employees/organization")
      .set("Cookie", acmeHrCookie);
    assert.equal(hrOrg.status, 200);
    assert.ok(Array.isArray(hrOrg.body.employees));
    // HR org retains richer fields (status) — separate from employee view.
    assert.ok(hrOrg.body.employees.some((e) => e.status === EMPLOYEE_STATUSES.ACTIVE));

    const blocked = await request(app)
      .get("/api/employees/organization")
      .set("Cookie", acmeWorkerCookie);
    assert.equal(blocked.status, 403);
  });

  it("returns only approved chart node fields", async () => {
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeWorkerCookie);
    assertNoSensitiveOrgLeak(res.body);
    const workerNode = res.body.employees.find((e) => e.id === ids.worker);
    assert.equal(workerNode.fullName, "Casey Worker");
    assert.equal(workerNode.employeeCode, "WRK-1");
    assert.equal(workerNode.jobTitle, "Software Engineer");
    assert.equal(workerNode.department, "Engineering");
    assert.equal(workerNode.reportingManagerId, ids.manager);
  });

  it("handles cycles and missing managers safely for rendering", async () => {
    // HR sees the full ACTIVE chart including cycle pairs and unassigned.
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.meta.cycleEdgesBroken >= 1);
    const a = res.body.employees.find((e) => e.id === ids.cycA);
    const b = res.body.employees.find((e) => e.id === ids.cycB);
    assert.ok(a && b);
    const mutualCycle =
      a.treeManagerId === b.id && b.treeManagerId === a.id;
    assert.equal(mutualCycle, false);
    const unassigned = res.body.employees.find((e) => e.id === ids.other);
    assert.equal(unassigned.reportingManagerId, null);
    assert.ok(res.body.unassignedIds.includes(ids.other));
  });

  it("places a manager with no own manager in hierarchyRootIds with direct reports", async () => {
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeRootMgrCookie);
    assert.equal(res.status, 200);
    const visible = new Set(res.body.employees.map((e) => e.id));
    assert.equal(visible.has(ids.rootMgr), true);
    assert.equal(visible.has(ids.rootReportA), true);
    assert.ok(res.body.hierarchyRootIds.includes(ids.rootMgr));
    assert.equal(res.body.unassignedIds.includes(ids.rootMgr), false);
    const mgrNode = res.body.employees.find((e) => e.id === ids.rootMgr);
    assert.ok(mgrNode.childIds.includes(ids.rootReportA));
    assert.equal(mgrNode.treeManagerId, null);
    assert.equal(mgrNode.directReportCount >= 1, true);
  });

  it("lists all visible direct reports under the manager", async () => {
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeRootMgrCookie);
    const mgrNode = res.body.employees.find((e) => e.id === ids.rootMgr);
    assert.ok(mgrNode.childIds.includes(ids.rootReportA));
    assert.ok(mgrNode.childIds.includes(ids.rootReportB));
    assert.equal(mgrNode.directReportCount, 2);
    assert.ok(res.body.childrenByManagerId[ids.rootMgr]?.includes(ids.rootReportA));
    assert.ok(res.body.childrenByManagerId[ids.rootMgr]?.includes(ids.rootReportB));
  });

  it("keeps unrelated employees out of chart indexes for a root manager", async () => {
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeRootMgrCookie);
    const visible = new Set(res.body.employees.map((e) => e.id));
    assert.equal(visible.has(ids.other), false);
    assert.equal(visible.has(ids.worker), false);
    assert.equal(res.body.hierarchyRootIds.includes(ids.other), false);
    assert.equal(res.body.unassignedIds.includes(ids.other), false);
    assert.equal(res.body.rootIds.includes(ids.other), false);
    for (const childIds of Object.values(res.body.childrenByManagerId || {})) {
      assert.equal(childIds.includes(ids.other), false);
    }
  });

  it("shows a manager subtree when their superior is invisible", async () => {
    // Blake Manager's CEO is visible as DIRECT_MANAGER — still a multi-level tree.
    // Clear CEO from visibility via unit filter to mirror "superior not visible".
    const full = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeManagerCookie);
    assert.equal(full.status, 200);
    assert.ok(full.body.employees.some((e) => e.id === ids.worker));
    assert.ok(full.body.employees.some((e) => e.id === ids.peer));

    const withoutCeo = filterOrganizationViewPayload(full.body, new Set([
      ids.manager,
      ids.worker,
      ids.peer,
      ids.skip,
    ]));
    assert.ok(withoutCeo.hierarchyRootIds.includes(ids.manager));
    assert.equal(withoutCeo.unassignedIds.includes(ids.manager), false);
    assert.equal(withoutCeo.employees.some((e) => e.id === ids.ceo), false);
    const mgr = withoutCeo.employees.find((e) => e.id === ids.manager);
    assert.equal(mgr.treeManagerId, null);
    assert.ok(mgr.childIds.includes(ids.worker));
    assert.ok(mgr.childIds.includes(ids.peer));
  });

  it("HR organization chart remains unchanged for ACTIVE employees", async () => {
    const hrOrg = await request(app)
      .get("/api/employees/organization")
      .set("Cookie", acmeHrCookie);
    assert.equal(hrOrg.status, 200);
    assert.ok(hrOrg.body.hierarchyRootIds.includes(ids.ceo));
    assert.ok(hrOrg.body.hierarchyRootIds.includes(ids.rootMgr));
    const ceoNode = hrOrg.body.employees.find((e) => e.id === ids.ceo);
    assert.ok(ceoNode.childIds.includes(ids.manager));
    const rootNode = hrOrg.body.employees.find((e) => e.id === ids.rootMgr);
    assert.ok(rootNode.childIds.includes(ids.rootReportA));
    assert.ok(rootNode.childIds.includes(ids.rootReportB));
    assert.ok(hrOrg.body.employees.some((e) => e.id === ids.other));
  });

  it("HR organization-view sees the complete ACTIVE hierarchy", async () => {
    const res = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.viewerEmployeeId, null);
    const visible = new Set(res.body.employees.map((e) => e.id));
    assert.ok(visible.has(ids.ceo));
    assert.ok(visible.has(ids.manager));
    assert.ok(visible.has(ids.worker));
    assert.ok(visible.has(ids.other));
    assert.ok(visible.has(ids.rootMgr));
    assert.ok(res.body.hierarchyRootIds.includes(ids.ceo));
    assert.ok(res.body.hierarchyRootIds.includes(ids.rootMgr));
    assertNoSensitiveOrgLeak(res.body);
  });
});

describe("filterOrganizationViewPayload chart indexes", () => {
  it("places employees with no tree manager and no visible reports in unassignedIds", () => {
    const payload = {
      employees: [
        {
          id: "solo",
          reportingManagerId: null,
          treeManagerId: null,
          childIds: [],
          directReportCount: 0,
        },
        {
          id: "hidden-report",
          reportingManagerId: "solo",
          treeManagerId: "solo",
          childIds: [],
          directReportCount: 0,
        },
      ],
      hierarchyRootIds: ["solo"],
      unassignedIds: [],
      rootIds: ["solo"],
      childrenByManagerId: { solo: ["hidden-report"] },
      meta: { cycleEdgesBroken: 0 },
    };
    const out = filterOrganizationViewPayload(payload, new Set(["solo"]));
    assert.deepEqual(out.hierarchyRootIds, []);
    assert.deepEqual(out.unassignedIds, ["solo"]);
    assert.deepEqual(out.rootIds, ["solo"]);
    assert.equal(out.employees.length, 1);
    assert.equal(out.employees[0].directReportCount, 0);
  });

  it("does not promote filtered-out identities into childrenByManagerId", () => {
    const payload = {
      employees: [
        {
          id: "mgr",
          reportingManagerId: null,
          treeManagerId: null,
          childIds: ["rep", "secret"],
          directReportCount: 2,
        },
        {
          id: "rep",
          reportingManagerId: "mgr",
          treeManagerId: "mgr",
          childIds: [],
          directReportCount: 0,
        },
        {
          id: "secret",
          reportingManagerId: "mgr",
          treeManagerId: "mgr",
          childIds: [],
          directReportCount: 0,
        },
      ],
      hierarchyRootIds: ["mgr"],
      unassignedIds: [],
      rootIds: ["mgr"],
      childrenByManagerId: { mgr: ["rep", "secret"] },
      meta: {},
    };
    const out = filterOrganizationViewPayload(payload, new Set(["mgr", "rep"]));
    assert.deepEqual(out.hierarchyRootIds, ["mgr"]);
    assert.deepEqual(out.childrenByManagerId.mgr, ["rep"]);
    assert.equal(out.employees.some((e) => e.id === "secret"), false);
  });
});

describe("directional visible-profile with organization-view context", () => {
  it("direct manager viewing a report gets expanded fields", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.worker}/visible-profile`)
      .set("Cookie", acmeManagerCookie);
    assert.equal(res.body.relationship, EMPLOYEE_RELATIONSHIPS.DIRECT_REPORT);
    assert.equal(res.body.visibilityTier, "DOWNWARD");
    assert.equal(res.body.employee.phoneNumber, undefined);
    assert.ok(res.body.employee.email);
    assert.ok(res.body.employee.job.employmentType);
    assert.ok(res.body.employee.job.joiningDate);
  });

  it("indirect manager viewing a report gets expanded fields", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.skip}/visible-profile`)
      .set("Cookie", acmeManagerCookie);
    assert.equal(res.body.relationship, EMPLOYEE_RELATIONSHIPS.INDIRECT_REPORT);
    assert.equal(res.body.visibilityTier, "DOWNWARD");
  });

  it("direct report viewing their manager gets basic upward fields", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.manager}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.body.relationship, EMPLOYEE_RELATIONSHIPS.DIRECT_MANAGER);
    assert.equal(res.body.visibilityTier, "UPWARD");
    assert.equal(res.body.employee.phoneNumber, undefined);
    assert.equal(res.body.employee.job.employmentType, undefined);
    assert.equal(res.body.employee.job.joiningDate, undefined);
    assert.ok(res.body.employee.email);
  });

  it("indirect report viewing a senior manager gets basic upward fields", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.ceo}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.body.relationship, EMPLOYEE_RELATIONSHIPS.INDIRECT_MANAGER);
    assert.equal(res.body.visibilityTier, "UPWARD");
    assert.equal(res.body.employee.phoneNumber, undefined);
  });

  it("peer visibility", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.peer}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.body.relationship, EMPLOYEE_RELATIONSHIPS.PEER);
    assert.equal(res.body.employee.phoneNumber, undefined);
    assert.ok(res.body.employee.job.reportingManagerId);
  });

  it("other-department profile is not discoverable (404)", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.other}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 404);
    assert.equal(res.body.code, "EMPLOYEE_NOT_FOUND");
  });

  it("self visibility", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.worker}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.body.relationship, EMPLOYEE_RELATIONSHIPS.SELF);
    assert.equal(res.body.employee.status, "ACTIVE");
    assert.equal(res.body.employee.invitation, undefined);
  });

  it("cross-tenant profile lookup returns 404", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.globexEmp}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 404);
  });

  it("no sensitive leaks on profile for report view", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.worker}/visible-profile`)
      .set("Cookie", acmeManagerCookie);
    const json = JSON.stringify(res.body);
    assert.equal(json.includes("secret-invite-token"), false);
    assert.equal(res.body.employee.bankDetails, undefined);
    assert.equal(res.body.employee.taxDetails, undefined);
    assert.equal(res.body.employee.identityDetails, undefined);
    assert.equal(res.body.employee.personalEmail, undefined);
    assert.equal(res.body.employee.status, undefined);
  });

  it("employee self-service /me still works", async () => {
    const res = await request(app).get("/api/employees/me").set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.employee.fullName, "Casey Worker");
    assert.equal(res.body.employee.invitation, undefined);
  });
});
