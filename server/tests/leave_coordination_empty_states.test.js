import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { LEAVE_STATUSES, HANDOVER_STATUSES } from "../models/LeaveRequest.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "../models/Task.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import {
  HANDOVER_DETAIL_MODES,
  resolveHandoverDetailPresentation,
} from "../utils/handoverDetailPresentation.js";

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
let company;
let models;
let hrCookie;
let leaveTaker;
let peer;
let hrUser;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  company = await Company.create({
    companyName: "Coord Co",
    slug: "coordco",
    databaseName: "company_coord_a",
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata" },
  });
  models = await getCompanyModels(company);

  hrUser = await models.User.create({
    email: "hr@coordco.test",
    passwordHash: await hashPassword("HrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  leaveTaker = await models.Employee.create({
    fullName: "Leave Taker",
    employeeCode: "CD-001",
    email: "taker@coordco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering" },
    skills: ["nodejs"],
  });

  peer = await models.Employee.create({
    fullName: "Peer Backup",
    employeeCode: "CD-002",
    email: "peer@coordco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Engineer", department: "Engineering" },
    skills: ["nodejs", "api"],
  });

  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: "hr@coordco.test", password: "HrPass123!", companyCode: "coordco" });
  hrCookie = cookieFrom(login);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Handover detail presentation (empty draft UX)", () => {
  it("no coverage needed + no handover → NO_HANDOVER_REQUIRED, no draft badge", () => {
    const view = resolveHandoverDetailPresentation({
      impactReady: true,
      coverageTaskCount: 0,
      handover: null,
    });
    assert.equal(view.mode, HANDOVER_DETAIL_MODES.NO_HANDOVER_REQUIRED);
    assert.equal(view.title, "No handover is currently required.");
    assert.match(view.body, /optional and can be created later/i);
    assert.equal(view.showDraftBadge, false);
    assert.equal(view.showSubmit, false);
    assert.equal(view.showLifecycle, false);
  });

  it("no coverage needed + empty draft → same NO_HANDOVER_REQUIRED (draft not deleted, not surfaced)", () => {
    const view = resolveHandoverDetailPresentation({
      impactReady: true,
      coverageTaskCount: 0,
      handover: { status: HANDOVER_STATUSES.DRAFT, items: [] },
    });
    assert.equal(view.mode, HANDOVER_DETAIL_MODES.NO_HANDOVER_REQUIRED);
    assert.equal(view.showDraftBadge, false);
    assert.equal(view.showSubmit, false);
    assert.doesNotMatch(view.title || "", /draft exists/i);
    assert.doesNotMatch(view.body || "", /draft exists/i);
  });

  it("coverage needed + empty draft → EMPTY_DRAFT_COVERAGE_NEEDED (not “no handover required”)", () => {
    const view = resolveHandoverDetailPresentation({
      impactReady: true,
      coverageTaskCount: 2,
      handover: { status: HANDOVER_STATUSES.DRAFT, items: [] },
    });
    assert.equal(view.mode, HANDOVER_DETAIL_MODES.EMPTY_DRAFT_COVERAGE_NEEDED);
    assert.match(view.title, /no responsibilities/i);
    assert.doesNotMatch(view.title, /currently required/i);
    assert.equal(view.showSubmit, false);
    assert.equal(view.showDraftBadge, false);
  });

  it("handover with responsibilities → ACTIVE_HANDOVER lifecycle", () => {
    const view = resolveHandoverDetailPresentation({
      impactReady: true,
      coverageTaskCount: 1,
      handover: {
        status: HANDOVER_STATUSES.AWAITING_BACKUP_ACKNOWLEDGEMENT,
        items: [{ status: "AWAITING_ACK", backupEmployeeId: "x" }],
      },
    });
    assert.equal(view.mode, HANDOVER_DETAIL_MODES.ACTIVE_HANDOVER);
    assert.equal(view.showLifecycle, true);
    assert.equal(view.itemCount, 1);
  });
});

