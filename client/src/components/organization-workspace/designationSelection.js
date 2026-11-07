/**
 * Catalog selection changes the title only.
 * A catalog level is offered as a suggestion and never replaces the current grade.
 */
export function applyExplicitDesignation(current, catalogEntry) {
  const title = String(catalogEntry?.title || "").trim();
  const currentGrade = current?.jobGrade == null ? "" : String(current.jobGrade);
  const catalogGrade = String(catalogEntry?.grade || "").trim();
  return {
    jobTitle: title,
    jobGrade: currentGrade,
    suggestedGrade: catalogGrade && catalogGrade !== currentGrade.trim() ? catalogGrade : "",
  };
}
