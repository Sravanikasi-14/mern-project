/**
 * HR leave-details handover panel presentation.
 * Mirrored from desktop for identical empty-state guidance (mobile-only copy).
 */

export const HANDOVER_DETAIL_MODES = Object.freeze({
  LOADING_IMPACT: "LOADING_IMPACT",
  NO_HANDOVER_REQUIRED: "NO_HANDOVER_REQUIRED",
  NO_HANDOVER: "NO_HANDOVER",
  EMPTY_DRAFT_COVERAGE_NEEDED: "EMPTY_DRAFT_COVERAGE_NEEDED",
  EMPTY_DRAFT: "EMPTY_DRAFT",
  ACTIVE_HANDOVER: "ACTIVE_HANDOVER",
});

export function resolveHandoverDetailPresentation({
  coverageTaskCount = null,
  impactReady = false,
  handover = null,
} = {}) {
  const items = (handover?.items || []).filter((it) => it.status !== "CANCELLED");
  const itemCount = items.length;
  const noCoverage = impactReady && Number(coverageTaskCount) === 0;
  const coverageNeeded = impactReady && Number(coverageTaskCount) > 0;

  if (itemCount > 0) {
    return {
      mode: HANDOVER_DETAIL_MODES.ACTIVE_HANDOVER,
      title: null,
      body: null,
      showStartButton: false,
      showLifecycle: true,
      itemCount,
    };
  }

  if (noCoverage) {
    return {
      mode: HANDOVER_DETAIL_MODES.NO_HANDOVER_REQUIRED,
      title: "No handover is currently required.",
      body: "Handover is optional and can be created later if coordination becomes necessary.",
      showStartButton: true,
      startButtonLabel: "Create handover later",
      showLifecycle: false,
      itemCount: 0,
    };
  }

  if (!handover) {
    if (!impactReady) {
      return {
        mode: HANDOVER_DETAIL_MODES.LOADING_IMPACT,
        title: "No handover has been created for this leave request.",
        body: "Handover is optional and is only useful when responsibilities need temporary coordination.",
        showStartButton: false,
        showLifecycle: false,
        itemCount: 0,
      };
    }
    return {
      mode: HANDOVER_DETAIL_MODES.NO_HANDOVER,
      title: "No handover has been created for this leave request.",
      body: "Handover is optional and is only useful when responsibilities need temporary coordination during the leave period.",
      showStartButton: true,
      startButtonLabel: "Start handover draft",
      showLifecycle: false,
      itemCount: 0,
    };
  }

  if (coverageNeeded) {
    return {
      mode: HANDOVER_DETAIL_MODES.EMPTY_DRAFT_COVERAGE_NEEDED,
      title: "A handover draft exists, but no responsibilities have been added yet.",
      body: "Coverage was identified for this leave window. Add responsibilities and select backups before requesting coordination. Leave approval does not depend on completing this draft.",
      showStartButton: false,
      showLifecycle: false,
      itemCount: 0,
    };
  }

  return {
    mode: HANDOVER_DETAIL_MODES.EMPTY_DRAFT,
    title: "A handover draft exists, but no responsibilities have been added yet.",
    body: "Coordination is unavailable until at least one responsibility with a selected coverage employee is added.",
    showStartButton: false,
    showLifecycle: false,
    itemCount: 0,
  };
}
