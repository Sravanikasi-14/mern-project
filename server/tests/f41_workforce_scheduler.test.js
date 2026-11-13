import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import {
  connectCentralDB,
  disconnectAll,
  getCompanyModels,
  getTenantConnectionStats,
} from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "../models/Task.js";
import {
  acquireCompanySchedulerLock,
  mapWithBoundedConcurrency,
  orderCompaniesForScheduler,
  releaseCompanySchedulerLock,
  runCompanyScheduler,
  runSchedulerForAllCompanies,
} from "../services/workforceScheduler/executionController.js";
import {
  clearFleetProgress,
  companyNeedsSchedulerRun,
  loadFleetProgress,
} from "../services/workforceScheduler/fleetProgress.js";
import { decideAssignment, ASSIGNMENT_PATHS } from "../services/workforceScheduler/strategy.js";
import { calculateWorkloadByEmployee } from "../services/workforceScheduler/workload.js";
import { ELIGIBLE_EMPLOYEE_SELECT } from "../services/workforceScheduler/eligibility.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f41-workforce-scheduler-test-secret-32!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f41_ws";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.CRON_SECRET = "f41-workforce-cron-secret";
process.env.WORKFORCE_SCHEDULER_ENABLED = "true";
process.env.WORKFORCE_SCHEDULER_MODE = "dry-run";
process.env.WORKFORCE_SCHEDULER_MAX_ACTIVE_TASKS = "5";
process.env.WORKFORCE_SCHEDULER_COMPANY_CONCURRENCY = "2";
process.env.WORKFORCE_SCHEDULER_BUDGET_MS = "50000";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let mongo;
let app;
let companyA;
let companyB;
let companyC;
let modelsA;
let modelsB;
let empA;
let hrCookieA;
let hrUserA;

