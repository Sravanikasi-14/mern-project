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
  beginOrResumeSchedulerWave,
  clearFleetProgress,
  companyNeedsSchedulerRun,
  contiguousCompletedCursor,
  getFleetStateModel,
  loadFleetProgress,
  saveFleetProgress,
} from "../services/workforceScheduler/fleetProgress.js";
import {
  buildContinuationRequest,
  continueSchedulerWaveViaHttp,
  normalizeChainDepth,
  remainingHopBudgetMs,
  runSchedulerWithAutoContinue,
  shouldAutoContinue,
} from "../services/workforceScheduler/autoContinue.js";
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
process.env.WORKFORCE_SCHEDULER_AUTO_CONTINUE = "false";
process.env.WORKFORCE_SCHEDULER_MAX_CHAIN_DEPTH = "3";

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
    assert.equal(denied.body.code, "CRON_UNAUTHORIZED");

    const wrong = await request(app)
      .post("/api/workforce-scheduler/run")
      .set("Authorization", "Bearer totally-wrong-secret");
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.code, "CRON_UNAUTHORIZED");
    assert.equal(JSON.stringify(wrong.body).includes("f41-workforce-cron-secret"), false);

    const ok = await request(app)
      .post("/api/workforce-scheduler/run")
      .query({ dryRun: "true", concurrency: 1, budgetMs: 20000 })
      .set("Authorization", "Bearer f41-workforce-cron-secret");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    // Public summary only — no per-tenant decision / employee payloads.
    assert.equal(ok.body.results, undefined);
    assert.equal(typeof ok.body.attempted, "number");
  });

  it("GET cron run accepts the same Bearer secret (Vercel Cron compatibility)", async () => {
    const denied = await request(app).get("/api/workforce-scheduler/run");
    assert.equal(denied.status, 401);

    const ok = await request(app)
      .get("/api/workforce-scheduler/run")
      .query({ dryRun: "true", concurrency: 1, budgetMs: 15000, maxCompanies: 1 })
      .set("Authorization", "Bearer f41-workforce-cron-secret");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    assert.equal(ok.body.results, undefined);
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

describe("Batch C NEW-S1 auto-continue", () => {
  it("shouldAutoContinue respects flag, truncation, and chain depth", () => {
    assert.equal(shouldAutoContinue({ truncated: true, chainDepth: 0, autoContinue: false }), false);
    assert.equal(shouldAutoContinue({ truncated: false, chainDepth: 0, autoContinue: true }), false);
    assert.equal(shouldAutoContinue({ truncated: true, chainDepth: 0, autoContinue: true, maxChainDepth: 3 }), true);
    assert.equal(shouldAutoContinue({ truncated: true, chainDepth: 3, autoContinue: true, maxChainDepth: 3 }), false);
    assert.equal(normalizeChainDepth("2"), 2);
    assert.equal(normalizeChainDepth(-1), 0);
  });

  it("remainingHopBudgetMs enforces min hop and chain deadline", () => {
    const now = 1_000_000;
    assert.equal(
      remainingHopBudgetMs({
        chainDeadlineMs: now + 20_000,
        nowMs: now,
        configuredBudgetMs: 50_000,
        minHopBudgetMs: 5_000,
        headroomMs: 1_000,
      }),
      19_000
    );
    assert.equal(
      remainingHopBudgetMs({
        chainDeadlineMs: now + 4_000,
        nowMs: now,
        configuredBudgetMs: 50_000,
        minHopBudgetMs: 5_000,
        headroomMs: 1_000,
      }),
      0
    );
  });

  it("buildContinuationRequest requires CRON_SECRET and preserves mode/cursor/depth", () => {
    const built = buildContinuationRequest({
      baseUrl: "https://example.test",
      afterCompanyId: "abc123",
      waveStartedAt: new Date("2026-11-17T02:00:00.000Z"),
      chainDepth: 2,
      mode: "dry-run",
      budgetMs: 15000,
      cronSecret: "f41-workforce-cron-secret",
    });
    assert.equal(built.ok, true);
    assert.equal(built.headers.Authorization, "Bearer f41-workforce-cron-secret");
    assert.equal(built.body.afterCompanyId, "abc123");
    assert.equal(built.body.chainDepth, 2);
    assert.equal(built.body.dryRun, "true");
    assert.equal(built.body.budgetMs, 15000);

    const noSecret = buildContinuationRequest({
      baseUrl: "https://example.test",
      cronSecret: "",
    });
    assert.equal(noSecret.ok, false);
    assert.equal(noSecret.reason, "missing_cron_secret");
  });

  it("continueSchedulerWaveViaHttp handles timeout/failure without throwing", async () => {
    const timedOut = await continueSchedulerWaveViaHttp(
      {
        baseUrl: "https://example.test",
        cronSecret: "f41-workforce-cron-secret",
        timeoutMs: 20,
      },
      {
        fetchImpl: () =>
          new Promise((_, reject) => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          }),
      }
    );
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.reason, "timeout");

    const httpErr = await continueSchedulerWaveViaHttp(
      {
        baseUrl: "https://example.test",
        cronSecret: "f41-workforce-cron-secret",
      },
      {
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          json: async () => ({ success: false }),
        }),
      }
    );
    assert.equal(httpErr.ok, false);
    assert.equal(httpErr.reason, "http_error");
    assert.equal(httpErr.status, 401);
  });

  it("feature flag disabled does not auto-continue a truncated wave", async () => {
    await clearFleetProgress();
    await Company.updateMany(
      { _id: { $in: [companyA._id, companyB._id, companyC._id] } },
      {
        $unset: {
          "config.workforceScheduler.lastRunAt": 1,
          "config.workforceScheduler.lastRunSummary": 1,
        },
      }
    );
    const waveNow = new Date("2026-11-17T08:00:00.000Z");
    const result = await runSchedulerWithAutoContinue({
      force: true,
      mode: "dry-run",
      concurrency: 1,
      maxCompanies: 1,
      budgetMs: 60_000,
      chainBudgetMs: 60_000,
      ignoreFleetCursor: true,
      now: waveNow,
      waveStartedAt: waveNow,
      autoContinue: false,
      maxChainDepth: 3,
    });
    assert.equal(result.truncated, true);
    assert.equal(result.hops, 1);
    assert.equal(result.autoContinued, false);
    assert.equal(result.continuationStoppedReason, "auto_continue_disabled");
  });

  it("truncated wave continuation preserves cursor, mode, and processes more companies", async () => {
    await clearFleetProgress();
    await Company.updateMany(
      { _id: { $in: [companyA._id, companyB._id, companyC._id] } },
      {
        $unset: {
          "config.workforceScheduler.lastRunAt": 1,
          "config.workforceScheduler.lastRunSummary": 1,
        },
      }
    );
    const waveNow = new Date("2026-11-17T08:10:00.000Z");
    const result = await runSchedulerWithAutoContinue({
      force: true,
      mode: "dry-run",
      concurrency: 1,
      maxCompanies: 1,
      budgetMs: 60_000,
      chainBudgetMs: 120_000,
      minHopBudgetMs: 1_000,
      ignoreFleetCursor: true,
      now: waveNow,
      waveStartedAt: waveNow,
      autoContinue: true,
      maxChainDepth: 3,
    });
    assert.ok(result.hops >= 2);
    assert.equal(result.autoContinued, true);
    assert.ok(result.attempted >= 2);
    assert.ok(result.results.every((r) => r.summary?.mode === "dry-run" || r.skipped));
    // Same wave across hops
    assert.equal(new Date(result.waveStartedAt).toISOString(), waveNow.toISOString());
  });

  it("chain depth limit stops continuation", async () => {
    await clearFleetProgress();
    await Company.updateMany(
      { _id: { $in: [companyA._id, companyB._id, companyC._id] } },
      {
        $unset: {
          "config.workforceScheduler.lastRunAt": 1,
          "config.workforceScheduler.lastRunSummary": 1,
        },
      }
    );
    const waveNow = new Date("2026-11-17T08:20:00.000Z");
    const result = await runSchedulerWithAutoContinue({
      force: true,
      mode: "dry-run",
      concurrency: 1,
      maxCompanies: 1,
      budgetMs: 60_000,
      chainBudgetMs: 180_000,
      minHopBudgetMs: 1_000,
      ignoreFleetCursor: true,
      now: waveNow,
      waveStartedAt: waveNow,
      autoContinue: true,
      maxChainDepth: 1,
    });
    // Initial hop + at most 1 continuation => hops <= 2
    assert.ok(result.hops <= 2);
    assert.equal(result.chainDepth, 1);
    if (result.truncated) {
      assert.equal(result.continuationStoppedReason, "max_chain_depth");
    }
  });

  it("cron continuation still requires Bearer auth (chainDepth query alone is insufficient)", async () => {
    const denied = await request(app)
      .post("/api/workforce-scheduler/run")
      .query({ chainDepth: 1, afterCompanyId: String(companyA._id), dryRun: "true" });
    assert.equal(denied.status, 401);

    const ok = await request(app)
      .post("/api/workforce-scheduler/run")
      .set("Authorization", "Bearer f41-workforce-cron-secret")
      .query({
        dryRun: "true",
        chainDepth: 1,
        concurrency: 1,
        budgetMs: 15000,
        maxCompanies: 1,
      });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    assert.equal(ok.body.mode, "dry-run");
    assert.equal(ok.body.results, undefined);
  });

  it("apply mode is preserved across auto-continue hops", async () => {
    await clearFleetProgress();
    await Company.updateMany(
      { _id: { $in: [companyA._id, companyB._id, companyC._id] } },
      {
        $unset: {
          "config.workforceScheduler.lastRunAt": 1,
          "config.workforceScheduler.lastRunSummary": 1,
        },
      }
    );
    // Ensure a fresh UNASSIGNED task for apply path idempotency later.
    await modelsA.Task.updateMany(
      { title: "F41 unassigned A" },
      { $set: { status: TASK_STATUSES.UNASSIGNED, assigneeId: null } }
    );
    const waveNow = new Date("2026-11-17T08:30:00.000Z");
    const result = await runSchedulerWithAutoContinue({
      force: true,
      mode: "apply",
      concurrency: 1,
      maxCompanies: 1,
      budgetMs: 60_000,
      chainBudgetMs: 120_000,
      minHopBudgetMs: 1_000,
      ignoreFleetCursor: true,
      now: waveNow,
      waveStartedAt: waveNow,
      autoContinue: true,
      maxChainDepth: 2,
    });
    const modes = result.results
      .filter((r) => r.summary?.mode)
      .map((r) => r.summary.mode);
    assert.ok(modes.length >= 1);
    assert.ok(modes.every((m) => m === "apply"));
  });
});

