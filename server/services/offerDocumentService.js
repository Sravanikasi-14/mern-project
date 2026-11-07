import {
  OFFER_TEMPLATE_STATUSES,
  OFFER_TEMPLATE_TYPES,
} from "../models/OfferTemplate.js";
import { HttpError } from "../utils/httpError.js";
import { convertDocxToPdf, getConversionStatus, isConversionConfigured } from "./docxConversionService.js";
import { fillDocxTemplate, findMissingMappings, renderDocxPlaceholderPreviewHtml } from "./offerDocxTemplateService.js";
import {
  getTemplateSnapshot,
  loadCompanyLogoDataUrl,
  renderBuilderHtml,
  renderDocxOfferSummaryHtml,
  SAMPLE_OFFER_DATA,
} from "./offerTemplateRenderService.js";
import { renderOfferLetterHtml } from "./offerTemplateService.js";
import { generateOfferLetterPdf } from "./pdfService.js";
import {
  PURPOSE_ISSUED_PDF,
  PURPOSE_SIGNED_PDF,
  getOfferFileBuffer,
  getStorageFileId,
  isOfferStorageConfigured,
  putOfferFile,
  storageRefFromUpload,
  streamOfferFileToResponse,
} from "./offerGridFsStorageService.js";

/**
 * Shared document generation for DEFAULT_BUILDER and UPLOADED_DOCX templates.
 * Issued PDFs in GridFS are never overwritten once written.
 */

export function toOfferDataFromLetter(offerLetter) {
  if (!offerLetter) return { ...SAMPLE_OFFER_DATA };
  return {
    candidate: {
      fullName: offerLetter.candidate?.fullName || "",
      email: offerLetter.candidate?.email || "",
    },
    position: offerLetter.position || "",
    department: offerLetter.department || "",
    workLocation: offerLetter.workLocation || "",
    reportingManager: offerLetter.reportingManager || "",
    employmentType: offerLetter.employmentType || "Full-time Permanent",
    monthlySalary: Number(offerLetter.monthlySalary) || 0,
    annualSalary: Number(offerLetter.annualSalary) || (Number(offerLetter.monthlySalary) || 0) * 12,
    joiningDate: offerLetter.joiningDate,
    createdAt: offerLetter.createdAt || new Date(),
    clauses: offerLetter.clauses,
  };
}

export async function resolveActiveTemplate(OfferTemplate, templateId) {
  if (!templateId) {
    const def = await OfferTemplate.findOne({
      isDefault: true,
      status: OFFER_TEMPLATE_STATUSES.ACTIVE,
    }).lean();
    return def || null;
  }
  const template = await OfferTemplate.findById(templateId).lean();
  if (!template) throw new HttpError(404, "Offer template not found.");
  if (template.status === OFFER_TEMPLATE_STATUSES.ARCHIVED) {
    throw new HttpError(400, "Cannot use an archived offer template.");
  }
  return template;
}

export async function renderTemplateHtml({ template, offerData, company, signature = null }) {
  if (!template) {
    return renderOfferLetterHtml(offerData, company);
  }

  if (template.type === OFFER_TEMPLATE_TYPES.UPLOADED_DOCX) {
    return renderDocxOfferSummaryHtml({ offerData, company, template });
  }

  const snapshot = getTemplateSnapshot(template, template.version) || {
    sectionConfig: template.settings?.sectionConfig,
    legalSections: template.settings?.legalSections,
    settings: template.settings || {},
  };
  const logoDataUrl = await loadCompanyLogoDataUrl(company);
  return renderBuilderHtml({ snapshot, offerData, company, logoDataUrl, signature });
}

export async function previewTemplateHtml({ template, offerData, company }) {
  const data = offerData || { ...SAMPLE_OFFER_DATA, createdAt: new Date() };
  if (template?.type === OFFER_TEMPLATE_TYPES.UPLOADED_DOCX) {
    return {
      html: renderDocxPlaceholderPreviewHtml(template, data, company),
      format: "docx-placeholder-table",
      conversion: getConversionStatus(),
    };
  }
  const html = await renderTemplateHtml({ template, offerData: data, company });
  return { html, format: "html", conversion: getConversionStatus() };
}

