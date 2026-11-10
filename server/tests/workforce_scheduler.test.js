import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { LEAVE_STATUSES } from "../models/LeaveRequest.js";
import { TASK_STATUSES, TASK_PRIORITIES } from "../models/Task.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import {
  sortTasksByPriority,
  scoreEmployeeForTask,
  decideAssignment,
  ASSIGNMENT_PATHS,
  runCompanyScheduler,
  acquireCompanySchedulerLock,
  releaseCompanySchedulerLock,
  SCHEDULER_WEIGHTS,
} from "../services/workforceScheduler/index.js";
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import {
  assignUnassignedTaskService,
  notifyTaskAssigned,
} from "../services/workManagementService.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.CRON_SECRET = "workforce-cron-test-secret";
process.env.WORKFORCE_SCHEDULER_ENABLED = "true";
process.env.WORKFORCE_SCHEDULER_MODE = "dry-run";
process.env.WORKFORCE_SCHEDULER_MAX_ACTIVE_TASKS = "2";

let mongo;
let app;
let company;
let models;
let hrCookie;
let hrUser;
let empLight;
let empHeavy;
let empLeave;
let empSkilled;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

async function createUnassignedTask(overrides = {}) {
  return models.Task.create({
    title: overrides.title || "Unassigned work",
    description: overrides.description || "Needs scheduling",
    assigneeId: null,
    assignedByUserId: hrUser._id,
    assignedBySnapshot: { fullName: "HR", role: USER_ROLES.HR_ADMIN, email: "hr@sched.test" },
    department: overrides.department || "Engineering",
    priority: overrides.priority || TASK_PRIORITIES.MEDIUM,
    status: TASK_STATUSES.UNASSIGNED,
    deadline: overrides.deadline || new Date(Date.now() + 3 * 86_400_000),
    requiredSkills: overrides.requiredSkills || [],
    createdAt: overrides.createdAt,
  });
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  company = await Company.create({
    companyName: "Scheduler Co",
    slug: "sched-co",
    databaseName: "company_sched_co_test",
    status: COMPANY_STATUSES.ACTIVE,
    config: { timezone: "Asia/Kolkata" },
  });

  models = await getCompanyModels(company);

  hrUser = await models.User.create({
    email: "hr@sched.test",
    passwordHash: await hashPassword("SchedPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const lightUser = await models.User.create({
    email: "light@sched.test",
    passwordHash: await hashPassword("SchedPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  empLight = await models.Employee.create({
    userId: lightUser._id,
    companyId: company._id,
    employeeCode: "E-LIGHT",
    fullName: "Light Load",
    email: "light@sched.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    skills: ["node", "react"],
    job: { department: "Engineering", jobTitle: "Dev" },
  });

  empHeavy = await models.Employee.create({
    companyId: company._id,
    employeeCode: "E-HEAVY",
    fullName: "Heavy Load",
    email: "heavy@sched.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    skills: ["node"],
    job: { department: "Engineering", jobTitle: "Dev" },
  });

  empLeave = await models.Employee.create({
    companyId: company._id,
    employeeCode: "E-LEAVE",
    fullName: "On Leave",
    email: "leave@sched.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    skills: ["node", "react"],
    job: { department: "Engineering", jobTitle: "Dev" },
  });

  empSkilled = await models.Employee.create({
    companyId: company._id,
    employeeCode: "E-SKILL",
    fullName: "Python Only",
    email: "py@sched.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    skills: ["python"],
    job: { department: "Data", jobTitle: "Analyst" },
  });

  // Fill heavy employee to capacity (maxActive=2)
  for (let i = 0; i < 2; i += 1) {
    await models.Task.create({
      title: `Heavy task ${i}`,
      description: "Busy",
      assigneeId: empHeavy._id,
      assignedByUserId: hrUser._id,
      assignedBySnapshot: { fullName: "HR", role: USER_ROLES.HR_ADMIN, email: "hr@sched.test" },
      department: "Engineering",
      priority: TASK_PRIORITIES.MEDIUM,
      status: TASK_STATUSES.IN_PROGRESS,
      deadline: new Date(Date.now() + 7 * 86_400_000),
    });
  }

  const today = new Date();
  await models.LeaveRequest.create({
    employeeId: empLeave._id,
    leaveTypeCode: "CASUAL",
    fromDate: new Date(today.getTime() - 86_400_000),
    toDate: new Date(today.getTime() + 86_400_000),
    daysCount: 3,
    reason: "PTO",
    status: LEAVE_STATUSES.APPROVED,
  });

  const login = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "sched-co", email: "hr@sched.test", password: "SchedPass123!" });
  hrCookie = cookieFrom(login);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Workforce Scheduler — priority & fairness", () => {
  it("orders CRITICAL/overdue ahead of LOW/later", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const ranked = sortTasksByPriority(
      [
        {
          _id: "a",
          priority: TASK_PRIORITIES.LOW,
          deadline: new Date("2026-07-01"),
          createdAt: now,
        },
        {
          _id: "b",
          priority: TASK_PRIORITIES.CRITICAL,
          deadline: new Date("2026-05-01"),
          createdAt: now,
        },
        {
          _id: "c",
          priority: TASK_PRIORITIES.HIGH,
          deadline: new Date("2026-06-02"),
          createdAt: now,
        },
      ],
      now
    );
    assert.equal(ranked[0].task._id, "b");
    assert.ok(ranked[0].score > ranked[1].score);
  });

  it("prefers lower utilization with documented weights", () => {
    const task = { requiredSkills: [], department: "Engineering" };
    const light = scoreEmployeeForTask({
      employee: empLight,
      task,
      workload: { activeCount: 0 },
      maxActive: 2,
      weights: SCHEDULER_WEIGHTS,
    });
    const heavy = scoreEmployeeForTask({
      employee: empHeavy,
      task,
      workload: { activeCount: 2 },
      maxActive: 2,
      weights: SCHEDULER_WEIGHTS,
    });
    assert.ok(light.score > heavy.score);
  });
});

