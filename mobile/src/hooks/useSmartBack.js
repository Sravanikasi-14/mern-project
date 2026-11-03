import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { resolveMobileFallback, smartBack } from "../utils/navigation";
import { closeTopOverlay, hasOpenOverlay } from "../components/Modal";

/**
 * Mobile smart back with overlay-first priority.
 */
export function useSmartBack(fallback) {
  const navigate = useNavigate();
  const location = useLocation();
  const resolvedFallback =
    fallback ||
    location.state?.from ||
    resolveMobileFallback(location.pathname, location.search);

  return useCallback(() => {
    if (hasOpenOverlay()) {
      closeTopOverlay();
      return { mode: "overlay" };
    }
    return smartBack(navigate, location, { fallback: resolvedFallback });
  }, [navigate, location, resolvedFallback]);
}