describe("Leave coordination empty states (API)", () => {
  it("no coverage needed + no handover", async () => {
    const leave = await models.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-09-01"),
      toDate: new Date("2026-09-03"),
      daysCount: 3,
      status: LEAVE_STATUSES.PENDING,
      reason: "Quiet week",
    });

    // No assigned open tasks → no coverage arrangements
    const backup = await request(app)
      .get(`/api/leave-requests/${leave._id}/backup-recommendations`)
      .set("Cookie", hrCookie);
    assert.equal(backup.status, 200);
    assert.equal(backup.body.summary.coverageTaskCount, 0);
    assert.equal(backup.body.summary.emptyState?.code, "NO_COVERAGE_NEEDED");
    assert.equal(backup.body.arrangements.length, 0);

    const ho = await request(app)
      .get(`/api/handovers/leave/${leave._id}`)
      .set("Cookie", hrCookie);
    assert.equal(ho.status, 200);
    assert.equal(ho.body.handover, null);

    const view = resolveHandoverDetailPresentation({
      impactReady: true,
      coverageTaskCount: backup.body.summary.coverageTaskCount,
      handover: ho.body.handover,
    });
    assert.equal(view.mode, HANDOVER_DETAIL_MODES.NO_HANDOVER_REQUIRED);
  });

  it("no coverage needed + empty draft preserved (GET does not delete; UI treats as not required)", async () => {
    const leave = await models.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-09-10"),
      toDate: new Date("2026-09-12"),
      daysCount: 3,
      status: LEAVE_STATUSES.PENDING,
      reason: "Empty draft case",
    });

    const created = await request(app)
      .post(`/api/handovers/leave/${leave._id}`)
      .set("Cookie", hrCookie);
    assert.equal(created.status, 200);
    assert.equal(created.body.handover.status, HANDOVER_STATUSES.DRAFT);
    assert.equal((created.body.handover.items || []).length, 0);

    const again = await request(app)
      .get(`/api/handovers/leave/${leave._id}`)
      .set("Cookie", hrCookie);
    assert.equal(again.status, 200);
    assert.ok(again.body.handover);
    assert.equal(again.body.handover.status, HANDOVER_STATUSES.DRAFT);
    assert.equal((again.body.handover.items || []).length, 0);

    const backup = await request(app)
      .get(`/api/leave-requests/${leave._id}/backup-recommendations`)
      .set("Cookie", hrCookie);
    assert.equal(backup.body.summary.emptyState?.code, "NO_COVERAGE_NEEDED");

    const view = resolveHandoverDetailPresentation({
      impactReady: true,
      coverageTaskCount: backup.body.summary.coverageTaskCount,
      handover: again.body.handover,
    });
    assert.equal(view.mode, HANDOVER_DETAIL_MODES.NO_HANDOVER_REQUIRED);
    assert.equal(view.showDraftBadge, false);
    assert.equal(view.showSubmit, false);

    // Opening details again must not create a second draft / wipe status
    const leaveDoc = await models.LeaveRequest.findById(leave._id).lean();
    assert.equal(leaveDoc.handover.status, HANDOVER_STATUSES.DRAFT);
  });

  it("coverage needed + no suitable backup", async () => {
    const leave = await models.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-10-05"),
      toDate: new Date("2026-10-09"),
      daysCount: 5,
      status: LEAVE_STATUSES.PENDING,
      reason: "Coverage needed",
    });

    // Only peer is unavailable (approved leave overlap) → no recommendable backup
    await models.LeaveRequest.create({
      employeeId: peer._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-10-04"),
      toDate: new Date("2026-10-10"),
      daysCount: 5,
      status: LEAVE_STATUSES.APPROVED,
      reason: "Peer away",
    });

    await models.Task.create({
      title: "Solo critical cutover",
      description: "Coverage needed with unavailable peers",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUser._id,
      priority: TASK_PRIORITIES.CRITICAL,
      status: TASK_STATUSES.ASSIGNED,
      deadline: new Date("2026-10-07"),
      requiredSkills: ["nodejs"],
      department: "Engineering",
    });

    const backup = await request(app)
      .get(`/api/leave-requests/${leave._id}/backup-recommendations`)
      .set("Cookie", hrCookie);
    assert.equal(backup.status, 200);
    assert.ok(backup.body.summary.coverageTaskCount >= 1);
    assert.notEqual(backup.body.summary.emptyState?.code, "NO_COVERAGE_NEEDED");
    assert.ok(
      backup.body.summary.withoutSuitableBackup >= 1 ||
        backup.body.arrangements.some((a) => a.noSuitableCandidate)
    );
    if (backup.body.summary.emptyState) {
      assert.equal(backup.body.summary.emptyState.code, "NO_SUITABLE_BACKUP");
    }

    const view = resolveHandoverDetailPresentation({
      impactReady: true,
      coverageTaskCount: backup.body.summary.coverageTaskCount,
      handover: null,
    });
    assert.notEqual(view.mode, HANDOVER_DETAIL_MODES.NO_HANDOVER_REQUIRED);
    assert.equal(view.mode, HANDOVER_DETAIL_MODES.NO_HANDOVER);
  });

  it("coverage needed + selected backup", async () => {
    const leave = await models.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-11-02"),
      toDate: new Date("2026-11-06"),
      daysCount: 5,
      status: LEAVE_STATUSES.PENDING,
      reason: "Propose backup",
    });

    const task = await models.Task.create({
      title: "API ship window",
      description: "Coverage with recommendable peer",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUser._id,
      priority: TASK_PRIORITIES.HIGH,
      status: TASK_STATUSES.ASSIGNED,
      deadline: new Date("2026-11-04"),
      requiredSkills: ["nodejs", "api"],
      department: "Engineering",
    });

    const backup = await request(app)
      .get(`/api/leave-requests/${leave._id}/backup-recommendations`)
      .set("Cookie", hrCookie);
    assert.ok(backup.body.summary.coverageTaskCount >= 1);
    assert.ok(backup.body.summary.withRecommendations >= 1);
    assert.equal(backup.body.summary.emptyState, null);

    const propose = await request(app)
      .put(`/api/leave-requests/${leave._id}/backup-proposals`)
      .set("Cookie", hrCookie)
      .send({ taskId: task._id, backupEmployeeId: peer._id });
    assert.equal(propose.status, 200);

    const refresh = await request(app)
      .get(`/api/leave-requests/${leave._id}/backup-recommendations`)
      .set("Cookie", hrCookie);
    const arr = refresh.body.arrangements.find(
      (a) => String(a.responsibility.taskId) === String(task._id)
    );
    assert.ok(arr?.proposedBackup?.employee?._id);
    assert.equal(String(arr.proposedBackup.employee._id), String(peer._id));
  });

  it("handover with responsibilities coordinates without peer acknowledgement", async () => {
    const leave = await models.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-12-01"),
      toDate: new Date("2026-12-05"),
      daysCount: 5,
      status: LEAVE_STATUSES.PENDING,
      reason: "Ack pending",
    });

    const task = await models.Task.create({
      title: "Partner escalation queue",
      description: "Handover acknowledgement pending",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUser._id,
      priority: TASK_PRIORITIES.HIGH,
      status: TASK_STATUSES.ASSIGNED,
      deadline: new Date("2026-12-03"),
      requiredSkills: ["nodejs"],
      department: "Engineering",
    });

    await request(app)
      .put(`/api/leave-requests/${leave._id}/backup-proposals`)
      .set("Cookie", hrCookie)
      .send({ taskId: task._id, backupEmployeeId: peer._id });

    const created = await request(app)
      .post(`/api/handovers/leave/${leave._id}`)
      .set("Cookie", hrCookie);
    assert.equal(created.status, 200);
    assert.ok(created.body.handover.items.length >= 1);

    const itemId = created.body.handover.items[0]._id;
    await request(app)
      .put(`/api/handovers/${created.body.handover._id}`)
      .set("Cookie", hrCookie)
      .send({
        items: [{ itemId, instructions: "Watch partner channel.", backupEmployeeId: peer._id }],
      });

    const submitted = await request(app)
      .post(`/api/handovers/${created.body.handover._id}/submit`)
      .set("Cookie", hrCookie);
    assert.equal(submitted.status, 200);
    // HR submit coordinates coverage immediately (no peer acknowledgement)
    assert.ok(
      [HANDOVER_STATUSES.APPROVED, HANDOVER_STATUSES.ACTIVE].includes(
        submitted.body.handover.status
      )
    );

    const view = resolveHandoverDetailPresentation({
      impactReady: true,
      coverageTaskCount: 1,
      handover: submitted.body.handover,
    });
    assert.equal(view.mode, HANDOVER_DETAIL_MODES.ACTIVE_HANDOVER);
    assert.equal(view.showLifecycle, true);
    assert.ok(view.itemCount >= 1);
  });
});
