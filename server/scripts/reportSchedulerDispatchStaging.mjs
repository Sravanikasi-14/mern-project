/**
 * Read-only HRMS Scheduler Monitoring Report — platform_staging only.
 *
 * Inspects:
 *   - scheduler_dispatch_history (latest 10)
 *   - scheduler_dispatch_jobs
 *   - scheduler_dispatch_locks
 *
 * Does NOT: call /api/scheduler/dispatch, run adapters, write DB, or touch Production.
 *
 * Connection note:
 *   This script intentionally does NOT call connectCentralDB(). That helper always
 *   invokes ensureCentralEphemeralTtlIndexes(), which may createCollection/createIndex
 *   on platform_admin_sessions / rate_limit_hits (a write side effect). There is no
 *   existing skip flag on connectCentralDB. Instead this script uses mongoose.connect
 *   with getMongoUri() + dbName=platform_staging, autoIndex:false, autoCreate:false
 *   (avoids Mongoose auto index/collection creation from schema.index() definitions).
 *
 * Required env:
 *   MONGO_URI                      (never logged)
 *   CENTRAL_DB_NAME=platform_staging
 *   STAGING_MONITOR_CONFIRM=platform_staging
 *
 * Optional:
 *   STALE_OVERDUE_MS=7200000       (default 2h) — overdue beyond this is "stale"
 *
 * Run (after review approval only):
 *   node scripts/reportSchedulerDispatchStaging.mjs
 */
import "dotenv/config";
import mongoose from "mongoose";
import { disconnectAll, getCentralDbName, getMongoUri } from "../config/db.js";
import {
  DISPATCH_HISTORY_COLLECTION,
  DISPATCH_JOB_COLLECTION,
  DISPATCH_LOCK_COLLECTION,
  JOB_KEYS,
} from "../services/schedulerDispatch/config.js";
import {
  getDispatchHistoryModel,
  getDispatchJobModel,
  getDispatchLockModel,
} from "../services/schedulerDispatch/models.js";

const REQUIRED_COLLECTIONS = Object.freeze([
  DISPATCH_HISTORY_COLLECTION,
  DISPATCH_JOB_COLLECTION,
  DISPATCH_LOCK_COLLECTION,
]);

const STAGING_CENTRAL = "platform_staging";
const HISTORY_LIMIT = 10;
const EXPECTED_MODES = Object.freeze({
  [JOB_KEYS.WORKFORCE]: "dry-run",
  [JOB_KEYS.ANNOUNCEMENTS]: "detect-only",
});

