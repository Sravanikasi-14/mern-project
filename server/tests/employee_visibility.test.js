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
import {
  EMPLOYEE_RELATIONSHIPS,
  MAX_RELATIONSHIP_WALK,
  resolveEmployeeRelationship,
  walkManagerAncestors,
} from "../services/employeeRelationshipService.js";
import {
  serializeEmployeeByRelationship,
  sanitizeHrEmployeePayload,
  visibilityTierForRelationship,
} from "../services/employeeVisibilityService.js";

let mongo;
let app;
let acme;
let globex;
let acmeHrCookie;
let acmeWorkerCookie;
let acmeManagerCookie;
let ids = {};

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

async function createEmp(company, data) {
  const { Employee } = await getCompanyModels(company);
  return Employee.create({
    status: EMPLOYEE_STATUSES.ACTIVE,
    phoneNumber: data.phoneNumber || "9000000001",
    email: data.email,
    employeeCode: data.employeeCode,
    fullName: data.fullName,
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

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme Visibility",
    slug: "acme-vis",
    databaseName: "company_acme_vis",
    status: COMPANY_STATUSES.ACTIVE,
  });
  globex = await Company.create({
    companyName: "Globex Visibility",
    slug: "globex-vis",
    databaseName: "company_globex_vis",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: AcmeUser } = await getCompanyModels(acme);
  await AcmeUser.create({
    email: "hr@acme-vis.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const hrLogin = await request(app)
    .post("/api/auth/login")
    .send({ email: "hr@acme-vis.test", password: "AcmePass123!", companyCode: "acme-vis" });
  acmeHrCookie = cookieFrom(hrLogin);
});

beforeEach(async () => {
  const { Employee: AcmeEmployee, User: AcmeUser } = await getCompanyModels(acme);
  const { Employee: GlobexEmployee, User: GlobexUser } = await getCompanyModels(globex);

  await AcmeEmployee.deleteMany({});
  await GlobexEmployee.deleteMany({});
  await AcmeUser.deleteMany({ role: USER_ROLES.EMPLOYEE });
  await GlobexUser.deleteMany({});

  // Hierarchy:
  // CEO
  //  └─ Manager
  //      ├─ Worker (authenticated employee)
  //      └─ Peer
  //         └─ Skip (indirect report of Manager; grandchild of CEO)
  const ceo = await createEmp(acme, {
    employeeCode: "CEO-1",
    fullName: "Ceo Person",
    email: "ceo@acme-vis.test",
  });
  const managerUser = await AcmeUser.create({
    email: "manager@acme-vis.test",
    passwordHash: await hashPassword("ManagerPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const manager = await createEmp(acme, {
    employeeCode: "MGR-1",
    fullName: "Manager Person",
    email: "manager@acme-vis.test",
    userId: managerUser._id,
    reportingManagerId: ceo._id,
    phoneNumber: "9000000099",
  });
  managerUser.employeeId = manager._id;
  await managerUser.save();

  const workerUser = await AcmeUser.create({
    email: "worker@acme-vis.test",
    passwordHash: await hashPassword("WorkerPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const worker = await createEmp(acme, {
    employeeCode: "WRK-1",
    fullName: "Worker Bee",
    email: "worker@acme-vis.test",
    userId: workerUser._id,
    reportingManagerId: manager._id,
    invitation: { status: "ACCEPTED", token: "secret-invite-token-do-not-leak", sentAt: new Date() },
  });
  workerUser.employeeId = worker._id;
  await workerUser.save();

  const peer = await createEmp(acme, {
    employeeCode: "PEER-1",
    fullName: "Peer Person",
    email: "peer@acme-vis.test",
    reportingManagerId: manager._id,
    phoneNumber: "9000000088",
    employmentType: "Contract",
    joiningDate: new Date("2023-06-01"),
  });
  const other = await createEmp(acme, {
    employeeCode: "OTH-1",
    fullName: "Other Person",
    email: "other@acme-vis.test",
    reportingManagerId: null,
    phoneNumber: "9000000077",
  });
  const skip = await createEmp(acme, {
    employeeCode: "SKIP-1",
    fullName: "Skip Level",
    email: "skip@acme-vis.test",
    reportingManagerId: peer._id,
  });

  const { User: GlobexUserModel } = await getCompanyModels(globex);
  await GlobexUserModel.create({
    email: "hr@globex-vis.test",
    passwordHash: await hashPassword("GlobexPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const globexEmp = await createEmp(globex, {
    employeeCode: "GX-1",
    fullName: "Globex Worker",
    email: "gx@globex-vis.test",
  });

  ids = {
    ceo: String(ceo._id),
    manager: String(manager._id),
    worker: String(worker._id),
    peer: String(peer._id),
    other: String(other._id),
    skip: String(skip._id),
    globexEmp: String(globexEmp._id),
  };

  const workerLogin = await request(app)
    .post("/api/auth/login")
    .send({ email: "worker@acme-vis.test", password: "WorkerPass123!", companyCode: "acme-vis" });
  acmeWorkerCookie = cookieFrom(workerLogin);

  const managerLogin = await request(app)
    .post("/api/auth/login")
    .send({ email: "manager@acme-vis.test", password: "ManagerPass123!", companyCode: "acme-vis" });
  acmeManagerCookie = cookieFrom(managerLogin);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("employeeRelationshipService", () => {
  it("classifies SELF", async () => {
    const { Employee } = await getCompanyModels(acme);
    const result = await resolveEmployeeRelationship({
      Employee,
      viewerEmployeeId: ids.worker,
      targetEmployeeId: ids.worker,
    });
    assert.equal(result.relationship, EMPLOYEE_RELATIONSHIPS.SELF);
  });

  it("classifies DIRECT_MANAGER", async () => {
    const { Employee } = await getCompanyModels(acme);
    const result = await resolveEmployeeRelationship({
      Employee,
      viewerEmployeeId: ids.worker,
      targetEmployeeId: ids.manager,
    });
    assert.equal(result.relationship, EMPLOYEE_RELATIONSHIPS.DIRECT_MANAGER);
  });

  it("classifies INDIRECT_MANAGER", async () => {
    const { Employee } = await getCompanyModels(acme);
    const result = await resolveEmployeeRelationship({
      Employee,
      viewerEmployeeId: ids.worker,
      targetEmployeeId: ids.ceo,
    });
    assert.equal(result.relationship, EMPLOYEE_RELATIONSHIPS.INDIRECT_MANAGER);
  });

  it("classifies DIRECT_REPORT", async () => {
    const { Employee } = await getCompanyModels(acme);
    const result = await resolveEmployeeRelationship({
      Employee,
      viewerEmployeeId: ids.manager,
      targetEmployeeId: ids.worker,
    });
    assert.equal(result.relationship, EMPLOYEE_RELATIONSHIPS.DIRECT_REPORT);
  });

  it("classifies INDIRECT_REPORT", async () => {
    const { Employee } = await getCompanyModels(acme);
    const result = await resolveEmployeeRelationship({
      Employee,
      viewerEmployeeId: ids.manager,
      targetEmployeeId: ids.skip,
    });
    assert.equal(result.relationship, EMPLOYEE_RELATIONSHIPS.INDIRECT_REPORT);
  });

  it("classifies PEER sharing the same manager", async () => {
    const { Employee } = await getCompanyModels(acme);
    const result = await resolveEmployeeRelationship({
      Employee,
      viewerEmployeeId: ids.worker,
      targetEmployeeId: ids.peer,
    });
    assert.equal(result.relationship, EMPLOYEE_RELATIONSHIPS.PEER);
  });

  it("classifies OTHER employee", async () => {
    const { Employee } = await getCompanyModels(acme);
    const result = await resolveEmployeeRelationship({
      Employee,
      viewerEmployeeId: ids.worker,
      targetEmployeeId: ids.other,
    });
    assert.equal(result.relationship, EMPLOYEE_RELATIONSHIPS.OTHER);
  });

  it("handles employee without manager", async () => {
    const { Employee } = await getCompanyModels(acme);
    const result = await resolveEmployeeRelationship({
      Employee,
      viewerEmployeeId: ids.other,
      targetEmployeeId: ids.worker,
    });
    assert.equal(result.relationship, EMPLOYEE_RELATIONSHIPS.OTHER);
  });

  it("handles multiple reporting levels for manager queries", async () => {
    const { Employee } = await getCompanyModels(acme);
    const up = await walkManagerAncestors(Employee, ids.skip);
    assert.deepEqual(up.ancestors, [ids.peer, ids.manager, ids.ceo]);
  });

  it("ignores invalid manager references while walking", async () => {
    const { Employee } = await getCompanyModels(acme);
    const orphan = await createEmp(acme, {
      employeeCode: "BAD-MGR",
      fullName: "Bad Manager Ref",
      email: "badmgr@acme-vis.test",
      reportingManagerId: "507f1f77bcf86cd799439011", // nonexistent but valid ObjectId shape
    });
    const up = await walkManagerAncestors(Employee, orphan._id);
    assert.equal(up.ancestors.length, 0);
  });

  it("stops on cyclic hierarchies", async () => {
    const { Employee } = await getCompanyModels(acme);
    const a = await createEmp(acme, {
      employeeCode: "CYC-A",
      fullName: "Cycle A",
      email: "cyca@acme-vis.test",
    });
    const b = await createEmp(acme, {
      employeeCode: "CYC-B",
      fullName: "Cycle B",
      email: "cycb@acme-vis.test",
      reportingManagerId: a._id,
    });
    await Employee.updateOne({ _id: a._id }, { $set: { "job.reportingManagerId": b._id } });

    const up = await walkManagerAncestors(Employee, a._id);
    assert.ok(up.ancestors.includes(String(b._id)));
    assert.ok(up.ancestors.length <= 2);
  });

  it("rejects cross-tenant target ids as not found", async () => {
    const { Employee } = await getCompanyModels(acme);
    await assert.rejects(
      () =>
        resolveEmployeeRelationship({
          Employee,
          viewerEmployeeId: ids.worker,
          targetEmployeeId: ids.globexEmp,
        }),
      (err) => err.status === 404
    );
  });

  it("enforces maximum traversal depth protection", async () => {
    const { Employee } = await getCompanyModels(acme);
    let parent = null;
    let last = null;
    for (let i = 0; i < MAX_RELATIONSHIP_WALK + 3; i += 1) {
      last = await createEmp(acme, {
        employeeCode: `DEEP-${i}`,
        fullName: `Deep ${i}`,
        email: `deep${i}@acme-vis.test`,
        reportingManagerId: parent,
      });
      parent = last._id;
    }
    const up = await walkManagerAncestors(Employee, last._id, { maxDepth: MAX_RELATIONSHIP_WALK });
    assert.equal(up.ancestors.length, MAX_RELATIONSHIP_WALK);
    assert.equal(up.depthExceeded, true);
  });

  it("does not classify incomplete depth walks as PEER or OTHER", async () => {
    const { Employee } = await getCompanyModels(acme);
    // Build a chain longer than maxDepth; leaf vs root cannot be proven within the walk.
    let parent = null;
    let root = null;
    let leaf = null;
    for (let i = 0; i < MAX_RELATIONSHIP_WALK + 2; i += 1) {
      leaf = await createEmp(acme, {
        employeeCode: `UNR-${i}`,
        fullName: `Unresolved ${i}`,
        email: `unr${i}@acme-vis.test`,
        reportingManagerId: parent,
      });
      if (!root) root = leaf;
      parent = leaf._id;
    }
    const result = await resolveEmployeeRelationship({
      Employee,
      viewerEmployeeId: leaf._id,
      targetEmployeeId: root._id,
      // walk uses MAX_RELATIONSHIP_WALK internally
    });
    // Root is beyond the walk window from the leaf → must not become OTHER/PEER.
    assert.equal(result.relationship, EMPLOYEE_RELATIONSHIPS.UNRESOLVED);
    assert.equal(result.depthExceeded, true);
  });
});

describe("employeeVisibilityService serializers", () => {
  function sampleEmployee() {
    return {
      _id: ids.peer,
      fullName: "Peer Person",
      employeeCode: "PEER-1",
      email: "peer@acme-vis.test",
      phoneNumber: "9000000088",
      personalEmail: "hidden@test",
      personalPhone: "111",
      dateOfBirth: new Date("1990-01-01"),
      status: "ACTIVE",
      invitation: { status: "PENDING", token: "leak-me" },
      bankDetails: { accountNumber: "999" },
      taxDetails: { panNumber: "X" },
      identityDetails: { idNumber: "Y" },
      job: {
        jobTitle: "Engineer",
        department: "Engineering",
        workLocation: "Hyderabad",
        employmentType: "Contract",
        joiningDate: new Date("2023-06-01"),
        reportingManagerId: { _id: ids.manager, fullName: "Manager Person", employeeCode: "MGR-1", job: { jobTitle: "Manager", department: "Engineering" } },
      },
    };
  }

  it("PEER cannot see official phone, joining date, employment type, or status", () => {
    const out = serializeEmployeeByRelationship(sampleEmployee(), EMPLOYEE_RELATIONSHIPS.PEER);
    assert.equal(out.email, "peer@acme-vis.test");
    assert.equal(out.phoneNumber, undefined);
    assert.equal(out.job.joiningDate, undefined);
    assert.equal(out.job.employmentType, undefined);
    assert.equal(out.status, undefined);
    assert.equal(out.invitation, undefined);
    assert.equal(out.bankDetails, undefined);
    assert.ok(out.job.reportingManagerId);
    assert.equal(out.job.reportingManagerId.fullName, "Manager Person");
  });

  it("OTHER cannot see official phone, joining date, or manager reference", () => {
    const out = serializeEmployeeByRelationship(sampleEmployee(), EMPLOYEE_RELATIONSHIPS.OTHER);
    assert.equal(visibilityTierForRelationship(EMPLOYEE_RELATIONSHIPS.OTHER), "OTHER");
    assert.equal(out.phoneNumber, undefined);
    assert.equal(out.job.joiningDate, undefined);
    assert.equal(out.job.reportingManagerId, undefined);
    assert.equal(out.personalEmail, undefined);
  });

  it("UNRESOLVED uses OTHER-restricted visibility", () => {
    const out = serializeEmployeeByRelationship(
      sampleEmployee(),
      EMPLOYEE_RELATIONSHIPS.UNRESOLVED
    );
    assert.equal(visibilityTierForRelationship(EMPLOYEE_RELATIONSHIPS.UNRESOLVED), "OTHER");
    assert.equal(out.phoneNumber, undefined);
    assert.equal(out.job.employmentType, undefined);
    assert.equal(out.job.reportingManagerId, undefined);
  });

  it("upward manager views exclude phone, employment type, and joining date", () => {
    for (const rel of [
      EMPLOYEE_RELATIONSHIPS.DIRECT_MANAGER,
      EMPLOYEE_RELATIONSHIPS.INDIRECT_MANAGER,
    ]) {
      const out = serializeEmployeeByRelationship(sampleEmployee(), rel);
      assert.equal(visibilityTierForRelationship(rel), "UPWARD");
      assert.equal(out.email, "peer@acme-vis.test");
      assert.equal(out.phoneNumber, undefined);
      assert.equal(out.job.employmentType, undefined);
      assert.equal(out.job.joiningDate, undefined);
      assert.ok(out.job.reportingManagerId);
      assert.equal(out.status, undefined);
      assert.equal(out.bankDetails, undefined);
      assert.equal(out.invitation, undefined);
    }
  });

  it("downward report views include employment type and joining date but not generic phone", () => {
    for (const rel of [
      EMPLOYEE_RELATIONSHIPS.DIRECT_REPORT,
      EMPLOYEE_RELATIONSHIPS.INDIRECT_REPORT,
    ]) {
      const out = serializeEmployeeByRelationship(sampleEmployee(), rel);
      assert.equal(visibilityTierForRelationship(rel), "DOWNWARD");
      assert.equal(out.phoneNumber, undefined);
      assert.equal(out.job.employmentType, "Contract");
      assert.ok(out.job.joiningDate);
      assert.equal(out.status, undefined);
      assert.equal(out.bankDetails, undefined);
      assert.equal(out.taxDetails, undefined);
      assert.equal(out.identityDetails, undefined);
      assert.equal(out.personalEmail, undefined);
      assert.equal(out.invitation, undefined);
    }
  });

  it("SELF preserves self-service fields without invitation token", () => {
    const out = serializeEmployeeByRelationship(sampleEmployee(), EMPLOYEE_RELATIONSHIPS.SELF);
    assert.equal(out.status, "ACTIVE");
    assert.equal(out.personalEmail, "hidden@test");
    assert.ok(out.bankDetails);
    assert.equal(out.invitation, undefined);
  });

  it("sanitizeHrEmployeePayload strips invitation tokens", () => {
    const sanitized = sanitizeHrEmployeePayload({
      fullName: "X",
      invitation: { status: "PENDING", token: "secret", sentAt: new Date() },
      passwordHash: "nope",
    });
    assert.equal(sanitized.invitation.token, undefined);
    assert.equal(sanitized.invitation.status, "PENDING");
    assert.equal(sanitized.passwordHash, undefined);
  });
});

describe("visible-profile API integration", () => {
  it("rejects anonymous requests with 401", async () => {
    const res = await request(app).get(`/api/employees/${ids.peer}/visible-profile`);
    assert.equal(res.status, 401);
  });

  it("EMPLOYEE cannot access HR-only employee detail route", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.peer}`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 403);
  });

  it("EMPLOYEE receives peer-scoped fields only", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.peer}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.relationship, EMPLOYEE_RELATIONSHIPS.PEER);
    assert.equal(res.body.employee.fullName, "Peer Person");
    assert.equal(res.body.employee.email, "peer@acme-vis.test");
    assert.equal(res.body.employee.phoneNumber, undefined);
    assert.equal(res.body.employee.status, undefined);
    assert.equal(res.body.employee.job.employmentType, undefined);
    assert.equal(res.body.employee.invitation, undefined);
    assert.equal(JSON.stringify(res.body).includes("secret-invite-token"), false);
  });

  it("EMPLOYEE viewing direct manager gets upward (basic) fields only", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.manager}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.relationship, EMPLOYEE_RELATIONSHIPS.DIRECT_MANAGER);
    assert.equal(res.body.visibilityTier, "UPWARD");
    assert.equal(res.body.employee.email, "manager@acme-vis.test");
    assert.equal(res.body.employee.phoneNumber, undefined);
    assert.equal(res.body.employee.job.employmentType, undefined);
    assert.equal(res.body.employee.job.joiningDate, undefined);
    assert.equal(res.body.employee.status, undefined);
    assert.equal(res.body.employee.bankDetails, undefined);
  });

  it("EMPLOYEE viewing indirect manager (CEO) gets upward fields only", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.ceo}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.relationship, EMPLOYEE_RELATIONSHIPS.INDIRECT_MANAGER);
    assert.equal(res.body.visibilityTier, "UPWARD");
    assert.equal(res.body.employee.phoneNumber, undefined);
    assert.equal(res.body.employee.job.employmentType, undefined);
  });

  it("manager viewing direct report gets expanded downward fields", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.worker}/visible-profile`)
      .set("Cookie", acmeManagerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.relationship, EMPLOYEE_RELATIONSHIPS.DIRECT_REPORT);
    assert.equal(res.body.visibilityTier, "DOWNWARD");
    assert.equal(res.body.employee.phoneNumber, undefined);
    assert.equal(res.body.employee.job.employmentType, "Full-time");
    assert.ok(res.body.employee.job.joiningDate);
    assert.equal(res.body.employee.status, undefined);
    assert.equal(res.body.employee.bankDetails, undefined);
    assert.equal(JSON.stringify(res.body).includes("secret-invite-token"), false);
  });

  it("manager viewing indirect report gets expanded downward fields", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.skip}/visible-profile`)
      .set("Cookie", acmeManagerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.relationship, EMPLOYEE_RELATIONSHIPS.INDIRECT_REPORT);
    assert.equal(res.body.visibilityTier, "DOWNWARD");
    assert.ok(res.body.employee.email);
    assert.equal(res.body.employee.status, undefined);
  });

  it("EMPLOYEE other-employee profile is not discoverable (404)", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.other}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 404);
    assert.equal(res.body.code, "EMPLOYEE_NOT_FOUND");
  });

  it("cross-tenant employee ids cannot retrieve another company record", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.globexEmp}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 404);
  });

  it("HR_ADMIN visible-profile remains available and strips invitation token", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.worker}/visible-profile`)
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.visibilityTier, "HR_ADMIN");
    assert.equal(res.body.employee.fullName, "Worker Bee");
    assert.equal(res.body.employee.status, "ACTIVE");
    assert.equal(res.body.employee.invitation?.token, undefined);
    assert.equal(JSON.stringify(res.body).includes("secret-invite-token"), false);
  });

  it("HR getEmployeeById still works and does not leak invitation token", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.worker}`)
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.fullName, "Worker Bee");
    assert.equal(res.body.invitation?.token, undefined);
    assert.equal(JSON.stringify(res.body).includes("secret-invite-token"), false);
  });

  it("SELF via visible-profile preserves self-service style fields", async () => {
    const res = await request(app)
      .get(`/api/employees/${ids.worker}/visible-profile`)
      .set("Cookie", acmeWorkerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.relationship, EMPLOYEE_RELATIONSHIPS.SELF);
    assert.equal(res.body.employee.status, "ACTIVE");
    assert.equal(res.body.employee.personalEmail, "personal@hidden.test");
    assert.equal(res.body.employee.invitation, undefined);
  });
});
