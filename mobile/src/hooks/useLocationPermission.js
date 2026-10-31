import { useCallback, useEffect, useState } from "react";
import { checkPermission, getCurrentPosition, requestPermission } from "../services/location";

function statusFromError(err) {
  if (err?.code === "PERMISSION_DENIED") return "denied";
  if (err?.code === "GPS_DISABLED" || err?.status === "gps-disabled") return "gps-disabled";
  if (err?.code === "POSITION_UNAVAILABLE") return "unavailable";
  if (err?.code === "UNSUPPORTED") return "unsupported";
  return "error";
}

export default function useLocationPermission() {
  const [status, setStatus] = useState("unknown");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await checkPermission();
      setStatus(next);
      setError(null);
      return next;
    } catch (err) {
      const next = statusFromError(err);
      setStatus(next);
      setError(err);
      return next;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ask = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Always request explicitly so Android shows the system dialog when possible.
      console.info("[HRMS:geo] Allow/Try again tapped — calling requestPermission()");
      const next = await requestPermission();
      setStatus(next);
      return next;
    } catch (err) {
      console.info("[HRMS:geo] Allow/Try again failed", {
        code: err?.code,
        message: String(err?.message || "").slice(0, 160),
      });
      setError(err);
      setStatus(statusFromError(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const readPosition = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const current = await checkPermission().catch((err) => statusFromError(err));
      if (current !== "granted") {
        await requestPermission();
      }
      const pos = await getCurrentPosition();
      setStatus("granted");
      return pos;
    } catch (err) {
      setError(err);
      setStatus(statusFromError(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, error, busy, refresh, ask, readPosition };
}