describe("Workforce Scheduler — eligibility & decisions", () => {
  it("excludes employees on approved leave and at capacity", async () => {
    const task = await createUnassignedTask({
      title: "Elig check",
      requiredSkills: ["node"],
    });
    const workloadByEmployee = new Map([
      [String(empLight._id), { activeCount: 0, taskIds: [] }],
      [String(empHeavy._id), { activeCount: 2, taskIds: [] }],
      [String(empLeave._id), { activeCount: 0, taskIds: [] }],
      [String(empSkilled._id), { activeCount: 0, taskIds: [] }],
    ]);

    const decision = await decideAssignment(models, task, workloadByEmployee, {
      maxActive: 2,
      company,
    });

    assert.equal(decision.path, ASSIGNMENT_PATHS.AUTO);
    assert.equal(decision.proposal.employeeId, String(empLight._id));
    const reasons = decision.rejected.map((r) => r.reason);
    assert.ok(reasons.includes("on_approved_leave") || reasons.includes("at_capacity"));
  });

  it("requires manager approval for HIGH priority", async () => {
    const task = await createUnassignedTask({
      title: "High prio",
      priority: TASK_PRIORITIES.HIGH,
      requiredSkills: ["node"],
    });
    const workloadByEmployee = new Map([
      [String(empLight._id), { activeCount: 0, taskIds: [] }],
    ]);
    const decision = await decideAssignment(models, task, workloadByEmployee, {
      maxActive: 2,
      company,
    });
    assert.equal(decision.path, ASSIGNMENT_PATHS.MANAGER_APPROVAL);
  });

  it("returns NO_ELIGIBLE when skills unavailable / mismatch", async () => {
    const task = await createUnassignedTask({
      title: "Needs rust",
      requiredSkills: ["rust"],
    });
    const workloadByEmployee = new Map([
      [String(empLight._id), { activeCount: 0, taskIds: [] }],
      [String(empSkilled._id), { activeCount: 0, taskIds: [] }],
    ]);
    const decision = await decideAssignment(models, task, workloadByEmployee, {
      maxActive: 2,
      company,
    });
    assert.equal(decision.path, ASSIGNMENT_PATHS.NO_ELIGIBLE);
  });
});