before(async () => {
  fs.mkdirSync("D:/tmp/hrms-mongo/f41-workforce-scheduler", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/f41-workforce-scheduler" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  await Company.deleteMany({});
  await clearFleetProgress();
  const suffix = `${Date.now()}`;
  companyA = await Company.create({
    companyName: "F41 Acme",
    slug: `f41-acme-${suffix}`,
    databaseName: `company_f41_acme_${suffix}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
    config: {
      workforceScheduler: { lastRunAt: new Date("2026-01-01T00:00:00.000Z") },
    },
  });
  companyB = await Company.create({
    companyName: "F41 Globex",
    slug: `f41-globex-${suffix}`,
    databaseName: `company_f41_globex_${suffix}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
    config: {
      workforceScheduler: { lastRunAt: new Date("2026-06-01T00:00:00.000Z") },
    },
  });
  companyC = await Company.create({
    companyName: "F41 Initech",
    slug: `f41-initech-${suffix}`,
    databaseName: `company_f41_initech_${suffix}`,
    status: COMPANY_STATUSES.TRIAL,
    schemaVersion: 1,
    migrationVersion: 0,
    // never run — should sort first among non-truncated
  });

  modelsA = await getCompanyModels(companyA, { provision: true });
  modelsB = await getCompanyModels(companyB, { provision: true });
  await getCompanyModels(companyC, { provision: true });

  empA = await modelsA.Employee.create({
    employeeCode: "F41-001",
    fullName: "Able Ann",
    email: "ann@f41.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    skills: ["js"],
    job: { jobTitle: "Eng", department: "Engineering", employmentType: "Full-time" },
    schemaVersion: 1,
  });
  hrUserA = await modelsA.User.create({
    email: "hr@f41-acme.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
    schemaVersion: 1,
  });

  hrCookieA = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ companyCode: companyA.slug, email: "hr@f41-acme.test", password: "Password123!" })
  );

  await modelsA.Task.create({
    title: "F41 unassigned A",
    description: "queue item",
    status: TASK_STATUSES.UNASSIGNED,
    priority: TASK_PRIORITIES.MEDIUM,
    requiredSkills: ["js"],
    deadline: new Date(Date.now() + 7 * 86_400_000),
    assignedByUserId: hrUserA._id,
  });
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("F41 scheduler helpers", () => {
  it("orders companies by truncated-first, then oldest lastRunAt, with afterCompanyId resume", () => {
    const truncatedB = {
      ...companyB.toObject(),
      config: {
        workforceScheduler: {
          lastRunAt: new Date("2026-06-01T00:00:00.000Z"),
          lastRunSummary: { truncated: true },
        },
      },
    };
    const ordered = orderCompaniesForScheduler([companyA, truncatedB, companyC]);
    assert.equal(String(ordered[0]._id), String(companyB._id));
    assert.equal(String(ordered[1]._id), String(companyC._id));
    assert.equal(String(ordered[2]._id), String(companyA._id));

    const byAge = orderCompaniesForScheduler([companyA, companyB, companyC]);
    assert.equal(String(byAge[0]._id), String(companyC._id));
    assert.equal(String(byAge[1]._id), String(companyA._id));
    assert.equal(String(byAge[2]._id), String(companyB._id));

    const resumed = orderCompaniesForScheduler([companyA, companyB, companyC], {
      afterCompanyId: companyC._id,
    });
    assert.equal(resumed.length, 2);
    assert.equal(String(resumed[0]._id), String(companyA._id));
  });

  it("bounds concurrent mapper workers", async () => {
    let peak = 0;
    let active = 0;
    const items = [1, 2, 3, 4, 5];
    const out = await mapWithBoundedConcurrency(items, 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return n * 2;
    });
    assert.deepEqual(out, [2, 4, 6, 8, 10]);
    assert.ok(peak <= 2);
  });

  it("companyNeedsSchedulerRun distinguishes completed vs pending in a wave", () => {
    const waveStartedAt = new Date("2026-11-01T00:00:00.000Z");
    assert.equal(
      companyNeedsSchedulerRun(
        { config: { workforceScheduler: { lastRunAt: new Date("2026-10-01") } } },
        waveStartedAt
      ),
      true
    );
    assert.equal(
      companyNeedsSchedulerRun(
        {
          config: {
            workforceScheduler: {
              lastRunAt: new Date("2026-11-02"),
              lastRunSummary: { truncated: false },
            },
          },
        },
        waveStartedAt
      ),
      false
    );
    assert.equal(
      companyNeedsSchedulerRun(
        {
          config: {
            workforceScheduler: {
              lastRunAt: new Date("2026-11-02"),
              lastRunSummary: { truncated: true },
            },
          },
        },
        waveStartedAt
      ),
      true
    );
  });
});

