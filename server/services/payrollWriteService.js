import crypto from "node:crypto";
import { connectionSupportsTransactions } from "./onboardingEmployeeService.js";
import { calculatePayrollCycle } from "./payrollCalculationService.js";
import { HttpError } from "../utils/httpError.js";
import { PAYROLL_CYCLE_STATUSES } from "../models/PayrollCycle.js";

/**
 * F50-B — Calculation lock TTL.
 * Must safely exceed Vercel `maxDuration` (60s) so a killed invocation's lock
 * outlives the request and expires before another HR can race mid-write.
 */
export const PAYROLL_CALC_LOCK_MS = 90_000;

/**
 * F50 residual — chunk size for Payslip.insertMany inside one required transaction.
 * Keeps a single atomic commit while reducing per-command BSON pressure.
 * F50-E: async payroll remains deferred; sync create/recalc is the supported path.
 */
export const PAYSLIP_INSERT_CHUNK_SIZE = 200;

async function insertPayslipDraftsChunked(Payslip, drafts, session) {
  if (!drafts?.length) return;
  for (let i = 0; i < drafts.length; i += PAYSLIP_INSERT_CHUNK_SIZE) {
    const chunk = drafts.slice(i, i + PAYSLIP_INSERT_CHUNK_SIZE);
    await Payslip.insertMany(chunk, { session });
  }
}

const RECALC_BLOCKED_STATUSES = new Set([
  PAYROLL_CYCLE_STATUSES.FINALIZED,
  PAYROLL_CYCLE_STATUSES.PAID,
  PAYROLL_CYCLE_STATUSES.PARTIALLY_PAID,
]);

const FINALIZE_BLOCKED_STATUSES = new Set([
  PAYROLL_CYCLE_STATUSES.FINALIZED,
  PAYROLL_CYCLE_STATUSES.PAID,
]);

function tenantConnection(models) {
  return models?.connection || models?.PayrollCycle?.db || models?.User?.db || null;
}

function isDuplicateKeyError(error) {
  return Boolean(error && (error.code === 11000 || error.code === 11001));
}

