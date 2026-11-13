/**
 * Bounded per-user notification read state (tenant-scoped collection).
 * Dual-reads legacy User.preferences.readNotificationIds until migrated.
 * New writes go only to notification_read_states (stops User array growth).
 */

export function normalizeNotificationKey(rawId) {
  return String(rawId || "")
    .replace(/^(leave|task)-/, "")
    .trim();
}

/**
 * @param {object} models
 * @param {object} user — authenticated user doc (may include preferences)
 * @returns {Promise<Set<string>>}
 */
export async function loadUserReadNotificationKeys(models, user) {
  const keys = new Set();
  if (!user?._id) return keys;

  const legacy = user.preferences?.readNotificationIds;
  if (Array.isArray(legacy)) {
    for (const id of legacy) {
      const key = normalizeNotificationKey(id);
      if (key) keys.add(key);
    }
  }

  const NotificationReadState = models.NotificationReadState;
  if (!NotificationReadState) return keys;

  const rows = await NotificationReadState.find({ userId: user._id })
    .select("notificationKey")
    .lean();
  for (const row of rows) {
    if (row?.notificationKey) keys.add(String(row.notificationKey));
  }
  return keys;
}

/**
 * Idempotent mark-read for one notification key.
 */
export async function markNotificationKeyRead(models, userId, rawId) {
  const NotificationReadState = models.NotificationReadState;
  const key = normalizeNotificationKey(rawId);
  if (!NotificationReadState || !userId || !key) {
    return { ok: false, key };
  }

  await NotificationReadState.updateOne(
    { userId, notificationKey: key },
    {
      $setOnInsert: { userId, notificationKey: key },
      $set: { readAt: new Date() },
    },
    { upsert: true }
  );
  return { ok: true, key };
}

/**
 * Verify every expected key exists for a user in notification_read_states.
 * @returns {{ ok: boolean, missing: string[] }}
 */
export async function verifyReadKeysMigrated(NotificationReadState, userId, expectedKeys) {
  const expected = [...new Set(expectedKeys.map(normalizeNotificationKey).filter(Boolean))];
  if (!NotificationReadState || !userId || expected.length === 0) {
    return { ok: true, missing: [] };
  }

  const rows = await NotificationReadState.find({
    userId,
    notificationKey: { $in: expected },
  })
    .select("notificationKey")
    .lean();

  const present = new Set(rows.map((r) => String(r.notificationKey)));
  const missing = expected.filter((k) => !present.has(k));
  return { ok: missing.length === 0, missing };
}

/**
 * Copy legacy preferences.readNotificationIds → notification_read_states.
 * Does not delete legacy array unless pruneLegacy is true AND per-user verification passes.
 */
export async function migrateLegacyReadNotificationIds(models, { pruneLegacy = false } = {}) {
  const { User, NotificationReadState } = models;
  if (!User || !NotificationReadState) {
    return {
      usersScanned: 0,
      keysMigrated: 0,
      duplicatesSkipped: 0,
      pruned: 0,
      pruneSkipped: 0,
      verificationFailures: 0,
    };
  }

  const users = await User.find({
    "preferences.readNotificationIds.0": { $exists: true },
  })
    .select("_id preferences.readNotificationIds")
    .lean();

  let keysMigrated = 0;
  let duplicatesSkipped = 0;
  let pruned = 0;
  let pruneSkipped = 0;
  let verificationFailures = 0;

  for (const user of users) {
    const ids = Array.isArray(user.preferences?.readNotificationIds)
      ? user.preferences.readNotificationIds
      : [];
    const expectedKeys = [];

    for (const raw of ids) {
      const key = normalizeNotificationKey(raw);
      if (!key) continue;
      expectedKeys.push(key);
      try {
        const result = await NotificationReadState.updateOne(
          { userId: user._id, notificationKey: key },
          {
            $setOnInsert: {
              userId: user._id,
              notificationKey: key,
              readAt: new Date(),
            },
          },
          { upsert: true }
        );
        if (result.upsertedCount > 0) keysMigrated += 1;
        else duplicatesSkipped += 1;
      } catch (err) {
        if (err?.code === 11000) duplicatesSkipped += 1;
        else throw err;
      }
    }

    if (!pruneLegacy || expectedKeys.length === 0) {
      continue;
    }

    const verification = await verifyReadKeysMigrated(
      NotificationReadState,
      user._id,
      expectedKeys
    );
    if (!verification.ok) {
      verificationFailures += 1;
      pruneSkipped += 1;
      console.warn(
        `[notificationReadState] skip prune for user ${user._id}: missing keys ` +
          verification.missing.join(",")
      );
      continue;
    }

    await User.updateOne(
      { _id: user._id },
      { $set: { "preferences.readNotificationIds": [] } }
    );
    pruned += 1;
  }

  return {
    usersScanned: users.length,
    keysMigrated,
    duplicatesSkipped,
    pruned,
    pruneSkipped,
    verificationFailures,
  };
}
