/**
 * Fail-closed ownership helpers for employee-owned sensitive resources
 * (documents, payslips). Phase A6.2 B1d — preparation only; routes are not
 * permission-migrated yet.
 *
 * Access is allowed when:
 *  1. The actor is HR_ADMIN (preserves current HR unrestricted access), or
 *  2. The actor is the linked owner of the target employee record.
 *
 * Any other identity role is denied. Do not treat "not EMPLOYEE" as allow.
 * Ownership is based on stable user↔employee links (userId / employeeId),
 * never display names.
 */

import { USER_ROLES, isHrPortalOperator } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";

function idString(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value.toString === "function") return value.toString();
  return String(value);
}

/**
 * True when the authenticated user is linked to the target employee record.
 */
export function isLinkedEmployeeOwner(user, employee) {
  if (!user || !employee) return false;

  const employeeId = idString(employee._id || employee.id);
  const userEmployeeId = idString(user.employeeId);
  if (employeeId && userEmployeeId && employeeId === userEmployeeId) {
    return true;
  }

  const employeeUserId = idString(employee.userId);
  const actorUserId = idString(user._id || user.id);
  if (employeeUserId && actorUserId && employeeUserId === actorUserId) {
    return true;
  }

  return false;
}

/**
 * Assert the actor may access a resource owned by targetEmployee
 * (e.g. document download/upload target).
 */
export function assertCanAccessEmployeeOwnedResource({
  user,
  targetEmployee,
  denyMessage = "You do not have access to this resource",
} = {}) {
  if (!user) {
    throw new HttpError(401, "Authentication required");
  }
  if (!targetEmployee) {
    throw new HttpError(404, "Employee not found");
  }

  if (isHrPortalOperator(user.role)) {
    return { allowed: true, via: user.role === USER_ROLES.HR_ADMIN ? "HR_ADMIN" : "COMPANY_ADMIN" };
  }

  if (isLinkedEmployeeOwner(user, targetEmployee)) {
    return { allowed: true, via: "OWNER" };
  }

  throw new HttpError(403, denyMessage, { code: "FORBIDDEN" });
}

/**
 * Assert the actor may access a payslip belonging to payslip.employeeId.
 * viewerEmployee must be the actor's linked employee when not HR_ADMIN.
 */
export function assertCanAccessPayslip({
  user,
  viewerEmployee,
  payslip,
  denyMessage = "Access denied: You are not authorized to view or download this payslip.",
} = {}) {
  if (!user) {
    throw new HttpError(401, "Authentication required");
  }
  if (!payslip) {
    throw new HttpError(404, "Payslip not found.");
  }

  if (isHrPortalOperator(user.role)) {
    return { allowed: true, via: user.role === USER_ROLES.HR_ADMIN ? "HR_ADMIN" : "COMPANY_ADMIN" };
  }

  if (
    viewerEmployee &&
    isLinkedEmployeeOwner(user, viewerEmployee) &&
    idString(payslip.employeeId) === idString(viewerEmployee._id || viewerEmployee.id)
  ) {
    return { allowed: true, via: "OWNER" };
  }

  throw new HttpError(403, denyMessage, { code: "FORBIDDEN" });
}
