process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "dispatch-test-jwt-secret-32chars!!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.CRON_SECRET = "dispatch-cron-test-secret-xxxx";
process.env.WORKFORCE_SCHEDULER_ENABLED = "false";
process.env.WORKFORCE_SCHEDULER_MODE = "dry-run";
process.env.SCHEDULER_DISPATCH_ENABLED = "true";
process.env.SCHEDULER_DISPATCH_BUDGET_MS = "20000";

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import {
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_PRIORITIES,
} from "../models/Announcement.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "../models/Task.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import {
  JOB_KEYS,
  SCHEDULE_ACTIONS,
  DISPATCH_MAX_BUDGET_MS,
  DISPATCH_RETRY_MS,
  DISPATCH_LOCK_ID,
  acquireDispatchLock,
  renewDispatchLock,
  releaseDispatchLock,
  ensureDispatchJobRegistry,
  runSchedulerDispatch,
  forceJobDue,
  computeNextDailyRunAt,
  zonedCivilDateTimeToUtc,
  isJobDue,
  getDispatchJobModel,
  getDispatchLockModel,
  getDispatchHistoryModel,
  toPublicDispatchSummary,
  sanitizeJobSummary,
  classifyJobScheduleAction,
  clampDispatcherBudgetMs,
  countDueAnnouncements,
  runAnnouncementsDetectAdapter,
} from "../services/schedulerDispatch/index.js";

/** H4 — unique isolated Mongo dbPath per process/run (no shared fixed path). */
const RUN_ID = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const ISOLATED_DB_PATH = path.join(
  process.env.TEMP || process.env.TMP || os.tmpdir(),
  "hrms-mongo",
  `scheduler-dispatch-${RUN_ID}`
);
fs.mkdirSync(ISOLATED_DB_PATH, { recursive: true });

let mongo;
let app;
let company;
let models;

describe("schedulerDispatch schedule helpers", () => {
  it("converts IST civil datetime to the expected UTC instant", () => {
    const utc = zonedCivilDateTimeToUtc("2026-03-20", 7, 30, "Asia/Kolkata");
    assert.ok(utc);
    assert.equal(utc.toISOString(), "2026-03-20T02:00:00.000Z");

    const utcAnn = zonedCivilDateTimeToUtc("2026-03-20", 8, 30, "Asia/Kolkata");
    assert.equal(utcAnn.toISOString(), "2026-03-20T03:00:00.000Z");
  });

  it("computes next daily run in Asia/Kolkata correctly", () => {
    const before = new Date("2026-03-20T01:00:00.000Z"); // 06:30 IST
    const nextBefore = computeNextDailyRunAt(before, {
      timezone: "Asia/Kolkata",
      hour: 7,
      minute: 30,
    });
    assert.equal(nextBefore.toISOString(), "2026-03-20T02:00:00.000Z");

    const after = new Date("2026-03-20T02:30:00.000Z"); // 08:00 IST
    const nextAfter = computeNextDailyRunAt(after, {
      timezone: "Asia/Kolkata",
      hour: 7,
      minute: 30,
    });
    assert.equal(nextAfter.toISOString(), "2026-03-21T02:00:00.000Z");
  });

  it("isJobDue respects nextRunAt and enabled", () => {
    const now = new Date("2026-03-20T02:00:00.000Z");
    assert.equal(isJobDue({ enabled: false, nextRunAt: new Date(0) }, now), false);
    assert.equal(isJobDue({ enabled: true, nextRunAt: new Date("2026-03-20T02:00:00.000Z") }, now), true);
    assert.equal(isJobDue({ enabled: true, nextRunAt: new Date("2026-03-20T02:00:01.000Z") }, now), false);
  });

  it("classifyJobScheduleAction maps outcomes correctly", () => {
    assert.equal(
      classifyJobScheduleAction({ status: "ok" }),
      SCHEDULE_ACTIONS.ADVANCE_DAILY
    );
    assert.equal(
      classifyJobScheduleAction({ status: "error", reason: "boom" }),
      SCHEDULE_ACTIONS.RETRY_15M
    );
    assert.equal(
      classifyJobScheduleAction({
        status: "ok",
        summary: { truncated: true },
      }),
      SCHEDULE_ACTIONS.RETRY_15M
    );
    assert.equal(
      classifyJobScheduleAction({
        status: "skipped",
        reason: "workforce_scheduler_disabled",
      }),
      SCHEDULE_ACTIONS.RETRY_15M
    );
    assert.equal(
      classifyJobScheduleAction({ status: "skipped", reason: "insufficient_budget" }),
      SCHEDULE_ACTIONS.RETRY_15M
    );
  });

  it("clampDispatcherBudgetMs enforces 22s ceiling and rejects invalid inputs", () => {
    assert.equal(clampDispatcherBudgetMs(999_999_999), DISPATCH_MAX_BUDGET_MS);
    assert.equal(clampDispatcherBudgetMs("50000"), DISPATCH_MAX_BUDGET_MS);
    assert.equal(clampDispatcherBudgetMs(10_000), 10_000);
    assert.equal(clampDispatcherBudgetMs(-1), clampDispatcherBudgetMs(undefined));
    assert.equal(clampDispatcherBudgetMs("nope"), clampDispatcherBudgetMs(undefined));
    assert.equal(clampDispatcherBudgetMs(null), clampDispatcherBudgetMs(undefined));
  });

  it("strict public summary allowlists nested fields and strips secrets", () => {
    const publicBody = toPublicDispatchSummary({
      jobsDue: 1,
      jobsAttempted: 1,
      jobsSucceeded: 1,
      secretRoot: "leak",
      jobs: [
        {
          jobKey: "workforce-scheduler",
          name: "Workforce Scheduler",
          status: "ok",
          executionMode: "dry-run",
          durationMs: 10,
          scheduleAction: SCHEDULE_ACTIONS.ADVANCE_DAILY,
          summary: {
            mode: "dry-run",
            attempted: 1,
            truncated: false,
            decisions: [{ employeeId: "emp-secret" }],
            nestedEvil: { password: "x" },
          },
          companyId: "should-not-leak",
          decisions: [{ employeeId: "emp-secret" }],
        },
      ],
      tenantConnectionsOpened: 0,
    });
    assert.equal(publicBody.success, true);
    assert.equal(publicBody.secretRoot, undefined);
    assert.equal(publicBody.jobs[0].jobKey, "workforce-scheduler");
    assert.equal(publicBody.jobs[0].companyId, undefined);
    assert.equal(publicBody.jobs[0].summary.mode, "dry-run");
    assert.equal(publicBody.jobs[0].summary.decisions, undefined);
    assert.equal(publicBody.jobs[0].summary.nestedEvil, undefined);
    assert.equal(JSON.stringify(publicBody).includes("emp-secret"), false);
    assert.equal(JSON.stringify(publicBody).includes("should-not-leak"), false);

    const sanitized = sanitizeJobSummary({
      mode: "detect-only",
      dueCount: 3,
      tenants: [{ id: "t1" }],
      published: 0,
    });
    assert.equal(sanitized.dueCount, 3);
    assert.equal(sanitized.tenants, undefined);
  });
});

