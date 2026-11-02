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

function companyContext(req) {
  return { models: req.auth.models, company: req.auth.company };
}

export async function createHandover(req, res, next) {
  try {
    const handover = await createOrGetHandover(
      companyContext(req),
      req.params.leaveRequestId,
      req.auth.user
    );
    res.json({
      success: true,
      handover,
      note: "Handover is operational coordination only and never blocks leave approval.",
    });
  } catch (err) {
    next(err);
  }
}

export async function getHandover(req, res, next) {
  try {
    const handover = await getHandoverById(companyContext(req), req.params.id, req.auth.user);
    res.json({ success: true, handover });
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
    res.json({ success: true, handover });
  } catch (err) {
    next(err);
  }
}

export async function updateHandover(req, res, next) {
  try {
    const handover = await updateHandoverDraft(
      companyContext(req),
      req.params.id,
      req.auth.user,
      req.body || {}
    );
    res.json({ success: true, handover });
  } catch (err) {
    next(err);
  }
}

export async function submitHandoverRequest(req, res, next) {
  try {
    const handover = await submitHandover(companyContext(req), req.params.id, req.auth.user);
    res.json({ success: true, handover });
  } catch (err) {
    next(err);
  }
}

export async function respondHandoverItem(req, res, next) {
  try {
    const handover = await respondToHandoverItem(
      companyContext(req),
      req.params.id,
      req.params.itemId,
      req.auth.user,
      req.body || {}
    );
    res.json({ success: true, handover });
  } catch (err) {
    next(err);
  }
}

export async function reassignHandoverItem(req, res, next) {
  try {
    const handover = await reassignHandoverItemBackup(
      companyContext(req),
      req.params.id,
      req.params.itemId,
      req.auth.user,
      req.body?.backupEmployeeId
    );
    res.json({ success: true, handover });
  } catch (err) {
    next(err);
  }
}

export async function decideHandover(req, res, next) {
  try {
    const handover = await managerDecideHandover(
      companyContext(req),
      req.params.id,
      req.auth.user,
      req.body || {}
    );
    res.json({ success: true, handover });
  } catch (err) {
    next(err);
  }
}

/** HR/manager one-step temporary coverage coordination (no peer acknowledgement). */
export async function coordinateHandover(req, res, next) {
  try {
    const handover = await coordinateHandoverCoverage(
      companyContext(req),
      req.params.id,
      req.auth.user,
      req.body || {}
    );
    res.json({
      success: true,
      handover,
      note: "Temporary coverage coordinated. Task ownership was not changed. Leave approval is independent.",
    });
  } catch (err) {
    next(err);
  }
}

export async function cancelHandoverRequest(req, res, next) {
  try {
    const handover = await cancelHandover(
      companyContext(req),
      req.params.id,
      req.auth.user,
      req.body?.reason || ""
    );
    res.json({ success: true, handover });
  } catch (err) {
    next(err);
  }
}

export async function extendHandoverItem(req, res, next) {
  try {
    const handover = await extendDelegation(
      companyContext(req),
      req.params.id,
      req.params.itemId,
      req.auth.user,
      req.body?.toDate
    );
    res.json({ success: true, handover });
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
    });
    res.json({ success: true, handovers });
  } catch (err) {
    next(err);
  }
}
