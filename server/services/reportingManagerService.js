import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";

const MAX_HIERARCHY_WALK = 64;

/**
 * True when `value` is a canonical 24-hex ObjectId string (rejects loose isValid hits).
 */
export function isStrictObjectId(value) {
  if (value == null) return false;
  const str = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(str)) return false;
  try {
    return String(new mongoose.Types.ObjectId(str)) === str;
  } catch {
    return false;
  }
}

/**
 * Parse a reportingManagerId body/import value.
 * - undefined → not provided (caller leaves field unchanged)
 * - null / "" / "null" → clear manager
 * - otherwise must be a strict ObjectId or throw
 *
 * @returns {{ provided: boolean, managerId: import("mongoose").Types.ObjectId | null | undefined }}
 */
export function parseReportingManagerInput(value) {
  if (value === undefined) {
    return { provided: false, managerId: undefined };
  }
  if (value === null || value === "" || value === "null" || value === "undefined") {
    return { provided: true, managerId: null };
  }
  const str = String(value).trim();
  if (!str) {
    return { provided: true, managerId: null };
  }
  if (!isStrictObjectId(str)) {
    throw new HttpError(400, "Invalid reporting manager reference.", {
      field: "reportingManagerId",
      errors: { reportingManagerId: "Invalid reporting manager reference." },
      code: "INVALID_MANAGER_ID",
    });
  }
  return { provided: true, managerId: new mongoose.Types.ObjectId(str) };
}

/**
 * Walk upward from `fromManagerId`. Returns true if `employeeId` appears in that chain
 * (assigning that manager would create a cycle).
 */
export async function wouldCreateReportingCycle(Employee, employeeId, fromManagerId) {
  if (!employeeId || !fromManagerId) return false;

  const target = String(employeeId);
  let current = fromManagerId;
  const visited = new Set();

  for (let depth = 0; depth < MAX_HIERARCHY_WALK; depth += 1) {
    if (!current) return false;
    const currentStr = String(current);
    if (currentStr === target) return true;
    if (visited.has(currentStr)) {
      // Corrupt existing cycle — treat as unsafe for further assignment along this chain.
      return true;
    }
    visited.add(currentStr);

    const node = await Employee.findById(current).select("job.reportingManagerId").lean();
    if (!node) return false;
    current = node.job?.reportingManagerId || null;
  }

  throw new HttpError(400, "Reporting hierarchy is too deep to validate safely.", {
    field: "reportingManagerId",
    errors: { reportingManagerId: "Reporting hierarchy is too deep to validate safely." },
    code: "HIERARCHY_TOO_DEEP",
  });
}

/**
 * Validate assigning `managerId` as the reporting manager of `employeeId`.
 * Same-company is enforced by querying the tenant `Employee` model from getCompanyModels().
 *
 * @param {object} opts
 * @param {*} opts.Employee - tenant Employee model
 * @param {string|null} [opts.employeeId] - subject being updated (null on create)
 * @param {import("mongoose").Types.ObjectId|string|null} opts.managerId - null clears
 * @returns {Promise<import("mongoose").Types.ObjectId|null>}
 */
export async function assertValidReportingManagerAssignment({ Employee, employeeId = null, managerId }) {
  if (managerId == null || managerId === "") {
    return null;
  }

  if (!isStrictObjectId(managerId)) {
    throw new HttpError(400, "Invalid reporting manager reference.", {
      field: "reportingManagerId",
      errors: { reportingManagerId: "Invalid reporting manager reference." },
      code: "INVALID_MANAGER_ID",
    });
  }

  const managerObjectId = new mongoose.Types.ObjectId(String(managerId));

  if (employeeId && String(employeeId) === String(managerObjectId)) {
    throw new HttpError(400, "An employee cannot report to themselves.", {
      field: "reportingManagerId",
      errors: { reportingManagerId: "An employee cannot report to themselves." },
      code: "SELF_REPORTING",
    });
  }

  const manager = await Employee.findById(managerObjectId).select("_id").lean();
  if (!manager) {
    throw new HttpError(400, "Reporting manager not found in this company.", {
      field: "reportingManagerId",
      errors: { reportingManagerId: "Reporting manager not found in this company." },
      code: "MANAGER_NOT_FOUND",
    });
  }

  if (employeeId) {
    const createsCycle = await wouldCreateReportingCycle(Employee, employeeId, managerObjectId);
    if (createsCycle) {
      throw new HttpError(400, "This assignment would create a circular reporting relationship.", {
        field: "reportingManagerId",
        errors: { reportingManagerId: "This assignment would create a circular reporting relationship." },
        code: "CIRCULAR_REPORTING",
      });
    }
  }

  return managerObjectId;
}

/**
 * Best-effort resolve of OfferLetter.reportingManager (free-text name or id) to an Employee id.
 * Never returns a fabricated id. Ambiguous or missing matches → null.
 */
export async function resolveReportingManagerFromOfferHint(Employee, hint) {
  if (hint == null) return null;
  const text = String(hint).trim();
  if (!text) return null;

  // Prefer exact ObjectId when it points at a real employee in this tenant DB.
  if (isStrictObjectId(text)) {
    const byId = await Employee.findById(text).select("_id").lean();
    return byId ? byId._id : null;
  }

  // Unambiguous exact fullName match only (case-insensitive).
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = await Employee.find({
    fullName: new RegExp(`^${escaped}$`, "i"),
  })
    .select("_id")
    .limit(2)
    .lean();

  if (matches.length === 1) {
    return matches[0]._id;
  }
  return null;
}