/** Active lock predicate: calcLockUntil strictly in the future. */
export function isPayrollCalcLockActive(cycle, now = new Date()) {
  if (!cycle?.calcLockUntil) return false;
  const until = new Date(cycle.calcLockUntil).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

export function assertPayrollTransactionsSupported(connection) {
  if (!connectionSupportsTransactions(connection)) {
    throw new HttpError(
      503,
      "Payroll writes require a MongoDB replica set or sharded cluster with multi-document transactions enabled."
    );
  }
}

/**
 * Require a tenant Mongo transaction. Never falls back to non-transactional writes.
 */
export async function withRequiredPayrollTransaction(connection, work) {
  assertPayrollTransactionsSupported(connection);
  const session = await connection.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function inactiveLockFilter(now) {
  return {
    $or: [
      { calcLockUntil: null },
      { calcLockUntil: { $exists: false } },
      { calcLockUntil: { $lte: now } },
    ],
  };
}

/**
 * Atomically acquire a recalculation lock on an eligible draft/calculated cycle.
 * @returns {{ cycle: object, token: string }}
 */
export async function acquirePayrollCalcLock(PayrollCycle, cycleId, { now = new Date() } = {}) {
  const token = crypto.randomUUID();
  const lockUntil = new Date(now.getTime() + PAYROLL_CALC_LOCK_MS);

  const locked = await PayrollCycle.findOneAndUpdate(
    {
      _id: cycleId,
      status: { $nin: [...RECALC_BLOCKED_STATUSES] },
      ...inactiveLockFilter(now),
    },
    {
      $set: {
        calcLockUntil: lockUntil,
        calcLockToken: token,
      },
    },
    { returnDocument: "after" }
  );

  if (locked) {
    return { cycle: locked, token };
  }

  const existing = await PayrollCycle.findById(cycleId).lean();
  if (!existing) {
    throw new HttpError(404, "Payroll cycle not found.");
  }
  if (RECALC_BLOCKED_STATUSES.has(existing.status)) {
    throw new HttpError(
      400,
      "Cannot recalculate a finalized or paid payroll cycle. Only draft cycles may be recalculated."
    );
  }
  if (isPayrollCalcLockActive(existing, now)) {
    throw new HttpError(409, "Payroll recalculation is already in progress for this cycle.", {
      code: "PAYROLL_CALC_LOCK_HELD",
    });
  }
  throw new HttpError(409, "Payroll recalculation is already in progress for this cycle.", {
    code: "PAYROLL_CALC_LOCK_HELD",
  });
}

/**
 * Release a lock only when the caller still owns the token.
 * @returns {boolean} true when the lock was cleared
 */
export async function releasePayrollCalcLock(PayrollCycle, cycleId, token, { session } = {}) {
  if (!token) return false;
  const updated = await PayrollCycle.findOneAndUpdate(
    {
      _id: cycleId,
      calcLockToken: token,
    },
    {
      $set: {
        calcLockUntil: null,
        calcLockToken: "",
      },
    },
    { returnDocument: "after", ...(session ? { session } : {}) }
  );
  return Boolean(updated);
}

function mapPayslipDrafts(employeeRecords, cycleId) {
  return (employeeRecords || []).map((rec) => ({
    ...rec,
    payrollCycleId: cycleId,
    status: "DRAFT",
  }));
}

/**
 * F50-A — Create cycle + draft payslips in one required transaction.
 */
export async function createPayrollCycleAtomic({
  models,
  company,
  periodMonth,
  periodYear,
  notes = "",
  createdBy,
}) {
  const { PayrollCycle, Payslip } = models;
  const connection = tenantConnection(models);
  assertPayrollTransactionsSupported(connection);

  const month = parseInt(periodMonth, 10);
  const year = parseInt(periodYear, 10);

  const existing = await PayrollCycle.findOne({ periodMonth: month, periodYear: year }).lean();
  if (existing) {
    throw new HttpError(409, `A payroll cycle for ${month}/${year} already exists.`);
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStr = String(month).padStart(2, "0");
  const periodStartDate = new Date(`${year}-${monthStr}-01T00:00:00.000Z`);
  const periodEndDate = new Date(
    `${year}-${monthStr}-${String(daysInMonth).padStart(2, "0")}T23:59:59.999Z`
  );

  const calculation = await calculatePayrollCycle({
    models,
    company,
    periodMonth: month,
    periodYear: year,
  });

  let createdCycle;
  try {
    createdCycle = await withRequiredPayrollTransaction(connection, async (session) => {
      const [cycle] = await PayrollCycle.create(
        [
          {
            periodMonth: month,
            periodYear: year,
            periodStartDate,
            periodEndDate,
            status: PAYROLL_CYCLE_STATUSES.CALCULATED,
            employeeCount: calculation.cycleSummary.employeeCount,
            totalGrossEarnings: calculation.cycleSummary.totalGrossEarnings,
            totalEmployeeDeductions: calculation.cycleSummary.totalEmployeeDeductions,
            totalEmployerContributions: calculation.cycleSummary.totalEmployerContributions,
            totalNetPayable: calculation.cycleSummary.totalNetPayable,
            totalPaidAmount: 0,
            paymentStatus: "UNPAID",
            payments: [],
            validationIssues: calculation.validationIssues,
            notes: notes || "",
            createdBy: createdBy || null,
            calculatedAt: new Date(),
            calcLockUntil: null,
            calcLockToken: "",
          },
        ],
        { session }
      );

      const drafts = mapPayslipDrafts(calculation.employeeRecords, cycle._id);
      await insertPayslipDraftsChunked(Payslip, drafts, session);
      return cycle;
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new HttpError(409, `A payroll cycle for ${month}/${year} already exists.`);
    }
    throw error;
  }

  return { cycle: createdCycle, calculation };
}

/**
 * F50-A + F50-B — Locked recalculation with transactional payslip replacement.
 * Previous payslips and cycle totals remain intact if the transaction aborts.
 */
export async function recalculatePayrollCycleAtomic({ models, company, cycleId }) {
  const { PayrollCycle, Payslip } = models;
  const connection = tenantConnection(models);
  assertPayrollTransactionsSupported(connection);

  const { cycle: lockedCycle, token } = await acquirePayrollCalcLock(PayrollCycle, cycleId);
  let lockHeld = true;

  try {
    const calculation = await calculatePayrollCycle({
      models,
      company,
      periodMonth: lockedCycle.periodMonth,
      periodYear: lockedCycle.periodYear,
    });

    const updatedCycle = await withRequiredPayrollTransaction(connection, async (session) => {
      const now = new Date();
      // Ownership + eligibility must still hold inside the write transaction.
      const owned = await PayrollCycle.findOne({
        _id: cycleId,
        calcLockToken: token,
        calcLockUntil: { $gt: now },
        status: { $nin: [...RECALC_BLOCKED_STATUSES] },
      }).session(session);

      if (!owned) {
        throw new HttpError(
          409,
          "Payroll recalculation lock was lost or the cycle is no longer recalculable.",
          { code: "PAYROLL_CALC_LOCK_LOST" }
        );
      }

      await Payslip.deleteMany({ payrollCycleId: cycleId }, { session });
      const drafts = mapPayslipDrafts(calculation.employeeRecords, cycleId);
      await insertPayslipDraftsChunked(Payslip, drafts, session);

      const cleared = await PayrollCycle.findOneAndUpdate(
        {
          _id: cycleId,
          calcLockToken: token,
          status: { $nin: [...RECALC_BLOCKED_STATUSES] },
        },
        {
          $set: {
            status: PAYROLL_CYCLE_STATUSES.CALCULATED,
            employeeCount: calculation.cycleSummary.employeeCount,
            totalGrossEarnings: calculation.cycleSummary.totalGrossEarnings,
            totalEmployeeDeductions: calculation.cycleSummary.totalEmployeeDeductions,
            totalEmployerContributions: calculation.cycleSummary.totalEmployerContributions,
            totalNetPayable: calculation.cycleSummary.totalNetPayable,
            validationIssues: calculation.validationIssues,
            calculatedAt: now,
            calcLockUntil: null,
            calcLockToken: "",
          },
        },
        { returnDocument: "after", session }
      );

      if (!cleared) {
        throw new HttpError(
          409,
          "Payroll recalculation lock was lost or the cycle is no longer recalculable.",
          { code: "PAYROLL_CALC_LOCK_LOST" }
        );
      }

      return cleared;
    });

    lockHeld = false;
    return { cycle: updatedCycle, calculation };
  } catch (error) {
    if (lockHeld) {
      try {
        await releasePayrollCalcLock(PayrollCycle, cycleId, token);
      } catch {
        // Lock TTL remains the safety net if release fails.
      }
    }
    throw error;
  }
}

/**
 * F50-F — Finalize cycle + payslips atomically; blocked while a calc lock is active.
 */
export async function finalizePayrollCycleAtomic({
  models,
  cycleId,
  finalizedBy,
  actor,
}) {
  const { PayrollCycle, Payslip, AuditLog } = models;
  const connection = tenantConnection(models);
  assertPayrollTransactionsSupported(connection);

  const result = await withRequiredPayrollTransaction(connection, async (session) => {
    const now = new Date();
    const cycle = await PayrollCycle.findOneAndUpdate(
      {
        _id: cycleId,
        status: { $nin: [...FINALIZE_BLOCKED_STATUSES] },
        ...inactiveLockFilter(now),
      },
      {
        $set: {
          status: PAYROLL_CYCLE_STATUSES.FINALIZED,
          finalizedAt: now,
          finalizedBy: finalizedBy || null,
          calcLockUntil: null,
          calcLockToken: "",
        },
      },
      { returnDocument: "after", session }
    );

    if (!cycle) {
      const existing = await PayrollCycle.findById(cycleId).session(session).lean();
      if (!existing) {
        throw new HttpError(404, "Payroll cycle not found.");
      }
      if (FINALIZE_BLOCKED_STATUSES.has(existing.status)) {
        throw new HttpError(400, "Payroll cycle has already been finalized.");
      }
      if (isPayrollCalcLockActive(existing, now)) {
        throw new HttpError(409, "Payroll recalculation is in progress. Try finalizing again shortly.", {
          code: "PAYROLL_CALC_LOCK_HELD",
        });
      }
      throw new HttpError(409, "Payroll cycle could not be finalized.", {
        code: "PAYROLL_FINALIZE_CONFLICT",
      });
    }

    await Payslip.updateMany(
      { payrollCycleId: cycle._id },
      {
        $set: {
          status: "FINALIZED",
          finalizedAt: now,
          finalizedBy: finalizedBy || null,
        },
      },
      { session }
    );

    if (AuditLog && actor) {
      await AuditLog.create(
        [
          {
            actorUserId: actor._id,
            actorEmail: actor.email,
            actorRole: actor.role,
            action: "PAYROLL_FINALIZED",
            targetType: "PayrollCycle",
            targetId: cycle._id,
            changes: {
              periodMonth: cycle.periodMonth,
              periodYear: cycle.periodYear,
              employeeCount: cycle.employeeCount,
              totalNetPayable: cycle.totalNetPayable,
            },
          },
        ],
        { session }
      );
    }

    return cycle;
  });

  return { cycle: result };
}
