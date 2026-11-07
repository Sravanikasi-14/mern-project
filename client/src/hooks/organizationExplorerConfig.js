export const EXPLORER_VIEWS = Object.freeze(["reporting", "teams", "projects", "departments"]);

export const DEFAULT_EXPLORER_CONFIG = Object.freeze({
  enabledViews: Object.freeze([...EXPLORER_VIEWS]),
  defaultView: "reporting",
  allowCompletedProjectsFilter: false,
});

export function normalizeExplorerConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  let enabledViews = Array.isArray(source.enabledViews)
    ? source.enabledViews
        .filter((v) => typeof v === "string")
        .map((v) => v.trim().toLowerCase())
        .filter((v) => EXPLORER_VIEWS.includes(v))
    : [];
  enabledViews = [...new Set(enabledViews)];
  if (enabledViews.length === 0) {
    enabledViews = [...DEFAULT_EXPLORER_CONFIG.enabledViews];
  }

  let defaultView =
    typeof source.defaultView === "string" ? source.defaultView.trim().toLowerCase() : "";
  if (!enabledViews.includes(defaultView)) {
    defaultView = enabledViews.includes(DEFAULT_EXPLORER_CONFIG.defaultView)
      ? DEFAULT_EXPLORER_CONFIG.defaultView
      : enabledViews[0];
  }

  return {
    enabledViews,
    defaultView,
    allowCompletedProjectsFilter: false,
  };
}

export function resolveActiveExplorerView(preferred, enabledViews) {
  const enabled = Array.isArray(enabledViews) ? enabledViews : [];
  if (!enabled.length) return null;
  if (preferred && enabled.includes(preferred)) return preferred;
  return enabled[0];
}
