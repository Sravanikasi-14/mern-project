import { HttpError } from "../utils/httpError.js";
import { resolvePlanRecordForCompany } from "./platformPlanService.js";
import { shouldPersistDocumentsToGridFs } from "./documentStorage.js";

/**
 * Storage limit enforcement (Batch 4).
 *
 * Reliable usage is only available when the tenant uses GridFS (files.length sum).
 * Disk-backed uploads and mixed modes cannot be accurately totaled from central metadata —
 * those paths document the limitation and skip hard enforcement rather than invent usage.
 */
export async function getTenantStorageUsageBytes(connection) {
  if (!connection?.db || !shouldPersistDocumentsToGridFs(connection)) {
    return {
      available: false,
      usedBytes: null,
      reason: "STORAGE_USAGE_UNAVAILABLE",
      detail:
        "Exact tenant storage accounting requires GridFS. Disk or mixed storage is not aggregated.",
    };
  }

  try {
    const rows = await connection.db
      .collection("hr_documents.files")
      .aggregate([{ $group: { _id: null, total: { $sum: "$length" } } }])
      .toArray();
    return {
      available: true,
      usedBytes: Number(rows[0]?.total) || 0,
      reason: null,
      detail: null,
    };
  } catch {
    return {
      available: false,
      usedBytes: null,
      reason: "STORAGE_USAGE_UNAVAILABLE",
      detail: "Unable to read GridFS usage for this tenant.",
    };
  }
}

export async function assertStorageAllowsUpload({ company, connection, incomingBytes = 0 }) {
  const plan = await resolvePlanRecordForCompany(company);
  const maxStorageMb = Number(plan?.maxStorageMb) || 0;
  if (maxStorageMb <= 0) {
    // 0 = unlimited / not enforced
    return { enforced: false, maxStorageMb: 0 };
  }

  const usage = await getTenantStorageUsageBytes(connection);
  if (!usage.available) {
    // Fail open with documentation rather than inventing usage numbers.
    return {
      enforced: false,
      maxStorageMb,
      usageUnavailable: true,
      reason: usage.reason,
    };
  }

  const maxBytes = maxStorageMb * 1024 * 1024;
  const next = usage.usedBytes + Math.max(0, Number(incomingBytes) || 0);
  if (next > maxBytes) {
    throw new HttpError(
      403,
      `Storage limit reached (${maxStorageMb} MB). Free space or upgrade the plan before uploading.`,
      {
        code: "STORAGE_LIMIT_REACHED",
        maxStorageMb,
        usedBytes: usage.usedBytes,
      }
    );
  }

  return {
    enforced: true,
    maxStorageMb,
    usedBytes: usage.usedBytes,
  };
}
