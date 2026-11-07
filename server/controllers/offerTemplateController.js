import {
  OFFER_TEMPLATE_SOURCES,
  OFFER_TEMPLATE_STATUSES,
  OFFER_TEMPLATE_TYPES,
} from "../models/OfferTemplate.js";
import { HttpError } from "../utils/httpError.js";
import { getConversionStatus } from "../services/docxConversionService.js";
import {
  DOCX_MIME,
  getMaxDocxBytes,
  inspectDocx,
  suggestMappings,
  validateMappings,
  findMissingMappings,
} from "../services/offerDocxTemplateService.js";
import {
  previewTemplateHtml,
  generateFilledDocx,
  generateOfferPdfBuffer,
  toOfferDataFromLetter,
} from "../services/offerDocumentService.js";
import { ensureMasterTemplate } from "../services/offerTemplateProvisioningService.js";
import {
  OFFER_FIELD_CATALOG,
  SAMPLE_OFFER_DATA,
  buildBuilderSnapshot,
  getTemplateSnapshot,
} from "../services/offerTemplateRenderService.js";
import {
  PURPOSE_TEMPLATE_SOURCE,
  cleanupTemplateFiles,
  getStorageFileId,
  isOfferStorageConfigured,
  pruneOldTemplateVersions,
  putOfferFile,
  storageRefFromUpload,
  streamOfferFileToResponse,
} from "../services/offerGridFsStorageService.js";

function parseBase64Docx(fileData) {
  const raw = String(fileData || "");
  const comma = raw.indexOf(",");
  const b64 = raw.startsWith("data:") && comma >= 0 ? raw.slice(comma + 1) : raw;
  let buffer;
  try {
    buffer = Buffer.from(b64, "base64");
  } catch {
    throw new HttpError(400, "Invalid base64 DOCX payload.");
  }
  if (!buffer.length) throw new HttpError(400, "DOCX file data is empty.");
  const maxBytes = getMaxDocxBytes();
  if (buffer.length > maxBytes) {
    throw new HttpError(400, `DOCX file is too large (max ${Math.round(maxBytes / (1024 * 1024))} MB).`);
  }
  return buffer;
}

function serializeStorage(storage) {
  if (!storage) return null;
  const fileId = getStorageFileId(storage);
  return {
    provider: storage.provider || "gridfs",
    bucket: storage.bucket || "offer_docs",
    fileId: fileId ? String(fileId) : null,
    key: storage.key || (fileId ? String(fileId) : ""),
    filename: storage.filename || "",
    contentType: storage.contentType,
    byteSize: storage.byteSize,
    checksumSha256: storage.checksumSha256,
    uploadedAt: storage.uploadedAt,
  };
}

