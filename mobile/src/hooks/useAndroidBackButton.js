import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { closeTopOverlay, hasOpenOverlay } from "../components/Modal";
import { isTabRootPath, resolveMobileFallback, smartBack } from "../utils/navigation";

/**
 * Single Capacitor hardware-back listener (native only).
 * Priority: overlay → smart back / parent fallback → exit on tab roots.
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigateRef = useRef(navigate);
  const locationRef = useRef(location);

  useEffect(() => {
    navigateRef.current = navigate;
    locationRef.current = location;
  }, [navigate, location]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    let listener;
    let cancelled = false;

    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        if (cancelled) return;

        listener = await App.addListener("backButton", ({ canGoBack }) => {
          if (hasOpenOverlay()) {
            closeTopOverlay();
            return;
          }

          const loc = locationRef.current;
          if (isTabRootPath(loc.pathname)) {
            App.exitApp();
            return;
          }

          const fallback = resolveMobileFallback(loc.pathname, loc.search);
          if (canGoBack) {
            smartBack(navigateRef.current, loc, { fallback });
          } else {
            navigateRef.current(fallback, { replace: true });
          }
        });

        if (cancelled) {
          await listener?.remove?.();
        }
      } catch {
        // Optional on web / when plugin missing.
      }
    })();

    return () => {
      cancelled = true;
      listener?.remove?.();
    };
  }, []);
}
