/**
 * Shared fixtures for offer e-signature tests.
 * - HR_SIGNATURE_LETTERHEAD: spread into Company.create({ letterhead }) so offers can be sent.
 * - CANDIDATE_SIGNATURE_FIELDS: spread into the candidate accept request body.
 */

// Valid 1x1 PNG (68 bytes).
export const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

export const HR_SIGNATURE_LETTERHEAD = Object.freeze({
  signatureMethod: "UPLOAD",
  signatureMimeType: "image/png",
  signatureUpdatedAt: new Date("2026-01-01T00:00:00Z"),
  signatureTypedText: "",
  signatureData: Buffer.from(TINY_PNG_BASE64, "base64"),
});

export const CANDIDATE_SIGNATURE_FIELDS = Object.freeze({
  signatureMethod: "DRAW",
  imageDataUrl: TINY_PNG_DATA_URL,
});

/** Directly seed an HR signature on an existing Company document (bypasses the API). */
export async function seedCompanyHrSignature(Company, companyId) {
  await Company.updateOne(
    { _id: companyId },
    {
      $set: {
        "letterhead.signatureMethod": HR_SIGNATURE_LETTERHEAD.signatureMethod,
        "letterhead.signatureMimeType": HR_SIGNATURE_LETTERHEAD.signatureMimeType,
        "letterhead.signatureUpdatedAt": HR_SIGNATURE_LETTERHEAD.signatureUpdatedAt,
        "letterhead.signatureTypedText": "",
        "letterhead.signatureData": HR_SIGNATURE_LETTERHEAD.signatureData,
      },
    }
  );
}