describe("Workforce Scheduler — dry-run & apply", () => {
  async function clearUnassignedQueue() {
    await models.Task.deleteMany({ status: TASK_STATUSES.UNASSIGNED });
  }

  it("dry-run does not change assignee ownership", async () => {
    await clearUnassignedQueue();
    const task = await createUnassignedTask({ title: "Dry run task", requiredSkills: ["node"] });
    const result = await runCompanyScheduler(company, {
      mode: "dry-run",
      force: true,
      skipLock: true,
    });
    assert.equal(result.skipped, false);
    assert.equal(result.summary.dryRun, true);

    const reloaded = await models.Task.findById(task._id);
    assert.equal(reloaded.status, TASK_STATUSES.UNASSIGNED);
    assert.equal(reloaded.assigneeId, null);
  });

  it("apply mode assigns AUTO tasks atomically", async () => {
    await clearUnassignedQueue();
    // Free capacity on preferred assignee (prior tests may have filled slots)
    await models.Task.deleteMany({
      assigneeId: empLight._id,
      status: { $in: [TASK_STATUSES.ASSIGNED, TASK_STATUSES.IN_PROGRESS] },
    });
    const task = await createUnassignedTask({ title: "Apply task", requiredSkills: ["node"] });
    process.env.WORKFORCE_SCHEDULER_MODE = "apply";
    const result = await runCompanyScheduler(company, {
      mode: "apply",
      force: true,
      skipLock: true,
    });
    process.env.WORKFORCE_SCHEDULER_MODE = "dry-run";

    assert.ok(result.summary.autoApplied >= 1, JSON.stringify(result.summary));
    const reloaded = await models.Task.findById(task._id);
    assert.equal(reloaded.status, TASK_STATUSES.ASSIGNED);
    assert.equal(String(reloaded.assigneeId), String(empLight._id));
  });

  it("prevents duplicate assignment under concurrent claim", async () => {
    const task = await createUnassignedTask({ title: "Race task" });
    const first = await assignUnassignedTaskService({
      models,
      taskId: task._id,
      assigneeId: empLight._id,
      source: "WORKFORCE_SCHEDULER",
    });
    assert.equal(first.idempotent, false);

    await assert.rejects(
      () =>
        assignUnassignedTaskService({
          models,
          taskId: task._id,
          assigneeId: empSkilled._id,
          source: "WORKFORCE_SCHEDULER",
        }),
      (err) => err.status === 409
    );
  });

  it("company lock blocks overlapping runs", async () => {
    const lock1 = await acquireCompanySchedulerLock(company._id, 60_000);
    assert.equal(lock1.acquired, true);
    const lock2 = await acquireCompanySchedulerLock(company._id, 60_000);
    assert.equal(lock2.acquired, false);
    await releaseCompanySchedulerLock(company._id, lock1.token);
    const lock3 = await acquireCompanySchedulerLock(company._id, 60_000);
    assert.equal(lock3.acquired, true);
    await releaseCompanySchedulerLock(company._id, lock3.token);
  });
});

