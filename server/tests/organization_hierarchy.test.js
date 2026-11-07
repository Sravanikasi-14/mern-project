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
import { buildOrganizationHierarchy } from "../services/organizationHierarchyService.js";

let mongo;
let app;
let acme;
let globex;
let acmeHrCookie;
let acmeEmployeeCookie;
let globexHrCookie;

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
    companyName: "Acme Org",
    slug: "acme-org",
    databaseName: "company_acme_org",
    status: COMPANY_STATUSES.ACTIVE,
  });
  globex = await Company.create({
    companyName: "Globex Org",
    slug: "globex-org",
    databaseName: "company_globex_org",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: AcmeUser } = await getCompanyModels(acme);
  await AcmeUser.create({
    email: "hr@acme-org.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  await AcmeUser.create({
    email: "worker@acme-org.test",
    passwordHash: await hashPassword("WorkerPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  const { User: GlobexUser, Employee: GlobexEmployee } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "hr@globex-org.test",
    passwordHash: await hashPassword("GlobexPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  await GlobexEmployee.create({
    employeeCode: "GX-1",
    fullName: "Globex Only",
    email: "only@globex-org.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Lead", department: "Ops", joiningDate: new Date() },
  });

  acmeHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-org",
      email: "hr@acme-org.test",
      password: "AcmePass123!",
    })
  );
  acmeEmployeeCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-org",
      email: "worker@acme-org.test",
      password: "WorkerPass123!",
    })
  );
  globexHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "globex-org",
      email: "hr@globex-org.test",
      password: "GlobexPass123!",
    })
  );
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Organization hierarchy API", () => {
  let ceo;
  let mgr;
  let ic;
  let solo;
  let cycleA;
  let cycleB;

  before(async () => {
    const { Employee } = await getCompanyModels(acme);
    ceo = await Employee.create({
      employeeCode: "CEO-1",
      fullName: "Casey CEO",
      email: "ceo@acme-org.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "CEO", department: "Executive", joiningDate: new Date() },
    });
    mgr = await Employee.create({
      employeeCode: "MGR-1",
      fullName: "Morgan Manager",
      email: "mgr@acme-org.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: {
        jobTitle: "Engineering Manager",
        department: "Engineering",
        reportingManagerId: ceo._id,
        joiningDate: new Date(),
      },
    });
    ic = await Employee.create({
      employeeCode: "IC-1",
      fullName: "Ivy Contributor",
      email: "ic@acme-org.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: {
        jobTitle: "Engineer",
        department: "Engineering",
        reportingManagerId: mgr._id,
        joiningDate: new Date(),
      },
    });
    solo = await Employee.create({
      employeeCode: "SOLO-1",
      fullName: "Sam Solo",
      email: "solo@acme-org.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "Analyst", department: "Finance", joiningDate: new Date() },
    });

    cycleA = await Employee.create({
      employeeCode: "CYC-A",
      fullName: "Cycle A",
      email: "cyclea@acme-org.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "A", department: "Cycle", joiningDate: new Date() },
    });
    cycleB = await Employee.create({
      employeeCode: "CYC-B",
      fullName: "Cycle B",
      email: "cycleb@acme-org.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: {
        jobTitle: "B",
        department: "Cycle",
        reportingManagerId: cycleA._id,
        joiningDate: new Date(),
      },
    });
    cycleA.job.reportingManagerId = cycleB._id;
    await cycleA.save();
  });

  it("requires HR authentication", async () => {
    const anon = await request(app).get("/api/employees/organization");
    assert.equal(anon.status, 401);

    const emp = await request(app)
      .get("/api/employees/organization")
      .set("Cookie", acmeEmployeeCookie);
    assert.equal(emp.status, 403);
  });

  it("returns multi-level hierarchy with light fields and counts", async () => {
    const res = await request(app)
      .get("/api/employees/organization")
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);

    const byId = Object.fromEntries(res.body.employees.map((e) => [e.id, e]));
    assert.ok(byId[String(ceo._id)]);
    assert.equal(byId[String(ceo._id)].directReportCount, 1);
    assert.deepEqual(byId[String(ceo._id)].childIds, [String(mgr._id)]);
    assert.equal(byId[String(mgr._id)].directReportCount, 1);
    assert.equal(byId[String(ic._id)].directReportCount, 0);
    assert.equal(byId[String(ic._id)].reportingManagerId, String(mgr._id));

    for (const key of ["bankDetails", "documents", "taxDetails", "passwordHash"]) {
      assert.equal(Object.hasOwn(byId[String(ceo._id)], key), false);
    }

    assert.ok(res.body.hierarchyRootIds.includes(String(ceo._id)));
    assert.ok(res.body.unassignedIds.includes(String(solo._id)));
  });

  it("breaks circular reporting for tree rendering without hanging", async () => {
    const { Employee } = await getCompanyModels(acme);
    const payload = await buildOrganizationHierarchy(Employee, { status: "ACTIVE" });
    assert.ok(payload.meta.cycleEdgesBroken >= 1);

    const byId = Object.fromEntries(payload.employees.map((e) => [e.id, e]));
    // At least one of the cycle pair is a tree root after break
    const aRoot = !byId[String(cycleA._id)].treeManagerId;
    const bRoot = !byId[String(cycleB._id)].treeManagerId;
    assert.ok(aRoot || bRoot);

    // Walk children from every root — must terminate
    const visited = new Set();
    function walk(id, depth = 0) {
      assert.ok(depth < 20);
      if (visited.has(id)) return;
      visited.add(id);
      for (const child of byId[id].childIds) walk(child, depth + 1);
    }
    for (const root of payload.rootIds) walk(root);
  });

  it("isolates companies", async () => {
    const acmeRes = await request(app)
      .get("/api/employees/organization")
      .set("Cookie", acmeHrCookie);
    const globexRes = await request(app)
      .get("/api/employees/organization")
      .set("Cookie", globexHrCookie);

    assert.equal(acmeRes.status, 200);
    assert.equal(globexRes.status, 200);
    assert.ok(acmeRes.body.employees.some((e) => e.fullName === "Casey CEO"));
    assert.equal(
      acmeRes.body.employees.some((e) => e.fullName === "Globex Only"),
      false
    );
    assert.ok(globexRes.body.employees.some((e) => e.fullName === "Globex Only"));
    assert.equal(
      globexRes.body.employees.some((e) => e.fullName === "Casey CEO"),
      false
    );
  });

  it("supports reassignment then refreshed hierarchy", async () => {
    const move = await request(app)
      .patch(`/api/employees/${ic._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: ceo._id.toString() });
    assert.equal(move.status, 200);

    const res = await request(app)
      .get("/api/employees/organization")
      .set("Cookie", acmeHrCookie);
    const byId = Object.fromEntries(res.body.employees.map((e) => [e.id, e]));
    assert.equal(byId[String(ic._id)].reportingManagerId, String(ceo._id));
    assert.ok(byId[String(ceo._id)].childIds.includes(String(ic._id)));
  });
});
