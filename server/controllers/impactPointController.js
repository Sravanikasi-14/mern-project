import { HttpError } from "../utils/httpError.js";
import { USER_ROLES } from "../models/User.js";
import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import {
  getAuthenticatedEmployee,
  awardManagerRecognitionService,
  reverseTransactionService,
  getLeaderboardService,
  getEmployeePointsSummaryService,
} from "../services/workManagementService.js";

/**
 * Returns the authenticated employee's personal Impact Points summary,
 * total balance, ranking, and recent transactions.
 */
export async function getMyPointsSummary(req, res, next) {
  try {
    const actorEmployee = await getAuthenticatedEmployee(req.auth.models, req.auth.user);
    if (!actorEmployee) {
      throw new HttpError(404, "Employee record not found for the authenticated user.");
    }

    const summary = await getEmployeePointsSummaryService({
      models: req.auth.models,
      employeeId: actorEmployee._id,
    });

    res.status(200).json({
      success: true,
      summary,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Returns a specific employee's points summary (HR Admin or manager).
 */
export async function getEmployeePointsSummary(req, res, next) {
  try {
    const actorEmployee = await getAuthenticatedEmployee(req.auth.models, req.auth.user);
    const isHrAdmin = req.auth.user.role === USER_ROLES.HR_ADMIN;
    const targetEmployeeId = req.params.employeeId;

    if (!isHrAdmin) {
      const targetEmp = await req.auth.models.Employee.findById(targetEmployeeId);
      const isManager = actorEmployee && targetEmp?.job?.reportingManagerId && String(targetEmp.job.reportingManagerId) === String(actorEmployee._id);
      const isSelf = actorEmployee && String(actorEmployee._id) === String(targetEmployeeId);

      if (!isManager && !isSelf) {
        throw new HttpError(403, "You do not have permission to view this employee's impact points summary.");
      }
    }

    const summary = await getEmployeePointsSummaryService({
      models: req.auth.models,
      employeeId: targetEmployeeId,
    });

    res.status(200).json({
      success: true,
      summary,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Computes company and department-level leaderboards dynamically from the ledger.
 */
export async function getLeaderboard(req, res, next) {
  try {
    const { department = "ALL", period, startDate, endDate, limit = 50 } = req.query;

    const leaderboard = await getLeaderboardService({
      models: req.auth.models,
      department,
      period,
      startDate,
      endDate,
      limit,
    });

    res.status(200).json({
      success: true,
      department: department || "ALL",
      count: leaderboard.length,
      leaderboard,
      data: { leaderboard },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Awards manager recognition points to an eligible subordinate.
 */
export async function awardRecognition(req, res, next) {
  try {
    const recipientEmployeeId =
      req.body.recipientEmployeeId || req.body.recipientId || req.body.employeeId;
    const { points, reason, ruleCode } = req.body;

    const transaction = await awardManagerRecognitionService({
      models: req.auth.models,
      user: req.auth.user,
      recipientEmployeeId,
      points,
      reason,
      ruleCode,
    });

    res.status(201).json({
      success: true,
      message: `Successfully recognized employee with ${transaction.points} Impact Points!`,
      transaction,
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Lists all Impact Point transactions for HR reporting and audit inspection.
 */
export async function getTransactionLedger(req, res, next) {
  try {
    const { ImpactPointTransaction } = req.auth.models;
    const isHrAdmin = req.auth.user.role === USER_ROLES.HR_ADMIN;
    const actorEmployee = await getAuthenticatedEmployee(req.auth.models, req.auth.user);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { employeeId, department, source, transactionType, startDate, endDate } = req.query;

    const query = {};

    // Scope check: employees can only see their own transactions
    if (!isHrAdmin) {
      if (!actorEmployee) {
        return res.status(200).json({ success: true, transactions: [], pagination: { total: 0, page, limit, pages: 1 } });
      }
      query.employeeId = actorEmployee._id;
    } else if (employeeId) {
      query.employeeId = employeeId;
    }

    if (department && department !== "ALL") {
      query["employeeSnapshot.department"] = department;
    }
    if (source) {
      query.source = source;
    }
    if (transactionType) {
      query.transactionType = transactionType;
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const [total, transactions] = await Promise.all([
      ImpactPointTransaction.countDocuments(query),
      ImpactPointTransaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const pagination = {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    };

    res.status(200).json({
      success: true,
      transactions,
      pagination,
      data: {
        transactions,
        pagination,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Reverses an erroneous or disputed transaction (HR Admin only).
 */
export async function reverseTransaction(req, res, next) {
  try {
    const { reason } = req.body;
    const result = await reverseTransactionService({
      models: req.auth.models,
      user: req.auth.user,
      transactionId: req.params.id,
      reason,
    });

    res.status(200).json({
      success: true,
      message: "Transaction successfully reversed in the immutable ledger.",
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Returns current policy Impact Point rules.
 */
export async function getImpactPointRules(req, res, next) {
  try {
    const { CompanyHrPolicy } = req.auth.models;
    const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
    res.status(200).json({
      success: true,
      impactPointRules: policy?.impactPointRules || {},
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Updates Impact Point rules inside the active CompanyHrPolicy (HR Admin only).
 */
export async function updateImpactPointRules(req, res, next) {
  try {
    const { CompanyHrPolicy, AuditLog } = req.auth.models;
    if (req.auth.user.role !== USER_ROLES.HR_ADMIN) {
      throw new HttpError(403, "Only HR Administrators can configure Impact Points rules.");
    }

    const policy = await CompanyHrPolicy.findOne().sort({ effectiveFromDate: -1 });
    if (!policy) {
      throw new HttpError(404, "Active company HR policy document not found.");
    }

    const { enabled, rules, managerMonthlyCap, allowRuleStacking } = req.body;

    if (enabled !== undefined) {
      policy.impactPointRules.enabled = Boolean(enabled);
    }
    if (managerMonthlyCap !== undefined) {
      policy.impactPointRules.managerMonthlyCap = Number(managerMonthlyCap) || 100;
    }
    if (allowRuleStacking !== undefined) {
      policy.impactPointRules.allowRuleStacking = Boolean(allowRuleStacking);
    }
    if (Array.isArray(rules)) {
      policy.impactPointRules.rules = rules.map((r) => ({
        ruleCode: String(r.ruleCode || "").trim(),
        name: String(r.name || "").trim(),
        description: String(r.description || "").trim(),
        points: parseInt(r.points, 10) || 0,
        eventType: String(r.eventType || "").trim(),
        isEnabled: Boolean(r.isEnabled),
      }));
    }

    policy.updatedBy = req.auth.user._id;
    policy.markModified("impactPointRules");
    await policy.save();

    if (AuditLog) {
      try {
        await AuditLog.create({
          actorUserId: req.auth.user._id,
          actorEmail: req.auth.user.email,
          actorRole: req.auth.user.role,
          action: "HR_POLICY_UPDATED",
          targetType: "CompanyHrPolicy",
          targetId: policy._id,
          changes: { impactPointRules: policy.impactPointRules },
          timestamp: new Date(),
        });
      } catch {
        // Non-blocking
      }
    }

    res.status(200).json({
      success: true,
      message: "Impact Point rules updated successfully",
      impactPointRules: policy.impactPointRules,
    });
  } catch (error) {
    next(error);
  }
}
