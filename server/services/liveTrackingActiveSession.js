/**
 * F73 — helpers for single-ACTIVE LiveTrackingSession invariant.
 * Never deletes historical sessions; only STOPPED status transitions for duplicates.
 */

import { TRACKING_STATUSES } from "../models/LiveTrackingSession.js";

export const ACTIVE_EMPLOYEE_UNIQUE_INDEX = Object.freeze({
  key: { employeeId: 1 },
  name: "uniq_live_tracking_active_employeeId",
  unique: true,
  partialFilterExpression: { status: TRACKING_STATUSES.ACTIVE },
});

/**
 * Find employees with more than one ACTIVE live tracking session.
 * @param {import("mongoose").Model} LiveTrackingSession
 */
export async function inventoryDuplicateActiveSessions(LiveTrackingSession) {
  const rows = await LiveTrackingSession.aggregate([
    { $match: { status: TRACKING_STATUSES.ACTIVE } },
    {
      $group: {
        _id: "$employeeId",
        count: { $sum: 1 },
        newestStartedAt: { $max: "$startedAt" },
        sessionIds: { $push: "$_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);

  return rows.map((row) => ({
    employeeId: row._id,
    count: row.count,
    newestStartedAt: row.newestStartedAt,
    sessionIds: row.sessionIds,
  }));
}

/**
 * Keep the newest ACTIVE session (by startedAt, then _id); stop the rest.
 * @param {import("mongoose").Model} LiveTrackingSession
 * @param {{ apply?: boolean }} [options]
 */
export async function cleanupDuplicateActiveSessions(
  LiveTrackingSession,
  { apply = false } = {}
) {
  const duplicates = await inventoryDuplicateActiveSessions(LiveTrackingSession);
  let wouldStop = 0;
  let stopped = 0;
  const details = [];

  for (const group of duplicates) {
    const sessions = await LiveTrackingSession.find({
      _id: { $in: group.sessionIds },
      status: TRACKING_STATUSES.ACTIVE,
    })
      .select("_id startedAt createdAt")
      .lean();

    sessions.sort((a, b) => {
      const aTime = new Date(a.startedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.startedAt || b.createdAt || 0).getTime();
      if (bTime !== aTime) return bTime - aTime;
      return String(b._id).localeCompare(String(a._id));
    });

    const keep = sessions[0];
    const stopIds = sessions.slice(1).map((s) => s._id);
    wouldStop += stopIds.length;

    details.push({
      employeeId: String(group.employeeId),
      keepId: keep ? String(keep._id) : null,
      stopIds: stopIds.map(String),
      applied: false,
    });

    if (!apply || stopIds.length === 0) continue;

    const result = await LiveTrackingSession.updateMany(
      {
        _id: { $in: stopIds },
        status: TRACKING_STATUSES.ACTIVE,
      },
      {
        $set: {
          status: TRACKING_STATUSES.STOPPED,
          stoppedAt: new Date(),
        },
      }
    );
    const n =
      typeof result.modifiedCount === "number"
        ? result.modifiedCount
        : typeof result.nModified === "number"
          ? result.nModified
          : 0;
    stopped += n;
    details[details.length - 1].applied = true;
    details[details.length - 1].stoppedCount = n;
  }

  return {
    duplicateGroups: duplicates.length,
    wouldStop,
    stopped: apply ? stopped : 0,
    apply: Boolean(apply),
    details,
  };
}

export function isDuplicateKeyError(err) {
  if (!err) return false;
  if (err.code === 11000) return true;
  const msg = String(err.message || "");
  return msg.includes("E11000") || msg.includes("duplicate key");
}

/**
 * Ensure the unique partial ACTIVE index exists.
 * May replace a same-named index with wrong options. Does not drop employeeId_1.
 * Caller must cleanup duplicate ACTIVE rows first.
 * @param {import("mongodb").Collection} collection
 */
export async function ensureActiveEmployeeUniqueIndex(collection) {
  const desired = ACTIVE_EMPLOYEE_UNIQUE_INDEX;
  const indexes = await collection.indexes();
  const existing = indexes.find((ix) => ix.name === desired.name);
  const matches =
    existing &&
    existing.unique === true &&
    JSON.stringify(existing.partialFilterExpression || null) ===
      JSON.stringify(desired.partialFilterExpression);

  if (matches) {
    return { status: "exists", name: desired.name };
  }

  if (existing) {
    await collection.dropIndex(existing.name);
  }

  await collection.createIndex(desired.key, {
    name: desired.name,
    unique: true,
    partialFilterExpression: desired.partialFilterExpression,
  });
  return { status: "created", name: desired.name };
}
