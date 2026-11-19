import crypto from "node:crypto";
import {
  DISPATCH_LOCK_ID,
  DISPATCH_RETRY_MS,
  JOB_KEYS,
  SCHEDULE_ACTIONS,
  clampDispatcherBudgetMs,
  defaultJobDefinitions,
  dispatcherBudgetMs,
  dispatcherEnabled,
  dispatcherHistoryRetention,
  dispatcherLockTtlForBudget,
} from "./config.js";
import {
  getDispatchHistoryModel,
  getDispatchJobModel,
  getDispatchLockModel,
} from "./models.js";
import { computeNextDailyRunAt, isJobDue } from "./schedule.js";
import { classifyJobScheduleAction } from "./schedulePolicy.js";
import { toPublicDispatchSummary } from "./publicSummary.js";
import { runWorkforceDispatchAdapter } from "./adapters/workforceAdapter.js";
import { runAnnouncementsDetectAdapter } from "./adapters/announcementsDetectAdapter.js";

function scheduleFromJob(job) {
  return {
    timezone: job.timezone || "Asia/Kolkata",
    hour: Number(job.schedule?.hour) || 0,
    minute: Number(job.schedule?.minute) || 0,
  };
}

/**
 * Atomic registry seed via $setOnInsert upserts.
 * Preserves enabled + nextRunAt on existing docs.
 * @param {{ updateMetadata?: boolean }} options — when false (idle), skip writes for existing jobs.
 */