describe("schedulerDispatch HTTP + service", () => {
  before(async () => {
    mongo = await MongoMemoryServer.create({
      instance: { dbPath: ISOLATED_DB_PATH },
    });
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    const slug = `dispatch-co-${RUN_ID}`.slice(0, 48);
    company = await Company.create({
      companyName: "Dispatch Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata" },
    });
    models = await getCompanyModels(company);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
    try {
      fs.rmSync(ISOLATED_DB_PATH, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  beforeEach(async () => {
    process.env.SCHEDULER_DISPATCH_ENABLED = "true";
    process.env.WORKFORCE_SCHEDULER_ENABLED = "false";
    await getDispatchJobModel().deleteMany({});
    await getDispatchLockModel().deleteMany({});
    await getDispatchHistoryModel().deleteMany({});
    await models.Announcement.deleteMany({});
    await ensureDispatchJobRegistry(new Date("2026-03-20T00:00:00.000Z"), {
      updateMetadata: false,
    });
  });

  it("rejects unauthenticated dispatch and accepts Bearer CRON_SECRET", async () => {
    const denied = await request(app).post("/api/scheduler/dispatch");
    assert.equal(denied.status, 401);
    assert.equal(denied.body.code, "CRON_UNAUTHORIZED");

    const ok = await request(app)
      .post("/api/scheduler/dispatch")
      .set("Authorization", "Bearer dispatch-cron-test-secret-xxxx");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    assert.equal(ok.body.results, undefined);
  });

  it("returns dispatcher_disabled when feature flag is off", async () => {
    process.env.SCHEDULER_DISPATCH_ENABLED = "false";
    const res = await request(app)
      .post("/api/scheduler/dispatch")
      .set("Authorization", "Bearer dispatch-cron-test-secret-xxxx");
    assert.equal(res.status, 200);
    assert.equal(res.body.skipped, true);
    assert.equal(res.body.reason, "dispatcher_disabled");
    assert.equal(res.body.tenantConnectionsOpened, 0);
  });

  it("HTTP clamps extremely large and invalid budgetMs to server maximum", async () => {
    const huge = await request(app)
      .post("/api/scheduler/dispatch")
      .query({ budgetMs: "999999999" })
      .set("Authorization", "Bearer dispatch-cron-test-secret-xxxx");
    assert.equal(huge.status, 200);
    assert.equal(huge.body.budgetMs, DISPATCH_MAX_BUDGET_MS);

    const invalid = await request(app)
      .post("/api/scheduler/dispatch")
      .query({ budgetMs: "not-a-number" })
      .set("Authorization", "Bearer dispatch-cron-test-secret-xxxx");
    assert.equal(invalid.status, 200);
    assert.ok(invalid.body.budgetMs <= DISPATCH_MAX_BUDGET_MS);
    assert.ok(invalid.body.budgetMs > 0);
  });

  it("idle tick when no jobs due opens zero tenant connections and skips registry metadata writes", async () => {
    const Job = getDispatchJobModel();
    const future = new Date("2099-01-01T00:00:00.000Z");
    await Job.updateMany({}, { $set: { nextRunAt: future, enabled: true, updatedAt: new Date("2020-01-01T00:00:00.000Z") } });
    const before = await Job.find({}).lean();
    const beforeUpdated = Object.fromEntries(before.map((j) => [j._id, j.updatedAt?.getTime()]));

    const result = await runSchedulerDispatch({
      now: new Date("2026-03-20T04:00:00.000Z"),
      budgetMs: 20000,
      force: true,
    });
    assert.equal(result.reason, "no_jobs_due");
    assert.equal(result.jobsDue, 0);
    assert.equal(result.tenantConnectionsOpened, 0);

    const after = await Job.find({}).lean();
    for (const j of after) {
      assert.equal(j.updatedAt?.getTime(), beforeUpdated[j._id]);
      assert.equal(j.nextRunAt.getTime(), future.getTime());
    }
  });

  it("advances daily schedule on successful adapter completion", async () => {
    const now = new Date("2026-03-20T02:00:00.000Z");
    await forceJobDue(JOB_KEYS.WORKFORCE, now);
    await getDispatchJobModel().updateOne(
      { _id: JOB_KEYS.ANNOUNCEMENTS },
      { $set: { nextRunAt: new Date("2099-01-01T00:00:00.000Z") } }
    );

    const result = await runSchedulerDispatch({
      now,
      budgetMs: 20000,
      force: true,
      adapters: {
        [JOB_KEYS.WORKFORCE]: async () => ({
          status: "ok",
          executionMode: "dry-run",
          durationMs: 5,
          tenantConnectionsOpened: 0,
          summary: { mode: "dry-run", truncated: false, attempted: 1 },
        }),
      },
    });

    const wf = result.jobs.find((j) => j.jobKey === JOB_KEYS.WORKFORCE);
    assert.equal(wf.status, "ok");
    assert.equal(wf.scheduleAction, SCHEDULE_ACTIONS.ADVANCE_DAILY);

    const job = await getDispatchJobModel().findById(JOB_KEYS.WORKFORCE).lean();
    const expected = computeNextDailyRunAt(now, {
      timezone: "Asia/Kolkata",
      hour: 7,
      minute: 30,
    }, { inclusive: false });
    // After run, finished≈now; next should be next calendar slot (tomorrow 07:30 IST)
    assert.ok(job.nextRunAt.getTime() >= expected.getTime());
    assert.equal(job.nextRunAt.toISOString(), "2026-03-21T02:00:00.000Z");
  });

  it("retries after 15 minutes on adapter error", async () => {
    const now = new Date("2026-03-20T02:00:00.000Z");
    await forceJobDue(JOB_KEYS.WORKFORCE, now);
    await getDispatchJobModel().updateOne(
      { _id: JOB_KEYS.ANNOUNCEMENTS },
      { $set: { nextRunAt: new Date("2099-01-01T00:00:00.000Z") } }
    );

    const result = await runSchedulerDispatch({
      now,
      budgetMs: 20000,
      force: true,
      adapters: {
        [JOB_KEYS.WORKFORCE]: async () => ({
          status: "error",
          executionMode: "dry-run",
          reason: "simulated_adapter_failure",
          durationMs: 3,
          tenantConnectionsOpened: 0,
          summary: { mode: "dry-run", reason: "simulated_adapter_failure" },
        }),
      },
    });

    const wf = result.jobs.find((j) => j.jobKey === JOB_KEYS.WORKFORCE);
    assert.equal(wf.status, "error");
    assert.equal(wf.scheduleAction, SCHEDULE_ACTIONS.RETRY_15M);

    const job = await getDispatchJobModel().findById(JOB_KEYS.WORKFORCE).lean();
    const delta = job.nextRunAt.getTime() - now.getTime();
    assert.ok(delta >= DISPATCH_RETRY_MS - 5_000);
    assert.ok(delta <= DISPATCH_RETRY_MS + 60_000);
  });

  it("retries after 15 minutes on workforce truncation", async () => {
    const now = new Date("2026-03-20T02:00:00.000Z");
    await forceJobDue(JOB_KEYS.WORKFORCE, now);
    await getDispatchJobModel().updateOne(
      { _id: JOB_KEYS.ANNOUNCEMENTS },
      { $set: { nextRunAt: new Date("2099-01-01T00:00:00.000Z") } }
    );

    const result = await runSchedulerDispatch({
      now,
      budgetMs: 20000,
      force: true,
      adapters: {
        [JOB_KEYS.WORKFORCE]: async () => ({
          status: "ok",
          executionMode: "dry-run",
          reason: "budget_exhausted",
          truncated: true,
          durationMs: 8,
          tenantConnectionsOpened: 0,
          summary: { mode: "dry-run", truncated: true, pendingRemaining: 4 },
        }),
      },
    });

    const wf = result.jobs.find((j) => j.jobKey === JOB_KEYS.WORKFORCE);
    assert.equal(wf.scheduleAction, SCHEDULE_ACTIONS.RETRY_15M);
    assert.equal(result.truncated, true);

    const job = await getDispatchJobModel().findById(JOB_KEYS.WORKFORCE).lean();
    assert.ok(job.nextRunAt.getTime() - now.getTime() >= DISPATCH_RETRY_MS - 5_000);
  });

  it("retries eligibility after 15 minutes when workforce scheduler is disabled", async () => {
    process.env.WORKFORCE_SCHEDULER_ENABLED = "false";
    const now = new Date("2026-03-20T02:00:00.000Z");
    await forceJobDue(JOB_KEYS.WORKFORCE, now);
    await getDispatchJobModel().updateOne(
      { _id: JOB_KEYS.ANNOUNCEMENTS },
      { $set: { nextRunAt: new Date("2099-01-01T00:00:00.000Z") } }
    );

    const result = await runSchedulerDispatch({
      now,
      budgetMs: 20000,
      force: true,
    });

    const wf = result.jobs.find((j) => j.jobKey === JOB_KEYS.WORKFORCE);
    assert.ok(wf);
    assert.equal(wf.reason, "workforce_scheduler_disabled");
    assert.equal(wf.scheduleAction, SCHEDULE_ACTIONS.RETRY_15M);

    const job = await getDispatchJobModel().findById(JOB_KEYS.WORKFORCE).lean();
    assert.ok(job.nextRunAt.getTime() - now.getTime() >= DISPATCH_RETRY_MS - 5_000);
  });

  it("preserves due state when budget exhausted before execution", async () => {
    await forceJobDue(JOB_KEYS.WORKFORCE, new Date("2026-03-20T02:00:00.000Z"));
    await forceJobDue(JOB_KEYS.ANNOUNCEMENTS, new Date("2026-03-20T02:00:00.000Z"));
    const before = await getDispatchJobModel().find({}).lean();
    const beforeMap = Object.fromEntries(before.map((j) => [j._id, j.nextRunAt.getTime()]));

    const result = await runSchedulerDispatch({
      now: new Date("2026-03-20T02:00:00.000Z"),
      budgetMs: 1,
      force: true,
    });
    assert.equal(result.truncated || result.jobsSkipped > 0, true);
    assert.ok(result.jobs.every((j) => j.reason === "budget_exhausted"));
    assert.ok(result.jobs.every((j) => j.scheduleAction === SCHEDULE_ACTIONS.PRESERVE));

    const after = await getDispatchJobModel().find({}).lean();
    for (const j of after) {
      assert.equal(j.nextRunAt.getTime(), beforeMap[j._id]);
    }
  });

  it("does not modify job schedule on lock contention", async () => {
    const now = new Date("2026-03-20T02:00:00.000Z");
    await forceJobDue(JOB_KEYS.WORKFORCE, now);
    const before = await getDispatchJobModel().findById(JOB_KEYS.WORKFORCE).lean();

    // Lock uses wall-clock time (same as dispatchService acquire).
    const lock = await acquireDispatchLock({
      now: new Date(),
      ttlMs: 120_000,
      holder: "test-holder",
    });
    assert.equal(lock.acquired, true);

    const res = await runSchedulerDispatch({
      now,
      budgetMs: 5000,
      force: true,
    });
    assert.equal(res.reason, "lock_held");
    assert.equal(res.lockAcquired, false);

    const after = await getDispatchJobModel().findById(JOB_KEYS.WORKFORCE).lean();
    assert.equal(after.nextRunAt.getTime(), before.nextRunAt.getTime());

    await releaseDispatchLock(lock.token);
  });

  it("concurrent registry initialization preserves a single enabled/nextRunAt seed", async () => {
    await getDispatchJobModel().deleteMany({});
    const seedAt = new Date("2026-03-20T00:00:00.000Z");
    await Promise.all([
      ensureDispatchJobRegistry(seedAt, { updateMetadata: false }),
      ensureDispatchJobRegistry(seedAt, { updateMetadata: false }),
      ensureDispatchJobRegistry(seedAt, { updateMetadata: false }),
      ensureDispatchJobRegistry(seedAt, { updateMetadata: false }),
    ]);
    const jobs = await getDispatchJobModel().find({}).lean();
    assert.equal(jobs.length, 2);
    const ids = jobs.map((j) => j._id).sort();
    assert.deepEqual(ids, [JOB_KEYS.ANNOUNCEMENTS, JOB_KEYS.WORKFORCE].sort());

    // Re-run must not clobber nextRunAt / enabled
    const wf = jobs.find((j) => j._id === JOB_KEYS.WORKFORCE);
    const customNext = new Date("2026-04-01T02:00:00.000Z");
    await getDispatchJobModel().updateOne(
      { _id: JOB_KEYS.WORKFORCE },
      { $set: { nextRunAt: customNext, enabled: false } }
    );
    await Promise.all([
      ensureDispatchJobRegistry(new Date(), { updateMetadata: false }),
      ensureDispatchJobRegistry(new Date(), { updateMetadata: true }),
    ]);
    const again = await getDispatchJobModel().findById(JOB_KEYS.WORKFORCE).lean();
    assert.equal(again.enabled, false);
    assert.equal(again.nextRunAt.getTime(), customNext.getTime());
    void wf;
  });

  it("concurrent lock acquisition allows only one holder", async () => {
    const now = new Date("2026-03-20T04:00:00.000Z");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        acquireDispatchLock({ now, ttlMs: 60_000, holder: "race" })
      )
    );
    const winners = results.filter((r) => r.acquired);
    assert.equal(winners.length, 1);
    assert.ok(winners[0].token);

    const losers = results.filter((r) => !r.acquired);
    assert.equal(losers.length, 7);

    await releaseDispatchLock(winners[0].token);
  });

  it("lock renewal requires ownership token; stale holders cannot renew or release", async () => {
    const lock = await acquireDispatchLock({
      now: new Date("2026-03-20T04:00:00.000Z"),
      ttlMs: 30_000,
      holder: "owner",
    });
    assert.equal(lock.acquired, true);

    const staleRenew = await renewDispatchLock("stale-token", {
      ttlMs: 30_000,
      now: new Date("2026-03-20T04:00:05.000Z"),
    });
    assert.equal(staleRenew.renewed, false);

    const okRenew = await renewDispatchLock(lock.token, {
      ttlMs: 45_000,
      now: new Date("2026-03-20T04:00:05.000Z"),
    });
    assert.equal(okRenew.renewed, true);
    assert.ok(okRenew.lockUntil.getTime() > Date.parse("2026-03-20T04:00:05.000Z"));

    const staleRelease = await releaseDispatchLock("stale-token");
    assert.equal(staleRelease.released, false);

    const stillHeld = await getDispatchLockModel().findById(DISPATCH_LOCK_ID).lean();
    assert.equal(stillHeld.lockToken, lock.token);

    const released = await releaseDispatchLock(lock.token);
    assert.equal(released.released, true);
  });

  it("recovers lock after TTL expiry", async () => {
    const Lock = getDispatchLockModel();
    await Lock.create({
      _id: DISPATCH_LOCK_ID,
      lockToken: "stale-token",
      lockUntil: new Date("2026-03-20T03:00:00.000Z"),
      holder: "dead",
      updatedAt: new Date("2026-03-20T02:59:00.000Z"),
    });
    const acquired = await acquireDispatchLock({
      now: new Date("2026-03-20T04:00:00.000Z"),
      ttlMs: 30_000,
    });
    assert.equal(acquired.acquired, true);
    await releaseDispatchLock(acquired.token);
  });

  it("history persistence failure does not hide adapter outcome or reverse schedule", async () => {
    // After 08:30 IST so successful advance moves to next calendar day.
    const now = new Date("2026-03-20T03:30:00.000Z");
    await forceJobDue(JOB_KEYS.ANNOUNCEMENTS, now);
    await getDispatchJobModel().updateOne(
      { _id: JOB_KEYS.WORKFORCE },
      { $set: { nextRunAt: new Date("2099-01-01T00:00:00.000Z") } }
    );

    const History = getDispatchHistoryModel();
    const originalCreate = History.create.bind(History);
    History.create = async () => {
      throw new Error("simulated history write failure");
    };

    try {
      const result = await runSchedulerDispatch({
        now,
        budgetMs: 20000,
        force: true,
        adapters: {
          [JOB_KEYS.ANNOUNCEMENTS]: async () => ({
            status: "ok",
            executionMode: "detect-only",
            durationMs: 4,
            tenantConnectionsOpened: 0,
            summary: { mode: "detect-only", dueCount: 1, published: 0, mutations: false },
          }),
        },
      });

      assert.equal(result.success, true);
      const ann = result.jobs.find((j) => j.jobKey === JOB_KEYS.ANNOUNCEMENTS);
      assert.equal(ann.status, "ok");
      assert.equal(ann.scheduleAction, SCHEDULE_ACTIONS.ADVANCE_DAILY);

      const job = await getDispatchJobModel().findById(JOB_KEYS.ANNOUNCEMENTS).lean();
      assert.equal(job.nextRunAt.toISOString(), "2026-03-21T03:00:00.000Z");
      assert.equal(job.lastStatus, "ok");
    } finally {
      History.create = originalCreate;
    }
  });

  it("runs due workforce adapter in dry-run without apply", async () => {
    process.env.WORKFORCE_SCHEDULER_ENABLED = "true";
    await forceJobDue(JOB_KEYS.WORKFORCE, new Date("2026-03-20T02:00:00.000Z"));
    await getDispatchJobModel().updateOne(
      { _id: JOB_KEYS.ANNOUNCEMENTS },
      { $set: { nextRunAt: new Date("2099-01-01T00:00:00.000Z") } }
    );

    const result = await runSchedulerDispatch({
      now: new Date("2026-03-20T02:00:00.000Z"),
      budgetMs: 20000,
      force: true,
    });
    assert.equal(result.jobsDue, 1);
    assert.equal(result.jobsAttempted, 1);
    const wf = result.jobs.find((j) => j.jobKey === JOB_KEYS.WORKFORCE);
    assert.ok(wf);
    assert.equal(wf.executionMode, "dry-run");
    assert.ok(["ok", "skipped"].includes(wf.status));
    assert.equal(wf.summary?.mode, "dry-run");
    assert.equal(wf.summary?.results, undefined);
  });

  it("workforce dry-run success advances Asia/Kolkata schedule without applying assignments", async () => {
    // After 07:30 IST so ADVANCE_DAILY lands on the next civil day at 07:30 IST.
    const now = new Date("2026-03-20T02:30:00.000Z");
    process.env.WORKFORCE_SCHEDULER_ENABLED = "true";
    // Prove dispatcher hard-forces dry-run even when env mode is apply.
    process.env.WORKFORCE_SCHEDULER_MODE = "apply";

    await forceJobDue(JOB_KEYS.WORKFORCE, now);
    await getDispatchJobModel().updateOne(
      { _id: JOB_KEYS.ANNOUNCEMENTS },
      { $set: { nextRunAt: new Date("2099-01-01T00:00:00.000Z") } }
    );

    const hrUser = await models.User.create({
      email: `wf-hr-${RUN_ID}@dispatch.test`,
      passwordHash: await hashPassword("DispatchPass123!"),
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
    });
    const empUser = await models.User.create({
      email: `wf-emp-${RUN_ID}@dispatch.test`,
      passwordHash: await hashPassword("DispatchPass123!"),
      role: USER_ROLES.EMPLOYEE,
      isActive: true,
    });
    const employee = await models.Employee.create({
      userId: empUser._id,
      companyId: company._id,
      employeeCode: `WF-${RUN_ID}`.slice(0, 20),
      fullName: "Dispatch Eligible",
      email: `wf-emp-${RUN_ID}@dispatch.test`,
      status: EMPLOYEE_STATUSES.ACTIVE,
      skills: ["node"],
      job: { department: "Engineering", jobTitle: "Dev" },
    });
    const task = await models.Task.create({
      title: `WF dry-run queue ${RUN_ID}`,
      description: "Queued for dry-run proposals only",
      assigneeId: null,
      assignedByUserId: hrUser._id,
      assignedBySnapshot: {
        fullName: "HR",
        role: USER_ROLES.HR_ADMIN,
        email: hrUser.email,
      },
      department: "Engineering",
      priority: TASK_PRIORITIES.MEDIUM,
      status: TASK_STATUSES.UNASSIGNED,
      deadline: new Date(now.getTime() + 3 * 86_400_000),
      requiredSkills: ["node"],
    });
    const notifBefore = models.Notification
      ? await models.Notification.countDocuments({})
      : 0;

    try {
      const result = await runSchedulerDispatch({
        now,
        budgetMs: 20000,
        force: true,
      });

      assert.equal(result.jobsDue, 1);
      assert.equal(result.jobsAttempted, 1);
      const wf = result.jobs.find((j) => j.jobKey === JOB_KEYS.WORKFORCE);
      assert.ok(wf);
      assert.equal(wf.status, "ok");
      assert.equal(wf.executionMode, "dry-run");
      assert.equal(wf.scheduleAction, SCHEDULE_ACTIONS.ADVANCE_DAILY);
      assert.equal(wf.summary?.mode, "dry-run");
      assert.equal(wf.summary?.truncated, false);
      assert.ok(Number(wf.summary?.attempted) >= 1);
      // Dry-run success is not apply: ownership must remain unchanged.
      assert.equal(wf.summary?.autoApplied, undefined);

      const job = await getDispatchJobModel().findById(JOB_KEYS.WORKFORCE).lean();
      assert.equal(job.lastStatus, "ok");
      assert.equal(job.nextRunAt.toISOString(), "2026-03-21T02:00:00.000Z");

      const reloaded = await models.Task.findById(task._id).lean();
      assert.equal(reloaded.status, TASK_STATUSES.UNASSIGNED);
      assert.equal(reloaded.assigneeId, null);
      if (models.Notification) {
        assert.equal(await models.Notification.countDocuments({}), notifBefore);
      }
    } finally {
      process.env.WORKFORCE_SCHEDULER_MODE = "dry-run";
      await models.Task.deleteOne({ _id: task._id });
      await models.Employee.deleteOne({ _id: employee._id });
      await models.User.deleteMany({ _id: { $in: [hrUser._id, empUser._id] } });
    }
  });

  it("announcements detect-only counts due rows without publishing", async () => {
    await models.Announcement.create({
      title: "Due soon",
      body: "Hello",
      status: ANNOUNCEMENT_STATUSES.SCHEDULED,
      scheduledAt: new Date("2026-03-19T00:00:00.000Z"),
      audience: ANNOUNCEMENT_AUDIENCES.COMPANY,
      priority: ANNOUNCEMENT_PRIORITIES.NORMAL,
      publishedBy: new mongoose.Types.ObjectId(),
    });

    const before = await models.Announcement.findOne({ title: "Due soon" }).lean();
    assert.equal(before.status, ANNOUNCEMENT_STATUSES.SCHEDULED);

    const detect = await runAnnouncementsDetectAdapter({
      now: new Date("2026-03-20T03:30:00.000Z"),
      budgetMs: 15000,
    });
    assert.equal(detect.executionMode, "detect-only");
    assert.equal(detect.summary.dueCount >= 1, true);
    assert.equal(detect.summary.published, 0);
    assert.equal(detect.summary.mutations, false);

    const after = await models.Announcement.findById(before._id).lean();
    assert.equal(after.status, ANNOUNCEMENT_STATUSES.SCHEDULED);
    assert.equal(after.notifiedAt, null);
    assert.equal(after.publishedAt, null);

    const count = await countDueAnnouncements(models, new Date("2026-03-20T03:30:00.000Z"));
    assert.equal(count >= 1, true);
  });

  it("runs announcements detect-only when due via dispatcher", async () => {
    await forceJobDue(JOB_KEYS.ANNOUNCEMENTS, new Date("2026-03-20T03:00:00.000Z"));
    await getDispatchJobModel().updateOne(
      { _id: JOB_KEYS.WORKFORCE },
      { $set: { nextRunAt: new Date("2099-01-01T00:00:00.000Z") } }
    );
    await models.Announcement.create({
      title: "Fleet due",
      body: "Body",
      status: ANNOUNCEMENT_STATUSES.SCHEDULED,
      scheduledAt: new Date("2026-03-19T12:00:00.000Z"),
      audience: ANNOUNCEMENT_AUDIENCES.COMPANY,
      priority: ANNOUNCEMENT_PRIORITIES.NORMAL,
      publishedBy: new mongoose.Types.ObjectId(),
    });

    const result = await runSchedulerDispatch({
      now: new Date("2026-03-20T03:00:00.000Z"),
      budgetMs: 20000,
      force: true,
    });
    const ann = result.jobs.find((j) => j.jobKey === JOB_KEYS.ANNOUNCEMENTS);
    assert.ok(ann);
    assert.equal(ann.executionMode, "detect-only");
    assert.equal(ann.summary.published, 0);
    assert.equal(ann.summary.mutations, false);

    const still = await models.Announcement.findOne({ title: "Fleet due" }).lean();
    assert.equal(still.status, ANNOUNCEMENT_STATUSES.SCHEDULED);
  });

  it("announcements detect-only success advances Asia/Kolkata daily schedule and persists lastStatus", async () => {
    // After 08:30 IST so ADVANCE_DAILY lands on the next civil day at 08:30 IST.
    const now = new Date("2026-03-20T03:30:00.000Z");
    await forceJobDue(JOB_KEYS.ANNOUNCEMENTS, now);
    await getDispatchJobModel().updateOne(
      { _id: JOB_KEYS.WORKFORCE },
      { $set: { nextRunAt: new Date("2099-01-01T00:00:00.000Z") } }
    );

    const created = await models.Announcement.create({
      title: "Detect-only success row",
      body: "Must stay scheduled",
      status: ANNOUNCEMENT_STATUSES.SCHEDULED,
      scheduledAt: new Date("2026-03-19T08:00:00.000Z"),
      audience: ANNOUNCEMENT_AUDIENCES.COMPANY,
      priority: ANNOUNCEMENT_PRIORITIES.NORMAL,
      publishedBy: new mongoose.Types.ObjectId(),
    });
    const notifBefore = models.Notification
      ? await models.Notification.countDocuments({})
      : 0;

    const result = await runSchedulerDispatch({
      now,
      budgetMs: 20000,
      force: true,
    });

    assert.equal(result.jobsDue, 1);
    assert.equal(result.jobsAttempted, 1);
    const ann = result.jobs.find((j) => j.jobKey === JOB_KEYS.ANNOUNCEMENTS);
    assert.ok(ann);
    assert.equal(ann.status, "ok");
    assert.equal(ann.executionMode, "detect-only");
    assert.equal(ann.scheduleAction, SCHEDULE_ACTIONS.ADVANCE_DAILY);
    assert.equal(ann.summary?.mode, "detect-only");
    assert.equal(ann.summary?.published, 0);
    assert.equal(ann.summary?.mutations, false);
    assert.ok(Number(ann.summary?.dueCount) >= 1);

    const job = await getDispatchJobModel().findById(JOB_KEYS.ANNOUNCEMENTS).lean();
    assert.equal(job.lastStatus, "ok");
    assert.equal(job.nextRunAt.toISOString(), "2026-03-21T03:00:00.000Z");

    const still = await models.Announcement.findById(created._id).lean();
    assert.equal(still.status, ANNOUNCEMENT_STATUSES.SCHEDULED);
    assert.equal(still.publishedAt, null);
    assert.equal(still.notifiedAt, null);
    if (models.Notification) {
      assert.equal(await models.Notification.countDocuments({}), notifBefore);
    }
  });

  it("isolates adapter failures and still records other job status", async () => {
    await forceJobDue(JOB_KEYS.WORKFORCE, new Date("2026-03-20T02:00:00.000Z"));
    await forceJobDue(JOB_KEYS.ANNOUNCEMENTS, new Date("2026-03-20T02:00:00.000Z"));
    process.env.WORKFORCE_SCHEDULER_ENABLED = "false";

    const result = await runSchedulerDispatch({
      now: new Date("2026-03-20T02:00:00.000Z"),
      budgetMs: 20000,
      force: true,
    });
    assert.equal(result.jobsDue, 2);
    assert.equal(result.jobs.length, 2);
    const keys = result.jobs.map((j) => j.jobKey).sort();
    assert.deepEqual(keys, [JOB_KEYS.ANNOUNCEMENTS, JOB_KEYS.WORKFORCE].sort());

    const history = await getDispatchHistoryModel().find({}).lean();
    assert.ok(history.length >= 1);
  });

  it("repeated integration run stays isolated (no fixed shared dbPath collision)", async () => {
    // Re-seed and dispatch twice in-process; uniqueness of ISOLATED_DB_PATH
    // is asserted by construction (RUN_ID). This test verifies cleanup between runs.
    await forceJobDue(JOB_KEYS.ANNOUNCEMENTS, new Date("2026-03-20T03:00:00.000Z"));
    await getDispatchJobModel().updateOne(
      { _id: JOB_KEYS.WORKFORCE },
      { $set: { nextRunAt: new Date("2099-01-01T00:00:00.000Z") } }
    );

    const first = await runSchedulerDispatch({
      now: new Date("2026-03-20T03:00:00.000Z"),
      budgetMs: 15000,
      force: true,
      adapters: {
        [JOB_KEYS.ANNOUNCEMENTS]: async () => ({
          status: "ok",
          executionMode: "detect-only",
          durationMs: 1,
          summary: { mode: "detect-only", dueCount: 0, published: 0, mutations: false },
        }),
      },
    });
    assert.equal(first.jobsAttempted, 1);

    await getDispatchJobModel().deleteMany({});
    await getDispatchLockModel().deleteMany({});
    await getDispatchHistoryModel().deleteMany({});
    await ensureDispatchJobRegistry(new Date("2026-03-20T00:00:00.000Z"));
    await getDispatchJobModel().updateMany(
      {},
      { $set: { nextRunAt: new Date("2099-01-01T00:00:00.000Z") } }
    );

    const second = await runSchedulerDispatch({
      now: new Date("2026-03-20T04:00:00.000Z"),
      budgetMs: 15000,
      force: true,
    });
    assert.equal(second.reason, "no_jobs_due");
    assert.ok(ISOLATED_DB_PATH.includes(RUN_ID));
  });
});
