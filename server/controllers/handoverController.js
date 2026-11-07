import {
  createOrGetHandover,
  getHandoverById,
  getHandoverForLeave,
  updateHandoverDraft,
  submitHandover,
  respondToHandoverItem,
  reassignHandoverItemBackup,
  managerDecideHandover,
  coordinateHandoverCoverage,
  cancelHandover,
  listMyHandovers,
  listHandoversForHr,
  extendDelegation,
} from "../services/leaveHandoverService.js";

import { USER_ROLES } from "../models/User.js";
import { HR_SCOPE_MODES } from "../constants/hrAccessCatalog.js";
import {
  assertEmployeeInScope,
  assertHrPermission,
  isEmployeeIdInScope,
} from "../services/hrAccessEnforcementService.js";

function companyContext(req) {
  return { models: req.auth.models, company: req.auth.company };
}

function assertHrLeaveEmployeeScope(req, leaveLike) {
  if (req.auth?.user?.role !== USER_ROLES.HR_ADMIN) return;
  assertHrPermission(req.hrAccess, "leave.view");
  const employeeId =
    leaveLike?.employeeId?._id ||
    leaveLike?.employeeId ||
    leaveLike?.originalEmployeeId?._id ||
    leaveLike?.originalEmployeeId ||
    leaveLike?.leaveRequest?.employeeId ||
    leaveLike?.leave?.employeeId;
  assertEmployeeInScope(req.hrAccess, employeeId, "You do not have access to this handover.");
}

function assertHrHandoverEdit(req) {
  if (req.auth?.user?.role !== USER_ROLES.HR_ADMIN) return;
  assertHrPermission(req.hrAccess, "leave.edit");
}

function assertHrBackupSelectionsInScope(req, payload) {
  if (req.auth?.user?.role !== USER_ROLES.HR_ADMIN) return;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  for (const patch of items) {
    if (patch?.backupEmployeeId) {
      assertEmployeeInScope(
        req.hrAccess,
        patch.backupEmployeeId,
        "You cannot assign a backup employee outside your access scope."
      );
    }
  }
}

/** Drop name and code of a backup who is outside an enforced CUSTOM scope. */
function redactHandoverBackupIdentity(hrAccess, handover) {
  if (!handover?.items || !hrAccess?.enforced || hrAccess.role !== USER_ROLES.HR_ADMIN) {
    return handover;
  }
  if (!hrAccess.configured || hrAccess.scopeMode !== HR_SCOPE_MODES.CUSTOM) return handover;
  return {
    ...handover,
    items: handover.items.map((item) => {
      const backupId = item.backupEmployee?._id || item.backupEmployeeId?._id || item.backupEmployeeId;
      if (!backupId || isEmployeeIdInScope(hrAccess, backupId)) return item;
      const next = { ...item };
      if (next.backupEmployee && typeof next.backupEmployee === "object") {
        next.backupEmployee = { _id: next.backupEmployee._id || backupId };
      }
      return next;
    }),
  };
}

function presentHandover(req, handover) {
  return redactHandoverBackupIdentity(req.hrAccess, handover);
}

export async function createHandover(req, res, next) {
  try {
    const LeaveRequest = companyContext(req).models.LeaveRequest;
    const leave = await LeaveRequest.findById(req.params.leaveRequestId).select("employeeId").lean();
    assertHrLeaveEmployeeScope(req, leave);
    const handover = await createOrGetHandover(
      companyContext(req),
      req.params.leaveRequestId,
      req.auth.user
    );
    res.json({
      success: true,
      handover: presentHandover(req, handover),
      note: "Handover is operational coordination only and never blocks leave approval.",
    });
  } catch (err) {
    next(err);
  }
}

export async function getHandover(req, res, next) {
  try {
    const handover = await getHandoverById(companyContext(req), req.params.id, req.auth.user);
    assertHrLeaveEmployeeScope(req, handover);
    res.json({ success: true, handover: presentHandover(req, handover) });
  } catch (err) {
    next(err);
  }
}

export async function getHandoverByLeaveRequest(req, res, next) {
  try {
    const handover = await getHandoverForLeave(
      companyContext(req),
      req.params.leaveRequestId,
      req.auth.user
    );
    assertHrLeaveEmployeeScope(req, handover);
    res.json({ success: true, handover: presentHandover(req, handover) });
  } catch (err) {
    next(err);
  }
}

