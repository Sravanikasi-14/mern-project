/**
 * Read-only audit: SENT/ACCEPTED offers whose frozen HTML lacks an HR signature mark.
 * Does NOT modify documents or resend email.
 *
 * Usage (from server/): node scripts/auditUnsignedOffers.js
 */
import "dotenv/config";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company from "../models/Company.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";

function hasHrSignatureEmbed(html) {
  const s = String(html || "");
  return s.includes('class="sig-img"') || s.includes('class="sig-typed"');
}

await connectCentralDB();
const companies = await Company.find({}).lean();
const items = [];
let scanned = 0;

for (const company of companies) {
  try {
    const { OfferLetter } = await getCompanyModels(company, { provision: true });
    const offers = await OfferLetter.find({
      status: { $in: [OFFER_LETTER_STATUSES.SENT, OFFER_LETTER_STATUSES.ACCEPTED] },
    })
      .select(
        "status candidate.fullName candidate.email issuedContent content emailedAt emailDelivery.status issuedAt createdAt"
      )
      .lean();

    for (const offer of offers) {
      scanned += 1;
      const html = offer.issuedContent || offer.content || "";
      if (!hasHrSignatureEmbed(html)) {
        items.push({
          company: company.slug || company.companyName,
          offerId: String(offer._id),
          status: offer.status,
          candidate: offer.candidate?.fullName || "",
          email: offer.candidate?.email || "",
          emailDelivery: offer.emailDelivery?.status || "",
          issuedAt: offer.issuedAt || null,
          reason: html.trim()
            ? "Frozen HTML has no HR signature image/typed mark"
            : "Missing issuedContent/content",
        });
      }
    }
  } catch (err) {
    items.push({
      company: company.slug || company.companyName,
      databaseName: company.databaseName,
      error: err.message,
    });
  }
}

console.log(
  JSON.stringify(
    {
      auditedAt: new Date().toISOString(),
      companies: companies.length,
      scannedOffers: scanned,
      unsignedOrMissing: items.filter((i) => !i.error).length,
      errors: items.filter((i) => i.error).length,
      items,
    },
    null,
    2
  )
);
await disconnectAll();
process.exit(0);