async function loadDocxSourceBuffer(template, connection) {
  const fileId = getStorageFileId(template?.storage);
  if (!fileId) {
    throw new HttpError(400, "This DOCX template has no uploaded source file.", {
      code: "TEMPLATE_SOURCE_MISSING",
    });
  }
  return getOfferFileBuffer({ connection, fileId });
}

export async function generateFilledDocx({ template, offerData, company, connection }) {
  if (template.type !== OFFER_TEMPLATE_TYPES.UPLOADED_DOCX) {
    throw new HttpError(400, "Filled DOCX is only available for uploaded Word templates.");
  }
  const missing = findMissingMappings(template.placeholders || [], template.placeholderMappings || []);
  if (missing.length > 0) {
    throw new HttpError(400, "Some required placeholders are not mapped.", {
      code: "MAPPINGS_INCOMPLETE",
      missingFields: missing,
    });
  }
  const source = await loadDocxSourceBuffer(template, connection);
  return fillDocxTemplate(source, template.placeholderMappings, offerData, company);
}

/**
 * Produce a PDF for an offer. For UPLOADED_DOCX, requires LIBREOFFICE_CONVERT_URL
 * (or test converter). Never uses a paid fallback.
 */
export async function generateOfferPdfBuffer({
  template,
  offerData,
  company,
  signature = null,
  connection = null,
}) {
  if (!template || template.type === OFFER_TEMPLATE_TYPES.DEFAULT_BUILDER || !template.type) {
    const html = await renderTemplateHtml({ template, offerData, company, signature });
    return { buffer: await generateOfferLetterPdf(html), contentType: "application/pdf", format: "pdf" };
  }

  if (template.type === OFFER_TEMPLATE_TYPES.UPLOADED_DOCX) {
    if (!isConversionConfigured()) {
      throw new HttpError(503, getConversionStatus().message, { code: "CONVERSION_NOT_CONFIGURED" });
    }
    const filled = await generateFilledDocx({ template, offerData, company, connection });
    const pdf = await convertDocxToPdf(filled);
    return { buffer: pdf, contentType: "application/pdf", format: "pdf" };
  }

  throw new HttpError(400, `Unsupported template type '${template.type}'.`);
}

function hasIssuedPdf(offerLetter) {
  return Boolean(getStorageFileId(offerLetter?.generatedPdf));
}

/**
 * Persist an issued PDF once. Each offer gets its own GridFS file; never overwritten.
 */
export async function storeIssuedPdfIfNeeded({
  OfferLetter,
  offerLetter,
  pdfBuffer,
  connection,
}) {
  if (hasIssuedPdf(offerLetter)) {
    const fileId = getStorageFileId(offerLetter.generatedPdf);
    let buffer = pdfBuffer;
    try {
      buffer = await getOfferFileBuffer({ connection, fileId });
    } catch {
      buffer = pdfBuffer;
    }
    return {
      storage: offerLetter.generatedPdf,
      reused: true,
      buffer,
    };
  }

  if (!isOfferStorageConfigured(connection)) {
    return { storage: null, reused: false, buffer: pdfBuffer };
  }

  let uploaded;
  try {
    uploaded = await putOfferFile({
      connection,
      body: pdfBuffer,
      contentType: "application/pdf",
      filename: `offer_${offerLetter._id}_issued.pdf`,
      purpose: PURPOSE_ISSUED_PDF,
      metadata: {
        offerId: String(offerLetter._id),
        templateVersion: offerLetter.templateVersion || null,
      },
    });
  } catch (error) {
    throw error;
  }

  const storage = storageRefFromUpload(uploaded);
  const generatedPdf = {
    provider: storage.provider,
    bucket: storage.bucket,
    fileId: storage.fileId,
    key: storage.key,
    filename: storage.filename,
    contentType: storage.contentType,
    byteSize: storage.byteSize,
    checksumSha256: storage.checksumSha256,
    generatedAt: storage.uploadedAt,
  };

  // Only write if no issued PDF fileId exists yet (immutability).
  const updateResult = await OfferLetter.updateOne(
    {
      _id: offerLetter._id,
      $or: [
        { generatedPdf: { $exists: false } },
        { "generatedPdf.fileId": { $exists: false } },
        { "generatedPdf.fileId": null },
        { "generatedPdf.key": { $in: [null, ""] }, "generatedPdf.fileId": { $exists: false } },
      ],
    },
    { $set: { generatedPdf } }
  );

  if (!updateResult.modifiedCount && !updateResult.matchedCount) {
    // Race: another writer stored first — keep existing; delete our new unique file? 
    // Issued PDFs must never be auto-deleted. Leave orphan for rare race; prefer reload.
    const refreshed = await OfferLetter.findById(offerLetter._id).lean();
    if (hasIssuedPdf(refreshed)) {
      return {
        storage: refreshed.generatedPdf,
        reused: true,
        buffer: await getOfferFileBuffer({
          connection,
          fileId: getStorageFileId(refreshed.generatedPdf),
        }).catch(() => pdfBuffer),
      };
    }
  }

  return { storage: generatedPdf, reused: false, buffer: pdfBuffer };
}