export async function updateHandover(req, res, next) {
  try {
    const existing = await getHandoverById(companyContext(req), req.params.id, req.auth.user);
    assertHrLeaveEmployeeScope(req, existing);
    assertHrHandoverEdit(req);
    assertHrBackupSelectionsInScope(req, req.body || {});
    const handover = await updateHandoverDraft(
      companyContext(req),
      req.params.id,
      req.auth.user,
      req.body || {}
    );
    res.json({ success: true, handover: presentHandover(req, handover) });
  } catch (err) {
    next(err);
  }
}

export async function submitHandoverRequest(req, res, next) {
  try {
    const existing = await getHandoverById(companyContext(req), req.params.id, req.auth.user);
    assertHrLeaveEmployeeScope(req, existing);
    const handover = await submitHandover(companyContext(req), req.params.id, req.auth.user);
    res.json({ success: true, handover: presentHandover(req, handover) });
  } catch (err) {
    next(err);
  }
}

export async function respondHandoverItem(req, res, next) {
  try {
    const existing = await getHandoverById(companyContext(req), req.params.id, req.auth.user);
    assertHrLeaveEmployeeScope(req, existing);
    const handover = await respondToHandoverItem(
      companyContext(req),
      req.params.id,
      req.params.itemId,
      req.auth.user,
      req.body || {}
    );
    res.json({ success: true, handover: presentHandover(req, handover) });
  } catch (err) {
    next(err);
  }
}

export async function reassignHandoverItem(req, res, next) {
  try {
    const existing = await getHandoverById(companyContext(req), req.params.id, req.auth.user);
    assertHrLeaveEmployeeScope(req, existing);
    if (req.auth?.user?.role === USER_ROLES.HR_ADMIN && req.body?.backupEmployeeId) {
      assertEmployeeInScope(
        req.hrAccess,
        req.body.backupEmployeeId,
        "You cannot assign a backup employee outside your access scope."
      );
    }
    const handover = await reassignHandoverItemBackup(
      companyContext(req),
      req.params.id,
      req.params.itemId,
      req.auth.user,
      req.body?.backupEmployeeId
    );
    res.json({ success: true, handover: presentHandover(req, handover) });
  } catch (err) {
    next(err);
  }
}

export async function decideHandover(req, res, next) {
  try {
    const existing = await getHandoverById(companyContext(req), req.params.id, req.auth.user);
    assertHrLeaveEmployeeScope(req, existing);
    const handover = await managerDecideHandover(
      companyContext(req),
      req.params.id,
      req.auth.user,
      req.body || {}
    );
    res.json({ success: true, handover: presentHandover(req, handover) });
  } catch (err) {
    next(err);
  }
}

/** HR/manager one-step temporary coverage coordination (no peer acknowledgement). */
export async function coordinateHandover(req, res, next) {
  try {
    const existing = await getHandoverById(companyContext(req), req.params.id, req.auth.user);
    assertHrLeaveEmployeeScope(req, existing);
    const handover = await coordinateHandoverCoverage(
      companyContext(req),
      req.params.id,
      req.auth.user,
      req.body || {}
    );
    res.json({
      success: true,
      handover: presentHandover(req, handover),
      note: "Temporary coverage coordinated. Task ownership was not changed. Leave approval is independent.",
    });
  } catch (err) {
    next(err);
  }
}

export async function cancelHandoverRequest(req, res, next) {
  try {
    const existing = await getHandoverById(companyContext(req), req.params.id, req.auth.user);
    assertHrLeaveEmployeeScope(req, existing);
    const handover = await cancelHandover(
      companyContext(req),
      req.params.id,
      req.auth.user,
      req.body?.reason || ""
    );
    res.json({ success: true, handover: presentHandover(req, handover) });
  } catch (err) {
    next(err);
  }
}

export async function extendHandoverItem(req, res, next) {
  try {
    const existing = await getHandoverById(companyContext(req), req.params.id, req.auth.user);
    assertHrLeaveEmployeeScope(req, existing);
    const handover = await extendDelegation(
      companyContext(req),
      req.params.id,
      req.params.itemId,
      req.auth.user,
      req.body?.toDate
    );
    res.json({ success: true, handover: presentHandover(req, handover) });
  } catch (err) {
    next(err);
  }
}

export async function myHandovers(req, res, next) {
  try {
    const result = await listMyHandovers(companyContext(req), req.auth.user);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function hrListHandovers(req, res, next) {
  try {
    const handovers = await listHandoversForHr(companyContext(req), req.auth.user, {
      status: req.query.status,
      employeeId: req.query.employeeId,
      hrAccess: req.hrAccess,
    });
    res.json({
      success: true,
      handovers: (handovers || []).map((row) => presentHandover(req, row)),
    });
  } catch (err) {
    next(err);
  }
}