function serializeTemplate(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  return {
    id: String(o._id),
    name: o.name,
    type: o.type,
    source: o.source,
    masterCode: o.masterCode,
    masterVersion: o.masterVersion,
    status: o.status,
    isDefault: Boolean(o.isDefault),
    isSystemDefault: Boolean(o.isSystemDefault),
    version: o.version,
    placeholders: o.placeholders || [],
    placeholderMappings: o.placeholderMappings || [],
    settings: o.settings || {},
    storage: serializeStorage(o.storage),
    versions: (o.versions || []).map((v) => ({
      version: v.version,
      createdAt: v.createdAt,
      hasSnapshot: Boolean(v.snapshot),
      hasStorage: Boolean(getStorageFileId(v.storage)),
    })),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

async function clearDefaultFlag(OfferTemplate, exceptId = null) {
  const filter = { isDefault: true };
  if (exceptId) filter._id = { $ne: exceptId };
  await OfferTemplate.updateMany(filter, { $set: { isDefault: false } });
}

/**
 * GET /api/offer-templates
 */
export async function listOfferTemplates(req, res, next) {
  try {
    const { OfferTemplate } = req.auth.models;

    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const filter = {};
    if (status && Object.values(OFFER_TEMPLATE_STATUSES).includes(status)) {
      filter.status = status;
    }

    const rows = await OfferTemplate.find(filter).sort({ isDefault: -1, updatedAt: -1 }).lean();
    res.json({
      success: true,
      templates: rows.map(serializeTemplate),
      fieldCatalog: OFFER_FIELD_CATALOG,
      conversion: getConversionStatus(),
      storageConfigured: isOfferStorageConfigured(req.auth.models.connection),
      storageProvider: "gridfs",
      limits: { docxMaxBytes: getMaxDocxBytes() },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/offer-templates/:id
 */
export async function getOfferTemplate(req, res, next) {
  try {
    const { OfferTemplate } = req.auth.models;
    const doc = await OfferTemplate.findById(req.params.id).lean();
    if (!doc) throw new HttpError(404, "Offer template not found.");
    res.json({
      success: true,
      template: serializeTemplate(doc),
      fieldCatalog: OFFER_FIELD_CATALOG,
      conversion: getConversionStatus(),
      storageConfigured: isOfferStorageConfigured(req.auth.models.connection),
      storageProvider: "gridfs",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/offer-templates
 * Create a company DEFAULT_BUILDER clone (settings) or stub before DOCX upload.
 */
export async function createOfferTemplate(req, res, next) {
  try {
    const { OfferTemplate, connection } = req.auth.models;

    const {
      name,
      type = OFFER_TEMPLATE_TYPES.DEFAULT_BUILDER,
      settings = {},
      isDefault = false,
    } = req.body || {};

    if (!name || !String(name).trim()) {
      throw new HttpError(400, "Template name is required.");
    }
    if (!Object.values(OFFER_TEMPLATE_TYPES).includes(type)) {
      throw new HttpError(400, "Invalid template type.");
    }
    if (type === OFFER_TEMPLATE_TYPES.UPLOADED_DOCX && !isOfferStorageConfigured(connection)) {
      throw new HttpError(503, "Document storage is not available for this company database.", {
        code: "STORAGE_NOT_CONFIGURED",
      });
    }

    let snapshot = null;
    if (type === OFFER_TEMPLATE_TYPES.DEFAULT_BUILDER) {
      const { master } = await ensureMasterTemplate();
      snapshot = buildBuilderSnapshot({
        sectionConfig: settings.sectionConfig,
        legalSections: settings.legalSections,
        settings,
        masterCode: master.code,
        masterVersion: master.currentVersion,
      });
    }

    if (isDefault) await clearDefaultFlag(OfferTemplate);

    const doc = await OfferTemplate.create({
      name: String(name).trim(),
      type,
      source: OFFER_TEMPLATE_SOURCES.COMPANY,
      status: OFFER_TEMPLATE_STATUSES.DRAFT,
      isDefault: Boolean(isDefault),
      isSystemDefault: false,
      // UPLOADED_DOCX starts at 0 until the first source file is stored as v1.
      version: type === OFFER_TEMPLATE_TYPES.UPLOADED_DOCX ? 0 : 1,
      versions:
        type === OFFER_TEMPLATE_TYPES.DEFAULT_BUILDER
          ? [{ version: 1, snapshot, placeholderMappings: [], createdAt: new Date() }]
          : [],
      settings: settings || {},
      createdBy: req.auth.user._id,
    });

    res.status(201).json({
      success: true,
      message: "Offer template created.",
      template: serializeTemplate(doc),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/offer-templates/:id
 */
export async function updateOfferTemplate(req, res, next) {
  try {
    const { OfferTemplate } = req.auth.models;
    const doc = await OfferTemplate.findById(req.params.id);
    if (!doc) throw new HttpError(404, "Offer template not found.");

    const { name, settings, status, isDefault, placeholderMappings, bumpVersion } = req.body || {};

    if (name != null) {
      const trimmed = String(name).trim();
      if (!trimmed) throw new HttpError(400, "Template name cannot be empty.");
      doc.name = trimmed;
    }

    if (status != null) {
      const nextStatus = String(status).toUpperCase();
      if (!Object.values(OFFER_TEMPLATE_STATUSES).includes(nextStatus)) {
        throw new HttpError(400, "Invalid template status.");
      }
      if (nextStatus === OFFER_TEMPLATE_STATUSES.ACTIVE && doc.type === OFFER_TEMPLATE_TYPES.UPLOADED_DOCX) {
        if (!doc.storage?.key) {
          throw new HttpError(400, "Upload a DOCX file before activating this template.");
        }
        const missing = findMissingMappings(doc.placeholders || [], placeholderMappings || doc.placeholderMappings);
        if (missing.length > 0) {
          throw new HttpError(400, "Map all required placeholders before activating.", {
            code: "MAPPINGS_INCOMPLETE",
            missingFields: missing,
          });
        }
      }
      doc.status = nextStatus;
    }

    if (placeholderMappings != null) {
      if (doc.type !== OFFER_TEMPLATE_TYPES.UPLOADED_DOCX) {
        throw new HttpError(400, "Placeholder mappings apply only to uploaded DOCX templates.");
      }
      doc.placeholderMappings = validateMappings(placeholderMappings, doc.placeholders || []);
    }

    if (settings != null && typeof settings === "object") {
      doc.settings = { ...(doc.settings || {}), ...settings };
      if (doc.type === OFFER_TEMPLATE_TYPES.DEFAULT_BUILDER && bumpVersion) {
        const nextVersion = doc.version + 1;
        const snapshot = buildBuilderSnapshot({
          sectionConfig: settings.sectionConfig || getTemplateSnapshot(doc)?.sectionConfig,
          legalSections: settings.legalSections || getTemplateSnapshot(doc)?.legalSections,
          settings: doc.settings,
          masterCode: doc.masterCode,
          masterVersion: doc.masterVersion,
        });
        doc.versions.push({
          version: nextVersion,
          snapshot,
          placeholderMappings: [],
          createdAt: new Date(),
        });
        doc.version = nextVersion;
        // Company customisation: once edited, detach from automatic master overwrite semantics.
        if (doc.source === OFFER_TEMPLATE_SOURCES.HRMS_MASTER) {
          doc.source = OFFER_TEMPLATE_SOURCES.COMPANY;
          doc.isSystemDefault = false;
        }
      }
    }

    if (isDefault === true) {
      await clearDefaultFlag(OfferTemplate, doc._id);
      doc.isDefault = true;
    } else if (isDefault === false) {
      doc.isDefault = false;
    }

    doc.updatedAt = new Date();
    await doc.save();

    res.json({
      success: true,
      message: "Offer template updated.",
      template: serializeTemplate(doc),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/offer-templates/:id/docx
 * Body: { fileName, fileData (base64), mimeType? }
 */
export async function uploadOfferTemplateDocx(req, res, next) {
  let uploadedFileId = null;
  let deduped = false;
  try {
    const { OfferTemplate, connection } = req.auth.models;
    if (!isOfferStorageConfigured(connection)) {
      throw new HttpError(503, "Document storage is not available for this company database.", {
        code: "STORAGE_NOT_CONFIGURED",
      });
    }

    const doc = await OfferTemplate.findById(req.params.id);
    if (!doc) throw new HttpError(404, "Offer template not found.");
    if (doc.type !== OFFER_TEMPLATE_TYPES.UPLOADED_DOCX) {
      throw new HttpError(400, "DOCX upload is only valid for UPLOADED_DOCX templates.");
    }

    const { fileName, fileData, mimeType } = req.body || {};
    if (!fileName || !fileData) {
      throw new HttpError(400, "fileName and fileData (base64) are required.");
    }
    if (mimeType && mimeType !== DOCX_MIME && !String(fileName).toLowerCase().endsWith(".docx")) {
      throw new HttpError(400, "Only .docx Word documents are supported.");
    }

    const buffer = parseBase64Docx(fileData);
    const { placeholders } = inspectDocx(buffer);
    const mappings = suggestMappings(placeholders);

    const nextVersion = (doc.version || 0) + 1;
    const uploaded = await putOfferFile({
      connection,
      body: buffer,
      contentType: DOCX_MIME,
      filename: `${String(doc._id)}_v${nextVersion}_source.docx`,
      purpose: PURPOSE_TEMPLATE_SOURCE,
      metadata: {
        templateId: String(doc._id),
        version: nextVersion,
      },
    });
    uploadedFileId = uploaded.fileId;
    deduped = Boolean(uploaded.deduped);
    const storage = storageRefFromUpload(uploaded);

    doc.version = nextVersion;
    doc.placeholders = placeholders;
    doc.placeholderMappings = mappings;
    doc.storage = storage;
    doc.versions.push({
      version: nextVersion,
      snapshot: {},
      storage,
      placeholderMappings: mappings,
      createdAt: new Date(),
    });
    doc.status = OFFER_TEMPLATE_STATUSES.DRAFT;
    doc.updatedAt = new Date();

    await pruneOldTemplateVersions({ connection, templateDoc: doc });
    await doc.save();
    uploadedFileId = null; // ownership transferred to template metadata

    res.json({
      success: true,
      message: deduped
        ? "DOCX template uploaded (reused existing identical file). Review placeholder mappings."
        : "DOCX template uploaded. Review and confirm placeholder mappings.",
      template: serializeTemplate(doc),
      placeholders,
      suggestedMappings: mappings,
      conversion: getConversionStatus(),
      deduped,
    });
  } catch (error) {
    // Compensating cleanup if GridFS write/dedupe succeeded but metadata save failed.
    if (uploadedFileId && req.auth?.models?.connection) {
      try {
        const { releaseTemplateSourceFile } = await import("../services/offerGridFsStorageService.js");
        await releaseTemplateSourceFile({
          connection: req.auth.models.connection,
          fileId: uploadedFileId,
        });
      } catch {
        /* best-effort cleanup */
      }
    }
    next(error);
  }
}

/**
 * POST /api/offer-templates/:id/preview
 */
export async function previewOfferTemplate(req, res, next) {
  try {
    const { OfferTemplate } = req.auth.models;
    const doc = await OfferTemplate.findById(req.params.id).lean();
    if (!doc) throw new HttpError(404, "Offer template not found.");

    const offerData = req.body?.offerData
      ? toOfferDataFromLetter(req.body.offerData)
      : { ...SAMPLE_OFFER_DATA, createdAt: new Date(), joiningDate: new Date() };

    const result = await previewTemplateHtml({
      template: doc,
      offerData,
      company: req.auth.company,
    });

    res.json({
      success: true,
      ...result,
      template: serializeTemplate(doc),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/offer-templates/:id/generate-docx
 * Preview/download filled DOCX (does not require PDF conversion).
 */
export async function generateTemplateDocx(req, res, next) {
  try {
    const { OfferTemplate } = req.auth.models;
    const doc = await OfferTemplate.findById(req.params.id).lean();
    if (!doc) throw new HttpError(404, "Offer template not found.");
    if (doc.type !== OFFER_TEMPLATE_TYPES.UPLOADED_DOCX) {
      throw new HttpError(400, "DOCX generation applies only to uploaded Word templates.");
    }

    const offerData = req.body?.offerData
      ? toOfferDataFromLetter(req.body.offerData)
      : { ...SAMPLE_OFFER_DATA, createdAt: new Date(), joiningDate: new Date() };

    const buffer = await generateFilledDocx({
      template: doc,
      offerData,
      company: req.auth.company,
      connection: req.auth.models.connection,
    });

    const safeName = String(doc.name || "offer-template").replace(/[^a-zA-Z0-9_-]/g, "_");
    res.setHeader("Content-Type", DOCX_MIME);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-preview.docx"`);
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/offer-templates/:id/generate-pdf
 * DEFAULT_BUILDER always; UPLOADED_DOCX only when LibreOffice URL configured.
 */
export async function generateTemplatePdf(req, res, next) {
  try {
    const { OfferTemplate, connection } = req.auth.models;
    const doc = await OfferTemplate.findById(req.params.id).lean();
    if (!doc) throw new HttpError(404, "Offer template not found.");

    const offerData = req.body?.offerData
      ? toOfferDataFromLetter(req.body.offerData)
      : { ...SAMPLE_OFFER_DATA, createdAt: new Date(), joiningDate: new Date() };

    const { buffer } = await generateOfferPdfBuffer({
      template: doc,
      offerData,
      company: req.auth.company,
      connection,
    });

    const safeName = String(doc.name || "offer-template").replace(/[^a-zA-Z0-9_-]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-preview.pdf"`);
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/offer-templates/:id/source-download
 * Streams the uploaded DOCX source from tenant GridFS (authz already applied by router).
 */
export async function downloadTemplateSource(req, res, next) {
  try {
    const { OfferTemplate, connection } = req.auth.models;
    const doc = await OfferTemplate.findById(req.params.id).lean();
    if (!doc) throw new HttpError(404, "Offer template not found.");
    const fileId = getStorageFileId(doc.storage);
    if (!fileId) throw new HttpError(404, "No source file stored for this template.");

    // Authorization: fileId must match this template's storage in this tenant DB only.
    const safeName = String(doc.name || "template").replace(/[^a-zA-Z0-9_-]/g, "_");
    await streamOfferFileToResponse({
      connection,
      fileId,
      res,
      downloadName: `${safeName}-source.docx`,
      contentType: doc.storage?.contentType || DOCX_MIME,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/offer-templates/:id — archive (soft) or delete draft company templates.
 */
export async function deleteOfferTemplate(req, res, next) {
  try {
    const { OfferTemplate, connection } = req.auth.models;
    const doc = await OfferTemplate.findById(req.params.id);
    if (!doc) throw new HttpError(404, "Offer template not found.");

    if (doc.isSystemDefault && doc.source === OFFER_TEMPLATE_SOURCES.HRMS_MASTER) {
      throw new HttpError(400, "The HRMS system default template cannot be deleted. Archive it instead or set another default.");
    }

    if (doc.isDefault) {
      throw new HttpError(400, "Unset this template as default before deleting it.");
    }

    if (doc.status === OFFER_TEMPLATE_STATUSES.DRAFT && doc.source === OFFER_TEMPLATE_SOURCES.COMPANY) {
      await cleanupTemplateFiles({ connection, template: doc });
      await OfferTemplate.deleteOne({ _id: doc._id });
      return res.json({ success: true, message: "Draft template deleted." });
    }

    doc.status = OFFER_TEMPLATE_STATUSES.ARCHIVED;
    doc.updatedAt = new Date();
    await doc.save();
    res.json({ success: true, message: "Template archived.", template: serializeTemplate(doc) });
  } catch (error) {
    next(error);
  }
}

/** Exported for tests / internal use */
export { parseBase64Docx, serializeTemplate };
