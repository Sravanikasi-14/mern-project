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
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { TEAM_EMPLOYEE_ALLOWED_KEYS } from "../services/organizationExplorerTeamsService.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

let mongo;
let app;
let acme;
let globex;
let acmeHrCookie;
let acmeEmpCookie;
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
      employmentType: "Full-time",
      workLocation: "Hyderabad",
      joiningDate: new Date("2024-01-15"),
      reportingManagerId: data.reportingManagerId || null,
    },
  });
}

function assertSafeTeamEmployees(team) {
  const people = [...(team.members || []), ...(team.inactiveMembers || [])];
  if (team.lead) people.push(team.lead);
  if (team.inactiveLead) people.push(team.inactiveLead);
  const json = JSON.stringify(team);
  assert.equal(json.includes("secret-invite"), false);
  assert.equal(json.includes("passwordHash"), false);
  assert.equal(json.includes("personalEmail"), false);
  assert.equal(json.includes("bankDetails"), false);
  assert.equal(json.includes("compensation"), false);
  assert.equal(json.includes("9000000001"), false);
  for (const emp of people) {
    assert.equal(emp.email, undefined);
    assert.equal(emp.status, undefined);
    for (const key of Object.keys(emp)) {
      assert.ok(TEAM_EMPLOYEE_ALLOWED_KEYS.includes(key), `unexpected field ${key}`);
    }
  }
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme Teams",
    slug: "acme-teams",
    databaseName: "company_acme_teams",
    status: COMPANY_STATUSES.ACTIVE,
  });
  globex = await Company.create({
    companyName: "Globex Teams",
    slug: "globex-teams",
    databaseName: "company_globex_teams",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: AcmeUser, Employee: AcmeEmployee } = await getCompanyModels(acme);
  await AcmeUser.create({
    email: "hr@acme-teams.test",
    passwordHash: await hashPassword("AcmeHrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const empUser = await AcmeUser.create({
    email: "emp@acme-teams.test",
    passwordHash: await hashPassword("AcmeEmpPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  const lead = await createEmp(acme, {
    employeeCode: "TM-LEAD",
    fullName: "Taylor Lead",
    email: "lead@acme-teams.test",
    jobTitle: "Team Lead",
    department: "Engineering",
  });
  const member = await createEmp(acme, {
    employeeCode: "TM-MEM",
    fullName: "Morgan Member",
    email: "emp@acme-teams.test",
    userId: empUser._id,
    jobTitle: "Engineer",
    department: "Engineering",
    reportingManagerId: lead._id,
    invitation: { token: "secret-invite", status: "PENDING" },
  });
  empUser.employeeId = member._id;
  await empUser.save();

  const peer = await createEmp(acme, {
    employeeCode: "TM-PEER",
    fullName: "Parker Peer",
    email: "peer@acme-teams.test",
    jobTitle: "Engineer",
    reportingManagerId: lead._id,
  });
  const inactive = await createEmp(acme, {
    employeeCode: "TM-INACT",
    fullName: "Inactive Person",
    email: "inactive@acme-teams.test",
    status: EMPLOYEE_STATUSES.INACTIVE,
  });

  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "hr@globex-teams.test",
    passwordHash: await hashPassword("GlobexHrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const globexEmp = await createEmp(globex, {
    employeeCode: "GX-TM-1",
    fullName: "Globex Only",
    email: "gx@globex-teams.test",
  });

  ids = {
    lead: String(lead._id),
    member: String(member._id),
    peer: String(peer._id),
    inactive: String(inactive._id),
    globexEmp: String(globexEmp._id),
    leadManagerBefore: String(lead.job.reportingManagerId || "") || null,
    memberManagerBefore: String(member.job.reportingManagerId),
  };
  // Normalize null
  ids.leadManagerBefore = lead.job?.reportingManagerId
    ? String(lead.job.reportingManagerId)
    : null;

  acmeHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-teams",
      email: "hr@acme-teams.test",
      password: "AcmeHrPass123!",
    })
  );
  acmeEmpCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-teams",
      email: "emp@acme-teams.test",
      password: "AcmeEmpPass123!",
    })
  );
  globexHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "globex-teams",
      email: "hr@globex-teams.test",
      password: "GlobexHrPass123!",
    })
  );

  // Ensure indexes (unique active name) exist for this tenant.
  const { Team } = await getCompanyModels(acme);
  await Team.createIndexes();
  const { Team: GlobexTeam } = await getCompanyModels(globex);
  await GlobexTeam.createIndexes();

  void AcmeEmployee;
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Organization Explorer Teams API", () => {
  let platformTeamId;
  let secondaryTeamId;

  it("rejects empty / invalid team names", async () => {
    const empty = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({ name: "   ", memberEmployeeIds: [] });
    assert.equal(empty.status, 400);

    const missing = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({ memberEmployeeIds: [ids.member] });
    assert.equal(missing.status, 400);
  });

  it("HR can create a team; lead is included in members; reporting unchanged", async () => {
    const res = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({
        name: "Platform Team",
        department: "Engineering",
        leadEmployeeId: ids.lead,
        memberEmployeeIds: [ids.member],
        companyId: String(globex._id),
        databaseName: globex.databaseName,
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.team.name, "Platform Team");
    assert.equal(res.body.team.department, "Engineering");
    assert.equal(res.body.team.isActive, true);
    assert.equal(res.body.team.lead.id, ids.lead);
    assert.ok(res.body.team.members.some((m) => m.id === ids.lead));
    assert.ok(res.body.team.members.some((m) => m.id === ids.member));
    assert.equal(res.body.team.memberCount, 2);
    assertSafeTeamEmployees(res.body.team);
    platformTeamId = res.body.team.id;

    const { Employee } = await getCompanyModels(acme);
    const member = await Employee.findById(ids.member).lean();
    assert.equal(String(member.job.reportingManagerId), ids.lead);
    const lead = await Employee.findById(ids.lead).lean();
    assert.equal(lead.job?.reportingManagerId || null, ids.leadManagerBefore);
  });

  it("allows empty membership when no lead is assigned", async () => {
    const res = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({ name: "Shell Team", memberEmployeeIds: [] });
    assert.equal(res.status, 201);
    assert.equal(res.body.team.memberCount, 0);
    assert.equal(res.body.team.lead, null);
    secondaryTeamId = res.body.team.id;
  });

  it("rejects duplicate active team names (case-insensitive)", async () => {
    const res = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({ name: "  platform team  ", memberEmployeeIds: [ids.peer] });
    assert.equal(res.status, 409);
  });

  it("rejects duplicate member IDs, inactive members/lead, invalid and cross-tenant IDs", async () => {
    const dup = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({
        name: "Dup Members",
        memberEmployeeIds: [ids.member, ids.member],
      });
    assert.equal(dup.status, 400);

    const inactiveMem = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({
        name: "Inactive Member Team",
        memberEmployeeIds: [ids.inactive],
      });
    assert.equal(inactiveMem.status, 400);

    const inactiveLead = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({
        name: "Inactive Lead Team",
        leadEmployeeId: ids.inactive,
        memberEmployeeIds: [ids.inactive],
      });
    assert.equal(inactiveLead.status, 400);

    const badId = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({
        name: "Bad Id Team",
        memberEmployeeIds: ["not-an-objectid"],
      });
    assert.equal(badId.status, 400);

    const missing = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({
        name: "Missing Emp Team",
        memberEmployeeIds: [new mongoose.Types.ObjectId().toString()],
      });
    assert.equal(missing.status, 400);

    const cross = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({
        name: "Cross Tenant Team",
        memberEmployeeIds: [ids.globexEmp],
      });
    assert.equal(cross.status, 400);
  });

  it("HR and employees can list active teams; employees omit inactive", async () => {
    const hr = await request(app)
      .get("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie);
    assert.equal(hr.status, 200);
    assert.ok(hr.body.teams.some((t) => t.id === platformTeamId));
    assert.ok(hr.body.teams.every((t) => t.isActive === true || t.isActive === false));

    const emp = await request(app)
      .get("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeEmpCookie);
    assert.equal(emp.status, 200);
    assert.ok(emp.body.teams.some((t) => t.id === platformTeamId));
    assert.equal(
      emp.body.teams.some((t) => Object.prototype.hasOwnProperty.call(t, "isActive")),
      false
    );
  });

  it("HR and employees can get one active team", async () => {
    const hr = await request(app)
      .get(`/api/employees/organization-explorer/teams/${platformTeamId}`)
      .set("Cookie", acmeHrCookie);
    const emp = await request(app)
      .get(`/api/employees/organization-explorer/teams/${platformTeamId}`)
      .set("Cookie", acmeEmpCookie);
    assert.equal(hr.status, 200);
    assert.equal(emp.status, 200);
    assert.equal(hr.body.team.name, "Platform Team");
    assertSafeTeamEmployees(hr.body.team);
  });

  it("updates team without changing membership when members omitted", async () => {
    const res = await request(app)
      .put(`/api/employees/organization-explorer/teams/${platformTeamId}`)
      .set("Cookie", acmeHrCookie)
      .send({ name: "Platform Squad", department: "Product" });
    assert.equal(res.status, 200);
    assert.equal(res.body.team.name, "Platform Squad");
    assert.equal(res.body.team.department, "Product");
    assert.equal(res.body.team.memberCount, 2);
    assert.ok(res.body.team.members.some((m) => m.id === ids.member));
  });

  it("can update membership and supports multiple teams per employee", async () => {
    const res = await request(app)
      .put(`/api/employees/organization-explorer/teams/${secondaryTeamId}`)
      .set("Cookie", acmeHrCookie)
      .send({
        name: "Growth Team",
        leadEmployeeId: ids.peer,
        memberEmployeeIds: [ids.peer, ids.member],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.team.memberCount, 2);
    assert.ok(res.body.team.members.some((m) => m.id === ids.member));

    const list = await request(app)
      .get("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeEmpCookie);
    const memberTeams = list.body.teams.filter((t) =>
      t.members.some((m) => m.id === ids.member)
    );
    assert.ok(memberTeams.length >= 2);
  });

  it("employee cannot create, update, or deactivate", async () => {
    const create = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeEmpCookie)
      .send({ name: "Emp Team", memberEmployeeIds: [] });
    assert.equal(create.status, 403);

    const update = await request(app)
      .put(`/api/employees/organization-explorer/teams/${platformTeamId}`)
      .set("Cookie", acmeEmpCookie)
      .send({ name: "Hacked" });
    assert.equal(update.status, 403);

    const deactivate = await request(app)
      .patch(`/api/employees/organization-explorer/teams/${platformTeamId}/deactivate`)
      .set("Cookie", acmeEmpCookie);
    assert.equal(deactivate.status, 403);
  });

  it("deactivates team retaining membership; employees cannot see it; HR can with filter", async () => {
    const before = await request(app)
      .get(`/api/employees/organization-explorer/teams/${secondaryTeamId}`)
      .set("Cookie", acmeHrCookie);
    const memberIdsBefore = before.body.team.members.map((m) => m.id).sort();

    const res = await request(app)
      .patch(`/api/employees/organization-explorer/teams/${secondaryTeamId}/deactivate`)
      .set("Cookie", acmeHrCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.team.isActive, false);
    assert.deepEqual(res.body.team.members.map((m) => m.id).sort(), memberIdsBefore);
    assert.equal(res.body.team.lead?.id, ids.peer);

    const empList = await request(app)
      .get("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeEmpCookie);
    assert.equal(empList.body.teams.some((t) => t.id === secondaryTeamId), false);

    const empGet = await request(app)
      .get(`/api/employees/organization-explorer/teams/${secondaryTeamId}`)
      .set("Cookie", acmeEmpCookie);
    assert.equal(empGet.status, 404);

    const empInactive = await request(app)
      .get("/api/employees/organization-explorer/teams")
      .query({ includeInactive: "true" })
      .set("Cookie", acmeEmpCookie);
    assert.equal(empInactive.status, 403);

    const hrInactive = await request(app)
      .get("/api/employees/organization-explorer/teams")
      .query({ includeInactive: "true" })
      .set("Cookie", acmeHrCookie);
    assert.equal(hrInactive.status, 200);
    assert.ok(hrInactive.body.teams.some((t) => t.id === secondaryTeamId && t.isActive === false));

    // Same name can be reused for a new active team after deactivation.
    const reuse = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({ name: "Growth Team", memberEmployeeIds: [ids.peer] });
    assert.equal(reuse.status, 201);
  });

  it("blocks cross-tenant team visibility and ignores client tenant ids", async () => {
    const acmeList = await request(app)
      .get("/api/employees/organization-explorer/teams")
      .query({ companyId: String(globex._id), databaseName: globex.databaseName })
      .set("Cookie", acmeHrCookie);
    assert.equal(acmeList.status, 200);
    assert.ok(acmeList.body.teams.some((t) => t.id === platformTeamId));

    const gx = await request(app)
      .get("/api/employees/organization-explorer/teams")
      .set("Cookie", globexHrCookie);
    assert.equal(gx.status, 200);
    assert.equal(gx.body.teams.some((t) => t.id === platformTeamId), false);

    const gxGet = await request(app)
      .get(`/api/employees/organization-explorer/teams/${platformTeamId}`)
      .set("Cookie", globexHrCookie);
    assert.equal(gxGet.status, 404);
  });

  it("returns 403 when Teams view is disabled", async () => {
    await Company.updateOne(
      { _id: acme._id },
      {
        $set: {
          "config.organizationExplorer.enabledViews": ["reporting", "departments", "projects"],
          "config.organizationExplorer.defaultView": "reporting",
        },
      }
    );

    const list = await request(app)
      .get("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeEmpCookie);
    const create = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({ name: "Disabled View Team", memberEmployeeIds: [] });

    assert.equal(list.status, 403);
    assert.equal(create.status, 403);

    await Company.updateOne(
      { _id: acme._id },
      {
        $set: {
          "config.organizationExplorer.enabledViews": [
            "reporting",
            "teams",
            "projects",
            "departments",
          ],
        },
      }
    );
  });

  it("keeps inactive employees in Team IDs but separates them in HR vs employee responses", async () => {
    const created = await request(app)
      .post("/api/employees/organization-explorer/teams")
      .set("Cookie", acmeHrCookie)
      .send({
        name: "Lifecycle Squad",
        leadEmployeeId: ids.lead,
        memberEmployeeIds: [ids.lead, ids.member, ids.peer],
      });
    assert.equal(created.status, 201);
    const teamId = created.body.team.id;
    assert.equal(created.body.team.memberCount, 3);
    assert.deepEqual(created.body.team.inactiveMembers, []);
    assert.equal(created.body.team.inactiveLead, null);

    const { Employee, Team } = await getCompanyModels(acme);
    await Employee.updateOne(
      { _id: ids.peer },
      { $set: { status: EMPLOYEE_STATUSES.INACTIVE } }
    );
    await Employee.updateOne(
      { _id: ids.lead },
      { $set: { status: EMPLOYEE_STATUSES.INACTIVE } }
    );

    const stored = await Team.findById(teamId).lean();
    assert.ok(stored.memberEmployeeIds.map(String).includes(ids.peer));
    assert.ok(stored.memberEmployeeIds.map(String).includes(ids.lead));
    assert.equal(String(stored.leadEmployeeId), ids.lead);

    const empGet = await request(app)
      .get(`/api/employees/organization-explorer/teams/${teamId}`)
      .set("Cookie", acmeEmpCookie);
    assert.equal(empGet.status, 200);
    assert.equal(empGet.body.team.lead, null);
    assert.equal(empGet.body.team.members.some((m) => m.id === ids.peer), false);
    assert.equal(empGet.body.team.members.some((m) => m.id === ids.lead), false);
    assert.ok(empGet.body.team.members.some((m) => m.id === ids.member));
    assert.equal(empGet.body.team.memberCount, 1);
    assert.equal(empGet.body.team.inactiveMembers, undefined);
    assert.equal(empGet.body.team.inactiveLead, undefined);
    assertSafeTeamEmployees(empGet.body.team);

    const hrGet = await request(app)
      .get(`/api/employees/organization-explorer/teams/${teamId}`)
      .set("Cookie", acmeHrCookie);
    assert.equal(hrGet.status, 200);
    assert.equal(hrGet.body.team.lead, null);
    assert.equal(hrGet.body.team.inactiveLead?.id, ids.lead);
    assert.equal(hrGet.body.team.members.some((m) => m.id === ids.member), true);
    assert.equal(hrGet.body.team.members.some((m) => m.id === ids.peer), false);
    assert.equal(hrGet.body.team.inactiveMembers.some((m) => m.id === ids.peer), true);
    assert.equal(hrGet.body.team.inactiveMembers.some((m) => m.id === ids.lead), true);
    assert.equal(hrGet.body.team.memberCount, 1);
    assertSafeTeamEmployees(hrGet.body.team);

    // Cross-tenant still blocked; no sensitive fields.
    const gx = await request(app)
      .get(`/api/employees/organization-explorer/teams/${teamId}`)
      .set("Cookie", globexHrCookie);
    assert.equal(gx.status, 404);

    await Employee.updateOne(
      { _id: ids.peer },
      { $set: { status: EMPLOYEE_STATUSES.ACTIVE } }
    );
    await Employee.updateOne(
      { _id: ids.lead },
      { $set: { status: EMPLOYEE_STATUSES.ACTIVE } }
    );

    const after = await request(app)
      .get(`/api/employees/organization-explorer/teams/${teamId}`)
      .set("Cookie", acmeEmpCookie);
    assert.equal(after.status, 200);
    assert.equal(after.body.team.lead?.id, ids.lead);
    assert.ok(after.body.team.members.some((m) => m.id === ids.peer));
    assert.ok(after.body.team.members.some((m) => m.id === ids.lead));
    assert.equal(after.body.team.memberCount, 3);

    const hrAfter = await request(app)
      .get(`/api/employees/organization-explorer/teams/${teamId}`)
      .set("Cookie", acmeHrCookie);
    assert.equal(hrAfter.body.team.inactiveLead, null);
    assert.deepEqual(hrAfter.body.team.inactiveMembers, []);
    assert.equal(hrAfter.body.team.lead?.id, ids.lead);
  });
});

describe("Existing explorer / directory regressions", () => {
  it("reporting, departments, projects, and directory remain available", async () => {
    const orgView = await request(app)
      .get("/api/employees/organization-view")
      .set("Cookie", acmeEmpCookie);
    assert.equal(orgView.status, 200);

    const departments = await request(app)
      .get("/api/employees/organization-explorer/departments")
      .set("Cookie", acmeEmpCookie);
    assert.equal(departments.status, 200);

    const projects = await request(app)
      .get("/api/employees/organization-explorer/projects")
      .set("Cookie", acmeEmpCookie);
    assert.equal(projects.status, 200);

    const directory = await request(app)
      .get("/api/employees/directory")
      .set("Cookie", acmeEmpCookie);
    assert.equal(directory.status, 200);
    assert.ok(Array.isArray(directory.body.data));
  });
});
