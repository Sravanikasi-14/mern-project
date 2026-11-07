import OfferTemplateMaster, { getMasterVersion } from "../models/OfferTemplateMaster.js";
import {
  OFFER_TEMPLATE_SOURCES,
  OFFER_TEMPLATE_STATUSES,
  OFFER_TEMPLATE_TYPES,
  getOfferTemplateModel,
} from "../models/OfferTemplate.js";
import {
  MASTER_TEMPLATE_CODE,
  MASTER_TEMPLATE_KIND,
  MASTER_TEMPLATE_TITLE,
  getDefaultLegalSections,
  getMasterSectionConfig,
} from "../assets/offer-templates/hrms-default-master.js";
import { buildBuilderSnapshot } from "./offerTemplateRenderService.js";

function isDuplicateKey(error) {
  return error && (error.code === 11000 || /E11000/.test(error.message || ""));
}

/**
 * Upsert the global HRMS master (central DB) from the code asset.
 *
 * - Missing → create version 1.
 * - Exists  → NEVER rewrite existing version content.
 * - `bumpVersion: true` → append a NEW version (currentVersion + 1) from the asset.
 *   Previously issued versions stay untouched; tenant copies are unaffected.
 */
export async function ensureMasterTemplate({ bumpVersion = false, notes = "" } = {}) {
  let master = await OfferTemplateMaster.findOne({ code: MASTER_TEMPLATE_CODE });

  const buildVersion = (version, versionNotes) => ({
    version,
    htmlTemplate: "",
    sectionConfig: getMasterSectionConfig(),
    legalSections: getDefaultLegalSections(),
    createdAt: new Date(),
    notes: versionNotes,
  });

  if (!master) {
    try {
      master = await OfferTemplateMaster.create({
        code: MASTER_TEMPLATE_CODE,
        title: MASTER_TEMPLATE_TITLE,
        kind: MASTER_TEMPLATE_KIND,
        currentVersion: 1,
        versions: [buildVersion(1, notes || "Initial HRMS default master")],
        isActive: true,
      });
      return { master, created: true, bumped: false };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      master = await OfferTemplateMaster.findOne({ code: MASTER_TEMPLATE_CODE });
    }
  }

  // Repair: master exists but has no content for its current version (never overwrites existing).
  if (!getMasterVersion(master, master.currentVersion)) {
    master.versions.push(buildVersion(master.currentVersion, notes || "Restored current version"));
    await master.save();
    return { master, created: false, bumped: false };
  }

  if (bumpVersion) {
    const nextVersion = master.currentVersion + 1;
    if (!getMasterVersion(master, nextVersion)) {
      master.versions.push(buildVersion(nextVersion, notes || `Version ${nextVersion}`));
    }
    master.currentVersion = nextVersion;
    await master.save();
    return { master, created: false, bumped: true };
  }

  return { master, created: false, bumped: false };
}

function resolveTemplateModel(models) {
  if (models?.OfferTemplate) return models.OfferTemplate;
  if (models?.connection) return getOfferTemplateModel(models.connection);
  throw new Error("ensureCompanyDefaultTemplate requires tenant models (OfferTemplate or connection).");
}

/**
 * Ensure a company has the HRMS system-default offer template without ever
 * overwriting or re-defaulting company-owned templates.
 *
 * - Zero templates      → create ACTIVE + isDefault + isSystemDefault copy of the master.
 * - Has templates, none from HRMS_MASTER → add system default as ACTIVE, NOT default.
 * - Already has an HRMS_MASTER template → no-op.
 */
export async function ensureCompanyDefaultTemplate(company, models) {
  const OfferTemplate = resolveTemplateModel(models);
  const outcome = { created: false, madeDefault: false, skipped: false, templateId: null };

  const existingCount = await OfferTemplate.estimatedDocumentCount();
  const hasMasterCopy =
    existingCount > 0 &&
    (await OfferTemplate.exists({ source: OFFER_TEMPLATE_SOURCES.HRMS_MASTER, isSystemDefault: true }));
  if (hasMasterCopy) {
    outcome.skipped = true;
    return outcome;
  }

  const { master } = await ensureMasterTemplate();
  const masterVersion = getMasterVersion(master, master.currentVersion);
  if (!masterVersion) {
    throw new Error("HRMS master offer template has no usable version.");
  }

  const totalNow = await OfferTemplate.countDocuments({});
  const shouldBeDefault = totalNow === 0;

  const snapshot = buildBuilderSnapshot({
    sectionConfig: masterVersion.sectionConfig,
    legalSections: masterVersion.legalSections,
    settings: {},
    masterCode: master.code,
    masterVersion: master.currentVersion,
  });

  const payload = {
    name: master.title,
    type: OFFER_TEMPLATE_TYPES.DEFAULT_BUILDER,
    source: OFFER_TEMPLATE_SOURCES.HRMS_MASTER,
    masterCode: master.code,
    masterVersion: master.currentVersion,
    status: OFFER_TEMPLATE_STATUSES.ACTIVE,
    isDefault: shouldBeDefault,
    isSystemDefault: true,
    version: 1,
    versions: [{ version: 1, snapshot, placeholderMappings: [], createdAt: new Date() }],
    settings: {},
  };

  try {
    const doc = await OfferTemplate.create(payload);
    outcome.created = true;
    outcome.madeDefault = shouldBeDefault;
    outcome.templateId = doc._id;
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    // Concurrent provisioning created the system default first → nothing to do.
    const existing = await OfferTemplate.findOne({ isSystemDefault: true }).select("_id").lean();
    if (existing) {
      outcome.skipped = true;
      outcome.templateId = existing._id;
      return outcome;
    }
    // Another template grabbed isDefault concurrently: add ours as non-default.
    const doc = await OfferTemplate.create({ ...payload, isDefault: false });
    outcome.created = true;
    outcome.templateId = doc._id;
  }
  return outcome;
}
