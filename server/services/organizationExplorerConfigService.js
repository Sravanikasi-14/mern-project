import { HttpError } from "../utils/httpError.js";

export const ORGANIZATION_EXPLORER_VIEWS = Object.freeze([
  "reporting",
  "teams",
  "projects",
  "departments",
]);

export const DEFAULT_ORGANIZATION_EXPLORER_CONFIG = Object.freeze({
  enabledViews: Object.freeze([...ORGANIZATION_EXPLORER_VIEWS]),
  defaultView: "reporting",
  allowCompletedProjectsFilter: false,
});

const ALLOWED_VIEW_SET = new Set(ORGANIZATION_EXPLORER_VIEWS);

/**
 * Resolve stored Company.config.organizationExplorer to a complete, safe object.
 * Missing / partial config returns defaults without requiring a migration.
 */
export function resolveOrganizationExplorerConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : {};

  let enabledViews = Array.isArray(source.enabledViews)
    ? source.enabledViews
        .filter((v) => typeof v === "string")
        .map((v) => v.trim().toLowerCase())
        .filter((v) => ALLOWED_VIEW_SET.has(v))
    : [];

  // Dedupe while preserving order.
  enabledViews = [...new Set(enabledViews)];

  if (enabledViews.length === 0) {
    enabledViews = [...DEFAULT_ORGANIZATION_EXPLORER_CONFIG.enabledViews];
  }

  let defaultView =
    typeof source.defaultView === "string" ? source.defaultView.trim().toLowerCase() : "";
  if (!enabledViews.includes(defaultView)) {
    defaultView = enabledViews.includes(DEFAULT_ORGANIZATION_EXPLORER_CONFIG.defaultView)
      ? DEFAULT_ORGANIZATION_EXPLORER_CONFIG.defaultView
      : enabledViews[0];
  }

  // Completed-project filtering stays locked off until a Project lifecycle model exists.
  const allowCompletedProjectsFilter = false;

  return {
    enabledViews,
    defaultView,
    allowCompletedProjectsFilter,
  };
}

export function serializeOrganizationExplorerConfig(raw) {
  return resolveOrganizationExplorerConfig(raw);
}

/**
 * Validate an HR update payload and return the normalized config to persist.
 * Rejects completed-project filtering, empty/duplicate/invalid views, and
 * a defaultView outside enabledViews.
 */
export function validateOrganizationExplorerUpdate(input, options = {}) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "organizationExplorer must be an object.", {
      field: "organizationExplorer",
      code: "INVALID_ORGANIZATION_EXPLORER",
    });
  }

  const current = resolveOrganizationExplorerConfig(options.current);

  let enabledViews;
  if (Object.prototype.hasOwnProperty.call(input, "enabledViews")) {
    if (!Array.isArray(input.enabledViews)) {
      throw new HttpError(400, "enabledViews must be an array.", {
        field: "enabledViews",
        code: "INVALID_ENABLED_VIEWS",
      });
    }

    const normalized = input.enabledViews.map((v, index) => {
      if (typeof v !== "string" || !v.trim()) {
        throw new HttpError(400, "enabledViews entries must be non-empty strings.", {
          field: `enabledViews[${index}]`,
          code: "INVALID_ENABLED_VIEW",
        });
      }
      const view = v.trim().toLowerCase();
      if (!ALLOWED_VIEW_SET.has(view)) {
        throw new HttpError(
          400,
          `Invalid view "${v}". Allowed: ${ORGANIZATION_EXPLORER_VIEWS.join(", ")}.`,
          {
            field: `enabledViews[${index}]`,
            code: "INVALID_ENABLED_VIEW",
          }
        );
      }
      return view;
    });

    const unique = [...new Set(normalized)];
    if (unique.length !== normalized.length) {
      throw new HttpError(400, "enabledViews must not contain duplicates.", {
        field: "enabledViews",
        code: "DUPLICATE_ENABLED_VIEWS",
      });
    }
    if (unique.length === 0) {
      throw new HttpError(400, "At least one organization explorer view must remain enabled.", {
        field: "enabledViews",
        code: "EMPTY_ENABLED_VIEWS",
      });
    }
    enabledViews = unique;
  } else {
    enabledViews = [...current.enabledViews];
  }

  let defaultView;
  if (Object.prototype.hasOwnProperty.call(input, "defaultView")) {
    if (typeof input.defaultView !== "string" || !input.defaultView.trim()) {
      throw new HttpError(400, "defaultView must be a non-empty string.", {
        field: "defaultView",
        code: "INVALID_DEFAULT_VIEW",
      });
    }
    defaultView = input.defaultView.trim().toLowerCase();
    if (!ALLOWED_VIEW_SET.has(defaultView)) {
      throw new HttpError(
        400,
        `Invalid defaultView "${input.defaultView}". Allowed: ${ORGANIZATION_EXPLORER_VIEWS.join(", ")}.`,
        {
          field: "defaultView",
          code: "INVALID_DEFAULT_VIEW",
        }
      );
    }
  } else {
    defaultView = current.defaultView;
  }

  if (!enabledViews.includes(defaultView)) {
    throw new HttpError(400, "defaultView must be one of the enabledViews.", {
      field: "defaultView",
      code: "DEFAULT_VIEW_NOT_ENABLED",
    });
  }

  if (Object.prototype.hasOwnProperty.call(input, "allowCompletedProjectsFilter")) {
    const flag = input.allowCompletedProjectsFilter;
    if (flag === true || flag === "true" || flag === 1 || flag === "1") {
      throw new HttpError(
        400,
        "allowCompletedProjectsFilter cannot be enabled until a Project lifecycle model is implemented.",
        {
          field: "allowCompletedProjectsFilter",
          code: "COMPLETED_PROJECTS_FILTER_LOCKED",
        }
      );
    }
    if (flag !== false && flag !== "false" && flag !== 0 && flag !== "0") {
      throw new HttpError(400, "allowCompletedProjectsFilter must be false.", {
        field: "allowCompletedProjectsFilter",
        code: "INVALID_COMPLETED_PROJECTS_FILTER",
      });
    }
  }

  return {
    enabledViews,
    defaultView,
    allowCompletedProjectsFilter: false,
  };
}
