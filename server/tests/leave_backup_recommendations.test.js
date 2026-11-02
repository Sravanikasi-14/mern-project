import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { LEAVE_STATUSES } from "../models/LeaveRequest.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "../models/Task.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import {
  assessSkillMatch,
  assessWorkload,
  buildSuitabilityLabel,
  recommendBackupEmployees,
} from "../services/backupRecommendationService.js";
import { HANDOVER_STATUSES } from "../models/LeaveRequest.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

let mongo;
let app;
let companyA;
let companyB;
let hrCookieA;
let hrCookieB;
let modelsA;
let leaveTaker;
let skilledPeer;
let busyPeer;
let crossDeptPeer;
let awayPeer;
let hrUserA;

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
    companyName: "Backup Co",
    slug: "backupco",
    databaseName: "company_backup_a",
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata" },
  });
  companyB = await Company.create({
    companyName: "Other Backup Co",
    slug: "otherbackup",
    databaseName: "company_backup_b",
    status: COMPANY_STATUSES.ACTIVE,
  });

  modelsA = await getCompanyModels(companyA);
  const modelsB = await getCompanyModels(companyB);

  hrUserA = await modelsA.User.create({
    email: "hr@backupco.test",
    passwordHash: await hashPassword("HrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  await modelsB.User.create({
    email: "hr@otherbackup.test",
    passwordHash: await hashPassword("HrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  leaveTaker = await modelsA.Employee.create({
    fullName: "Rahul Sharma",
    employeeCode: "BK-001",
    email: "rahul@backupco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Backend Engineer", department: "Engineering" },
    skills: ["nodejs", "api", "mongodb"],
  });

  skilledPeer = await modelsA.Employee.create({
    fullName: "Arjun Mehta",
    employeeCode: "BK-002",
    email: "arjun@backupco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Backend Engineer", department: "Engineering" },
    skills: ["nodejs", "api", "mongodb"],
  });

  busyPeer = await modelsA.Employee.create({
    fullName: "Priya Nair",
    employeeCode: "BK-003",
    email: "priya@backupco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Backend Engineer", department: "Engineering" },
    skills: ["nodejs", "api"],
  });

  crossDeptPeer = await modelsA.Employee.create({
    fullName: "Kiran Das",
    employeeCode: "BK-004",
    email: "kiran@backupco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Technical Writer", department: "Documentation" },
    skills: ["documentation", "api"],
  });

  awayPeer = await modelsA.Employee.create({
    fullName: "Sam Away",
    employeeCode: "BK-005",
    email: "sam@backupco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Backend Engineer", department: "Engineering" },
    skills: ["nodejs", "api", "mongodb"],
  });

  await modelsA.Employee.create({
    fullName: "Inactive Emp",
    employeeCode: "BK-006",
    email: "inactive@backupco.test",
    status: EMPLOYEE_STATUSES.INACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering" },
    skills: ["nodejs", "api", "mongodb"],
  });

  // Heavy open workload for Priya
  for (let i = 0; i < 6; i += 1) {
    await modelsA.Task.create({
      title: `Busy task ${i}`,
      description: "Load fixture",
      assigneeId: busyPeer._id,
      assignedByUserId: hrUserA._id,
      priority: i % 2 === 0 ? TASK_PRIORITIES.HIGH : TASK_PRIORITIES.MEDIUM,
      status: TASK_STATUSES.IN_PROGRESS,
      deadline: new Date("2026-06-12T00:00:00.000Z"),
    });
  }

  await modelsA.LeaveRequest.create({
    employeeId: awayPeer._id,
    leaveTypeCode: "CASUAL",
    fromDate: new Date("2026-06-10T00:00:00.000Z"),
    toDate: new Date("2026-06-14T00:00:00.000Z"),
    daysCount: 3,
    reason: "Confidential reason",
    status: LEAVE_STATUSES.APPROVED,
  });

  const loginA = await request(app).post("/api/auth/login").send({
    companyCode: "backupco",
    email: "hr@backupco.test",
    password: "HrPass123!",
  });
  hrCookieA = cookieFrom(loginA);

  const loginB = await request(app).post("/api/auth/login").send({
    companyCode: "otherbackup",
    email: "hr@otherbackup.test",
    password: "HrPass123!",
  });
  hrCookieB = cookieFrom(loginB);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Backup scoring helpers", () => {
  it("does not invent skill matches when data is missing", () => {
    const missingTask = assessSkillMatch([], ["nodejs"]);
    assert.equal(missingTask.assessed, false);
    assert.equal(missingTask.score, null);

    const missingCand = assessSkillMatch(["nodejs"], []);
    assert.equal(missingCand.assessed, false);
    assert.equal(missingCand.score, null);

    const full = assessSkillMatch(["nodejs", "api"], ["nodejs", "api", "mongodb"]);
    assert.equal(full.assessed, true);
    assert.equal(full.score, 1);
  });

  it("uses transparent suitability labels without claiming unverified skill matches", () => {
    const incomplete = buildSuitabilityLabel({
      skill: { assessed: false, score: null },
      availability: { assessed: true, available: true },
      workload: { assessed: true, score: 0.9 },
    });
    assert.equal(incomplete.label, "Incomplete information");

    const skillOk = buildSuitabilityLabel({
      skill: { assessed: true, score: 1 },
      availability: { assessed: true, available: true },
      workload: { assessed: true, score: 0.8 },
    });
    assert.equal(skillOk.label, "Skill match verified");

    const availOnly = buildSuitabilityLabel({
      skill: { assessed: true, score: 0 },
      availability: { assessed: true, available: true },
      workload: { assessed: true, score: 0.2 },
    });
    assert.equal(availOnly.label, "Availability match");
  });

  it("excludes completed tasks from workload", () => {
    const w = assessWorkload(
      [
        { status: TASK_STATUSES.APPROVED, priority: TASK_PRIORITIES.CRITICAL, deadline: "2026-06-12" },
        { status: TASK_STATUSES.REJECTED, priority: TASK_PRIORITIES.HIGH, deadline: "2026-06-12" },
        { status: TASK_STATUSES.IN_PROGRESS, priority: TASK_PRIORITIES.MEDIUM, deadline: "2026-06-12" },
      ],
      "2026-06-10",
      "2026-06-14"
    );
    assert.equal(w.activeOpenTasks, 1);
  });
});