function hasSignedPdf(offerLetter) {
  return Boolean(getStorageFileId(offerLetter?.signedPdf));
}

/**
 * Persist the final signed PDF (HR + candidate signatures) once, as purpose SIGNED_PDF.
 * Never touches generatedPdf (the issued copy the candidate received).
 */
export async function storeSignedPdfIfNeeded({ OfferLetter, offerLetter, pdfBuffer, connection }) {
  if (hasSignedPdf(offerLetter)) {
    return { storage: offerLetter.signedPdf, reused: true, buffer: pdfBuffer };
  }
  if (!isOfferStorageConfigured(connection)) {
    return { storage: null, reused: false, buffer: pdfBuffer };
  }

  const uploaded = await putOfferFile({
    connection,
    body: pdfBuffer,
    contentType: "application/pdf",
    filename: `offer_${offerLetter._id}_signed.pdf`,
    purpose: PURPOSE_SIGNED_PDF,
    metadata: { offerId: String(offerLetter._id) },
  });
  const storage = storageRefFromUpload(uploaded);
  const signedPdf = {
    provider: storage.provider,
    bucket: storage.bucket,
    fileId: storage.fileId,
    key: storage.key,
    filename: storage.filename,
    contentType: storage.contentType,
    byteSize: storage.byteSize,
    checksumSha256: storage.checksumSha256,
    generatedAt: storage.uploadedAt,
  };
  await OfferLetter.updateOne(
    {
      _id: offerLetter._id,
      $or: [{ "signedPdf.fileId": { $exists: false } }, { "signedPdf.fileId": null }],
    },
    { $set: { signedPdf } }
  );
  return { storage: signedPdf, reused: false, buffer: pdfBuffer };
}

export async function getSignedPdfDownload({ offerLetter, connection }) {
  const fileId = getStorageFileId(offerLetter?.signedPdf);
  if (!fileId) return null;
  const buffer = await getOfferFileBuffer({ connection, fileId });
  return { buffer, fileId, fromStorage: true };
}

export async function streamSignedPdfToResponse({ offerLetter, connection, res, downloadName }) {
  const fileId = getStorageFileId(offerLetter?.signedPdf);
  if (!fileId) return false;
  await streamOfferFileToResponse({
    connection,
    fileId,
    res,
    downloadName,
    contentType: offerLetter.signedPdf?.contentType || "application/pdf",
  });
  return true;
}

export async function getIssuedPdfDownload({ offerLetter, connection }) {
  const fileId = getStorageFileId(offerLetter?.generatedPdf);
  if (!fileId) return null;
  const buffer = await getOfferFileBuffer({ connection, fileId });
  return { buffer, fileId, fromStorage: true };
}

export async function streamIssuedPdfToResponse({ offerLetter, connection, res, downloadName }) {
  const fileId = getStorageFileId(offerLetter?.generatedPdf);
  if (!fileId) return false;
  await streamOfferFileToResponse({
    connection,
    fileId,
    res,
    downloadName,
    contentType: offerLetter.generatedPdf?.contentType || "application/pdf",
  });
  return true;
}
