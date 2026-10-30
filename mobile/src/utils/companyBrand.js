/**
 * Company name shown in the HR portal chrome (sidebar, headers).
 * Prefers branding.displayName, then legal companyName.
 * Strips a trailing "Updated" token that was never a legal suffix.
 */
export function getCompanyBrandName(company) {
  const display = String(company?.branding?.displayName || "").trim();
  const legal = String(company?.companyName || company?.name || "").trim();
  const raw = display || legal;
  const cleaned = raw.replace(/\s+Updated$/i, "").trim();
  return cleaned || legal || "HRMS Portal";
}

export function companyHasLogo(company) {
  return Boolean(company?.branding?.logoUrl);
}