describe("Backup recommendations API", () => {
  let coverageTask;
  let docsTask;
  let leaveRequest;

  before(async () => {
    coverageTask = await modelsA.Task.create({
      title: "API Integration",
      description: "Ship integration",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUserA._id,
      priority: TASK_PRIORITIES.CRITICAL,
      status: TASK_STATUSES.IN_PROGRESS,
      requiredSkills: ["nodejs", "api"],
      department: "Engineering",
      deadline: new Date("2026-06-12T00:00:00.000Z"),
    });
    docsTask = await modelsA.Task.create({
      title: "Database Documentation",
      description: "Write docs",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUserA._id,
      priority: TASK_PRIORITIES.MEDIUM,
      status: TASK_STATUSES.ASSIGNED,
      requiredSkills: ["documentation"],
      department: "Documentation",
      deadline: new Date("2026-06-13T00:00:00.000Z"),
    });
    leaveRequest = await modelsA.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-06-10T00:00:00.000Z"),
      toDate: new Date("2026-06-14T00:00:00.000Z"),
      daysCount: 3,
      reason: "Family",
      status: LEAVE_STATUSES.PENDING,
    });
  });

  it("1–4. excludes self, inactive, approved-away; pending shown separately at factor level", async () => {
    await modelsA.LeaveRequest.create({
      employeeId: skilledPeer._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-06-11T00:00:00.000Z"),
      toDate: new Date("2026-06-12T00:00:00.000Z"),
      daysCount: 1,
      reason: "Should not leak",
      status: LEAVE_STATUSES.PENDING,
    });

    const result = await recommendBackupEmployees(
      { models: modelsA, company: companyA },
      leaveTaker._id,
      coverageTask._id,
      "2026-06-10",
      "2026-06-14"
    );

    const ids = result.recommendations.map((r) => String(r.employee._id));
    assert.ok(!ids.includes(String(leaveTaker._id)), "leave requester must never be recommended");
    assert.ok(!ids.includes(String(awayPeer._id)), "approved-away peer excluded");
    assert.ok(
      !result.recommendations.some((r) => r.employee.employeeCode === "BK-006"),
      "inactive employee excluded"
    );
    assert.ok(ids.includes(String(skilledPeer._id)));

    const arjun = result.recommendations.find((r) => r.employee.employeeCode === "BK-002");
    assert.ok(arjun.factors.availability.pendingLeaveOverlaps >= 1);
    assert.equal(arjun.suitability.label, "Skill match verified");
    assert.ok(!JSON.stringify(result).includes("Should not leak"));
    assert.ok(!JSON.stringify(result).includes("Confidential reason"));
  });

  it("5–6. skill-compatible ranked above heavier workload peer", async () => {
    const result = await recommendBackupEmployees(
      { models: modelsA, company: companyA },
      leaveTaker._id,
      coverageTask._id,
      "2026-06-10",
      "2026-06-14"
    );
    const arjunIdx = result.recommendations.findIndex((r) => r.employee.employeeCode === "BK-002");
    const priyaIdx = result.recommendations.findIndex((r) => r.employee.employeeCode === "BK-003");
    assert.ok(arjunIdx >= 0 && priyaIdx >= 0);
    assert.ok(arjunIdx < priyaIdx);
    assert.ok(result.recommendations[arjunIdx].score >= result.recommendations[priyaIdx].score);
  });

  it("7–8. missing skills / missing requirements handled as incomplete", async () => {
    const noSkillEmp = await modelsA.Employee.create({
      fullName: "No Skills",
      employeeCode: "BK-010",
      email: "noskills@backupco.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "Engineer", department: "Engineering" },
      skills: [],
    });
    const bareTask = await modelsA.Task.create({
      title: "No requirements listed",
      description: "x",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUserA._id,
      priority: TASK_PRIORITIES.LOW,
      status: TASK_STATUSES.ASSIGNED,
      requiredSkills: [],
      deadline: new Date("2026-06-12T00:00:00.000Z"),
    });

    const result = await recommendBackupEmployees(
      { models: modelsA, company: companyA },
      leaveTaker._id,
      bareTask._id,
      "2026-06-10",
      "2026-06-14",
      { includeWeak: true, limit: 10 }
    );
    assert.ok(result.recommendations.some((r) => r.incompleteAssessment));

    const withReq = await recommendBackupEmployees(
      { models: modelsA, company: companyA },
      leaveTaker._id,
      coverageTask._id,
      "2026-06-10",
      "2026-06-14",
      { limit: 15 }
    );
    const noskill = withReq.recommendations.find((r) => String(r.employee._id) === String(noSkillEmp._id));
    if (noskill) {
      assert.equal(noskill.factors.skill.assessed, false);
      assert.equal(noskill.incompleteAssessment, true);
    }
  });

  it("9. cross-department candidate can appear for matching skills", async () => {
    const result = await recommendBackupEmployees(
      { models: modelsA, company: companyA },
      leaveTaker._id,
      docsTask._id,
      "2026-06-10",
      "2026-06-14"
    );
    assert.ok(result.recommendations.some((r) => r.employee.employeeCode === "BK-004"));
  });

  it("11–13. multiple responsibilities + propose/clear + no forced match", async () => {
    const res = await request(app)
      .get(`/api/leave-requests/${leaveRequest._id}/backup-recommendations`)
      .set("Cookie", hrCookieA);
    assert.equal(res.status, 200);
    assert.ok(res.body.arrangements.length >= 2);
    assert.equal(res.body.doesNot.autoAssign, true);
    assert.equal(res.body.doesNot.blockLeaveApproval, true);
    assert.ok(res.body.summary);
    assert.ok(res.body.summary.coverageTaskCount >= 2);
    assert.equal(res.body.summary.emptyState, null);

    const apiArr = res.body.arrangements.find((a) => a.responsibility.title === "API Integration");
    assert.ok(apiArr);
    const top = apiArr.recommendations[0];
    assert.ok(!apiArr.recommendations.some((r) => String(r.employee._id) === String(leaveTaker._id)));

    const save = await request(app)
      .put(`/api/leave-requests/${leaveRequest._id}/backup-proposals`)
      .set("Cookie", hrCookieA)
      .send({ taskId: coverageTask._id, backupEmployeeId: top.employee._id });
    assert.equal(save.status, 200);
    assert.match(save.body.note || save.body.result?.note || "", /PROPOSED|proposal|ownership/i);

    const taskAfter = await modelsA.Task.findById(coverageTask._id).lean();
    assert.equal(String(taskAfter.assigneeId), String(leaveTaker._id));

    // Duplicate propose for same task replaces prior proposal (unique leave+task)
    const saveAgain = await request(app)
      .put(`/api/leave-requests/${leaveRequest._id}/backup-proposals`)
      .set("Cookie", hrCookieA)
      .send({ taskId: coverageTask._id, backupEmployeeId: busyPeer._id });
    assert.equal(saveAgain.status, 200);
    const proposalCount = await modelsA.LeaveBackupProposal.countDocuments({
      leaveRequestId: leaveRequest._id,
      taskId: coverageTask._id,
      status: "PROPOSED",
    });
    assert.equal(proposalCount, 1);

    const refresh = await request(app)
      .get(`/api/leave-requests/${leaveRequest._id}/backup-recommendations`)
      .set("Cookie", hrCookieA);
    const updated = refresh.body.arrangements.find((a) => a.responsibility.title === "API Integration");
    assert.equal(updated.proposedBackup.status, "PROPOSED_BACKUP");
    assert.equal(String(updated.proposedBackup.employee._id), String(busyPeer._id));

    const clear = await request(app)
      .put(`/api/leave-requests/${leaveRequest._id}/backup-proposals`)
      .set("Cookie", hrCookieA)
      .send({ taskId: coverageTask._id, backupEmployeeId: null });
    assert.equal(clear.status, 200);
  });

  it("propose syncs draft handover item without submitting or changing Task.assigneeId", async () => {
    const leave = await modelsA.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-07-01T00:00:00.000Z"),
      toDate: new Date("2026-07-03T00:00:00.000Z"),
      daysCount: 3,
      reason: "Propose sync",
      status: LEAVE_STATUSES.PENDING,
    });
    const task = await modelsA.Task.create({
      title: "Sync propose task",
      description: "Handover item sync",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUserA._id,
      priority: TASK_PRIORITIES.HIGH,
      status: TASK_STATUSES.ASSIGNED,
      requiredSkills: ["nodejs", "api"],
      department: "Engineering",
      deadline: new Date("2026-07-02T00:00:00.000Z"),
    });

    const created = await request(app)
      .post(`/api/handovers/leave/${leave._id}`)
      .set("Cookie", hrCookieA);
    assert.equal(created.status, 200);
    assert.equal(created.body.handover.status, HANDOVER_STATUSES.DRAFT);
    const item = created.body.handover.items.find((it) => String(it.taskId) === String(task._id));
    assert.ok(item);
    assert.ok(!item.backupEmployeeId);

    const propose = await request(app)
      .put(`/api/leave-requests/${leave._id}/backup-proposals`)
      .set("Cookie", hrCookieA)
      .send({ taskId: task._id, backupEmployeeId: skilledPeer._id });
    assert.equal(propose.status, 200);

    const ho = await request(app)
      .get(`/api/handovers/leave/${leave._id}`)
      .set("Cookie", hrCookieA);
    assert.equal(ho.body.handover.status, HANDOVER_STATUSES.DRAFT);
    const synced = ho.body.handover.items.find((it) => String(it.taskId) === String(task._id));
    assert.equal(String(synced.backupEmployeeId || synced.backupEmployee?._id), String(skilledPeer._id));
    assert.ok(!synced.delegation?.status);

    const taskAfter = await modelsA.Task.findById(task._id).lean();
    assert.equal(String(taskAfter.assigneeId), String(leaveTaker._id));
  });

  it("15–16. cross-company isolation and HR auth", async () => {
    const cross = await request(app)
      .get(`/api/leave-requests/${leaveRequest._id}/backup-recommendations`)
      .set("Cookie", hrCookieB);
    assert.equal(cross.status, 404);

    const unauth = await request(app).get(`/api/leave-requests/${leaveRequest._id}/backup-recommendations`);
    assert.equal(unauth.status, 401);
  });

  it("17–19. Phase 1 impact unchanged; approve without backup; ownership unchanged", async () => {
    const impact = await request(app)
      .get(`/api/leave-requests/${leaveRequest._id}/impact`)
      .set("Cookie", hrCookieA);
    assert.equal(impact.status, 200);
    assert.ok(impact.body.impact.responsibilities);

    const decide = await request(app)
      .post(`/api/leave-requests/${leaveRequest._id}/decision`)
      .set("Cookie", hrCookieA)
      .send({ action: "APPROVE", remarks: "Approved without mandatory backup" });
    assert.equal(decide.status, 200);

    const taskAfter = await modelsA.Task.findById(coverageTask._id).lean();
    assert.equal(String(taskAfter.assigneeId), String(leaveTaker._id));
  });

  it("rejects proposing the leave-taker as their own backup", async () => {
    const leave2 = await modelsA.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "SICK",
      fromDate: new Date("2026-07-10T00:00:00.000Z"),
      toDate: new Date("2026-07-11T00:00:00.000Z"),
      daysCount: 1,
      reason: "x",
      status: LEAVE_STATUSES.PENDING,
    });
    const bad = await request(app)
      .put(`/api/leave-requests/${leave2._id}/backup-proposals`)
      .set("Cookie", hrCookieA)
      .send({ taskId: coverageTask._id, backupEmployeeId: leaveTaker._id });
    assert.equal(bad.status, 400);
  });
});