describe("Batch C NEW-S3 CAS wave start", () => {
  it("concurrent beginOrResumeSchedulerWave converges on one waveStartedAt", async () => {
    await clearFleetProgress();
    const now = new Date("2026-11-17T09:00:00.000Z");
    const [a, b, c] = await Promise.all([
      beginOrResumeSchedulerWave({ now }),
      beginOrResumeSchedulerWave({ now }),
      beginOrResumeSchedulerWave({ now }),
    ]);
    const started = [a, b, c].map((w) => new Date(w.waveStartedAt).getTime());
    assert.equal(new Set(started).size, 1);
    const fleet = await loadFleetProgress();
    assert.equal(new Date(fleet.waveStartedAt).getTime(), started[0]);
    // At most one starter; others resume (or all resume if create race resolved).
    const starters = [a, b, c].filter((w) => !w.resumed);
    assert.ok(starters.length <= 1);
  });

  it("resume preserves afterCompanyId and does not reset active wave progress", async () => {
    await clearFleetProgress();
    const waveStartedAt = new Date("2026-11-17T09:05:00.000Z");
    await saveFleetProgress({
      waveStartedAt,
      truncated: true,
      afterCompanyId: String(companyB._id),
      now: new Date("2026-11-17T09:05:30.000Z"),
    });
    const resumed = await beginOrResumeSchedulerWave({
      now: new Date("2026-11-17T09:06:00.000Z"),
    });
    assert.equal(resumed.resumed, true);
    assert.equal(String(resumed.afterCompanyId), String(companyB._id));
    assert.equal(new Date(resumed.waveStartedAt).toISOString(), waveStartedAt.toISOString());
    const fleet = await loadFleetProgress();
    assert.equal(String(fleet.afterCompanyId), String(companyB._id));
  });
});

