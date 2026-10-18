import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { HttpError } from "../utils/httpError.js";
import {
  calculateEmployeeLeaveBalances,
  calculateLeaveDays,
  parseDateOnly,
  toDateString,
} from "../services/leaveService.js";
import { emitLeaveEvent } from "../services/leaveEventsService.js";

async function recordAuditLog(AuditLog, req, action, targetId, changes) {
  try {
    if (!AuditLog || !req.auth?.user) return;
    await AuditLog.create({
      actorUserId: req.auth.user._id,
      actorEmail: req.auth.user.email,
      actorRole: req.auth.user.role,
      action,
      targetType: "LeaveRequest",
      targetId,
      changes: changes || {},
      ipAddress: req.ip || "",
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("Audit log error:", err.message);
  }
}

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * Get leave summary cards metrics for HR portal
 */
export async function getLeaveSummary(req, res, next) {
  try {
    const { LeaveRequest } = req.auth.models;

    const todayDate = parseDateOnly(new Date());

    const [pending, approved, rejected, onLeaveTodayIds] = await Promise.all([
      LeaveRequest.countDocuments({ status: "PENDING" }),
      LeaveRequest.countDocuments({ status: "APPROVED" }),
      LeaveRequest.countDocuments({ status: "REJECTED" }),
      LeaveRequest.distinct("employeeId", {
        status: "APPROVED",
        fromDate: { $lte: todayDate },
        toDate: { $gte: todayDate },
      }),
    ]);

    res.json({
      success: true,
      summary: {
        pending,
        approved,
        rejected,
        onLeaveToday: onLeaveTodayIds.length,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List all leave requests for HR with search, filters, and pagination
 */
export async function getLeaveRequests(req, res, next) {
  try {
    const { LeaveRequest, Employee } = req.auth.models;

    const rawPage = parseInt(req.query.page, 10);
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 && rawLimit <= 200 ? rawLimit : 10;

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";
    const leaveType = typeof req.query.leaveType === "string" ? req.query.leaveType.trim().toUpperCase() : "";
    const fromDateParam = req.query.fromDate;
    const toDateParam = req.query.toDate;

    const query = {};

    // Filter by status
    if (status && status !== "ALL") {
      if (["PENDING", "APPROVED", "REJECTED"].includes(status)) {
        query.status = status;
      }
    }

    // Filter by leaveType
    if (leaveType && leaveType !== "ALL") {
      query.leaveTypeCode = leaveType;
    }

    // Filter by date range
    if (fromDateParam || toDateParam) {
      if (fromDateParam && toDateParam) {
        query.fromDate = { $lte: parseDateOnly(toDateParam) };
        query.toDate = { $gte: parseDateOnly(fromDateParam) };
      } else if (fromDateParam) {
        query.toDate = { $gte: parseDateOnly(fromDateParam) };
      } else if (toDateParam) {
        query.fromDate = { $lte: parseDateOnly(toDateParam) };
      }
    }

    // Search by employee name, email, or code
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      const matchedEmployees = await Employee.find({
        $or: [
          { fullName: regex },
          { email: regex },
          { employeeCode: regex },
        ],
      })
        .select("_id")
        .lean();

      const employeeIds = matchedEmployees.map((e) => e._id);
      query.employeeId = { $in: employeeIds };
    }

    const todayDate = parseDateOnly(new Date());

    const [total, requests, pendingCount, approvedCount, rejectedCount, onLeaveTodayIds] =
      await Promise.all([
        LeaveRequest.countDocuments(query),
        LeaveRequest.find(query)
          .populate("employeeId", "fullName employeeCode email job.department job.jobTitle status")
          .populate("decision.decidedBy", "email role")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        LeaveRequest.countDocuments({ status: "PENDING" }),
        LeaveRequest.countDocuments({ status: "APPROVED" }),
        LeaveRequest.countDocuments({ status: "REJECTED" }),
        LeaveRequest.distinct("employeeId", {
          status: "APPROVED",
          fromDate: { $lte: todayDate },
          toDate: { $gte: todayDate },
        }),
      ]);

    const formattedRequests = requests.map((req) => ({
      _id: req._id,
      employeeId: req.employeeId?._id || req.employeeId,
      employeeName: req.employeeId?.fullName || "Employee",
      employeeCode: req.employeeId?.employeeCode || "N/A",
      employeeEmail: req.employeeId?.email || "",
      department: req.employeeId?.job?.department || "General",
      jobTitle: req.employeeId?.job?.jobTitle || "Specialist",
      leaveTypeCode: req.leaveTypeCode,
      fromDate: toDateString(req.fromDate),
      toDate: toDateString(req.toDate),
      daysCount: req.daysCount || 1,
      reason: req.reason || "",
      status: req.status,
      decision: req.decision
        ? {
            decidedBy: req.decision.decidedBy?.email || req.decision.decidedBy || null,
            decidedAt: req.decision.decidedAt || null,
            remarks: req.decision.remarks || "",
          }
        : null,
      createdAt: req.createdAt,
      updatedAt: req.updatedAt,
    }));

    res.json({
      success: true,
      leaveRequests: formattedRequests,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      summary: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        onLeaveToday: onLeaveTodayIds.length,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get single leave request with full context and employee leave balance
 */
export async function getLeaveRequestById(req, res, next) {
  try {
    const { LeaveRequest, Employee, CompanyHrPolicy } = req.auth.models;
    const { id } = req.params;

    const leaveRequest = await LeaveRequest.findById(id)
      .populate("employeeId", "fullName employeeCode email phoneNumber job dateOfBirth")
      .populate("decision.decidedBy", "email role")
      .lean();

    if (!leaveRequest) {
      throw new HttpError(404, "Leave request not found");
    }

    const employee = leaveRequest.employeeId;
    let leaveBalance = null;
    const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
    if (employee && employee._id) {
      leaveBalance = await calculateEmployeeLeaveBalances(employee, policy, LeaveRequest);
    }

    const availableLeaveTypes = (policy?.leaveTypes || [])
      .filter((t) => t.isActive !== false)
      .map((t) => ({
        code: t.code,
        name: t.name,
        yearlyDays: t.yearlyDays,
      }));

    res.json({
      success: true,
      leaveRequest: {
        _id: leaveRequest._id,
        employee: leaveRequest.employeeId
          ? {
              _id: leaveRequest.employeeId._id,
              fullName: leaveRequest.employeeId.fullName,
              employeeCode: leaveRequest.employeeId.employeeCode,
              email: leaveRequest.employeeId.email,
              department: leaveRequest.employeeId.job?.department || "General",
              jobTitle: leaveRequest.employeeId.job?.jobTitle || "Specialist",
            }
          : null,
        leaveTypeCode: leaveRequest.leaveTypeCode,
        fromDate: toDateString(leaveRequest.fromDate),
        toDate: toDateString(leaveRequest.toDate),
        daysCount: leaveRequest.daysCount || 1,
        reason: leaveRequest.reason || "",
        status: leaveRequest.status,
        decision: leaveRequest.decision
          ? {
              decidedBy: leaveRequest.decision.decidedBy?.email || null,
              decidedAt: leaveRequest.decision.decidedAt || null,
              remarks: leaveRequest.decision.remarks || "",
            }
          : null,
        createdAt: leaveRequest.createdAt,
        updatedAt: leaveRequest.updatedAt,
      },
      leaveBalance,
      availableLeaveTypes,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Change leave type of an APPROVED leave request (HR-only)
 */
export async function changeLeaveType(req, res, next) {
  try {
    const { LeaveRequest, Employee, CompanyHrPolicy, AuditLog } = req.auth.models;
    const { id } = req.params;
    const { newLeaveType, reason } = req.body || {};

    // 1. Authorization: Only HR_ADMIN users can change leave type
    if (req.auth?.user?.role !== "HR_ADMIN") {
      throw new HttpError(403, "Access denied. Only HR administrators are authorized to change leave types.");
    }

    // 2. Validate reason explanation for auditing
    const cleanReason = typeof reason === "string" ? reason.trim() : "";
    if (!cleanReason) {
      throw new HttpError(400, "An explanation for changing the leave type is required for auditing purposes.");
    }

    // 3. Find target request
    const leaveRequest = await LeaveRequest.findById(id);
    if (!leaveRequest) {
      throw new HttpError(404, "Leave request not found");
    }

    // 4. Validate status is APPROVED
    if (leaveRequest.status !== "APPROVED") {
      throw new HttpError(
        400,
        `Leave type can only be changed for APPROVED requests. Current status: '${leaveRequest.status}'.`
      );
    }

    // 5. Validate new leave type exists and is active in company HR policy
    const cleanNewType = String(newLeaveType || "").toUpperCase().trim();
    if (!cleanNewType) {
      throw new HttpError(400, "New leave type is required.");
    }

    const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
    const activeLeaveTypes = (policy?.leaveTypes || []).filter((t) => t.isActive !== false);
    const matchedType = activeLeaveTypes.find((t) => t.code.toUpperCase() === cleanNewType);

    if (!matchedType) {
      throw new HttpError(
        400,
        `Leave type '${cleanNewType}' is invalid or inactive in the company HR policy.`
      );
    }

    const currentType = (leaveRequest.leaveTypeCode || "").toUpperCase();
    if (cleanNewType === currentType) {
      throw new HttpError(
        400,
        `The leave request is already assigned to '${cleanNewType}'. Please select a different active leave type.`
      );
    }

    // 6. Update leaveTypeCode on existing document without creating new document or altering employeeId, fromDate, toDate, status
    const oldLeaveType = leaveRequest.leaveTypeCode;
    leaveRequest.leaveTypeCode = cleanNewType;
    leaveRequest.updatedAt = new Date();
    await leaveRequest.save();

    // 7. Recalculate employee leave balances
    const employee = await Employee.findById(leaveRequest.employeeId);
    let leaveBalance = null;
    if (employee) {
      leaveBalance = await calculateEmployeeLeaveBalances(employee, policy, LeaveRequest);
    }

    // 8. Record audit log using existing approved audit convention
    if (AuditLog) {
      await recordAuditLog(
        AuditLog,
        req,
        AUDIT_ACTIONS.LEAVE_TYPE_CHANGED,
        leaveRequest._id,
        {
          employeeId: leaveRequest.employeeId,
          oldLeaveType,
          newLeaveType: cleanNewType,
          reason: cleanReason,
          fromDate: leaveRequest.fromDate,
          toDate: leaveRequest.toDate,
          daysCount: leaveRequest.daysCount,
        }
      );
    }

    // 9. Real-time cross-portal event emission
    emitLeaveEvent({
      companyId: String(req.auth.company._id),
      type: "LEAVE_TYPE_CHANGED",
      employeeId: String(leaveRequest.employeeId),
      employeeEmail: employee?.email || null,
      leaveRequestId: String(leaveRequest._id),
      oldLeaveType,
      newLeaveType: cleanNewType,
      reason: cleanReason,
    });

    res.json({
      success: true,
      message: `Leave type successfully changed from ${oldLeaveType} to ${cleanNewType}.`,
      leaveRequest: {
        _id: leaveRequest._id,
        leaveTypeCode: leaveRequest.leaveTypeCode,
        fromDate: toDateString(leaveRequest.fromDate),
        toDate: toDateString(leaveRequest.toDate),
        daysCount: leaveRequest.daysCount,
        status: leaveRequest.status,
        updatedAt: leaveRequest.updatedAt,
      },
      leaveBalance,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Approve or reject a leave request
 */
export async function decideLeaveRequest(req, res, next) {
  try {
    const { LeaveRequest, Employee, AuditLog } = req.auth.models;
    const { id } = req.params;
    const { action, remarks } = req.body || {};

    const cleanAction = String(action || "").toUpperCase().trim();
    if (!["APPROVE", "REJECT"].includes(cleanAction)) {
      throw new HttpError(400, "Invalid action. Must be 'APPROVE' or 'REJECT'.");
    }

    const targetStatus = cleanAction === "APPROVE" ? "APPROVED" : "REJECTED";

    // Atomically find and update only if currently PENDING (prevents concurrent/double decision)
    const leaveRequest = await LeaveRequest.findById(id);
    if (!leaveRequest) {
      throw new HttpError(404, "Leave request not found");
    }

    if (leaveRequest.status !== "PENDING") {
      throw new HttpError(
        409,
        `This leave request has already been processed with status '${leaveRequest.status}'. Decisions cannot be modified.`
      );
    }

    const decidedAt = new Date();
    leaveRequest.status = targetStatus;
    leaveRequest.decision = {
      decidedBy: req.auth.user._id,
      decidedAt,
      remarks: typeof remarks === "string" ? remarks.trim() : "",
    };
    await leaveRequest.save();

    // Attendance Integration:
    // If approved, update attendance logs for applicable dates
    const employee = await Employee.findById(leaveRequest.employeeId);
    if (employee && targetStatus === "APPROVED") {
      const todayStr = toDateString(new Date());
      const fromStr = toDateString(leaveRequest.fromDate);
      const toStr = toDateString(leaveRequest.toDate);

      const customFields = employee.customFields || {};
      const attendanceLogs = customFields.attendanceLogs || [];

      // Check if today falls in the approved leave window
      if (todayStr >= fromStr && todayStr <= toStr) {
        const todayLog = attendanceLogs.find((l) => l.date === todayStr);
        if (!todayLog || !todayLog.checkIn) {
          // Employee hasn't punched in today; reflect ON_LEAVE
          if (todayLog) {
            todayLog.status = "ON_LEAVE";
          } else {
            attendanceLogs.push({
              date: todayStr,
              checkIn: null,
              checkOut: null,
              status: "ON_LEAVE",
              workingHours: "--",
            });
          }
          employee.customFields = {
            ...customFields,
            attendanceLogs,
          };
          employee.markModified("customFields");
          await employee.save();
        }
      }
    }

    // Record audit log
    if (AuditLog) {
      await recordAuditLog(
        AuditLog,
        req,
        cleanAction === "APPROVE" ? AUDIT_ACTIONS.LEAVE_APPROVED : AUDIT_ACTIONS.LEAVE_REJECTED,
        leaveRequest._id,
        {
          employeeId: leaveRequest.employeeId,
          leaveTypeCode: leaveRequest.leaveTypeCode,
          fromDate: leaveRequest.fromDate,
          toDate: leaveRequest.toDate,
          daysCount: leaveRequest.daysCount,
          decision: leaveRequest.decision,
        }
      );
    }

    // Cross-portal real-time synchronization: notify employee and HR portals of decision
    emitLeaveEvent({
      companyId: String(req.auth.company._id),
      type: "LEAVE_DECIDED",
      employeeId: String(leaveRequest.employeeId),
      employeeEmail: employee ? employee.email : null,
      leaveRequestId: String(leaveRequest._id),
      status: leaveRequest.status,
      action: cleanAction,
      remarks: leaveRequest.decision.remarks,
    });

    res.json({
      success: true,
      message: `Leave request has been ${targetStatus.toLowerCase()} successfully.`,
      leaveRequest: {
        _id: leaveRequest._id,
        status: leaveRequest.status,
        decision: {
          decidedBy: req.auth.user.email,
          decidedAt: leaveRequest.decision.decidedAt,
          remarks: leaveRequest.decision.remarks,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get active Company HR Policy
 */
export async function getCompanyHrPolicy(req, res, next) {
  try {
    const { CompanyHrPolicy } = req.auth.models;
    const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
    res.json({
      success: true,
      policy,
    });
  } catch (error) {
    next(error);
  }
}
