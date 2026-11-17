/**
 * F43-OPS / F45 — Inventory + ensure TTL indexes only on ephemeral collections.
 *
 * Never applies TTL to business records (employees, payroll, leave, live tracking history, etc.).
 * Converting a pre-existing non-TTL index on the same key is intentional and scoped to
 * auth tokens / sessions / challenges / platform sessions / rate-limit hits.
 */

import { serializeIndexKey } from "./tenantIndexInventory.js";

function samePartial(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

async function ensureCollection(db, collectionName) {
  const existing = await db.listCollections({ name: collectionName }).toArray();
  if (existing.length === 0) {
    await db.createCollection(collectionName);
  }
}

/**
 * @param {import("mongodb").Collection} collection
 * @param {{
 *   key: Record<string, 1>,
 *   name: string,
 *   expireAfterSeconds?: number,
 *   partialFilterExpression?: object,
 * }} spec
 */
export async function ensureTtlIndex(collection, spec) {
  const {
    key,
    name,
    expireAfterSeconds = 0,
    partialFilterExpression,
  } = spec;

  const indexes = await collection.indexes();
  const matches = indexes.filter((ix) => {
    if (serializeIndexKey(ix.key) !== serializeIndexKey(key)) return false;
    return samePartial(ix.partialFilterExpression, partialFilterExpression);
  });

  for (const existing of matches) {
    const hasTtl = typeof existing.expireAfterSeconds === "number";
    if (hasTtl && existing.expireAfterSeconds === expireAfterSeconds) {
      return { status: "exists", name: existing.name, collection: collection.collectionName };
    }
    // Same key/partial without desired TTL (or wrong TTL) — drop then recreate.
    await collection.dropIndex(existing.name);
  }

  const options = { name, expireAfterSeconds };
  if (partialFilterExpression) {
    options.partialFilterExpression = partialFilterExpression;
  }
  await collection.createIndex(key, options);
  return { status: "created", name, collection: collection.collectionName };
}

/** Central-db ephemeral TTL specs (platform sessions + rate-limit hits). */
export function getCentralEphemeralTtlSpecs() {
  return [
    {
      collectionName: "platform_admin_sessions",
      key: { expiresAt: 1 },
      name: "expiresAt_ttl",
      expireAfterSeconds: 0,
    },
    {
      collectionName: "rate_limit_hits",
      key: { expiresAt: 1 },
      name: "expiresAt_ttl",
      expireAfterSeconds: 0,
    },
  ];
}

/**
 * Tenant-db ephemeral TTL specs only.
 * AuthSession uses purgeAt (not expiresAt) so mobile refresh windows stay valid.
 */
export function getTenantEphemeralTtlSpecs() {
  return [
    {
      collectionName: "authTokens",
      key: { expiresAt: 1 },
      name: "expiresAt_ttl",
      expireAfterSeconds: 0,
    },
    {
      collectionName: "attendance_verification_challenges",
      key: { expiresAt: 1 },
      name: "expiresAt_ttl",
      expireAfterSeconds: 0,
    },
    {
      collectionName: "authSessions",
      key: { purgeAt: 1 },
      name: "purgeAt_ttl",
      expireAfterSeconds: 0,
    },
  ];
}

/**
 * Backfill AuthSession.purgeAt for rows created before F45.
 * purgeAt = refreshExpiresAt || expiresAt (never earlier than access expiry alone when refresh exists).
 */
export async function backfillAuthSessionPurgeAt(collection) {
  const result = await collection.updateMany(
    {
      purgeAt: { $exists: false },
      expiresAt: { $exists: true },
    },
    [
      {
        $set: {
          purgeAt: {
            $cond: [
              {
                $and: [
                  { $ne: ["$refreshExpiresAt", null] },
                  { $gt: ["$refreshExpiresAt", "$expiresAt"] },
                ],
              },
              "$refreshExpiresAt",
              "$expiresAt",
            ],
          },
        },
      },
    ]
  );
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

export async function ensureEphemeralTtlIndexesForDb(db, specs) {
  const results = [];
  for (const spec of specs) {
    await ensureCollection(db, spec.collectionName);
    const collection = db.collection(spec.collectionName);
    results.push(await ensureTtlIndex(collection, spec));
    if (spec.collectionName === "authSessions" && spec.name === "purgeAt_ttl") {
      results.push({
        status: "backfill",
        collection: "authSessions",
        ...(await backfillAuthSessionPurgeAt(collection)),
      });
    }
  }
  return results;
}

export async function ensureCentralEphemeralTtlIndexes(connection) {
  const db = connection?.db;
  if (!db) return [];
  return ensureEphemeralTtlIndexesForDb(db, getCentralEphemeralTtlSpecs());
}

export async function ensureTenantEphemeralTtlIndexes(connection) {
  const db = connection?.db;
  if (!db) return [];
  return ensureEphemeralTtlIndexesForDb(db, getTenantEphemeralTtlSpecs());
}

/**
 * Read-only inventory of TTL indexes on a db (expireAfterSeconds present).
 */
export async function inventoryTtlIndexes(db) {
  const collections = await db.listCollections().toArray();
  const out = [];
  for (const col of collections) {
    const name = col.name;
    if (!name || name.startsWith("system.")) continue;
    const indexes = await db.collection(name).indexes();
    for (const ix of indexes) {
      if (typeof ix.expireAfterSeconds === "number") {
        out.push({
          collection: name,
          name: ix.name,
          key: ix.key,
          expireAfterSeconds: ix.expireAfterSeconds,
          partialFilterExpression: ix.partialFilterExpression || null,
        });
      }
    }
  }
  return out;
}
