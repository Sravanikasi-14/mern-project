const THUMB_MIN = 20;
const THUMB_MAX = 40;

/** @typedef {{ overflow: boolean, thumbH: number, top: number }} OverlayThumbLayout */

/**
 * Pure thumb geometry used by OverlayScrollbar sync + unit tests.
 * @param {number} clientHeight
 * @param {number} scrollHeight
 * @param {number} scrollTop
 * @returns {OverlayThumbLayout}
 */
export function computeOverlayThumbLayout(clientHeight, scrollHeight, scrollTop) {
  if (!(clientHeight > 0)) {
    return { overflow: false, thumbH: 0, top: 0 };
  }
  const overflow = scrollHeight > clientHeight + 1;
  if (!overflow) {
    return { overflow: false, thumbH: 0, top: 0 };
  }

  const track = Math.max(clientHeight - 8, 1);
  const ratio = clientHeight / Math.max(scrollHeight, 1);
  const rawH = Math.round(track * ratio);
  const thumbH = Math.min(THUMB_MAX, Math.max(THUMB_MIN, rawH));
  const maxTop = Math.max(track - thumbH, 0);
  const range = scrollHeight - clientHeight;
  const top =
    range <= 0 ? 0 : Math.round((Math.max(0, scrollTop) / range) * maxTop);

  return { overflow: true, thumbH, top };
}

/**
 * Coalesce many triggers into at most one callback per animation frame.
 * @param {() => void} run
 * @param {{ raf?: typeof requestAnimationFrame, caf?: typeof cancelAnimationFrame }} [api]
 */
export function createRafScheduler(run, api = {}) {
  const raf = api.raf || ((cb) => window.requestAnimationFrame(cb));
  const caf = api.caf || ((id) => window.cancelAnimationFrame(id));
  let id = 0;

  return {
    schedule() {
      if (id) return false;
      id = raf(() => {
        id = 0;
        run();
      });
      return true;
    },
    cancel() {
      if (!id) return;
      caf(id);
      id = 0;
    },
    isPending() {
      return id !== 0;
    },
  };
}

export const OVERLAY_SCROLLBAR_THUMB = Object.freeze({
  MIN: THUMB_MIN,
  MAX: THUMB_MAX,
});
