import {
  createPlatformCompany,
  getPlatformCompany,
  listPlatformCompanies,
  reprovisionPlatformCompany,
  setPlatformCompanyStatus,
  updatePlatformCompanyMetadata,
} from "../services/platformCompanyService.js";
import { getPlatformOverview } from "../services/platformOverviewService.js";

export async function overview(req, res, next) {
  try {
    const data = await getPlatformOverview();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function listCompanies(req, res, next) {
  try {
    const data = await listPlatformCompanies({
      search: req.query.search,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function getCompany(req, res, next) {
  try {
    const data = await getPlatformCompany(req.params.companyId);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function createCompany(req, res, next) {
  try {
    const data = await createPlatformCompany({
      payload: req.body,
      admin: req.platformAuth.admin,
      req,
    });
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function updateCompany(req, res, next) {
  try {
    const data = await updatePlatformCompanyMetadata({
      companyId: req.params.companyId,
      payload: req.body,
      admin: req.platformAuth.admin,
      req,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function setCompanyStatus(req, res, next) {
  try {
    const data = await setPlatformCompanyStatus({
      companyId: req.params.companyId,
      status: req.body?.status,
      confirm: Boolean(req.body?.confirm),
      admin: req.platformAuth.admin,
      req,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function reprovisionCompany(req, res, next) {
  try {
    const data = await reprovisionPlatformCompany({
      companyId: req.params.companyId,
      admin: req.platformAuth.admin,
      req,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}
