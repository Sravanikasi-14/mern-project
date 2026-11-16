import {
  createInvoice,
  createPlan,
  getCompanySubscription,
  getPlan,
  getPlansComparison,
  listPlans,
  recordInvoicePayment,
  updateCompanySubscription,
  updatePlan,
  voidInvoice,
} from "../services/platformPlanService.js";

export async function list(req, res, next) {
  try {
    const includeInactive = String(req.query.includeInactive || "true") !== "false";
    const plans = await listPlans({ includeInactive });
    res.status(200).json({ plans });
  } catch (err) {
    next(err);
  }
}

export async function comparison(req, res, next) {
  try {
    const data = await getPlansComparison();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function getOne(req, res, next) {
  try {
    const data = await getPlan(req.params.planId);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const data = await createPlan({
      payload: req.body,
      admin: req.platformAuth.admin,
      req,
    });
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function patch(req, res, next) {
  try {
    const data = await updatePlan({
      planId: req.params.planId,
      payload: {
        ...req.body,
        confirm: Boolean(req.body?.confirm),
        confirmDeactivate: Boolean(req.body?.confirm || req.body?.confirmDeactivate),
      },
      admin: req.platformAuth.admin,
      req,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function getSubscription(req, res, next) {
  try {
    const data = await getCompanySubscription(req.params.companyId);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function patchSubscription(req, res, next) {
  try {
    const data = await updateCompanySubscription({
      companyId: req.params.companyId,
      payload: req.body,
      confirm: Boolean(req.body?.confirm),
      admin: req.platformAuth.admin,
      req,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function postInvoice(req, res, next) {
  try {
    const data = await createInvoice({
      companyId: req.params.companyId,
      payload: req.body,
      admin: req.platformAuth.admin,
      req,
    });
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function postInvoicePayment(req, res, next) {
  try {
    const data = await recordInvoicePayment({
      invoiceId: req.params.invoiceId,
      payload: req.body,
      admin: req.platformAuth.admin,
      req,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function postInvoiceVoid(req, res, next) {
  try {
    const data = await voidInvoice({
      invoiceId: req.params.invoiceId,
      confirm: Boolean(req.body?.confirm),
      admin: req.platformAuth.admin,
      req,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}
