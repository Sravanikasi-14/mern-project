import { useCallback, useEffect, useState } from "react";
import { checkPermission, getCurrentPosition, requestPermission } from "../services/location";

export default function useLocationPermission() {
  const [status, setStatus] = useState("unknown");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await checkPermission();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ask = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await requestPermission();
      setStatus(next);
      return next;
    } catch (err) {
      setError(err);
      setStatus(err.code === "PERMISSION_DENIED" ? "denied" : "error");
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const readPosition = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const pos = await getCurrentPosition();
      setStatus("granted");
      return pos;
    } catch (err) {
      setError(err);
      setStatus(err.code === "PERMISSION_DENIED" ? "denied" : "error");
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, error, busy, refresh, ask, readPosition };
}
