/**
 * Offer letter employeeId uniqueness index — ensure + explicit migration.
 *
 * Legacy (pre-uniqueness): non-unique { employeeId: 1 } named "employeeId_1"
 * Desired: unique partial on ObjectId employeeId with a stable explicit name.
 *
 * Ordinary startup never drops indexes. Set applyMigration:true (or run the
 * migrate script) only after reviewing the dry-run report.
 */

export const OFFER_LETTER_EMPLOYEE_ID_INDEX = Object.freeze({
  name: "uniq_offer_letter_employeeId_objectId",
  key: Object.freeze({ employeeId: 1 }),
  unique: true,
  partialFilterExpression: Object.freeze({ employeeId: { $type: "objectId" } }),
});

export const LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME = "employeeId_1";

function sameKey(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function isDesiredIndex(idx) {
  if (!idx || !sameKey(idx.key, OFFER_LETTER_EMPLOYEE_ID_INDEX.key)) return false;
  if (idx.name !== OFFER_LETTER_EMPLOYEE_ID_INDEX.name) return false;
  if (!idx.unique) return false;
  const pfe = idx.partialFilterExpression || {};
  return pfe.employeeId?.$type === "objectId" || pfe.employeeId === "objectId";
}

/**
 * Legacy: same key, auto name employeeId_1, missing unique and/or partial filter.
 */
export function isLegacyEmployeeIdIndex(idx) {
  if (!idx || !sameKey(idx.key, { employeeId: 1 })) return false;
  if (idx.name !== LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME) return false;
  if (idx.unique) return false;
  if (idx.partialFilterExpression) return false;
  return true;
}

export async function findDuplicateOfferLetterEmployeeIds(collection) {
  return collection
    .aggregate([
      { $match: { employeeId: { $type: "objectId" } } },
      {
        $group: {
          _id: "$employeeId",
          count: { $sum: 1 },
          offerIds: { $push: "$_id" },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
}

/**
 * @param {import('mongodb').Db} db
 * @param {{ applyMigration?: boolean }} [options]
 */
export async function ensureOfferLetterEmployeeIdIndex(db, { applyMigration = false } = {}) {
  if (!db) throw new Error("ensureOfferLetterEmployeeIdIndex requires a tenant db handle");

  const collection = db.collection("offer_letters");
  const indexes = await collection.indexes();
  const desired = indexes.find((idx) => isDesiredIndex(idx));
  const legacy = indexes.find((idx) => isLegacyEmployeeIdIndex(idx));
  const sameKeyOther = indexes.find(
    (idx) =>
      sameKey(idx.key, OFFER_LETTER_EMPLOYEE_ID_INDEX.key) &&
      idx.name !== OFFER_LETTER_EMPLOYEE_ID_INDEX.name &&
      !isLegacyEmployeeIdIndex(idx) &&
      !isDesiredIndex(idx)
  );

  const base = {
    collection: "offer_letters",
    desiredName: OFFER_LETTER_EMPLOYEE_ID_INDEX.name,
    legacyName: LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME,
    applied: false,
    droppedLegacy: false,
    createdDesired: false,
  };

  if (desired && !legacy) {
    return {
      ...base,
      status: "ok",
      message: `Desired index "${OFFER_LETTER_EMPLOYEE_ID_INDEX.name}" is present.`,
      indexesBefore: indexes.map((i) => i.name),
    };
  }

  if (desired && legacy) {
    // Desired already created somehow; legacy leftover — still requires explicit drop
    if (!applyMigration) {
      return {
        ...base,
        status: "migration_required",
        message:
          `Desired index exists alongside legacy "${LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME}". ` +
          `Re-run with applyMigration:true (or the migrate script) to drop the legacy index only.`,
        legacy,
        desired,
      };
    }
    await collection.dropIndex(LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME);
    return {
      ...base,
      status: "ok",
      applied: true,
      droppedLegacy: true,
      message: `Dropped leftover legacy index "${LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME}".`,
    };
  }

  if (sameKeyOther) {
    return {
      ...base,
      status: "error",
      message:
        `Unexpected employeeId index "${sameKeyOther.name}" with options incompatible with ` +
        `${OFFER_LETTER_EMPLOYEE_ID_INDEX.name}. Manual review required.`,
      conflicting: sameKeyOther,
    };
  }

  const duplicates = await findDuplicateOfferLetterEmployeeIds(collection);

  if (legacy) {
    if (duplicates.length) {
      return {
        ...base,
        status: "error",
        message:
          `Cannot create unique employeeId index: ${duplicates.length} duplicate ObjectId employeeId value(s) ` +
          `in offer_letters. Resolve duplicates before migrating.`,
        duplicates: duplicates.map((d) => ({
          employeeId: String(d._id),
          count: d.count,
          offerIds: (d.offerIds || []).map((id) => String(id)),
        })),
        legacy,
      };
    }

    if (!applyMigration) {
      return {
        ...base,
        status: "migration_required",
        message:
          `Legacy non-unique index "${LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME}" blocks ` +
          `"${OFFER_LETTER_EMPLOYEE_ID_INDEX.name}" (unique + partial ObjectId). ` +
          `No duplicate ObjectId employeeIds detected. ` +
          `Run: node server/scripts/migrateOfferLetterEmployeeIdIndex.js --apply ` +
          `or provision with APPLY_OFFER_LETTER_EMPLOYEEID_INDEX_MIGRATION=true.`,
        legacy,
        duplicates: [],
      };
    }

    // Explicit migration: drop known-safe legacy, then create desired.
    await collection.dropIndex(LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME);
    await collection.createIndex(OFFER_LETTER_EMPLOYEE_ID_INDEX.key, {
      name: OFFER_LETTER_EMPLOYEE_ID_INDEX.name,
      unique: OFFER_LETTER_EMPLOYEE_ID_INDEX.unique,
      partialFilterExpression: { ...OFFER_LETTER_EMPLOYEE_ID_INDEX.partialFilterExpression },
    });

    const after = await collection.indexes();
    const created = after.find((idx) => isDesiredIndex(idx));
    if (!created) {
      return {
        ...base,
        status: "error",
        applied: true,
        droppedLegacy: true,
        message: `Legacy index dropped but desired index "${OFFER_LETTER_EMPLOYEE_ID_INDEX.name}" was not found after createIndex.`,
        indexesAfter: after.map((i) => i.name),
      };
    }

    return {
      ...base,
      status: "ok",
      applied: true,
      droppedLegacy: true,
      createdDesired: true,
      message: `Migrated offer_letters employeeId index to "${OFFER_LETTER_EMPLOYEE_ID_INDEX.name}".`,
      indexesAfter: after.map((i) => ({
        name: i.name,
        key: i.key,
        unique: Boolean(i.unique),
        partialFilterExpression: i.partialFilterExpression || null,
      })),
    };
  }

  // No legacy, no desired — create on new / clean tenants
  if (duplicates.length) {
    return {
      ...base,
      status: "error",
      message:
        `Cannot create unique employeeId index: ${duplicates.length} duplicate ObjectId employeeId value(s).`,
      duplicates: duplicates.map((d) => ({
        employeeId: String(d._id),
        count: d.count,
      })),
    };
  }

  await collection.createIndex(OFFER_LETTER_EMPLOYEE_ID_INDEX.key, {
    name: OFFER_LETTER_EMPLOYEE_ID_INDEX.name,
    unique: OFFER_LETTER_EMPLOYEE_ID_INDEX.unique,
    partialFilterExpression: { ...OFFER_LETTER_EMPLOYEE_ID_INDEX.partialFilterExpression },
  });

  return {
    ...base,
    status: "ok",
    createdDesired: true,
    message: `Created "${OFFER_LETTER_EMPLOYEE_ID_INDEX.name}" on offer_letters.`,
  };
}
