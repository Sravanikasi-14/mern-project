import mongoose from "mongoose";
import Company from "../models/Company.js";
import { HttpError } from "../utils/httpError.js";

function toCompanyId(companyId) {
  if (companyId == null) return null;
  if (typeof companyId === "string" && mongoose.isValidObjectId(companyId)) {
    return companyId;
  }
  if (typeof companyId?.toHexString === "function") {
    return companyId.toHexString();
  }
  const asString = String(companyId);
  if (mongoose.isValidObjectId(asString)) return asString;
  return null;
}

/**
 * Raise seatUsage to at least knownEmployeeCount when the counter lags reality
 * (e.g. employees created before Batch 4). Never lowers the counter.
 */
export async function alignSeatUsage(companyId, knownEmployeeCount) {
  const id = toCompanyId(companyId);
  const count = Math.max(0, Number(knownEmployeeCount) || 0);
  if (!id) return;
  await Company.updateOne(
    {
      _id: id,
      $expr: { $lt: [{ $ifNull: ["$subscription.seatUsage", 0] }, count] },
    },
    { $set: { "subscription.seatUsage": count } }
  );
}

/**
 * Atomic seat reservation on the central Company document.
 * Prevents concurrent invitations from exceeding maxEmployeeSeats.
 * Downgrades never delete existing employees — only new reservations are blocked
 * when seatUsage >= maxEmployeeSeats.
 */
export async function reserveEmployeeSeat(companyId, { knownEmployeeCount = null } = {}) {
  const id = toCompanyId(companyId);
  if (!id) {
    throw new HttpError(500, "Company id required for seat reservation", {
      code: "SEAT_RESERVATION_FAILED",
    });
  }

  if (knownEmployeeCount != null) {
    await alignSeatUsage(id, knownEmployeeCount);
  }

  const company = await Company.findById(id)
    .select("subscription.maxEmployeeSeats subscription.seatUsage")
    .lean();
  if (!company) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }

  const maxSeats = Math.max(1, Number(company.subscription?.maxEmployeeSeats) || 1);

  // Initialize seatUsage if missing so $expr comparisons are reliable.
  if (company.subscription?.seatUsage == null) {
    await Company.updateOne(
      { _id: id, "subscription.seatUsage": { $exists: false } },
      { $set: { "subscription.seatUsage": 0 } }
    );
  }

  const updated = await Company.findOneAndUpdate(
    {
      _id: id,
      $expr: {
        $lt: [
          { $ifNull: ["$subscription.seatUsage", 0] },
          { $ifNull: ["$subscription.maxEmployeeSeats", 1] },
        ],
      },
    },
    { $inc: { "subscription.seatUsage": 1 } },
    { returnDocument: "after" }
  )
    .select("subscription.seatUsage subscription.maxEmployeeSeats")
    .lean();

  if (!updated) {
    throw new HttpError(
      403,
      `Employee seat limit reached (${maxSeats}). Upgrade the subscription plan or free a seat before adding more employees.`,
      {
        code: "SEAT_LIMIT_REACHED",
        maxEmployeeSeats: maxSeats,
      }
    );
  }

  return {
    seatUsage: updated.subscription?.seatUsage ?? 0,
    maxEmployeeSeats: Math.max(
      1,
      Number(updated.subscription?.maxEmployeeSeats) || maxSeats
    ),
  };
}

export async function releaseEmployeeSeat(companyId) {
  const id = toCompanyId(companyId);
  if (!id) return;
  await Company.updateOne(
    { _id: id, "subscription.seatUsage": { $gt: 0 } },
    { $inc: { "subscription.seatUsage": -1 } }
  );
}

/**
 * Sync seatUsage from an authoritative employee count (e.g. after import reconcile).
 * Never lowers below current reserved usage without an explicit count.
 */
export async function syncSeatUsageFromCount(companyId, employeeCount) {
  const id = toCompanyId(companyId);
  if (!id) return;
  const count = Math.max(0, Number(employeeCount) || 0);
  await Company.updateOne(
    { _id: id },
    { $set: { "subscription.seatUsage": count } }
  );
}
