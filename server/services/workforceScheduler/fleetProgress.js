/**
 * F41 — Durable multi-tenant scheduler progress on the central MongoDB.
 *
 * Stores a wave cursor so truncated Vercel invocations can resume without Redis.
 * Per-company lastRunAt / lastRunSummary remain the source of "completed in this wave".
 *
 * NEW-S3: beginOrResumeSchedulerWave uses compare-and-set so concurrent invocations
 * converge on one waveStartedAt and do not reset an active wave's cursor.
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

function isActiveTruncatedWave(doc, staleBefore) {
  return Boolean(
    doc?.truncated &&
      doc.waveStartedAt &&
      new Date(doc.waveStartedAt).getTime() > staleBefore.getTime()
  );
}

/**
 * Resume an in-progress wave, or start a new one (CAS).
 * Concurrent Vercel instances converge on a single waveStartedAt; per-company locks
 * still prevent duplicate assignments.
 */
export async function beginOrResumeSchedulerWave({ now = new Date() } = {}) {
  const Fleet = getFleetStateModel();
  const staleBefore = new Date(now.getTime() - FLEET_WAVE_STALE_MS);

  // CAS resume: heartbeat only — never reset afterCompanyId / waveStartedAt.
  const resumed = await Fleet.findOneAndUpdate(
    {
      _id: FLEET_STATE_ID,
      truncated: true,
      waveStartedAt: { $gt: staleBefore },
    },
    { $set: { lastInvocationAt: now, updatedAt: now } },
    { returnDocument: "after" }
  );
  if (resumed) {
    return {
      waveStartedAt: new Date(resumed.waveStartedAt),
      afterCompanyId: resumed.afterCompanyId || null,
      resumed: true,
    };
  }

  const waveStartedAt = now;

  // CAS start: only when complete, missing fields, or stale — never clobber active wave.
  const started = await Fleet.findOneAndUpdate(
    {
      _id: FLEET_STATE_ID,
      $or: [
        { truncated: false },
        { truncated: { $exists: false } },
        { waveStartedAt: null },
        { waveStartedAt: { $lte: staleBefore } },
      ],
    },
    {
      $set: {
        waveStartedAt,
        truncated: true,
        afterCompanyId: null,
        updatedAt: now,
        lastInvocationAt: now,
      },
    },
    { returnDocument: "after" }
  );

  if (started && new Date(started.waveStartedAt).getTime() === waveStartedAt.getTime()) {
    return { waveStartedAt, afterCompanyId: null, resumed: false };
  }

  if (started && isActiveTruncatedWave(started, staleBefore)) {
    return {
      waveStartedAt: new Date(started.waveStartedAt),
      afterCompanyId: started.afterCompanyId || null,
      resumed: true,
    };
  }

  // Document missing — create. Duplicate key means a peer won the race.
  try {
    await Fleet.create({
      _id: FLEET_STATE_ID,
      waveStartedAt,
      truncated: true,
      afterCompanyId: null,
      updatedAt: now,
      lastInvocationAt: now,
    });
    return { waveStartedAt, afterCompanyId: null, resumed: false };
  } catch (err) {
    const code = err?.code || err?.cause?.code;
    if (code !== 11000) throw err;
  }

  // Lost the start race: converge on the winner (preserve cursor).
  const existing = await Fleet.findById(FLEET_STATE_ID).lean();
  if (isActiveTruncatedWave(existing, staleBefore)) {
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
  heartbeatOnly = false,
} = {}) {
  if (heartbeatOnly) {
    await getFleetStateModel().findOneAndUpdate(
      { _id: FLEET_STATE_ID },
      { $set: { lastInvocationAt: now, updatedAt: now } },
      { upsert: true }
    );
    return;
  }
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

/**
 * NEW-S2 — Furthest contiguous fully-completed company id along the ordered pending list.
 * Used for durable mid-wave checkpoints without skipping truncated tenants.
 */
export function contiguousCompletedCursor(
  orderedCompanies,
  completedFullyIds,
  resumeAfterCompanyId = null
) {
  const completed =
    completedFullyIds instanceof Set
      ? completedFullyIds
      : new Set(completedFullyIds || []);
  let cursor = resumeAfterCompanyId ? String(resumeAfterCompanyId) : null;
  for (const company of orderedCompanies || []) {
    const id = String(company._id);
    if (!completed.has(id)) break;
    cursor = id;
  }
  return cursor;
}
