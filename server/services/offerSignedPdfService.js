import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { buildSignedOfferHtml, pdfBufferFromHtml } from "./offerStandardRenderService.js";
import { storeSignedPdfIfNeeded } from "./offerDocumentService.js";
import { getOfferFileBuffer, getStorageFileId } from "./offerGridFsStorageService.js";

/**
 * Final signed PDF for an ACCEPTED offer.
 *
 * - Prefers the stored `signedPdf` (GridFS purpose signed_pdf).
 * - Otherwise builds it from the frozen issuedContent (HR signature already embedded) with only the
 *   candidate signature + date injected, renders it, and stores it as SIGNED_PDF.
 * - Never reads or overwrites `generatedPdf` (the issued copy).
 *
 * @returns {Promise<{ buffer: Buffer, stored: boolean, reused: boolean } | null>} null if not signed yet
 */
export async function getOrCreateSignedPdf({ OfferLetter, offerLetterId, connection }) {
  const doc = await OfferLetter.findById(offerLetterId).select("+signature.imageData").lean();
  if (!doc || doc.status !== OFFER_LETTER_STATUSES.ACCEPTED || !doc.signature?.signedAt) {
    return null;
  }

  const fileId = getStorageFileId(doc.signedPdf);
  if (fileId) {
    try {
      const buffer = await getOfferFileBuffer({ connection, fileId });
      return { buffer, stored: true, reused: true };
    } catch (err) {
      console.warn("[offerSignedPdf] Stored signed PDF unavailable; regenerating:", err.message);
    }
  }

  const { html } = buildSignedOfferHtml({
    issuedContent: doc.issuedContent || doc.content || "",
    signature: doc.signature,
  });
  const buffer = await pdfBufferFromHtml(html);

  let stored = false;
  try {
    const result = await storeSignedPdfIfNeeded({
      OfferLetter,
      offerLetter: doc,
      pdfBuffer: buffer,
      connection,
    });
    stored = Boolean(result?.storage);
  } catch (err) {
    console.warn("[offerSignedPdf] Could not store signed PDF:", err.message);
  }
  return { buffer, stored, reused: false };
}