describe("Batch C NEW-S2 fleet durability", () => {
  it("contiguousCompletedCursor never skips gaps", () => {
    const ordered = [{ _id: "1" }, { _id: "2" }, { _id: "3" }];
    assert.equal(contiguousCompletedCursor(ordered, new Set(["1", "3"])), "1");
    assert.equal(contiguousCompletedCursor(ordered, new Set(["1", "2"]), "0"), "2");
    assert.equal(contiguousCompletedCursor(ordered, new Set()), null);
  });

  it("checkpoints persist progress before final write; interrupt cannot mark complete", async () => {
    await clearFleetProgress();
    await Company.updateMany(
      { _id: { $in: [companyA._id, companyB._id, companyC._id] } },
      {
        $unset: {
          "config.workforceScheduler.lastRunAt": 1,
          "config.workforceScheduler.lastRunSummary": 1,
        },
      }
    );
    const waveNow = new Date("2026-11-17T10:00:00.000Z");
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
    const fleetAfter = await loadFleetProgress();
    assert.equal(fleetAfter?.truncated, true);
    assert.ok(fleetAfter?.afterCompanyId || fleetAfter?.waveStartedAt);
    // Simulate process death before a mistaken clear: fleet must stay truncated.
    assert.notEqual(fleetAfter?.truncated, false);

    // Mid-wave save with truncated:true must not be cleared by a partial re-read path.
    await saveFleetProgress({
      waveStartedAt: waveNow,
      truncated: true,
      afterCompanyId: first.nextAfterCompanyId,
      now: new Date(),
    });
    const Fleet = getFleetStateModel();
    const raw = await Fleet.findById("workforce-scheduler-fleet").lean();
    assert.equal(raw.truncated, true);
  });

  it("no duplicate employee assignments under apply + lock contention", async () => {
    const task = await modelsA.Task.findOneAndUpdate(
      { title: "F41 unassigned A" },
      { $set: { status: TASK_STATUSES.UNASSIGNED, assigneeId: null } },
      { returnDocument: "after" }
    );
    assert.ok(task);

    const [r1, r2] = await Promise.all([
      runCompanyScheduler(companyA, { force: true, mode: "apply" }),
      runCompanyScheduler(companyA, { force: true, mode: "apply" }),
    ]);
    const outcomes = [r1, r2];
    const applied = outcomes.filter((r) => !r.skipped);
    const locked = outcomes.filter((r) => r.reason === "lock_held");
    assert.ok(applied.length >= 1);
    assert.ok(locked.length + applied.length === 2);

    const after = await modelsA.Task.findById(task._id).lean();
    assert.equal(after.status, TASK_STATUSES.ASSIGNED);
    assert.equal(String(after.assigneeId), String(empA._id));
  });
});
