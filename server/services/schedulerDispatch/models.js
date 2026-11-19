import mongoose from "mongoose";
import {
  DISPATCH_HISTORY_COLLECTION,
  DISPATCH_JOB_COLLECTION,
  DISPATCH_LOCK_COLLECTION,
  DISPATCH_LOCK_ID,
} from "./config.js";

const JobSchema = new mongoose.Schema(
  {
    _id: { type: String },
    name: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    timezone: { type: String, default: "Asia/Kolkata" },
    schedule: {
      kind: { type: String, default: "daily" },
      hour: { type: Number, required: true },
      minute: { type: Number, required: true },
    },
    executionMode: { type: String, default: "dry-run" },
    description: { type: String, default: "" },
    nextRunAt: { type: Date, default: null, index: true },
    lastRunAt: { type: Date, default: null },
    lastStatus: { type: String, default: null },
    lastError: { type: String, default: null },
    lastDurationMs: { type: Number, default: null },
    updatedAt: { type: Date, default: null },
  },
  { collection: DISPATCH_JOB_COLLECTION, versionKey: false }
);

JobSchema.index({ enabled: 1, nextRunAt: 1 });

const LockSchema = new mongoose.Schema(
  {
    _id: { type: String },
    lockToken: { type: String, default: "" },
    lockUntil: { type: Date, default: null },
    holder: { type: String, default: "" },
    updatedAt: { type: Date, default: null },
  },
  { collection: DISPATCH_LOCK_COLLECTION, versionKey: false }
);

const HistorySchema = new mongoose.Schema(
  {
    startedAt: { type: Date, required: true, index: true },
    finishedAt: { type: Date, default: null },
    lockToken: { type: String, default: "" },
    outcome: { type: String, default: "ok" },
    reason: { type: String, default: null },
    budgetMs: { type: Number, default: null },
    durationMs: { type: Number, default: null },
    jobsDue: { type: Number, default: 0 },
    jobsAttempted: { type: Number, default: 0 },
    jobsSucceeded: { type: Number, default: 0 },
    jobsFailed: { type: Number, default: 0 },
    jobsSkipped: { type: Number, default: 0 },
    tenantConnectionsOpened: { type: Number, default: 0 },
    jobs: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { collection: DISPATCH_HISTORY_COLLECTION, versionKey: false }
);

HistorySchema.index({ startedAt: -1 });

export function getDispatchJobModel() {
  return mongoose.models.SchedulerDispatchJob || mongoose.model("SchedulerDispatchJob", JobSchema);
}

export function getDispatchLockModel() {
  return (
    mongoose.models.SchedulerDispatchLock || mongoose.model("SchedulerDispatchLock", LockSchema)
  );
}

export function getDispatchHistoryModel() {
  return (
    mongoose.models.SchedulerDispatchHistory ||
    mongoose.model("SchedulerDispatchHistory", HistorySchema)
  );
}

export { DISPATCH_LOCK_ID };
