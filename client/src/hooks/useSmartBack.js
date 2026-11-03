import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { resolveDesktopFallback, smartBack } from "../utils/navigation";

/**
 * Desktop smart back: pop history when possible, else go to logical parent.
 */
export function useSmartBack(fallback) {
  const navigate = useNavigate();
  const location = useLocation();
  const resolvedFallback =
    fallback ||
    location.state?.from ||
    resolveDesktopFallback(location.pathname, location.search);

  return useCallback(() => {
    return smartBack(navigate, location, { fallback: resolvedFallback });
  }, [navigate, location, resolvedFallback]);
}