describe("Workforce Scheduler — cron auth & manual regression", () => {
  it("rejects cron without secret", async () => {
    const res = await request(app).post("/api/workforce-scheduler/run");
    assert.equal(res.status, 401);
  });

  it("accepts cron with bearer secret", async () => {
    const res = await request(app)
      .post("/api/workforce-scheduler/run")
      .set("Authorization", "Bearer workforce-cron-test-secret");
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  it("manual assigned task creation still works", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .set("Cookie", hrCookie)
      .send({
        title: "Manual assign regression",
        description: "Must still assign immediately",
        assigneeId: empLight._id,
        deadline: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        priority: TASK_PRIORITIES.MEDIUM,
      });
    assert.equal(res.status, 201);
    assert.equal(res.body.task.status, TASK_STATUSES.ASSIGNED);
    assert.equal(String(res.body.task.assigneeId), String(empLight._id));
  });

  it("HR can manually assign an UNASSIGNED task via POST /tasks/:id/assign", async () => {
    await models.Task.deleteMany({ status: TASK_STATUSES.UNASSIGNED });
    const create = await request(app)
      .post("/api/tasks")
      .set("Cookie", hrCookie)
      .send({
        title: "Manual queue assign",
        description: "Assign without scheduler",
        unassigned: true,
        deadline: new Date(Date.now() + 4 * 86_400_000).toISOString(),
        priority: TASK_PRIORITIES.LOW,
      });
    assert.equal(create.status, 201);
    assert.equal(create.body.task.status, TASK_STATUSES.UNASSIGNED);

    const assign = await request(app)
      .post(`/api/tasks/${create.body.task._id}/assign`)
      .set("Cookie", hrCookie)
      .send({ assigneeId: empLight._id });
    assert.equal(assign.status, 200);
    assert.equal(assign.body.task.status, TASK_STATUSES.ASSIGNED);
    assert.equal(String(assign.body.task.assigneeId), String(empLight._id));

    // Cannot reassign already assigned via this endpoint
    const again = await request(app)
      .post(`/api/tasks/${create.body.task._id}/assign`)
      .set("Cookie", hrCookie)
      .send({ assigneeId: empSkilled._id });
    assert.equal(again.status, 409);
  });

  it("manual assign without auth is rejected", async () => {
    const res = await request(app)
      .post(`/api/tasks/${new mongoose.Types.ObjectId()}/assign`)
      .send({ assigneeId: empLight._id });
    assert.ok(res.status === 401 || res.status === 403);
  });

  it("unassigned create + approve proposal path", async () => {
    await models.Task.deleteMany({ status: TASK_STATUSES.UNASSIGNED });
    await models.Task.deleteMany({
      assigneeId: empLight._id,
      status: { $in: [TASK_STATUSES.ASSIGNED, TASK_STATUSES.IN_PROGRESS, TASK_STATUSES.SUBMITTED] },
    });

    const create = await request(app)
      .post("/api/tasks")
      .set("Cookie", hrCookie)
      .send({
        title: "Unassigned for approval",
        description: "Queue item",
        unassigned: true,
        deadline: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        priority: TASK_PRIORITIES.HIGH,
        requiredSkills: ["node"],
      });
    assert.equal(create.status, 201);
    assert.equal(create.body.task.status, TASK_STATUSES.UNASSIGNED);

    const run = await runCompanyScheduler(company, {
      mode: "apply",
      force: true,
      skipLock: true,
    });
    const decision = run.decisions.find((d) => d.taskId === String(create.body.task._id));
    assert.ok(decision, JSON.stringify(run.summary));
    assert.equal(decision.path, ASSIGNMENT_PATHS.MANAGER_APPROVAL);

    const taskAfter = await models.Task.findById(create.body.task._id);
    assert.equal(taskAfter.status, TASK_STATUSES.UNASSIGNED);
    assert.equal(taskAfter.auditMetadata?.workforceScheduler?.status, "PENDING_APPROVAL");

    const approve = await request(app)
      .post(`/api/workforce-scheduler/tasks/${create.body.task._id}/approve`)
      .set("Cookie", hrCookie);
    assert.equal(approve.status, 200);
    assert.equal(approve.body.task.status, TASK_STATUSES.ASSIGNED);
  });
});

describe("Workforce Scheduler — business rules & notifications", () => {
  it("rejects scheduler assign to employee on approved leave (no human auth required)", async () => {
    await models.Task.deleteMany({ status: TASK_STATUSES.UNASSIGNED });
    const task = await createUnassignedTask({ title: "Leave block", requiredSkills: ["node"] });
    await assert.rejects(
      () =>
        assignUnassignedTaskService({
          models,
          taskId: task._id,
          assigneeId: empLeave._id,
          source: "WORKFORCE_SCHEDULER",
          company,
        }),
      (err) => err.status === 400 && /leave/i.test(err.message)
    );
    const reloaded = await models.Task.findById(task._id);
    assert.equal(reloaded.status, TASK_STATUSES.UNASSIGNED);
  });

  it("rejects scheduler assign when skills mismatch", async () => {
    const task = await createUnassignedTask({ title: "Skill block", requiredSkills: ["rust"] });
    await assert.rejects(
      () =>
        assignUnassignedTaskService({
          models,
          taskId: task._id,
          assigneeId: empLight._id,
          source: "WORKFORCE_SCHEDULER",
          company,
        }),
      (err) => err.status === 400 && /skill/i.test(err.message)
    );
  });

  it("rejects scheduler assign when employee at capacity", async () => {
    const task = await createUnassignedTask({ title: "Capacity block", requiredSkills: ["node"] });
    await assert.rejects(
      () =>
        assignUnassignedTaskService({
          models,
          taskId: task._id,
          assigneeId: empHeavy._id,
          source: "WORKFORCE_SCHEDULER",
          company,
        }),
      (err) => err.status === 400 && /capacity/i.test(err.message)
    );
  });

  it("rejects inactive employees", async () => {
    const inactive = await models.Employee.create({
      companyId: company._id,
      employeeCode: "E-INACT",
      fullName: "Inactive",
      email: "inactive@sched.test",
      status: EMPLOYEE_STATUSES.INACTIVE,
      skills: ["node"],
      job: { department: "Engineering" },
    });
    const task = await createUnassignedTask({ title: "Inactive block", requiredSkills: ["node"] });
    await assert.rejects(
      () =>
        assignUnassignedTaskService({
          models,
          taskId: task._id,
          assigneeId: inactive._id,
          source: "WORKFORCE_SCHEDULER",
          company,
        }),
      (err) => err.status === 400 && /inactive/i.test(err.message)
    );
  });

  it("notifies once on successful assign; idempotent retry does not duplicate", async () => {
    await models.Task.deleteMany({ status: TASK_STATUSES.UNASSIGNED });
    await models.Task.deleteMany({
      assigneeId: empLight._id,
      status: { $in: [TASK_STATUSES.ASSIGNED, TASK_STATUSES.IN_PROGRESS] },
    });
    await models.Notification.deleteMany({
      userId: empLight.userId,
      type: NOTIFICATION_TYPES.TASK,
    });

    const task = await createUnassignedTask({ title: "Notify me", requiredSkills: ["node"] });
    const first = await assignUnassignedTaskService({
      models,
      taskId: task._id,
      assigneeId: empLight._id,
      source: "WORKFORCE_SCHEDULER",
      company,
    });
    assert.equal(first.idempotent, false);
    assert.equal(first.notified, true);

    const notes = await models.Notification.find({
      userId: empLight.userId,
      type: NOTIFICATION_TYPES.TASK,
      "metadata.taskId": String(task._id),
      "metadata.event": "TASK_ASSIGNED",
    });
    assert.equal(notes.length, 1);

    const second = await assignUnassignedTaskService({
      models,
      taskId: task._id,
      assigneeId: empLight._id,
      source: "WORKFORCE_SCHEDULER",
      company,
    });
    assert.equal(second.idempotent, true);
    assert.equal(second.notified, false);

    const notesAfter = await models.Notification.find({
      userId: empLight.userId,
      type: NOTIFICATION_TYPES.TASK,
      "metadata.taskId": String(task._id),
      "metadata.event": "TASK_ASSIGNED",
    });
    assert.equal(notesAfter.length, 1);

    // Explicit notify helper remains idempotent
    const again = await notifyTaskAssigned(models, {
      task: first.task,
      employee: empLight,
      source: "WORKFORCE_SCHEDULER",
    });
    assert.equal(again.notified, false);
  });

  it("dry-run does not create assignment notifications", async () => {
    await models.Task.deleteMany({ status: TASK_STATUSES.UNASSIGNED });
    await models.Notification.deleteMany({
      userId: empLight.userId,
      type: NOTIFICATION_TYPES.TASK,
    });
    await createUnassignedTask({ title: "Dry notify", requiredSkills: ["node"] });
    await runCompanyScheduler(company, { mode: "dry-run", force: true, skipLock: true });
    const count = await models.Notification.countDocuments({
      userId: empLight.userId,
      type: NOTIFICATION_TYPES.TASK,
      "metadata.event": "TASK_ASSIGNED",
    });
    assert.equal(count, 0);
  });
});
