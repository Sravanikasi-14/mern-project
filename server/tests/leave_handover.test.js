import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import {
  LEAVE_STATUSES,
  HANDOVER_STATUSES,
  HANDOVER_ITEM_STATUSES,
  DELEGATION_STATUSES,
} from "../models/LeaveRequest.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "../models/Task.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

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
let empCookie;
let backupCookie;
let modelsA;
let leaveTaker;
let backup;
let manager;
let hrUserA;
let leaveRequest;
let task;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

function futureRange(daysFrom = 3, length = 3) {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() + daysFrom);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + length - 1);
  return { from, to };
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  companyA = await Company.create({
    companyName: "Handover Co",
    slug: "handoverco",
    databaseName: "company_handover_a",
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata" },
  });
  companyB = await Company.create({
    companyName: "Other Handover Co",
    slug: "otherhandover",
    databaseName: "company_handover_b",
    status: COMPANY_STATUSES.ACTIVE,
  });

  modelsA = await getCompanyModels(companyA);
  const modelsB = await getCompanyModels(companyB);

  hrUserA = await modelsA.User.create({
    email: "hr@handoverco.test",
    passwordHash: await hashPassword("HrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  await modelsB.User.create({
    email: "hr@otherhandover.test",
    passwordHash: await hashPassword("HrPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const mgrUser = await modelsA.User.create({
    email: "mgr@handoverco.test",
    passwordHash: await hashPassword("EmpPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  manager = await modelsA.Employee.create({
    fullName: "Maya Manager",
    employeeCode: "HO-MGR",
    email: "mgr@handoverco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    userId: mgrUser._id,
    job: { jobTitle: "Engineering Manager", department: "Engineering" },
  });
  mgrUser.employeeId = manager._id;
  await mgrUser.save();

  const empUser = await modelsA.User.create({
    email: "rahul@handoverco.test",
    passwordHash: await hashPassword("EmpPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  leaveTaker = await modelsA.Employee.create({
    fullName: "Rahul Sharma",
    employeeCode: "HO-001",
    email: "rahul@handoverco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    userId: empUser._id,
    job: {
      jobTitle: "Backend Engineer",
      department: "Engineering",
      reportingManagerId: manager._id,
    },
    skills: ["nodejs", "api"],
  });
  empUser.employeeId = leaveTaker._id;
  await empUser.save();

  const backupUser = await modelsA.User.create({
    email: "arjun@handoverco.test",
    passwordHash: await hashPassword("EmpPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  backup = await modelsA.Employee.create({
    fullName: "Arjun Mehta",
    employeeCode: "HO-002",
    email: "arjun@handoverco.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    userId: backupUser._id,
    job: { jobTitle: "Backend Engineer", department: "Engineering" },
    skills: ["nodejs", "api"],
  });
  backupUser.employeeId = backup._id;
  await backupUser.save();

  const { from, to } = futureRange(5, 4);
  leaveRequest = await modelsA.LeaveRequest.create({
    employeeId: leaveTaker._id,
    leaveTypeCode: "CASUAL",
    fromDate: from,
    toDate: to,
    daysCount: 4,
    reason: "Family visit",
    status: LEAVE_STATUSES.PENDING,
  });

  task = await modelsA.Task.create({
    title: "API Integration",
    description: "Finish partner API",
    assigneeId: leaveTaker._id,
    assignedByUserId: hrUserA._id,
    status: TASK_STATUSES.IN_PROGRESS,
    priority: TASK_PRIORITIES.HIGH,
    deadline: to,
    requiredSkills: ["nodejs", "api"],
    department: "Engineering",
  });

  const loginHrA = await request(app)
    .post("/api/auth/login")
    .send({ email: "hr@handoverco.test", password: "HrPass123!", companyCode: "handoverco" });
  hrCookieA = cookieFrom(loginHrA);

  const loginHrB = await request(app)
    .post("/api/auth/login")
    .send({ email: "hr@otherhandover.test", password: "HrPass123!", companyCode: "otherhandover" });
  hrCookieB = cookieFrom(loginHrB);

  const loginEmp = await request(app)
    .post("/api/auth/login")
    .send({ email: "rahul@handoverco.test", password: "EmpPass123!", companyCode: "handoverco" });
  empCookie = cookieFrom(loginEmp);

  const loginBackup = await request(app)
    .post("/api/auth/login")
    .send({ email: "arjun@handoverco.test", password: "EmpPass123!", companyCode: "handoverco" });
  backupCookie = cookieFrom(loginBackup);

  await request(app)
    .put(`/api/leave-requests/${leaveRequest._id}/backup-proposals`)
    .set("Cookie", hrCookieA)
    .send({ taskId: task._id, backupEmployeeId: backup._id });
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Embedded leave handover lifecycle", () => {
  let handoverId;
  let itemId;

  it("1–2. creates draft and employee requests coordination (no peer acknowledgement)", async () => {
    const createRes = await request(app)
      .post(`/api/handovers/leave/${leaveRequest._id}`)
      .set("Cookie", empCookie);
    assert.equal(createRes.status, 200);
    assert.equal(createRes.body.handover.status, HANDOVER_STATUSES.DRAFT);
    assert.ok(createRes.body.handover.items.length >= 1);
    assert.equal(String(createRes.body.handover._id), String(leaveRequest._id));
    handoverId = createRes.body.handover._id;
    itemId = createRes.body.handover.items[0]._id;

    const again = await request(app)
      .post(`/api/handovers/leave/${leaveRequest._id}`)
      .set("Cookie", empCookie);
    assert.equal(String(again.body.handover._id), String(handoverId));

    const updateRes = await request(app)
      .put(`/api/handovers/${handoverId}`)
      .set("Cookie", empCookie)
      .send({
        generalNotes: "Please watch Slack for partner updates.",
        items: [{ itemId, instructions: "Deploy checklist is in Confluence.", backupEmployeeId: backup._id }],
      });
    assert.equal(updateRes.status, 200);

    const submitRes = await request(app)
      .post(`/api/handovers/${handoverId}/submit`)
      .set("Cookie", empCookie);
    assert.equal(submitRes.status, 200);
    assert.equal(submitRes.body.handover.status, HANDOVER_STATUSES.READY_FOR_MANAGER_REVIEW);
  });

  it("3–4. peer acknowledgement endpoint is retired (410)", async () => {
    const respond = await request(app)
      .post(`/api/handovers/${handoverId}/items/${itemId}/respond`)
      .set("Cookie", backupCookie)
      .send({ decision: "ACKNOWLEDGE", comment: "Happy to cover." });
    assert.equal(respond.status, 410);
  });

  it("5–6. HR coordinates coverage without employee acknowledgement; revision needs reason", async () => {
    const bad = await request(app)
      .post(`/api/handovers/${handoverId}/decide`)
      .set("Cookie", hrCookieA)
      .send({ decision: "REVISE" });
    assert.equal(bad.status, 400);

    const coordinate = await request(app)
      .post(`/api/handovers/${handoverId}/coordinate`)
      .set("Cookie", hrCookieA)
      .send({ notes: "Coverage arranged for leave window." });
    assert.equal(coordinate.status, 200);
    assert.ok(
      [HANDOVER_STATUSES.APPROVED, HANDOVER_STATUSES.ACTIVE].includes(
        coordinate.body.handover.status
      )
    );

    const leaveDoc = await modelsA.LeaveRequest.findById(leaveRequest._id).lean();
    const item = leaveDoc.handover.items.find((i) => String(i._id) === String(itemId));
    assert.ok(item?.delegation);
    assert.ok(
      [DELEGATION_STATUSES.SCHEDULED, DELEGATION_STATUSES.ACTIVE].includes(item.delegation.status)
    );
    const taskDoc = await modelsA.Task.findById(task._id).lean();
    assert.equal(String(taskDoc.assigneeId), String(leaveTaker._id));
  });

  it("7. HR can change coverage employee before coordinating (no ack loop)", async () => {
    const { from, to } = futureRange(20, 3);
    const leave2 = await modelsA.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: from,
      toDate: to,
      daysCount: 3,
      reason: "Second trip",
      status: LEAVE_STATUSES.PENDING,
    });
    const task2 = await modelsA.Task.create({
      title: "Weekly Reporting",
      description: "Prepare weekly status report",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUserA._id,
      status: TASK_STATUSES.ASSIGNED,
      priority: TASK_PRIORITIES.MEDIUM,
      deadline: to,
      requiredSkills: ["api"],
      department: "Engineering",
    });
    await modelsA.LeaveBackupProposal.create({
      leaveRequestId: leave2._id,
      originalEmployeeId: leaveTaker._id,
      taskId: task2._id,
      proposedBackupEmployeeId: backup._id,
      status: "PROPOSED",
    });

    const created = await request(app)
      .post(`/api/handovers/leave/${leave2._id}`)
      .set("Cookie", empCookie);
    const hid = created.body.handover._id;
    const iid = created.body.handover.items[0]._id;

    await request(app)
      .put(`/api/handovers/${hid}`)
      .set("Cookie", empCookie)
      .send({ items: [{ itemId: iid, backupEmployeeId: backup._id, instructions: "Reports folder" }] });
    await request(app).post(`/api/handovers/${hid}/submit`).set("Cookie", empCookie);

    const reassign = await request(app)
      .post(`/api/handovers/${hid}/items/${iid}/reassign`)
      .set("Cookie", hrCookieA)
      .send({ backupEmployeeId: manager._id });
    assert.equal(reassign.status, 200);
    assert.equal(String(reassign.body.handover.items[0].backupEmployeeId), String(manager._id));
    assert.equal(reassign.body.handover.items[0].status, HANDOVER_ITEM_STATUSES.DRAFT);
    assert.equal(reassign.body.handover.status, HANDOVER_STATUSES.READY_FOR_MANAGER_REVIEW);
  });

  it("8–9. cancel works; invalid transitions rejected", async () => {
    const { from, to } = futureRange(40, 2);
    const leave3 = await modelsA.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "SICK",
      fromDate: from,
      toDate: to,
      daysCount: 2,
      reason: "Medical",
      status: LEAVE_STATUSES.PENDING,
    });
    const created = await request(app)
      .post(`/api/handovers/leave/${leave3._id}`)
      .set("Cookie", empCookie);
    const hid = created.body.handover._id;

    const invalid = await request(app)
      .post(`/api/handovers/${hid}/decide`)
      .set("Cookie", hrCookieA)
      .send({ decision: "APPROVE" });
    assert.equal(invalid.status, 400);

    const cancel = await request(app)
      .post(`/api/handovers/${hid}/cancel`)
      .set("Cookie", empCookie)
      .send({ reason: "Plans changed" });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.handover.status, HANDOVER_STATUSES.CANCELLED);
  });

  it("10. duplicate embedded handover prevention (idempotent create)", async () => {
    const existing = await modelsA.LeaveRequest.findById(leaveRequest._id).lean();
    assert.ok(existing.handover?.status);
    const again = await request(app)
      .post(`/api/handovers/leave/${leaveRequest._id}`)
      .set("Cookie", empCookie);
    assert.equal(again.status, 200);
    assert.equal(String(again.body.handover._id), String(leaveRequest._id));
  });

  it("11–13. temporary embedded delegation preserves Task.assigneeId; covering scope works", async () => {
    const leave = await modelsA.LeaveRequest.findById(leaveRequest._id);
    assert.ok(leave.handover);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + 2);

    const item = leave.handover.items.id(itemId) || leave.handover.items[0];
    item.backupEmployeeId = backup._id;
    item.status = HANDOVER_ITEM_STATUSES.ACTIVE;
    leave.handover.status = HANDOVER_STATUSES.ACTIVE;
    leave.fromDate = today;
    leave.toDate = end;
    item.coverageFrom = today;
    item.coverageTo = end;
    item.delegation = {
      originalAssigneeId: leaveTaker._id,
      delegateEmployeeId: backup._id,
      fromDate: today,
      toDate: end,
      status: DELEGATION_STATUSES.ACTIVE,
      activatedAt: new Date(),
      endedAt: null,
      endReason: null,
      createdByUserId: hrUserA._id,
      endedByUserId: null,
      outcomeNote: "",
      migratedFromDelegationId: null,
    };
    leave.markModified("handover");
    await leave.save();

    const freshTask = await modelsA.Task.findById(task._id);
    assert.equal(String(freshTask.assigneeId), String(leaveTaker._id));

    const covering = await request(app)
      .get("/api/tasks?scope=covering")
      .set("Cookie", backupCookie);
    assert.equal(covering.status, 200);
    const coveringList = covering.body.tasks || covering.body.data?.tasks || [];
    const ids = coveringList.map((t) => String(t._id));
    assert.ok(ids.includes(String(task._id)));
    const annotated = coveringList.find((t) => String(t._id) === String(task._id));
    assert.ok(annotated);
    assert.equal(annotated.temporaryCoverage, undefined);
    assert.equal(annotated.coverageBadge, undefined);
    assert.equal(annotated.originalOwner, undefined);

    const dash = await request(app)
      .get("/api/employees/me/dashboard")
      .set("Cookie", backupCookie);
    assert.equal(dash.status, 200);
    const coverRows = dash.body.coveringResponsibilities || [];
    const coverRow = coverRows.find((r) => String(r.taskId) === String(task._id));
    assert.ok(coverRow);
    assert.equal(coverRow.originalOwner, undefined);
    assert.equal(coverRow.coordinatedBy, undefined);
    assert.equal(coverRow.instructions, undefined);
    assert.ok(coverRow.title);

    const unrelatedDash = await request(app)
      .get("/api/employees/me/dashboard")
      .set("Cookie", empCookie);
    assert.equal(unrelatedDash.status, 200);
    const unrelatedRows = unrelatedDash.body.coveringResponsibilities || [];
    assert.ok(!unrelatedRows.some((r) => String(r.taskId) === String(task._id)));
  });

  it("14. peer acknowledgement API remains retired for any actor", async () => {
    const { from, to } = futureRange(60, 2);
    const leave4 = await modelsA.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: from,
      toDate: to,
      daysCount: 2,
      reason: "Authz test",
      status: LEAVE_STATUSES.PENDING,
    });
    const task4 = await modelsA.Task.create({
      title: "Authz Task",
      description: "Permission check task",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUserA._id,
      status: TASK_STATUSES.ASSIGNED,
      priority: TASK_PRIORITIES.LOW,
      deadline: to,
      department: "Engineering",
    });
    await modelsA.LeaveBackupProposal.create({
      leaveRequestId: leave4._id,
      originalEmployeeId: leaveTaker._id,
      taskId: task4._id,
      proposedBackupEmployeeId: backup._id,
      status: "PROPOSED",
    });
    const created = await request(app).post(`/api/handovers/leave/${leave4._id}`).set("Cookie", empCookie);
    const hid = created.body.handover._id;
    const iid = created.body.handover.items[0]._id;
    await request(app)
      .put(`/api/handovers/${hid}`)
      .set("Cookie", empCookie)
      .send({ items: [{ itemId: iid, backupEmployeeId: backup._id, instructions: "x" }] });
    await request(app).post(`/api/handovers/${hid}/submit`).set("Cookie", empCookie);

    const retired = await request(app)
      .post(`/api/handovers/${hid}/items/${iid}/respond`)
      .set("Cookie", empCookie)
      .send({ decision: "ACKNOWLEDGE" });
    assert.equal(retired.status, 410);
  });

  it("15–16. end-date reconciliation completes handover and ends embedded delegation", async () => {
    const leave = await modelsA.LeaveRequest.findById(leaveRequest._id);
    const pastFrom = new Date();
    pastFrom.setUTCDate(pastFrom.getUTCDate() - 10);
    pastFrom.setUTCHours(0, 0, 0, 0);
    const pastTo = new Date();
    pastTo.setUTCDate(pastTo.getUTCDate() - 2);
    pastTo.setUTCHours(0, 0, 0, 0);
    leave.handover.status = HANDOVER_STATUSES.ACTIVE;
    leave.fromDate = pastFrom;
    leave.toDate = pastTo;
    for (const item of leave.handover.items) {
      if (item.delegation) {
        item.delegation.status = DELEGATION_STATUSES.ACTIVE;
        item.delegation.fromDate = pastFrom;
        item.delegation.toDate = pastTo;
      }
    }
    leave.markModified("handover");
    await leave.save();

    const res = await request(app).get(`/api/handovers/${leaveRequest._id}`).set("Cookie", hrCookieA);
    assert.equal(res.status, 200);
    assert.equal(res.body.handover.status, HANDOVER_STATUSES.COMPLETED);

    const after = await modelsA.LeaveRequest.findById(leaveRequest._id).lean();
    for (const item of after.handover.items) {
      if (item.delegation?.status) {
        assert.equal(item.delegation.status, DELEGATION_STATUSES.ENDED);
      }
    }
  });

  it("18–19. leave rejection cancels related embedded handover; inactive backup rejected", async () => {
    const { from, to } = futureRange(80, 2);
    const leave5 = await modelsA.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: from,
      toDate: to,
      daysCount: 2,
      reason: "Reject sync",
      status: LEAVE_STATUSES.PENDING,
    });
    const created = await request(app).post(`/api/handovers/leave/${leave5._id}`).set("Cookie", empCookie);
    const hid = created.body.handover._id;

    const decide = await request(app)
      .post(`/api/leave-requests/${leave5._id}/decision`)
      .set("Cookie", hrCookieA)
      .send({ action: "REJECT", remarks: "Insufficient notice for coverage planning." });
    assert.equal(decide.status, 200);

    const after = await modelsA.LeaveRequest.findById(leave5._id).lean();
    assert.equal(after.handover.status, HANDOVER_STATUSES.CANCELLED);
    assert.equal(String(hid), String(leave5._id));

    const inactive = await modelsA.Employee.create({
      fullName: "Inactive Peer",
      employeeCode: "HO-X",
      email: "inactive@handoverco.test",
      status: EMPLOYEE_STATUSES.INACTIVE,
      job: { jobTitle: "Engineer", department: "Engineering" },
    });
    const { from: f6, to: t6 } = futureRange(90, 2);
    const leave6 = await modelsA.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: f6,
      toDate: t6,
      daysCount: 2,
      reason: "Inactive backup",
      status: LEAVE_STATUSES.PENDING,
    });
    const c6 = await request(app).post(`/api/handovers/leave/${leave6._id}`).set("Cookie", empCookie);
    if (c6.body.handover.items?.[0]) {
      const badBackup = await request(app)
        .put(`/api/handovers/${c6.body.handover._id}`)
        .set("Cookie", empCookie)
        .send({
          items: [{ itemId: c6.body.handover.items[0]._id, backupEmployeeId: inactive._id }],
        });
      assert.equal(badBackup.status, 400);
    }
  });

  it("20–21. cross-tenant isolation and permissions", async () => {
    const cross = await request(app)
      .get(`/api/handovers/${leaveRequest._id}`)
      .set("Cookie", hrCookieB);
    assert.ok([403, 404].includes(cross.status));

    const empHrList = await request(app).get("/api/handovers").set("Cookie", empCookie);
    assert.equal(empHrList.status, 403);
  });

  it("22. leave approval works without completed handover", async () => {
    const { from, to } = futureRange(100, 2);
    const leave7 = await modelsA.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: from,
      toDate: to,
      daysCount: 2,
      reason: "No handover needed",
      status: LEAVE_STATUSES.PENDING,
    });
    const approve = await request(app)
      .post(`/api/leave-requests/${leave7._id}/decision`)
      .set("Cookie", hrCookieA)
      .send({ action: "APPROVE", remarks: "Approved without handover." });
    assert.equal(approve.status, 200);
    assert.equal(approve.body.leaveRequest.status, "APPROVED");
  });

  it("23. migration idempotency markers do not create duplicate embedded handovers", async () => {
    const leave = await modelsA.LeaveRequest.findById(leaveRequest._id);
    const marker = leave.handover.migratedFromHandoverId;
    leave.handover.migratedFromHandoverId = leave._id;
    leave.markModified("handover");
    await leave.save();

    const again = await request(app)
      .post(`/api/handovers/leave/${leaveRequest._id}`)
      .set("Cookie", empCookie);
    assert.equal(again.status, 200);
    assert.equal(String(again.body.handover._id), String(leaveRequest._id));

    // restore
    leave.handover.migratedFromHandoverId = marker || null;
    leave.markModified("handover");
    await leave.save();
  });

  it("24. expired and cancelled delegations never grant task access", async () => {
    const { getActiveDelegationForActor } = await import("../services/taskDelegationService.js");
    const { from, to } = futureRange(120, 3);
    const leaveX = await modelsA.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: from,
      toDate: to,
      daysCount: 3,
      reason: "Auth expiry",
      status: LEAVE_STATUSES.APPROVED,
    });
    const taskX = await modelsA.Task.create({
      title: "Expiry Task",
      description: "Delegation expiry check",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUserA._id,
      status: TASK_STATUSES.ASSIGNED,
      priority: TASK_PRIORITIES.LOW,
      deadline: to,
      department: "Engineering",
    });

    const pastFrom = new Date();
    pastFrom.setUTCDate(pastFrom.getUTCDate() - 10);
    pastFrom.setUTCHours(0, 0, 0, 0);
    const pastTo = new Date();
    pastTo.setUTCDate(pastTo.getUTCDate() - 1);
    pastTo.setUTCHours(0, 0, 0, 0);

    leaveX.handover = {
      status: HANDOVER_STATUSES.ACTIVE,
      managerEmployeeId: manager._id,
      generalNotes: "",
      items: [
        {
          taskId: taskX._id,
          backupEmployeeId: backup._id,
          status: HANDOVER_ITEM_STATUSES.ACTIVE,
          coverageFrom: pastFrom,
          coverageTo: pastTo,
          taskSnapshot: { title: "Expiry Task", priority: "LOW", deadline: to, status: "ASSIGNED" },
          delegation: {
            originalAssigneeId: leaveTaker._id,
            delegateEmployeeId: backup._id,
            fromDate: pastFrom,
            toDate: pastTo,
            status: DELEGATION_STATUSES.ACTIVE,
            activatedAt: pastFrom,
          },
        },
      ],
      createdByUserId: hrUserA._id,
      schemaVersion: 1,
    };
    leaveX.markModified("handover");
    await leaveX.save();

    // Dates expired → no access even if status still ACTIVE
    let del = await getActiveDelegationForActor(modelsA, taskX._id, backup._id);
    assert.equal(del, null);

    // Refresh and cancel handover + delegation
    const live = await modelsA.LeaveRequest.findById(leaveX._id);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + 2);
    live.fromDate = today;
    live.toDate = end;
    live.handover.status = HANDOVER_STATUSES.CANCELLED;
    live.handover.items[0].coverageFrom = today;
    live.handover.items[0].coverageTo = end;
    live.handover.items[0].delegation.fromDate = today;
    live.handover.items[0].delegation.toDate = end;
    live.handover.items[0].delegation.status = DELEGATION_STATUSES.CANCELLED;
    live.markModified("handover");
    await live.save();

    del = await getActiveDelegationForActor(modelsA, taskX._id, backup._id);
    assert.equal(del, null);

    // Unrelated employee never gets access
    del = await getActiveDelegationForActor(modelsA, taskX._id, manager._id);
    assert.equal(del, null);
  });

  it("25. concurrent delegation claims for the same task resolve without overlap", async () => {
    const { attachDelegationToItem } = await import("../services/taskDelegationService.js");
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + 2);

    const taskC = await modelsA.Task.create({
      title: "Concurrent Task",
      description: "Race claim check",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUserA._id,
      status: TASK_STATUSES.IN_PROGRESS,
      priority: TASK_PRIORITIES.HIGH,
      deadline: end,
      department: "Engineering",
    });

    async function seedLeave(code) {
      const leave = await modelsA.LeaveRequest.create({
        employeeId: leaveTaker._id,
        leaveTypeCode: "CASUAL",
        fromDate: today,
        toDate: end,
        daysCount: 2,
        reason: `Concurrent ${code}`,
        status: LEAVE_STATUSES.APPROVED,
        handover: {
          status: HANDOVER_STATUSES.READY_FOR_MANAGER_REVIEW,
          managerEmployeeId: manager._id,
          generalNotes: "",
          items: [
            {
              taskId: taskC._id,
              backupEmployeeId: backup._id,
              status: HANDOVER_ITEM_STATUSES.ACKNOWLEDGED,
              coverageFrom: today,
              coverageTo: end,
              taskSnapshot: { title: "Concurrent Task", priority: "HIGH", status: "IN_PROGRESS" },
              delegation: null,
            },
          ],
          createdByUserId: hrUserA._id,
          schemaVersion: 1,
        },
      });
      return modelsA.LeaveRequest.findById(leave._id);
    }

    const leaveA = await seedLeave("A");
    const leaveB = await seedLeave("B");
    const itemA = leaveA.handover.items[0];
    const itemB = leaveB.handover.items[0];

    const payload = {
      originalAssigneeId: leaveTaker._id,
      delegateEmployeeId: backup._id,
      fromDate: today,
      toDate: end,
      createdByUserId: hrUserA._id,
      activateNow: true,
    };

    const results = await Promise.allSettled([
      attachDelegationToItem(modelsA, leaveA, itemA, payload),
      attachDelegationToItem(modelsA, leaveB, itemB, payload),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.match(String(rejected[0].reason?.message || rejected[0].reason), /active temporary transfer|already claimed/i);

    const open = await modelsA.LeaveRequest.countDocuments({
      "handover.items": {
        $elemMatch: {
          taskId: taskC._id,
          "delegation.status": { $in: [DELEGATION_STATUSES.ACTIVE, DELEGATION_STATUSES.SCHEDULED] },
        },
      },
    });
    assert.equal(open, 1);
  });

  it("26. migration is idempotent and never writes source collections", async () => {
    const { migrateTenant } = await import("../scripts/migrateHandoversToLeaveRequest.js");
    const { getTenantConnection } = await import("../config/db.js");
    const conn = await getTenantConnection(companyA.databaseName);
    const db = conn.db;

    const { from, to } = futureRange(140, 2);
    const leaveM = await modelsA.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: from,
      toDate: to,
      daysCount: 2,
      reason: "Migration source",
      status: LEAVE_STATUSES.PENDING,
    });
    const taskM = await modelsA.Task.create({
      title: "Migrate Task",
      description: "Migration linkage",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUserA._id,
      status: TASK_STATUSES.ASSIGNED,
      priority: TASK_PRIORITIES.MEDIUM,
      deadline: to,
      department: "Engineering",
    });

    const hoId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();
    await db.collection("leave_handovers").insertOne({
      _id: hoId,
      leaveRequestId: leaveM._id,
      originalEmployeeId: leaveTaker._id,
      managerEmployeeId: manager._id,
      status: HANDOVER_STATUSES.DRAFT,
      leaveWindow: { fromDate: from, toDate: to },
      generalNotes: "from legacy",
      items: [
        {
          _id: itemId,
          taskId: taskM._id,
          backupEmployeeId: backup._id,
          status: HANDOVER_ITEM_STATUSES.DRAFT,
          taskSnapshot: { title: "Migrate Task", priority: "MEDIUM", status: "ASSIGNED" },
        },
      ],
      createdByUserId: hrUserA._id,
    });
    const delId = new mongoose.Types.ObjectId();
    await db.collection("task_delegations").insertOne({
      _id: delId,
      taskId: taskM._id,
      handoverId: hoId,
      handoverItemId: itemId,
      originalAssigneeId: leaveTaker._id,
      delegateEmployeeId: backup._id,
      fromDate: from,
      toDate: to,
      status: DELEGATION_STATUSES.SCHEDULED,
      createdByUserId: hrUserA._id,
    });

    const sourceHoBefore = await db.collection("leave_handovers").countDocuments({ _id: hoId });
    const sourceDelBefore = await db.collection("task_delegations").countDocuments({ _id: delId });

    const first = await migrateTenant(companyA);
    assert.ok(first.migrated >= 1);

    const embedded = await modelsA.LeaveRequest.findById(leaveM._id).lean();
    assert.equal(String(embedded.handover.migratedFromHandoverId), String(hoId));
    assert.equal(String(embedded.handover.items[0].delegation.migratedFromDelegationId), String(delId));

    const second = await migrateTenant(companyA);
    assert.ok(second.skippedAlreadyMigrated >= 1);

    const sourceHoAfter = await db.collection("leave_handovers").countDocuments({ _id: hoId });
    const sourceDelAfter = await db.collection("task_delegations").countDocuments({ _id: delId });
    assert.equal(sourceHoAfter, sourceHoBefore);
    assert.equal(sourceDelAfter, sourceDelBefore);

    // Still exactly one embedded handover on the leave
    const again = await modelsA.LeaveRequest.findById(leaveM._id).lean();
    assert.equal(String(again.handover.migratedFromHandoverId), String(hoId));
  });

  it("27. coordinated future coverage appears on Dashboard and Tasks for receiving employee", async () => {
    const { from, to } = futureRange(15, 4);
    const leaveF = await modelsA.LeaveRequest.create({
      employeeId: leaveTaker._id,
      leaveTypeCode: "CASUAL",
      fromDate: from,
      toDate: to,
      daysCount: 4,
      reason: "Future leave coverage visibility",
      status: LEAVE_STATUSES.PENDING,
    });
    const taskF = await modelsA.Task.create({
      title: "Future Coverage Task",
      description: "Must appear after HR coordinates",
      assigneeId: leaveTaker._id,
      assignedByUserId: hrUserA._id,
      status: TASK_STATUSES.ASSIGNED,
      priority: TASK_PRIORITIES.HIGH,
      deadline: to,
      department: "Engineering",
    });
    await modelsA.LeaveBackupProposal.create({
      leaveRequestId: leaveF._id,
      originalEmployeeId: leaveTaker._id,
      taskId: taskF._id,
      proposedBackupEmployeeId: backup._id,
      status: "PROPOSED",
    });

    const created = await request(app)
      .post(`/api/handovers/leave/${leaveF._id}`)
      .set("Cookie", hrCookieA);
    assert.equal(created.status, 200);
    const hid = created.body.handover._id;
    const iid = created.body.handover.items[0]._id;

    await request(app)
      .put(`/api/handovers/${hid}`)
      .set("Cookie", hrCookieA)
      .send({
        items: [
          {
            itemId: iid,
            backupEmployeeId: backup._id,
            instructions: "Keep the partner channel monitored.",
          },
        ],
      });

    const coordinated = await request(app)
      .post(`/api/handovers/${hid}/coordinate`)
      .set("Cookie", hrCookieA)
      .send({ notes: "Coverage arranged." });
    assert.equal(coordinated.status, 200);
    assert.ok(
      [HANDOVER_STATUSES.APPROVED, HANDOVER_STATUSES.ACTIVE].includes(
        coordinated.body.handover.status
      )
    );

    const ownership = await modelsA.Task.findById(taskF._id).lean();
    assert.equal(String(ownership.assigneeId), String(leaveTaker._id));

    const dashB = await request(app)
      .get("/api/employees/me/dashboard")
      .set("Cookie", backupCookie);
    assert.equal(dashB.status, 200);
    const coverRows = dashB.body.coveringResponsibilities || [];
    assert.ok(
      coverRows.some((r) => String(r.taskId) === String(taskF._id)),
      "Receiving employee Dashboard must list coordinated Temporary Coverage"
    );

    const covering = await request(app)
      .get("/api/tasks?scope=covering")
      .set("Cookie", backupCookie);
    assert.equal(covering.status, 200);
    const coveringList = covering.body.tasks || covering.body.data?.tasks || [];
    assert.ok(
      coveringList.some((t) => String(t._id) === String(taskF._id)),
      "Receiving employee Tasks covering scope must list the same task"
    );

    const openTask = await request(app)
      .get(`/api/tasks/${taskF._id}`)
      .set("Cookie", backupCookie);
    assert.equal(openTask.status, 200);
    assert.ok(openTask.body.task);
    assert.equal(openTask.body.task.temporaryCoverage, undefined);
    assert.equal(openTask.body.task.originalOwner, undefined);

    const start = await request(app)
      .post(`/api/tasks/${taskF._id}/start`)
      .set("Cookie", backupCookie);
    assert.equal(start.status, 200);

    const dashA = await request(app)
      .get("/api/employees/me/dashboard")
      .set("Cookie", empCookie);
    assert.equal(dashA.status, 200);
    const aRows = dashA.body.coveringResponsibilities || [];
    assert.ok(!aRows.some((r) => String(r.taskId) === String(taskF._id)));

    const loginMgr = await request(app)
      .post("/api/auth/login")
      .send({ email: "mgr@handoverco.test", password: "EmpPass123!", companyCode: "handoverco" });
    const mgrCookie = cookieFrom(loginMgr);
    const unrelated = await request(app)
      .get(`/api/tasks/${taskF._id}`)
      .set("Cookie", mgrCookie);
    assert.ok([403, 404].includes(unrelated.status));
  });
});

