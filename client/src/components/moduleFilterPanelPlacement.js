/** Pure viewport placement for the employee (ModuleFilters) popover. */

export const FILTER_PANEL_VIEWPORT_MARGIN = 12;
export const FILTER_PANEL_GAP = 8;
export const FILTER_PANEL_MIN_HEIGHT = 200;
export const FILTER_PANEL_PREFERRED_MAX = 560;
export const FILTER_PANEL_MAX_WIDTH = 360;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * @param {{ top: number, right: number, bottom: number, left: number, width: number, height: number }} trigger
 * @param {{ innerWidth: number, innerHeight: number }} viewport
 */
export function computeFilterPanelPlacement(trigger, viewport) {
  const vw = viewport.innerWidth;
  const vh = viewport.innerHeight;
  const width = Math.min(FILTER_PANEL_MAX_WIDTH, vw - FILTER_PANEL_VIEWPORT_MARGIN * 2);

  let left = trigger.right - width;
  left = clamp(left, FILTER_PANEL_VIEWPORT_MARGIN, vw - width - FILTER_PANEL_VIEWPORT_MARGIN);

  const spaceBelow = vh - trigger.bottom - FILTER_PANEL_VIEWPORT_MARGIN - FILTER_PANEL_GAP;
  const spaceAbove = trigger.top - FILTER_PANEL_VIEWPORT_MARGIN - FILTER_PANEL_GAP;
  const openBelow =
    spaceBelow >= FILTER_PANEL_MIN_HEIGHT || spaceBelow >= spaceAbove;
  const available = Math.max(openBelow ? spaceBelow : spaceAbove, FILTER_PANEL_MIN_HEIGHT);
  const maxHeight = Math.min(
    FILTER_PANEL_PREFERRED_MAX,
    Math.floor(vh * 0.78),
    available
  );

  let top = openBelow
    ? trigger.bottom + FILTER_PANEL_GAP
    : trigger.top - FILTER_PANEL_GAP - maxHeight;
  top = clamp(top, FILTER_PANEL_VIEWPORT_MARGIN, vh - FILTER_PANEL_VIEWPORT_MARGIN - maxHeight);

  return {
    top: Math.round(top),
    left: Math.round(left),
    width: Math.round(width),
    maxHeight: Math.round(maxHeight),
    openBelow,
  };
}

/**
 * Assert panel rect fits inside the viewport with the configured margin.
 */
export function filterPanelFitsViewport(placement, viewport, margin = FILTER_PANEL_VIEWPORT_MARGIN) {
  const bottom = placement.top + placement.maxHeight;
  const right = placement.left + placement.width;
  return (
    placement.top >= margin - 0.5 &&
    placement.left >= margin - 0.5 &&
    bottom <= viewport.innerHeight - margin + 0.5 &&
    right <= viewport.innerWidth - margin + 0.5 &&
    placement.maxHeight >= FILTER_PANEL_MIN_HEIGHT
  );
}