/** Capture before any force. */
const ORIGINAL_CENTRAL_WAS_SET = Object.prototype.hasOwnProperty.call(
  process.env,
  "CENTRAL_DB_NAME"
);
const ORIGINAL_CENTRAL = ORIGINAL_CENTRAL_WAS_SET
  ? String(process.env.CENTRAL_DB_NAME ?? "").trim()
  : null;

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function iso(d) {
  if (d == null) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function assertReadOnlyStagingGuards() {
  if (ORIGINAL_CENTRAL_WAS_SET && ORIGINAL_CENTRAL !== STAGING_CENTRAL) {
    throw new Error(
      `Refusing: CENTRAL_DB_NAME was explicitly set to "${ORIGINAL_CENTRAL}"; only ${STAGING_CENTRAL} is allowed. Aborting before connect.`
    );
  }

  process.env.CENTRAL_DB_NAME = STAGING_CENTRAL;

  const confirm = String(process.env.STAGING_MONITOR_CONFIRM || "").trim();
  must(process.env.MONGO_URI, "MONGO_URI required (value never printed)");
  must(
    confirm === STAGING_CENTRAL,
    `Refusing: STAGING_MONITOR_CONFIRM must be ${STAGING_CENTRAL}`
  );
  must(
    String(process.env.CENTRAL_DB_NAME || "").trim() === STAGING_CENTRAL,
    `Refusing: CENTRAL_DB_NAME must be ${STAGING_CENTRAL}`
  );
  must(getCentralDbName() === STAGING_CENTRAL, "getCentralDbName mismatch before connect");
}

function snapJob(j) {
  return {
    jobKey: j._id,
    enabled: j.enabled !== false,
    executionMode: j.executionMode ?? null,
    nextRunAt: iso(j.nextRunAt),
    lastRunAt: iso(j.lastRunAt),
    lastStatus: j.lastStatus ?? null,
    lastError: j.lastError ?? null,
    lastDurationMs: j.lastDurationMs ?? null,
    timezone: j.timezone ?? null,
    schedule: j.schedule
      ? { kind: j.schedule.kind, hour: j.schedule.hour, minute: j.schedule.minute }
      : null,
  };
}

function snapHistory(h) {
  return {
    id: String(h._id),
    startedAt: iso(h.startedAt),
    finishedAt: iso(h.finishedAt),
    outcome: h.outcome ?? null,
    reason: h.reason ?? null,
    budgetMs: h.budgetMs ?? null,
    durationMs: h.durationMs ?? null,
    jobsDue: h.jobsDue ?? 0,
    jobsAttempted: h.jobsAttempted ?? 0,
    jobsSucceeded: h.jobsSucceeded ?? 0,
    jobsFailed: h.jobsFailed ?? 0,
    jobsSkipped: h.jobsSkipped ?? 0,
    tenantConnectionsOpened: h.tenantConnectionsOpened ?? 0,
    jobs: Array.isArray(h.jobs)
      ? h.jobs.map((j) => ({
          jobKey: j.jobKey,
          status: j.status,
          durationMs: j.durationMs,
          reason: j.reason,
          scheduleAction: j.scheduleAction,
        }))
      : [],
  };
}

function snapLock(l, nowMs) {
  const untilMs = l.lockUntil ? new Date(l.lockUntil).getTime() : 0;
  const active = Boolean(untilMs && untilMs > nowMs);
  return {
    id: l._id,
    holder: l.holder || "",
    lockUntil: iso(l.lockUntil),
    active,
    lockTokenPresent: Boolean(l.lockToken),
  };
}

function summarizeHistory(rows) {
  const byOutcome = {
    ok: 0,
    idle: 0,
    skipped: 0,
    partial_error: 0,
    truncated: 0,
    other: 0,
  };
  let jobsAttempted = 0;
  let jobsSucceeded = 0;
  let jobsFailed = 0;
  let jobsSkipped = 0;

  for (const h of rows) {
    const o = String(h.outcome || "other");
    if (Object.prototype.hasOwnProperty.call(byOutcome, o)) byOutcome[o] += 1;
    else byOutcome.other += 1;
    jobsAttempted += Number(h.jobsAttempted) || 0;
    jobsSucceeded += Number(h.jobsSucceeded) || 0;
    jobsFailed += Number(h.jobsFailed) || 0;
    jobsSkipped += Number(h.jobsSkipped) || 0;
  }

  return {
    totalTicksSampled: rows.length,
    outcomes: byOutcome,
    jobsAttempted,
    jobsSucceeded,
    jobsFailed,
    jobsSkipped,
    mostRecentStartedAt: rows[0] ? iso(rows[0].startedAt) : null,
    mostRecentFinishedAt: rows[0] ? iso(rows[0].finishedAt) : null,
    mostRecentOutcome: rows[0]?.outcome ?? null,
    mostRecentReason: rows[0]?.reason ?? null,
  };
}

async function listRequiredCollections(db) {
  const present = {};
  for (const name of REQUIRED_COLLECTIONS) {
    const found = await db.listCollections({ name }, { nameOnly: true }).toArray();
    present[name] = found.length > 0;
  }
  return present;
}

function buildFlags(jobs, locks, nowMs, staleOverdueMs, collectionsPresent = {}) {
  const flags = [];

  for (const name of REQUIRED_COLLECTIONS) {
    if (!collectionsPresent[name]) {
      flags.push({
        severity: "error",
        code: "missing_collection",
        jobKey: null,
        message: `Required collection missing: ${name}`,
      });
    }
  }

  const jobMap = Object.fromEntries(jobs.map((j) => [j._id, j]));

  for (const key of Object.values(JOB_KEYS)) {
    if (!jobMap[key]) {
      flags.push({
        severity: "error",
        code: "missing_job",
        jobKey: key,
        message: `Registered job ${key} not found`,
      });
    }
  }

  for (const j of jobs) {
    const key = j._id;
    const expectedMode = EXPECTED_MODES[key];
    const mode = j.executionMode;
    if (expectedMode && mode !== expectedMode) {
      flags.push({
        severity: "error",
        code: "unexpected_execution_mode",
        jobKey: key,
        message: `executionMode=${mode} (expected ${expectedMode})`,
      });
    }

    if (j.lastStatus === "error") {
      flags.push({
        severity: "error",
        code: "last_status_error",
        jobKey: key,
        message: `lastStatus=error lastError=${j.lastError || "(none)"}`,
      });
    }

    const enabled = j.enabled !== false;
    const nextMs = j.nextRunAt ? new Date(j.nextRunAt).getTime() : null;
    if (enabled && nextMs != null && nextMs <= nowMs) {
      const overdueMs = nowMs - nextMs;
      const stale = overdueMs >= staleOverdueMs;
      flags.push({
        severity: stale ? "warning" : "info",
        code: stale ? "stale_overdue_nextRunAt" : "overdue_nextRunAt",
        jobKey: key,
        message: `nextRunAt ${iso(j.nextRunAt)} is ${Math.round(overdueMs / 1000)}s past now (${stale ? "stale" : "due"})`,
        overdueMs,
      });
    }
  }

  for (const l of locks) {
    const untilMs = l.lockUntil ? new Date(l.lockUntil).getTime() : 0;
    if (untilMs > nowMs) {
      flags.push({
        severity: "warning",
        code: "active_dispatch_lock",
        jobKey: null,
        message: `Active lock ${l._id} holder=${l.holder || "(none)"} until ${iso(l.lockUntil)}`,
      });
    }
  }

  return flags;
}

async function main() {
  let exitCode = 0;
  try {
    assertReadOnlyStagingGuards();

    console.log(
      JSON.stringify({
        phase: "guards_ok",
        mode: "read-only-monitor",
        centralRequired: STAGING_CENTRAL,
        originalCentralDbNameWasSet: ORIGINAL_CENTRAL_WAS_SET,
        originalCentralDbName: ORIGINAL_CENTRAL_WAS_SET ? ORIGINAL_CENTRAL : null,
        historyLimit: HISTORY_LIMIT,
        dispatcherHttpCalls: false,
        databaseWrites: false,
        connectionPath:
          "mongoose.connect(getMongoUri,{dbName,autoIndex:false,autoCreate:false}) — bypasses connectCentralDB TTL ensure",
      })
    );

    // Read-only connect:
    // - Bypass connectCentralDB() → ensureCentralEphemeralTtlIndexes() writes.
    // - Disable Mongoose autoIndex/autoCreate (Job/History schemas declare indexes).
    mongoose.set("autoIndex", false);
    mongoose.set("autoCreate", false);
    await mongoose.connect(getMongoUri(), {
      dbName: STAGING_CENTRAL,
      serverSelectionTimeoutMS: 8000,
      autoIndex: false,
      autoCreate: false,
    });
    const db = mongoose.connection.db;
    must(db.databaseName === STAGING_CENTRAL, `connected db mismatch: ${db.databaseName}`);
    must(getCentralDbName() === STAGING_CENTRAL, "getCentralDbName mismatch after connect");

    const nowMs = Date.now();
    const staleOverdueMs = (() => {
      const n = Number(process.env.STALE_OVERDUE_MS);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2 * 60 * 60 * 1000;
    })();

    const collectionsPresent = await listRequiredCollections(db);

    const Job = getDispatchJobModel();
    const History = getDispatchHistoryModel();
    const Lock = getDispatchLockModel();

    // Missing collections: Mongo find/count typically returns empty — still query safely.
    const [jobs, history, locks, historyTotal] = await Promise.all([
      collectionsPresent[DISPATCH_JOB_COLLECTION]
        ? Job.find({}).sort({ _id: 1 }).lean()
        : Promise.resolve([]),
      collectionsPresent[DISPATCH_HISTORY_COLLECTION]
        ? History.find({}).sort({ startedAt: -1 }).limit(HISTORY_LIMIT).lean()
        : Promise.resolve([]),
      collectionsPresent[DISPATCH_LOCK_COLLECTION]
        ? Lock.find({}).lean()
        : Promise.resolve([]),
      collectionsPresent[DISPATCH_HISTORY_COLLECTION]
        ? History.countDocuments({})
        : Promise.resolve(0),
    ]);

    const jobRows = jobs.map(snapJob);
    const historyRows = history.map(snapHistory);
    const lockRows = locks.map((l) => snapLock(l, nowMs));
    const summary = summarizeHistory(history);
    const flags = buildFlags(jobs, locks, nowMs, staleOverdueMs, collectionsPresent);

    const modeCheck = {
      workforce: {
        jobKey: JOB_KEYS.WORKFORCE,
        executionMode: jobRows.find((j) => j.jobKey === JOB_KEYS.WORKFORCE)?.executionMode ?? null,
        expected: EXPECTED_MODES[JOB_KEYS.WORKFORCE],
        ok:
          jobRows.find((j) => j.jobKey === JOB_KEYS.WORKFORCE)?.executionMode ===
          EXPECTED_MODES[JOB_KEYS.WORKFORCE],
      },
      announcements: {
        jobKey: JOB_KEYS.ANNOUNCEMENTS,
        executionMode:
          jobRows.find((j) => j.jobKey === JOB_KEYS.ANNOUNCEMENTS)?.executionMode ?? null,
        expected: EXPECTED_MODES[JOB_KEYS.ANNOUNCEMENTS],
        ok:
          jobRows.find((j) => j.jobKey === JOB_KEYS.ANNOUNCEMENTS)?.executionMode ===
          EXPECTED_MODES[JOB_KEYS.ANNOUNCEMENTS],
      },
    };

    const report = {
      phase: "scheduler_monitor_report",
      generatedAt: new Date(nowMs).toISOString(),
      connectedDb: db.databaseName,
      collections: collectionsPresent,
      summary: {
        ...summary,
        historyDocumentsTotal: historyTotal,
        note: "Outcome/attempt totals below are over the latest HISTORY_LIMIT sample, not necessarily all-time.",
        historyLimit: HISTORY_LIMIT,
      },
      modeCheck,
      flags,
      jobs: jobRows,
      latestHistory: historyRows,
      locks: lockRows,
      activeLockCount: lockRows.filter((l) => l.active).length,
    };

    console.log(JSON.stringify(report, null, 2));

    if (flags.some((f) => f.severity === "error")) {
      console.error("SCHEDULER_MONITOR_FLAGS_ERROR");
      exitCode = 2;
    } else if (flags.some((f) => f.severity === "warning")) {
      console.error("SCHEDULER_MONITOR_FLAGS_WARNING");
      // Still exit 0 for warnings — observation, not a hard failure.
    } else {
      console.log("SCHEDULER_MONITOR_OK");
    }
  } catch (err) {
    exitCode = 2;
    console.error("STOP:", err?.message || err);
  } finally {
    try {
      await disconnectAll();
    } catch (discErr) {
      console.error("disconnect warning:", discErr?.message || discErr);
    }
  }
  process.exit(exitCode);
}

main();