describe("F41 multi-tenant execution", () => {
  it("processes tenants with bounded concurrency and records per-tenant duration", async () => {
    await clearFleetProgress();
    const result = await runSchedulerForAllCompanies({
      force: true,
      mode: "dry-run",
      concurrency: 2,
      budgetMs: 60_000,
      ignoreFleetCursor: true,
      now: new Date(),
    });
    assert.equal(result.skipped, false);
    assert.equal(result.companies, 3);
    assert.ok(result.attempted >= 1);
    assert.equal(result.concurrency, 2);
    assert.ok(result.results.every((r) => typeof r.durationMs === "number"));
    const okSlugs = result.results.filter((r) => !r.skipped).map((r) => r.companySlug);
    assert.ok(okSlugs.length >= 1);
  });

  it("one tenant failure does not block other tenants", async () => {
    await clearFleetProgress();
    const bad = await Company.create({
      companyName: "F41 Broken",
      slug: `f41-broken-${Date.now()}`,
      databaseName: "bad db name!",
      status: COMPANY_STATUSES.ACTIVE,
      schemaVersion: 1,
      migrationVersion: 0,
    });
    try {
      const result = await runSchedulerForAllCompanies({
        force: true,
        mode: "dry-run",
        concurrency: 2,
        budgetMs: 60_000,
        ignoreFleetCursor: true,
        now: new Date(),
      });
      const failed = result.results.find((r) => String(r.companyId) === String(bad._id));
      assert.ok(failed);
      assert.equal(failed.reason, "error");
      const othersOk = result.results.filter(
        (r) => String(r.companyId) !== String(bad._id) && !r.skipped
      );
      assert.ok(othersOk.length >= 1);
    } finally {
      await Company.deleteOne({ _id: bad._id });
    }
  });

  it("truncates on wall-clock budget and persists fleet progress", async () => {
    await clearFleetProgress();
    const waveNow = new Date();
    const result = await runSchedulerForAllCompanies({
      force: true,
      mode: "dry-run",
      concurrency: 1,
      deadline: Date.now() - 1,
      ignoreFleetCursor: true,
      now: waveNow,
    });
    assert.equal(result.truncated, true);
    const fleet = await loadFleetProgress();
    assert.equal(fleet?.truncated, true);
    assert.ok(fleet?.waveStartedAt);
  });

  it("prevents duplicate overlapping company execution via lock", async () => {
    const lock1 = await acquireCompanySchedulerLock(companyA._id, 30_000);
    assert.equal(lock1.acquired, true);
    const blocked = await runCompanyScheduler(companyA, { force: true, mode: "dry-run" });
    assert.equal(blocked.skipped, true);
    assert.equal(blocked.reason, "lock_held");
    await releaseCompanySchedulerLock(companyA._id, lock1.token);

    const again = await runCompanyScheduler(companyA, { force: true, mode: "dry-run" });
    assert.equal(again.skipped, false);
  });

  it("keeps allocation semantics (eligible AUTO proposal unchanged with roster cache)", async () => {
    const task = await modelsA.Task.findOne({ status: TASK_STATUSES.UNASSIGNED }).lean();
    assert.ok(task);
    const roster = await modelsA.Employee.find({ status: EMPLOYEE_STATUSES.ACTIVE })
      .select(ELIGIBLE_EMPLOYEE_SELECT)
      .lean();
    const workload = await calculateWorkloadByEmployee(
      modelsA,
      roster.map((e) => e._id)
    );
    const decision = await decideAssignment(modelsA, task, workload, {
      company: companyA,
      employees: roster,
      onLeaveIds: new Set(),
    });
    assert.equal(decision.path, ASSIGNMENT_PATHS.AUTO);
    assert.equal(String(decision.proposal.employeeId), String(empA._id));
  });

  it("releases per-tenant connection scopes so cache can turn over", async () => {
    await clearFleetProgress();
    await runSchedulerForAllCompanies({
      force: true,
      mode: "dry-run",
      concurrency: 1,
      budgetMs: 60_000,
      maxCompanies: 2,
      ignoreFleetCursor: true,
      now: new Date(),
    });
    const stats = getTenantConnectionStats();
    const retained = (stats.entries || stats.connections || []).filter(
      (e) => Number(e.refCount || 0) > 0
    );
    assert.equal(retained.length, 0);
  });

  it("preserves partial progress across invocations and recovers after interrupt", async () => {
    await clearFleetProgress();
    // Reset telemetry so all three need work in a fresh wave.
    await Company.updateMany(
      { _id: { $in: [companyA._id, companyB._id, companyC._id] } },
      {
        $unset: {
          "config.workforceScheduler.lastRunAt": 1,
          "config.workforceScheduler.lastRunSummary": 1,
        },
      }
    );

    const waveNow = new Date("2026-11-13T06:00:00.000Z");
    const first = await runSchedulerForAllCompanies({
      force: true,
      mode: "dry-run",
      concurrency: 1,
      maxCompanies: 1,
      budgetMs: 60_000,
      ignoreFleetCursor: true,
      now: waveNow,
      waveStartedAt: waveNow,
    });
    assert.equal(first.truncated, true);
    assert.equal(first.attempted, 1);
    const completedId = first.results.find((r) => !r.skipped)?.companyId;
    assert.ok(completedId);

    const fleetAfterFirst = await loadFleetProgress();
    assert.equal(fleetAfterFirst?.truncated, true);

    const second = await runSchedulerForAllCompanies({
      force: true,
      mode: "dry-run",
      concurrency: 1,
      budgetMs: 60_000,
      // Resume via durable fleet (do not ignore cursor).
      now: new Date("2026-11-13T06:00:30.000Z"),
    });
    assert.equal(second.waveResumed, true);
    const secondIds = second.results.map((r) => String(r.companyId));
    // Completed tenant from first wave slice must not be re-attempted unnecessarily.
    assert.equal(secondIds.includes(String(completedId)), false);
    assert.ok(second.attempted >= 1);

    // Third pass should drain remaining pending for the same wave.
    const third = await runSchedulerForAllCompanies({
      force: true,
      mode: "dry-run",
      concurrency: 2,
      budgetMs: 60_000,
      now: new Date("2026-11-13T06:01:00.000Z"),
    });
    if (!third.truncated) {
      const fleetDone = await loadFleetProgress();
      assert.equal(fleetDone?.truncated, false);
    }
  });

  it("safe retry / idempotency: apply does not duplicate assignee on second run", async () => {
    const task = await modelsA.Task.findOne({ title: "F41 unassigned A" });
    assert.ok(task);
    // Ensure UNASSIGNED for apply path.
    await modelsA.Task.updateOne(
      { _id: task._id },
      { $set: { status: TASK_STATUSES.UNASSIGNED, assigneeId: null } }
    );

    const first = await runCompanyScheduler(companyA, {
      force: true,
      mode: "apply",
      skipLock: true,
    });
    assert.equal(first.skipped, false);
    const afterFirst = await modelsA.Task.findById(task._id).lean();
    assert.equal(afterFirst.status, TASK_STATUSES.ASSIGNED);
    assert.equal(String(afterFirst.assigneeId), String(empA._id));

    const second = await runCompanyScheduler(companyA, {
      force: true,
      mode: "apply",
      skipLock: true,
    });
    assert.equal(second.skipped, false);
    const afterSecond = await modelsA.Task.findById(task._id).lean();
    assert.equal(afterSecond.status, TASK_STATUSES.ASSIGNED);
    assert.equal(String(afterSecond.assigneeId), String(empA._id));
    // Queue empty on second run — no duplicate apply.
    assert.equal(second.summary?.autoApplied || 0, 0);
  });

  it("isolates tenants: company B tasks are not visible in company A models", async () => {
    const hrB = await modelsB.User.create({
      email: "hr@f41-globex.test",
      passwordHash: await hashPassword("Password123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      schemaVersion: 1,
    });
    await modelsB.Task.create({
      title: "F41 secret B task",
      description: "tenant B only",
      status: TASK_STATUSES.UNASSIGNED,
      priority: TASK_PRIORITIES.LOW,
      deadline: new Date(Date.now() + 3 * 86_400_000),
      assignedByUserId: hrB._id,
    });
    const inA = await modelsA.Task.find({ title: "F41 secret B task" }).lean();
    assert.equal(inA.length, 0);
    const inB = await modelsB.Task.find({ title: "F41 secret B task" }).lean();
    assert.equal(inB.length, 1);
  });
});

describe("F41 cron authentication", () => {
  it("rejects unauthenticated cron and accepts Bearer CRON_SECRET", async () => {
    const denied = await request(app).post("/api/workforce-scheduler/run");
    assert.equal(denied.status, 401);

    const ok = await request(app)
      .post("/api/workforce-scheduler/run")
      .query({ dryRun: "true", concurrency: 1, budgetMs: 20000 })
      .set("Authorization", "Bearer f41-workforce-cron-secret");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
  });

  it("HR company run still requires auth cookie (not cron secret alone)", async () => {
    const denied = await request(app).post("/api/workforce-scheduler/company/run");
    assert.ok(denied.status === 401 || denied.status === 403);

    const ok = await request(app)
      .post("/api/workforce-scheduler/company/run")
      .set("Cookie", hrCookieA)
      .query({ dryRun: "true" });
    assert.ok(ok.status === 200 || ok.status === 503);
  });
});
