/**
 * F41 — Durable multi-tenant scheduler progress on the central MongoDB.
 *
 * Stores a wave cursor so truncated Vercel invocations can resume without Redis.
 * Per-company lastRunAt / lastRunSummary remain the source of "completed in this wave".
 */

import mongoose from "mongoose";

export const FLEET_STATE_ID = "workforce-scheduler-fleet";
export const FLEET_COLLECTION = "workforce_scheduler_fleet";

/** Waves older than this are treated as abandoned and restarted. */
export const FLEET_WAVE_STALE_MS = Math.max(
  60_000,
  Number(process.env.WORKFORCE_SCHEDULER_WAVE_STALE_MS) || 24 * 60 * 60 * 1000
);

const FleetStateSchema = new mongoose.Schema(
  {
    _id: { type: String },
    waveStartedAt: { type: Date, default: null },
    truncated: { type: Boolean, default: false },
    afterCompanyId: { type: String, default: null },
    updatedAt: { type: Date, default: null },
    lastInvocationAt: { type: Date, default: null },
  },
  { collection: FLEET_COLLECTION, versionKey: false }
);

export function getFleetStateModel() {
  return (
    mongoose.models.WorkforceSchedulerFleetState ||
    mongoose.model("WorkforceSchedulerFleetState", FleetStateSchema)
  );
}

export async function loadFleetProgress() {
  try {
    return await getFleetStateModel().findById(FLEET_STATE_ID).lean();
  } catch {
    return null;
  }
}

/**
 * Resume an in-progress wave, or start a new one.
 * Concurrent Vercel instances may both resume the same wave; per-company locks
 * still prevent duplicate assignments.
 */
export async function beginOrResumeSchedulerWave({ now = new Date() } = {}) {
  const Fleet = getFleetStateModel();
  const existing = await Fleet.findById(FLEET_STATE_ID).lean();
  const staleBefore = new Date(now.getTime() - FLEET_WAVE_STALE_MS);

  if (
    existing?.truncated &&
    existing.waveStartedAt &&
    new Date(existing.waveStartedAt).getTime() > staleBefore.getTime()
  ) {
    await Fleet.updateOne(
      { _id: FLEET_STATE_ID },
      { $set: { lastInvocationAt: now, updatedAt: now } }
    );
    return {
      waveStartedAt: new Date(existing.waveStartedAt),
      afterCompanyId: existing.afterCompanyId || null,
      resumed: true,
    };
  }

  const waveStartedAt = now;
  await Fleet.findOneAndUpdate(
    { _id: FLEET_STATE_ID },
    {
      $set: {
        waveStartedAt,
        truncated: true,
        afterCompanyId: null,
        updatedAt: now,
        lastInvocationAt: now,
      },
    },
    { upsert: true }
  );
  return { waveStartedAt, afterCompanyId: null, resumed: false };
}

export async function saveFleetProgress({
  waveStartedAt,
  truncated,
  afterCompanyId = null,
  now = new Date(),
} = {}) {
  await getFleetStateModel().findOneAndUpdate(
    { _id: FLEET_STATE_ID },
    {
      $set: {
        waveStartedAt: waveStartedAt || null,
        truncated: Boolean(truncated),
        afterCompanyId: afterCompanyId ? String(afterCompanyId) : null,
        updatedAt: now,
        lastInvocationAt: now,
      },
    },
    { upsert: true }
  );
}

export async function clearFleetProgress({ now = new Date() } = {}) {
  await getFleetStateModel().findOneAndUpdate(
    { _id: FLEET_STATE_ID },
    {
      $set: {
        waveStartedAt: null,
        truncated: false,
        afterCompanyId: null,
        updatedAt: now,
        lastInvocationAt: now,
      },
    },
    { upsert: true }
  );
}

/**
 * A company still needs work in this wave when it has never completed a full run
 * at/after waveStartedAt, or its last summary was truncated mid-queue.
 */
export function companyNeedsSchedulerRun(company, waveStartedAt) {
  const ws = company?.config?.workforceScheduler || {};
  const summary = ws.lastRunSummary || {};
  if (summary.truncated === true) return true;
  if (!ws.lastRunAt) return true;
  if (!waveStartedAt) return true;
  return new Date(ws.lastRunAt).getTime() < new Date(waveStartedAt).getTime();
}