export async function ensureDispatchJobRegistry(now = new Date(), { updateMetadata = false } = {}) {
  const Job = getDispatchJobModel();
  const defs = defaultJobDefinitions();
  const existing = await Job.find({ _id: { $in: defs.map((d) => d._id) } })
    .select("_id")
    .lean();
  const existingIds = new Set(existing.map((e) => e._id));

  for (const def of defs) {
    // M1 — idle path: zero writes when registry already seeded.
    if (existingIds.has(def._id) && !updateMetadata) {
      continue;
    }

    // Existing doc + metadata sync: $set only (never mix with $setOnInsert paths).
    if (existingIds.has(def._id) && updateMetadata) {
      await Job.updateOne(
        { _id: def._id },
        {
          $set: {
            name: def.name,
            timezone: def.timezone,
            schedule: def.schedule,
            executionMode: def.executionMode,
            description: def.description,
            updatedAt: now,
          },
        }
      );
      continue;
    }

    const nextRunAt = computeNextDailyRunAt(now, {
      timezone: def.timezone,
      hour: def.schedule.hour,
      minute: def.schedule.minute,
    });
    try {
      await Job.updateOne(
        { _id: def._id },
        {
          $setOnInsert: {
            _id: def._id,
            name: def.name,
            enabled: def.enabled,
            timezone: def.timezone,
            schedule: def.schedule,
            executionMode: def.executionMode,
            description: def.description,
            nextRunAt,
            lastRunAt: null,
            lastStatus: null,
            lastError: null,
            lastDurationMs: null,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
    } catch (err) {
      if (err?.code !== 11000) throw err;
      // Lost insert race — document exists; optional metadata sync.
      if (updateMetadata) {
        await Job.updateOne(
          { _id: def._id },
          {
            $set: {
              name: def.name,
              timezone: def.timezone,
              schedule: def.schedule,
              executionMode: def.executionMode,
              description: def.description,
              updatedAt: now,
            },
          }
        );
      }
    }
  }
  return Job.find({}).lean();
}

export async function acquireDispatchLock({
  ttlMs,
  now = new Date(),
  holder = "dispatcher",
} = {}) {
  const Lock = getDispatchLockModel();
  const token = crypto.randomUUID();
  const effectiveTtl = Number.isFinite(ttlMs) ? ttlMs : dispatcherLockTtlForBudget(dispatcherBudgetMs());
  const lockUntil = new Date(now.getTime() + Math.max(1_000, effectiveTtl));

  try {
    await Lock.updateOne(
      { _id: DISPATCH_LOCK_ID },
      {
        $setOnInsert: {
          _id: DISPATCH_LOCK_ID,
          lockToken: "",
          lockUntil: null,
          holder: "",
          updatedAt: now,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }

  const acquired = await Lock.findOneAndUpdate(
    {
      _id: DISPATCH_LOCK_ID,
      $or: [{ lockUntil: { $lte: now } }, { lockUntil: null }, { lockUntil: { $exists: false } }],
    },
    {
      $set: {
        lockToken: token,
        lockUntil,
        holder,
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );

  if (!acquired || acquired.lockToken !== token) {
    return { acquired: false, token: null, lockUntil: null };
  }
  return { acquired: true, token, lockUntil };
}

/** Extend lock only when ownership token matches (stale holders cannot renew). */
export async function renewDispatchLock(token, { ttlMs, now = new Date() } = {}) {
  if (!token) return { renewed: false };
  const Lock = getDispatchLockModel();
  const effectiveTtl = Number.isFinite(ttlMs) ? ttlMs : dispatcherLockTtlForBudget(dispatcherBudgetMs());
  const lockUntil = new Date(now.getTime() + Math.max(1_000, effectiveTtl));
  const updated = await Lock.findOneAndUpdate(
    { _id: DISPATCH_LOCK_ID, lockToken: token },
    { $set: { lockUntil, updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!updated || updated.lockToken !== token) {
    return { renewed: false };
  }
  return { renewed: true, lockUntil };
}

export async function releaseDispatchLock(token) {
  if (!token) return { released: false };
  const Lock = getDispatchLockModel();
  const result = await Lock.updateOne(
    { _id: DISPATCH_LOCK_ID, lockToken: token },
    {
      $set: {
        lockToken: "",
        lockUntil: null,
        holder: "",
        updatedAt: new Date(),
      },
    }
  );
  return { released: result.modifiedCount > 0 };
}

async function recordHistory(doc) {
  try {
    const History = getDispatchHistoryModel();
    await History.create(doc);
    const retain = dispatcherHistoryRetention();
    const excess = await History.find({}).sort({ startedAt: -1 }).skip(retain).select("_id").lean();
    if (excess.length) {
      await History.deleteMany({ _id: { $in: excess.map((r) => r._id) } });
    }
  } catch (err) {
    // M5 — history must not hide adapter outcomes or force unsafe retries.
    if (process.env.NODE_ENV !== "test") {
      console.warn("[scheduler-dispatch] history write failed:", err?.message || err);
    }
  }
}

async function advanceJobNextDaily(job, now) {
  const Job = getDispatchJobModel();
  const nextRunAt = computeNextDailyRunAt(now, scheduleFromJob(job), { inclusive: false });
  await Job.updateOne({ _id: job._id }, { $set: { nextRunAt, updatedAt: now } });
  return nextRunAt;
}

async function scheduleJobRetry(job, now, retryMs = DISPATCH_RETRY_MS) {
  const Job = getDispatchJobModel();
  const nextRunAt = new Date(now.getTime() + retryMs);
  await Job.updateOne({ _id: job._id }, { $set: { nextRunAt, updatedAt: now } });
  return nextRunAt;
}

async function applyScheduleAction(job, action, now) {
  if (action === SCHEDULE_ACTIONS.PRESERVE) return job.nextRunAt || null;
  if (action === SCHEDULE_ACTIONS.RETRY_15M) return scheduleJobRetry(job, now);
  if (action === SCHEDULE_ACTIONS.ADVANCE_DAILY) return advanceJobNextDaily(job, now);
  return scheduleJobRetry(job, now);
}

async function persistJobResult(job, { status, error, durationMs, now }) {
  const Job = getDispatchJobModel();
  await Job.updateOne(
    { _id: job._id },
    {
      $set: {
        lastRunAt: now,
        lastStatus: status,
        lastError: error ? String(error).slice(0, 500) : null,
        lastDurationMs: durationMs,
        updatedAt: now,
      },
    }
  );
}

async function runJobAdapter(job, { budgetMs, now, trackTenantOpen, adapters }) {
  if (adapters && typeof adapters[job._id] === "function") {
    return adapters[job._id]({ budgetMs, now, trackTenantOpen, job });
  }
  if (job._id === JOB_KEYS.WORKFORCE) {
    return runWorkforceDispatchAdapter({ budgetMs, now, trackTenantOpen });
  }
  if (job._id === JOB_KEYS.ANNOUNCEMENTS) {
    return runAnnouncementsDetectAdapter({ budgetMs, now, trackTenantOpen });
  }
  return {
    status: "skipped",
    executionMode: job.executionMode || "unknown",
    reason: "unknown_job",
    durationMs: 0,
    tenantConnectionsOpened: 0,
    summary: { reason: "unknown_job" },
  };
}

/**
 * Main dispatcher entry — safe for 15-minute external polling.
 */
export async function runSchedulerDispatch(options = {}) {
  const startedAt = options.now ? new Date(options.now) : new Date();
  const startedMs = Date.now();
  const budgetMs = clampDispatcherBudgetMs(
    options.budgetMs != null ? options.budgetMs : dispatcherBudgetMs()
  );
  const deadline = startedMs + Math.max(0, budgetMs);
  const lockTtlMs = dispatcherLockTtlForBudget(budgetMs);

  if (!dispatcherEnabled() && !options.force) {
    return toPublicDispatchSummary({
      skipped: true,
      reason: "dispatcher_disabled",
      dispatcherEnabled: false,
      budgetMs,
      durationMs: Date.now() - startedMs,
      tenantConnectionsOpened: 0,
      jobs: [],
    });
  }

  // Idle-friendly seed: insert missing jobs only (no metadata churn).
  await ensureDispatchJobRegistry(startedAt, { updateMetadata: false });

  const lock = await acquireDispatchLock({
    now: new Date(),
    ttlMs: lockTtlMs,
    holder: options.holder || "http-dispatch",
  });

  if (!lock.acquired) {
    const body = toPublicDispatchSummary({
      skipped: true,
      reason: "lock_held",
      dispatcherEnabled: true,
      lockAcquired: false,
      budgetMs,
      durationMs: Date.now() - startedMs,
      tenantConnectionsOpened: 0,
      jobs: [],
    });
    await recordHistory({
      startedAt,
      finishedAt: new Date(),
      lockToken: "",
      outcome: "skipped",
      reason: "lock_held",
      budgetMs,
      durationMs: body.durationMs,
      jobsDue: 0,
      jobsAttempted: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      jobsSkipped: 1,
      tenantConnectionsOpened: 0,
      jobs: [],
    });
    return body;
  }

  let tenantConnectionsOpened = 0;
  const trackTenantOpen = (n = 1) => {
    tenantConnectionsOpened += Number(n) || 0;
  };

  const Job = getDispatchJobModel();
  const allJobs = await Job.find({}).sort({ _id: 1 }).lean();
  const dueJobs = allJobs.filter((j) => isJobDue(j, startedAt));

  if (dueJobs.length === 0) {
    await releaseDispatchLock(lock.token);
    const body = toPublicDispatchSummary({
      skipped: false,
      reason: "no_jobs_due",
      dispatcherEnabled: true,
      lockAcquired: true,
      jobsDue: 0,
      jobsAttempted: 0,
      budgetMs,
      durationMs: Date.now() - startedMs,
      tenantConnectionsOpened: 0,
      jobs: [],
    });
    await recordHistory({
      startedAt,
      finishedAt: new Date(),
      lockToken: lock.token,
      outcome: "idle",
      reason: "no_jobs_due",
      budgetMs,
      durationMs: body.durationMs,
      jobsDue: 0,
      jobsAttempted: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      jobsSkipped: 0,
      tenantConnectionsOpened: 0,
      jobs: [],
    });
    return body;
  }

  const jobResults = [];
  let jobsSucceeded = 0;
  let jobsFailed = 0;
  let jobsSkipped = 0;
  let truncated = false;
  let jobsAttempted = 0;

  try {
    for (const job of dueJobs) {
      // Ownership-checked renewal before each job so long sequential runs stay covered.
      await renewDispatchLock(lock.token, { ttlMs: lockTtlMs, now: new Date() });

      const remaining = deadline - Date.now();
      if (remaining < 800) {
        truncated = true;
        jobsSkipped += 1;
        await persistJobResult(job, {
          status: "skipped",
          error: "budget_exhausted",
          durationMs: 0,
          now: new Date(),
        });
        jobResults.push({
          jobKey: job._id,
          name: job.name,
          status: "skipped",
          executionMode: job.executionMode,
          durationMs: 0,
          reason: "budget_exhausted",
          scheduleAction: SCHEDULE_ACTIONS.PRESERVE,
        });
        // Preserve due state — do not touch nextRunAt.
        continue;
      }

      const jobStarted = Date.now();
      let adapterResult;
      try {
        jobsAttempted += 1;
        adapterResult = await runJobAdapter(job, {
          budgetMs: remaining,
          now: startedAt,
          trackTenantOpen,
          adapters: options.adapters,
        });
      } catch (err) {
        adapterResult = {
          status: "error",
          executionMode: job.executionMode,
          reason: err?.message || String(err),
          durationMs: Date.now() - jobStarted,
          tenantConnectionsOpened: 0,
          summary: { reason: "adapter_exception" },
        };
      }

      const finished = new Date();
      // Prefer logical dispatch time so schedule math is deterministic under options.now.
      const scheduleBasis = options.now ? new Date(options.now) : finished;
      const status = adapterResult.status || "error";
      const scheduleAction = classifyJobScheduleAction(adapterResult);

      await persistJobResult(job, {
        status,
        error: status === "error" ? adapterResult.reason : null,
        durationMs: adapterResult.durationMs,
        now: finished,
      });
      await applyScheduleAction(job, scheduleAction, scheduleBasis);

      if (status === "ok" && scheduleAction === SCHEDULE_ACTIONS.ADVANCE_DAILY) {
        jobsSucceeded += 1;
      } else if (status === "error") {
        jobsFailed += 1;
      } else {
        jobsSkipped += 1;
      }

      if (adapterResult.summary?.truncated || adapterResult.reason === "budget_exhausted") {
        truncated = true;
      }

      jobResults.push({
        jobKey: job._id,
        name: job.name,
        status,
        executionMode: adapterResult.executionMode || job.executionMode,
        durationMs: adapterResult.durationMs,
        reason: adapterResult.reason,
        scheduleAction,
        summary: adapterResult.summary,
      });
    }
  } finally {
    await releaseDispatchLock(lock.token);
  }

  const body = toPublicDispatchSummary({
    skipped: false,
    dispatcherEnabled: true,
    lockAcquired: true,
    jobsDue: dueJobs.length,
    jobsAttempted,
    jobsSucceeded,
    jobsFailed,
    jobsSkipped,
    truncated,
    budgetMs,
    durationMs: Date.now() - startedMs,
    tenantConnectionsOpened,
    jobs: jobResults,
  });

  await recordHistory({
    startedAt,
    finishedAt: new Date(),
    lockToken: lock.token,
    outcome: jobsFailed > 0 ? "partial_error" : truncated ? "truncated" : "ok",
    reason: null,
    budgetMs,
    durationMs: body.durationMs,
    jobsDue: dueJobs.length,
    jobsAttempted,
    jobsSucceeded,
    jobsFailed,
    jobsSkipped,
    tenantConnectionsOpened,
    jobs: jobResults.map((j) => ({
      jobKey: j.jobKey,
      status: j.status,
      durationMs: j.durationMs,
      reason: j.reason,
      scheduleAction: j.scheduleAction,
    })),
  });

  return body;
}

/** Test helper: mark a job due immediately. */
export async function forceJobDue(jobKey, at = new Date()) {
  const Job = getDispatchJobModel();
  await ensureDispatchJobRegistry(at, { updateMetadata: false });
  await Job.updateOne(
    { _id: jobKey },
    { $set: { nextRunAt: new Date(at.getTime() - 1_000), updatedAt: at, enabled: true } }
  );
}

export {
  toPublicDispatchSummary,
  isJobDue,
  computeNextDailyRunAt,
  classifyJobScheduleAction,
  clampDispatcherBudgetMs,
};
