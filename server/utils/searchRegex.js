/**
 * F58 — Shared search regex helpers.
 *
 * Free-text list search uses prefix-anchored case-insensitive regex so Mongo can
 * use leading-field indexes (fullName, email, employeeCode) more effectively than
 * unanchored substring regex scans (e.g. term with leading/trailing ".*").
 *
 * Behavior change vs legacy substring match: "ra" matches "Rao" and "Rachel"
 * but not "Sara". Exact filters that already use ^...$ are unchanged.
 */

export function escapeRegex(text) {
  return String(text || "").replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * Case-insensitive prefix regex for free-text search terms.
 * Empty/whitespace input returns null (caller should skip $or).
 */
export function buildPrefixCiRegex(raw) {
  const term = String(raw || "").trim();
  if (!term) return null;
  return new RegExp(`^${escapeRegex(term)}`, "i");
}

/**
 * Exact case-insensitive match (already-safe filter pattern).
 */
export function buildExactCiRegex(raw) {
  const term = String(raw || "").trim();
  if (!term) return null;
  return new RegExp(`^${escapeRegex(term)}$`, "i");
}
